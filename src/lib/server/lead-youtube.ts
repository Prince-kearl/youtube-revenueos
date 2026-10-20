import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchChannelCommentsPage,
  fetchCommentReplies,
  fetchCommentThreadsByIds,
  postYoutubeCommentReply,
  type YoutubeCommentSummary,
} from "./google-oauth";
import { REPLY_QUOTA_UNITS, replyAllowance } from "./comment-reply-queue";

// Lead Inbox ↔ YouTube: a conversation with a commenter, held where YouTube allows it — in public,
// in the threads of the lead's own comments on the workspace's channel (YouTube has no private
// messages for channels).
//
//   * receive (syncLeadConversation): the lead's comments on the channel (the newest page of the
//     channel's comments, plus threads already known for this lead) and every reply in those
//     threads written by the lead or by the channel, added to the conversation once each;
//   * send (sendLeadReply): a public reply in the lead's newest thread (or a thread of theirs the
//     caller names), within the workspace's daily reply allowance.
//
// Every thread is confirmed WITH YOUTUBE to be on the caller's channel and to have been started by
// this lead (their YouTube channel id) before anything is read from or posted to it. Callers pass
// a lead already authorized through the caller's own workspace (loadYoutubeLead) and the caller's
// own channel; every write here is scoped to that lead.

/** A YouTube channel id, which is what a YouTube lead's username holds. */
export const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
/** Threads read per sync (the newest). */
export const MAX_SYNC_THREADS = 5;
/** One sync per lead per this long; a quicker repeat answers from what is stored. */
export const SYNC_INTERVAL_MS = 20_000;
/** Lead syncs per workspace per UTC day (each reads a few units of the shared quota). */
export const DAILY_SYNC_CAP = 300;
/** The quota event a reply sent from the Lead Inbox is recorded as (counted in the daily cap). */
export const LEAD_REPLY_OPERATION = "lead.reply";
const SYNC_OPERATION = "lead.sync";

export class LeadYoutubeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export interface YoutubeLead {
  id: string;
  workspaceId: string;
  name: string | null;
  authorChannelId: string;
}

export interface LeadChannel {
  id: string;
  youtubeChannelId: string;
}

/** The lead through the caller's RLS-scoped client: theirs, in their workspace, from YouTube. */
export async function loadYoutubeLead(
  client: SupabaseClient,
  workspaceId: string,
  leadId: string,
): Promise<YoutubeLead> {
  const { data, error } = await client
    .from("leads")
    .select("id, workspace_id, name, platform, username")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new LeadYoutubeError("DATABASE_ERROR", 500);
  if (!data || data.workspace_id !== workspaceId) throw new LeadYoutubeError("NOT_FOUND", 404);
  const username = String(data.username ?? "");
  if (data.platform !== "YouTube Comment" || !YOUTUBE_CHANNEL_ID.test(username))
    throw new LeadYoutubeError("NOT_A_YOUTUBE_LEAD", 409);
  return {
    id: data.id as string,
    workspaceId,
    name: (data.name as string | null) ?? null,
    authorChannelId: username,
  };
}

type MessageRow = {
  id: string;
  from_who: "lead" | "you" | "system";
  kind: string;
  text: string;
  youtube_comment_id: string | null;
  youtube_thread_id: string | null;
  channel_id: string | null;
};

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();

async function leadMessages(service: SupabaseClient, leadId: string): Promise<MessageRow[]> {
  const { data, error } = await service
    .from("lead_messages")
    .select("id, from_who, kind, text, youtube_comment_id, youtube_thread_id, channel_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new LeadYoutubeError("DATABASE_ERROR", 500);
  return (data ?? []) as MessageRow[];
}

/**
 * Thread ids this lead is known to have started on the channel, newest first: from the
 * conversation, and from Comment Automation's records of their comments.
 */
async function knownThreadIds(
  service: SupabaseClient,
  lead: YoutubeLead,
  channel: LeadChannel,
  messages: MessageRow[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const m of messages)
    if (m.youtube_thread_id && (m.channel_id === null || m.channel_id === channel.id))
      ids.push(m.youtube_thread_id);
  const { data: jobs } = await service
    .from("comment_reply_jobs")
    .select("youtube_comment_id")
    .eq("workspace_id", lead.workspaceId)
    .eq("channel_id", channel.id)
    .eq("author_channel_id", lead.authorChannelId)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const j of jobs ?? []) ids.push(j.youtube_comment_id as string);
  // Replies recorded before threads were stored: matched by the lead's comment text.
  const texts = messages
    .filter((m) => m.from_who === "lead" && m.kind === "comment" && !m.youtube_thread_id)
    .map((m) => m.text)
    .slice(0, 20);
  if (texts.length) {
    const { data: replies } = await service
      .from("comment_automation_replies")
      .select("youtube_comment_id")
      .eq("channel_id", channel.id)
      .in("comment_text", texts)
      .order("created_at", { ascending: false })
      .limit(20);
    for (const r of replies ?? []) ids.push(r.youtube_comment_id as string);
  }
  return [...new Set(ids)];
}

async function recordQuota(
  service: SupabaseClient,
  userId: string,
  channelId: string,
  operation: string,
  units: number,
) {
  await service.from("youtube_quota_events").insert({
    user_id: userId,
    channel_id: channelId,
    operation,
    quota_units: units,
    succeeded: true,
  });
}

/** The lead's threads on the channel, confirmed with YouTube, newest first. */
async function verifiedThreads(
  token: string,
  lead: YoutubeLead,
  channel: LeadChannel,
  candidateIds: string[],
): Promise<YoutubeCommentSummary[]> {
  if (!candidateIds.length) return [];
  const threads = await fetchCommentThreadsByIds(token, candidateIds.slice(0, 50));
  return threads
    .filter(
      (t) => t.channelId === channel.youtubeChannelId && t.authorChannelId === lead.authorChannelId,
    )
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

export interface SyncResult {
  /** Messages added to the conversation by this sync. */
  added: number;
  /** False when this sync was skipped (too soon after the last one). */
  synced: boolean;
}

/** Brings the lead's comments and replies (and the channel's replies to them) into the inbox. */
export async function syncLeadConversation(
  service: SupabaseClient,
  input: { userId: string; lead: YoutubeLead; channel: LeadChannel; token: string; now?: Date },
): Promise<SyncResult> {
  const { lead, channel, token } = input;
  const now = input.now ?? new Date();

  // Throttle: one sync per lead per SYNC_INTERVAL_MS, and DAILY_SYNC_CAP per workspace a day.
  const { data: workspaceChannels } = await service
    .from("youtube_channels")
    .select("id")
    .eq("workspace_id", lead.workspaceId);
  const channelIds = (workspaceChannels ?? []).map((c) => c.id as string);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [{ data: last }, { count: today }] = await Promise.all([
    service
      .from("youtube_quota_events")
      .select("created_at")
      .eq("operation", `${SYNC_OPERATION}:${lead.id}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("youtube_quota_events")
      .select("id", { count: "exact", head: true })
      .in("channel_id", channelIds.length ? channelIds : [channel.id])
      .like("operation", `${SYNC_OPERATION}:%`)
      .gte("created_at", day.toISOString()),
  ]);
  if (last && now.getTime() - new Date(last.created_at as string).getTime() < SYNC_INTERVAL_MS)
    return { added: 0, synced: false };
  if ((today ?? 0) >= DAILY_SYNC_CAP) throw new LeadYoutubeError("DAILY_SYNC_LIMIT", 429);

  let units = 0;
  try {
    const messages = await leadMessages(service, lead.id);
    // The lead's newest comments anywhere on the channel (one page, newest first).
    units += 1;
    const page = await fetchChannelCommentsPage(token, channel.youtubeChannelId, null);
    const scanned = page.comments
      .filter((c) => c.authorChannelId === lead.authorChannelId)
      .map((c) => c.id);
    const known = await knownThreadIds(service, lead, channel, messages);
    const candidates = [...new Set([...scanned, ...known])];
    units += Math.ceil(Math.min(candidates.length, 50) / 50);
    const threads = (await verifiedThreads(token, lead, channel, candidates)).slice(
      0,
      MAX_SYNC_THREADS,
    );

    type Incoming = {
      youtubeCommentId: string;
      threadId: string;
      fromWho: "lead" | "you";
      text: string;
      at: string | null;
    };
    const incoming: Incoming[] = [];
    for (const thread of threads) {
      incoming.push({
        youtubeCommentId: thread.id,
        threadId: thread.id,
        fromWho: "lead",
        text: thread.text,
        at: thread.publishedAt,
      });
      if ((thread.replyCount ?? 1) === 0) continue;
      units += 1;
      const { replies } = await fetchCommentReplies(token, thread.id, 1);
      for (const reply of replies) {
        const fromWho =
          reply.authorChannelId === lead.authorChannelId
            ? "lead"
            : reply.authorChannelId === channel.youtubeChannelId
              ? "you"
              : null;
        if (!fromWho || !reply.text) continue;
        incoming.push({
          youtubeCommentId: reply.id,
          threadId: thread.id,
          fromWho,
          text: reply.text,
          at: reply.publishedAt,
        });
      }
    }

    const byYoutubeId = new Set(messages.map((m) => m.youtube_comment_id).filter(Boolean));
    // Rows recorded before YouTube ids were kept: matched once by sender and text.
    const unlinked = messages.filter((m) => m.kind === "comment" && !m.youtube_comment_id);
    let added = 0;
    let addedFromLead = 0;
    for (const item of incoming) {
      if (byYoutubeId.has(item.youtubeCommentId)) continue;
      byYoutubeId.add(item.youtubeCommentId);
      const match = unlinked.findIndex(
        (m) => m.from_who === item.fromWho && normalized(m.text) === normalized(item.text),
      );
      const ids = {
        channel_id: channel.id,
        youtube_comment_id: item.youtubeCommentId,
        youtube_thread_id: item.threadId,
      };
      if (match >= 0) {
        const [row] = unlinked.splice(match, 1);
        await service
          .from("lead_messages")
          .update(ids)
          .eq("id", row.id)
          .eq("lead_id", lead.id)
          .is("youtube_comment_id", null);
        continue;
      }
      const { error } = await service.from("lead_messages").insert({
        lead_id: lead.id,
        from_who: item.fromWho,
        kind: "comment",
        text: item.text,
        ...ids,
        ...(item.at ? { created_at: item.at } : {}),
      });
      // 23505: added by a sync running at the same moment.
      if (error && error.code !== "23505") throw new LeadYoutubeError("DATABASE_ERROR", 500);
      if (!error) {
        added += 1;
        if (item.fromWho === "lead") addedFromLead += 1;
      }
    }
    if (added)
      await service
        .from("leads")
        .update({
          updated_at: now.toISOString(),
          ...(addedFromLead ? { unread: true } : {}),
        })
        .eq("id", lead.id)
        .eq("workspace_id", lead.workspaceId);
    return { added, synced: true };
  } finally {
    // Recorded even when YouTube failed part-way: the units were still spent, and the throttle
    // still applies.
    await recordQuota(service, input.userId, channel.id, `${SYNC_OPERATION}:${lead.id}`, units);
  }
}

/** Posts a public reply in the lead's thread and adds it to the conversation. */
export async function sendLeadReply(
  service: SupabaseClient,
  input: {
    userId: string;
    lead: YoutubeLead;
    channel: LeadChannel;
    token: string;
    text: string;
    /** One of the lead's threads; the newest when omitted. */
    threadId?: string | null;
  },
) {
  const { lead, channel, token } = input;
  const allowance = await replyAllowance(service, lead.workspaceId, new Date());
  if (allowance.remaining <= 0)
    throw new LeadYoutubeError(
      allowance.workspaceRemaining <= 0 ? "DAILY_REPLY_LIMIT" : "QUOTA_RESERVE_REACHED",
      429,
    );

  const messages = await leadMessages(service, lead.id);
  const candidates = input.threadId
    ? [input.threadId]
    : await knownThreadIds(service, lead, channel, messages);
  const lookupUnits = candidates.length ? 1 : 0;
  let replyAttempt: "none" | "failed" | "sent" = "none";
  try {
    const [thread] = await verifiedThreads(token, lead, channel, candidates);
    if (!thread) throw new LeadYoutubeError("NO_THREAD", 409);
    if (thread.canReply === false) throw new LeadYoutubeError("REPLIES_DISABLED", 409);
    replyAttempt = "failed";
    const posted = await postYoutubeCommentReply(token, thread.id, input.text);
    replyAttempt = "sent";
    const { data, error } = await service
      .from("lead_messages")
      .insert({
        lead_id: lead.id,
        from_who: "you",
        kind: "comment",
        text: input.text,
        channel_id: channel.id,
        youtube_comment_id: posted.id,
        youtube_thread_id: thread.id,
      })
      .select()
      .single();
    if (error) throw new LeadYoutubeError("DATABASE_ERROR", 500);
    await service
      .from("leads")
      .update({ updated_at: new Date().toISOString(), unread: false })
      .eq("id", lead.id)
      .eq("workspace_id", lead.workspaceId);
    return data;
  } finally {
    if (lookupUnits)
      await recordQuota(service, input.userId, channel.id, "commentThreads.list", lookupUnits);
    // A sent reply counts towards the workspace's daily reply cap (see replyAllowance); a failed
    // attempt still spent the quota.
    if (replyAttempt !== "none")
      await recordQuota(
        service,
        input.userId,
        channel.id,
        replyAttempt === "sent" ? LEAD_REPLY_OPERATION : "comments.insert.failed",
        REPLY_QUOTA_UNITS,
      );
  }
}
