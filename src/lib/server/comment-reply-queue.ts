import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";
import { readAllRows } from "./paged-read";
import {
  getValidAccessToken,
  isYoutubeTokenRefreshReauthError,
  normalizeYoutubeConnectionRow,
} from "./youtube-tokens";
import {
  postYoutubeCommentReply,
  YoutubeInsufficientScopeError,
  YoutubeQuotaExceededError,
  type YoutubeCommentSummary,
} from "./google-oauth";
import {
  generateCommentReply,
  getActiveProviderInfo,
  type CommentReplyInput,
} from "./ai-generation";
import { recordAiUsage } from "./ai-usage";
import { loadVideoReplyContext, type VideoReplyContext } from "./comment-reply-context";

// The Comment Automation reply queue (table comment_reply_jobs).
//
// A bulk auto-reply is queued here instead of being sent from the browser. The server sends
// queued replies in small, paced batches, within two limits:
//
//   * a per-workspace daily cap on sent replies, so one creator cannot spend the YouTube quota
//     every Tubify user shares (YouTube's quota belongs to the app's Google project), and
//   * a reserve of that app-wide daily quota that replies never touch, so channel syncs and page
//     loads keep working however many replies are queued.
//
// Whatever does not fit today stays queued and goes out on following days (a daily cron, and the
// Comment Automation page while it is open). A comment is queued at most once (unique per channel
// and comment), a comment already replied to is never replied to again, and a reply is recorded
// once (a unique index on sent replies).
//
// Every function here takes the service-role client and acts only on the workspace / channel it
// is given: callers authorize first (requireWorkspaceFeature, the channel lookup through the
// caller's own RLS-scoped client).

export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;
/** comments.insert costs 50 units. */
export const REPLY_QUOTA_UNITS = 50;
/** Units of the app-wide daily quota that replies never use (syncs, page loads). */
export const QUOTA_RESERVE_UNITS = 2_000;
export const DEFAULT_WORKSPACE_DAILY_REPLY_CAP = 100;
/** Replies sent per processing call, and the pause between them (paced, not a burst). */
export const BATCH_SIZE = 4;
export const PACE_MS = 800;
/** A job claimed this long ago without finishing is returned to the queue. */
export const STALE_CLAIM_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
/** At most this many jobs are queued per request. */
export const MAX_QUEUE_PER_REQUEST = 2_000;
/** One processing call stops starting new replies after this long (AI replies take seconds each). */
export const PROCESS_TIME_BUDGET_MS = 25_000;
/** The ai_usage task an AI-written queued reply is recorded under. */
export const AI_QUEUE_TASK = "comment_reply_auto";

export type JobStatus = "queued" | "sending" | "sent" | "failed" | "skipped";
export type QueuePause = "daily_limit" | "quota" | "reconnect" | null;
/** "text": reply_text is posted as is. "ai": reply_text is the intent; AI writes the reply when it is sent. */
export type ReplyMode = "text" | "ai";

export class ReplyQueueError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ReplyQueueError";
  }
}

/** The per-workspace daily cap: COMMENT_REPLY_DAILY_CAP (1–1000) or the default. */
export function workspaceDailyReplyCap(): number {
  const raw = Number(getServerEnv("COMMENT_REPLY_DAILY_CAP"));
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : DEFAULT_WORKSPACE_DAILY_REPLY_CAP;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface ReplyAllowance {
  dailyCap: number;
  sentToday: number;
  /** Replies this workspace may still send today under its cap. */
  workspaceRemaining: number;
  /** Replies the app-wide quota still allows today, after the reserve. */
  quotaRemainingReplies: number;
  /** What can actually be sent today: the smaller of the two. */
  remaining: number;
}

const unwrap = <T>(result: { data: T | null; error: { code?: string } | null }): T => {
  if (result.error) throw new ReplyQueueError("DATABASE_ERROR");
  return result.data as T;
};

async function workspaceChannelIds(service: SupabaseClient, workspaceId: string) {
  const rows = unwrap(
    await service.from("youtube_channels").select("id").eq("workspace_id", workspaceId),
  ) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export async function replyAllowance(
  service: SupabaseClient,
  workspaceId: string,
  now: Date,
): Promise<ReplyAllowance> {
  const day = startOfUtcDay(now).toISOString();
  const channelIds = await workspaceChannelIds(service, workspaceId);
  let sentToday = 0;
  if (channelIds.length) {
    const { count, error } = await service
      .from("comment_automation_replies")
      .select("id", { count: "exact", head: true })
      .in("channel_id", channelIds)
      .eq("status", "sent")
      .gte("created_at", day);
    if (error) throw new ReplyQueueError("DATABASE_ERROR");
    sentToday = count ?? 0;
  }
  // Every unit any Tubify user spent today: the quota is the app's, not the workspace's.
  let used = 0;
  try {
    const events = await readAllRows<{ quota_units: number }>((from, to) =>
      service
        .from("youtube_quota_events")
        .select("id, quota_units")
        .eq("succeeded", true)
        .gte("created_at", day)
        .order("id")
        .range(from, to),
    );
    used = events.reduce((sum, row) => sum + Number(row.quota_units ?? 0), 0);
  } catch {
    throw new ReplyQueueError("DATABASE_ERROR");
  }
  const dailyCap = workspaceDailyReplyCap();
  const workspaceRemaining = Math.max(0, dailyCap - sentToday);
  const quotaRemainingReplies = Math.max(
    0,
    Math.floor((YOUTUBE_DAILY_QUOTA_UNITS - QUOTA_RESERVE_UNITS - used) / REPLY_QUOTA_UNITS),
  );
  return {
    dailyCap,
    sentToday,
    workspaceRemaining,
    quotaRemainingReplies,
    remaining: Math.min(workspaceRemaining, quotaRemainingReplies),
  };
}

// ---------- queueing ----------

export interface QueueItem {
  /** The comment as YouTube reported it (never as a browser described it). */
  comment: YoutubeCommentSummary;
  /** The reply to post ("text"), or the creator's intent for it ("ai"). */
  replyText: string;
  ruleId: string | null;
  mode?: ReplyMode;
}

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );

/**
 * Queues replies to comments on one channel of one workspace. A comment already replied to is
 * skipped; one already queued (or sending, or sent) keeps its job; one whose earlier job failed or
 * was cancelled is queued again with the new reply.
 */
export async function enqueueReplies(
  service: SupabaseClient,
  input: { workspaceId: string; channelId: string; createdBy: string; items: QueueItem[] },
): Promise<{ queued: number; alreadyReplied: number; alreadyQueued: number }> {
  const items = input.items.slice(0, MAX_QUEUE_PER_REQUEST);
  const ids = [...new Set(items.map((item) => item.comment.id))];
  const replied = new Set<string>();
  const existing = new Map<string, JobStatus>();
  for (const part of chunks(ids, 200)) {
    const sent = unwrap(
      await service
        .from("comment_automation_replies")
        .select("youtube_comment_id")
        .eq("channel_id", input.channelId)
        .eq("status", "sent")
        .in("youtube_comment_id", part),
    ) as Array<{ youtube_comment_id: string }>;
    for (const row of sent) replied.add(row.youtube_comment_id);
    const jobs = unwrap(
      await service
        .from("comment_reply_jobs")
        .select("youtube_comment_id, status")
        .eq("channel_id", input.channelId)
        .in("youtube_comment_id", part),
    ) as Array<{ youtube_comment_id: string; status: JobStatus }>;
    for (const row of jobs) existing.set(row.youtube_comment_id, row.status);
  }

  let queued = 0;
  let alreadyReplied = 0;
  let alreadyQueued = 0;
  const fresh: Array<Record<string, unknown>> = [];
  const requeue: QueueItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = item.comment.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (replied.has(id)) {
      alreadyReplied += 1;
      continue;
    }
    const status = existing.get(id);
    if (status === "queued" || status === "sending" || status === "sent") {
      alreadyQueued += 1;
      continue;
    }
    if (status === "failed" || status === "skipped") {
      requeue.push(item);
      continue;
    }
    fresh.push({
      workspace_id: input.workspaceId,
      channel_id: input.channelId,
      created_by: input.createdBy,
      rule_id: item.ruleId,
      youtube_comment_id: id,
      youtube_video_id: item.comment.videoId,
      author_name: item.comment.authorName,
      author_channel_id: item.comment.authorChannelId,
      author_avatar_url: item.comment.authorAvatarUrl,
      comment_text: item.comment.text,
      reply_text: item.replyText,
      reply_mode: item.mode ?? "text",
      status: "queued",
      attempts: 0,
    });
  }
  for (const part of chunks(fresh, 200)) {
    const inserted = unwrap(
      await service
        .from("comment_reply_jobs")
        .upsert(part, { onConflict: "channel_id,youtube_comment_id", ignoreDuplicates: true })
        .select("id"),
    ) as Array<{ id: string }>;
    queued += inserted.length;
    alreadyQueued += part.length - inserted.length;
  }
  for (const item of requeue) {
    const updated = unwrap(
      await service
        .from("comment_reply_jobs")
        .update({
          status: "queued",
          reply_text: item.replyText,
          reply_mode: item.mode ?? "text",
          rule_id: item.ruleId,
          attempts: 0,
          last_error: null,
          claimed_at: null,
          created_by: input.createdBy,
        })
        .eq("channel_id", input.channelId)
        .eq("youtube_comment_id", item.comment.id)
        .in("status", ["failed", "skipped"])
        .select("id"),
    ) as Array<{ id: string }>;
    if (updated.length) queued += 1;
    else alreadyQueued += 1;
  }
  return { queued, alreadyReplied, alreadyQueued };
}

/** Cancels this channel's replies still waiting in the queue. */
export async function cancelQueued(
  service: SupabaseClient,
  workspaceId: string,
  channelId: string,
): Promise<number> {
  const rows = unwrap(
    await service
      .from("comment_reply_jobs")
      .update({ status: "skipped", last_error: "CANCELLED", claimed_at: null })
      .eq("workspace_id", workspaceId)
      .eq("channel_id", channelId)
      .eq("status", "queued")
      .select("id"),
  ) as Array<{ id: string }>;
  return rows.length;
}

// ---------- status ----------

export interface QueueStatus {
  counts: Record<JobStatus, number>;
  allowance: ReplyAllowance;
  /** Comments of this channel with a queued or in-flight reply. */
  pendingCommentIds: string[];
}

export async function queueStatus(
  service: SupabaseClient,
  workspaceId: string,
  channelId: string,
  now: Date,
): Promise<QueueStatus> {
  const statuses: JobStatus[] = ["queued", "sending", "sent", "failed", "skipped"];
  const counts = Object.fromEntries(
    await Promise.all(
      statuses.map(async (status) => {
        const { count, error } = await service
          .from("comment_reply_jobs")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("channel_id", channelId)
          .eq("status", status);
        if (error) throw new ReplyQueueError("DATABASE_ERROR");
        return [status, count ?? 0] as const;
      }),
    ),
  ) as Record<JobStatus, number>;
  const pending = unwrap(
    await service
      .from("comment_reply_jobs")
      .select("youtube_comment_id")
      .eq("workspace_id", workspaceId)
      .eq("channel_id", channelId)
      .in("status", ["queued", "sending"])
      .order("created_at")
      .limit(MAX_QUEUE_PER_REQUEST),
  ) as Array<{ youtube_comment_id: string }>;
  return {
    counts,
    allowance: await replyAllowance(service, workspaceId, now),
    pendingCommentIds: pending.map((row) => row.youtube_comment_id),
  };
}

// ---------- processing ----------

export interface ProcessDependencies {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Writes an AI reply (null: the comment should get no reply). Replaceable in tests. */
  writeReply?: (input: CommentReplyInput) => Promise<string | null>;
}

const defaultDependencies: ProcessDependencies = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** An AI reply could not be written: no provider, the provider failed, or no video details. */
class AiReplyError extends Error {
  constructor(
    readonly code: "AI_NOT_CONFIGURED" | "AI_REPLY_FAILED" | "VIDEO_CONTEXT_UNAVAILABLE",
  ) {
    super(code);
  }
}

export interface ProcessResult {
  sent: number;
  failed: number;
  skipped: number;
  paused: QueuePause;
}

type Job = {
  id: string;
  workspace_id: string;
  channel_id: string;
  created_by: string | null;
  rule_id: string | null;
  youtube_comment_id: string;
  youtube_video_id: string;
  author_name: string | null;
  author_channel_id: string | null;
  author_avatar_url: string | null;
  comment_text: string;
  reply_text: string;
  reply_mode: ReplyMode;
  attempts: number;
};

const JOB_COLUMNS =
  "id, workspace_id, channel_id, created_by, rule_id, youtube_comment_id, youtube_video_id, author_name, author_channel_id, author_avatar_url, comment_text, reply_text, reply_mode, attempts";

/**
 * Sends up to `maxReplies` of one workspace's queued replies (never more than today's allowance),
 * a few at a time with a pause between them. Stops early, leaving the rest queued, when the
 * workspace's cap or the quota reserve is reached, when YouTube reports its quota exhausted, or
 * when the channel needs reconnecting.
 */
export async function processWorkspaceQueue(
  service: SupabaseClient,
  workspaceId: string,
  maxReplies: number,
  dependencies: ProcessDependencies = defaultDependencies,
): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, failed: 0, skipped: 0, paused: null };
  const now = dependencies.now();
  const startedAt = Date.now();

  // A job claimed long ago (a crashed or timed-out run) goes back to the queue.
  unwrap(
    await service
      .from("comment_reply_jobs")
      .update({ status: "queued", claimed_at: null })
      .eq("workspace_id", workspaceId)
      .eq("status", "sending")
      .lt("claimed_at", new Date(now.getTime() - STALE_CLAIM_MS).toISOString())
      .select("id"),
  );

  const allowance = await replyAllowance(service, workspaceId, now);
  const budget = Math.min(maxReplies, allowance.remaining);
  if (budget <= 0) {
    result.paused = allowance.workspaceRemaining <= 0 ? "daily_limit" : "quota";
    return result;
  }

  type ChannelAccess = { token: string; youtubeChannelId: string };
  const tokens = new Map<string, ChannelAccess | null>();
  const tokenFor = async (channelId: string): Promise<ChannelAccess | null> => {
    if (tokens.has(channelId)) return tokens.get(channelId)!;
    const row = unwrap(
      await service
        .from("youtube_channels")
        .select(
          "id, youtube_channel_id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
        )
        .eq("id", channelId)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ) as {
      youtube_channel_id?: string;
      connection?: Parameters<typeof normalizeYoutubeConnectionRow>[0];
    } | null;
    const connection = normalizeYoutubeConnectionRow(row?.connection);
    const token = connection ? await getValidAccessToken(service, connection) : null;
    const access =
      token && row?.youtube_channel_id ? { token, youtubeChannelId: row.youtube_channel_id } : null;
    tokens.set(channelId, access);
    return access;
  };

  // AI mode: the reply is written now, for this one comment, from the video's own details
  // (loaded once per video per run, and only for the job's own channel).
  const contexts = new Map<string, VideoReplyContext | null>();
  const writeAiReply = async (job: Job, channel: ChannelAccess): Promise<string | null> => {
    const provider = getActiveProviderInfo();
    if (!provider && !dependencies.writeReply) throw new AiReplyError("AI_NOT_CONFIGURED");
    const key = `${job.channel_id}:${job.youtube_video_id}`;
    if (!contexts.has(key))
      contexts.set(
        key,
        await loadVideoReplyContext(service, {
          channelId: job.channel_id,
          youtubeChannelId: channel.youtubeChannelId,
          youtubeVideoId: job.youtube_video_id,
          accessToken: channel.token,
        }),
      );
    const context = contexts.get(key);
    if (!context) throw new AiReplyError("VIDEO_CONTEXT_UNAVAILABLE");
    const { channelName, ...video } = context;
    let text: string | null;
    try {
      text = await (dependencies.writeReply ?? generateCommentReply)({
        channelName,
        video,
        comment: { authorName: job.author_name, text: job.comment_text },
        guidance: job.reply_text,
      });
    } catch {
      throw new AiReplyError("AI_REPLY_FAILED");
    }
    if (provider)
      await recordAiUsage(service, {
        userId: job.created_by,
        provider: provider.provider,
        model: provider.model,
        task: AI_QUEUE_TASK,
      });
    return text;
  };
  const setJob = async (id: string, fields: Record<string, unknown>) =>
    unwrap(await service.from("comment_reply_jobs").update(fields).eq("id", id).select("id"));

  let attempted = 0;
  while (attempted < budget) {
    if (Date.now() - startedAt > PROCESS_TIME_BUDGET_MS) break;
    const next = unwrap(
      await service
        .from("comment_reply_jobs")
        .select(JOB_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
        .order("created_at")
        .limit(1),
    ) as Job[];
    const candidate = next[0];
    if (!candidate) break;
    // Claim it: only the run that moves it out of "queued" sends it.
    const claimed = unwrap(
      await service
        .from("comment_reply_jobs")
        .update({
          status: "sending",
          claimed_at: dependencies.now().toISOString(),
          attempts: candidate.attempts + 1,
        })
        .eq("id", candidate.id)
        .eq("status", "queued")
        .select(JOB_COLUMNS),
    ) as Job[];
    const job = claimed[0];
    if (!job) continue;
    attempted += 1;

    // Never reply twice: a reply may have been sent another way since this was queued.
    const { count: alreadySent, error: sentError } = await service
      .from("comment_automation_replies")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", job.channel_id)
      .eq("youtube_comment_id", job.youtube_comment_id)
      .eq("status", "sent");
    if (sentError) throw new ReplyQueueError("DATABASE_ERROR");
    if ((alreadySent ?? 0) > 0) {
      await setJob(job.id, { status: "skipped", last_error: "ALREADY_REPLIED", claimed_at: null });
      result.skipped += 1;
      continue;
    }

    try {
      const channel = await tokenFor(job.channel_id);
      if (!channel) {
        await setJob(job.id, {
          status: "failed",
          last_error: "CHANNEL_DISCONNECTED",
          claimed_at: null,
        });
        result.failed += 1;
        continue;
      }
      let replyText = job.reply_text;
      if (job.reply_mode === "ai") {
        const written = await writeAiReply(job, channel);
        if (!written) {
          // The AI judged the comment spam or abuse: no reply, and nothing spent on YouTube.
          await setJob(job.id, { status: "skipped", last_error: "AI_SKIPPED", claimed_at: null });
          result.skipped += 1;
          continue;
        }
        replyText = written;
      }
      await postYoutubeCommentReply(channel.token, job.youtube_comment_id, replyText);
      const recorded = await service.from("comment_automation_replies").insert({
        channel_id: job.channel_id,
        rule_id: job.rule_id,
        youtube_comment_id: job.youtube_comment_id,
        youtube_video_id: job.youtube_video_id,
        author_name: job.author_name,
        comment_text: job.comment_text,
        reply_text: replyText,
        status: "sent",
      });
      // 23505: a reply to this comment was recorded at the same moment another way — still sent.
      if (recorded.error && recorded.error.code !== "23505")
        throw new ReplyQueueError("DATABASE_ERROR");
      await setJob(job.id, {
        status: "sent",
        reply_text: replyText,
        sent_at: dependencies.now().toISOString(),
        last_error: null,
        claimed_at: null,
      });
      await service.from("youtube_quota_events").insert({
        user_id: job.created_by,
        channel_id: job.channel_id,
        operation: "comments.insert",
        quota_units: REPLY_QUOTA_UNITS,
        succeeded: true,
      });
      await upsertLeadForReply(service, job.created_by, workspaceId, {
        authorName: job.author_name,
        authorChannelId: job.author_channel_id,
        authorAvatarUrl: job.author_avatar_url,
        commentText: job.comment_text,
        replyText,
      });
      result.sent += 1;
      if (attempted < budget) await dependencies.sleep(PACE_MS);
    } catch (error) {
      if (error instanceof ReplyQueueError) throw error;
      if (error instanceof YoutubeQuotaExceededError) {
        // Not this reply's fault: back in the queue, without spending an attempt.
        await setJob(job.id, { status: "queued", claimed_at: null, attempts: job.attempts - 1 });
        result.paused = "quota";
        break;
      }
      if (
        error instanceof YoutubeInsufficientScopeError ||
        isYoutubeTokenRefreshReauthError(error)
      ) {
        await setJob(job.id, { status: "queued", claimed_at: null, attempts: job.attempts - 1 });
        result.paused = "reconnect";
        break;
      }
      if (error instanceof AiReplyError && error.code === "AI_NOT_CONFIGURED") {
        // Nothing this job can fix: it (and the rest) stay queued until AI is available again.
        await setJob(job.id, { status: "queued", claimed_at: null, attempts: job.attempts - 1 });
        break;
      }
      const giveUp = job.attempts >= MAX_ATTEMPTS;
      await setJob(job.id, {
        status: giveUp ? "failed" : "queued",
        last_error: error instanceof AiReplyError ? error.code : "YOUTUBE_COMMENT_REPLY_FAILED",
        claimed_at: null,
      });
      if (giveUp) result.failed += 1;
    }
  }
  if (!result.paused && attempted >= budget && budget === allowance.remaining) {
    // The day's allowance is used up; anything still queued waits for tomorrow.
    const { count } = await service
      .from("comment_reply_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "queued");
    if ((count ?? 0) > 0)
      result.paused =
        allowance.remaining === allowance.workspaceRemaining ? "daily_limit" : "quota";
  }
  return result;
}

/** The daily cron: every workspace with queued replies, within each one's allowance. */
export async function processAllQueues(
  service: SupabaseClient,
  options: { maxTotal: number; timeBudgetMs: number },
  dependencies: ProcessDependencies = defaultDependencies,
): Promise<{ workspaces: number; sent: number; failed: number }> {
  const started = Date.now();
  const rows = unwrap(
    await service
      .from("comment_reply_jobs")
      .select("workspace_id")
      .eq("status", "queued")
      .order("created_at")
      .limit(1000),
  ) as Array<{ workspace_id: string }>;
  const workspaces = [...new Set(rows.map((row) => row.workspace_id))];
  let sent = 0;
  let failed = 0;
  let visited = 0;
  for (const workspaceId of workspaces) {
    if (sent >= options.maxTotal || Date.now() - started > options.timeBudgetMs) break;
    visited += 1;
    try {
      const result = await processWorkspaceQueue(
        service,
        workspaceId,
        Math.min(BATCH_SIZE * 5, options.maxTotal - sent),
        dependencies,
      );
      sent += result.sent;
      failed += result.failed;
      if (result.paused === "quota") break; // the app-wide quota is shared: stop everyone
    } catch {
      // One workspace's failure never stops the others.
    }
  }
  return { workspaces: visited, sent, failed };
}

// ---------- leads ----------

// Real lead capture for a real sent reply — the commenter's stable YouTube channel id is used to
// recognize the same person across multiple comments instead of creating a duplicate lead each
// time. Every read and write is scoped to the given workspace. Best-effort: the YouTube reply
// itself already succeeded by the time this runs, so a failure here is swallowed rather than
// surfaced as a reply failure.
export async function upsertLeadForReply(
  client: SupabaseClient,
  userId: string | null,
  workspaceId: string,
  input: {
    authorName: string | null;
    authorChannelId: string | null;
    authorAvatarUrl: string | null;
    commentText: string;
    replyText: string;
  },
): Promise<void> {
  const username = input.authorChannelId ?? input.authorName;
  if (!username) return;
  try {
    const { data: existing } = await client
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("platform", "YouTube Comment")
      .eq("username", username)
      .maybeSingle();

    let leadId: string;
    if (existing) {
      leadId = existing.id as string;
    } else {
      const { data: created, error } = await client
        .from("leads")
        .insert({
          user_id: userId,
          workspace_id: workspaceId,
          name: input.authorName ?? "YouTube commenter",
          platform: "YouTube Comment",
          username,
          avatar_url: input.authorAvatarUrl,
          source: input.commentText,
          unread: true,
        })
        .select("id")
        .single();
      if (error || !created) return;
      leadId = created.id as string;
    }

    await client.from("lead_messages").insert([
      { lead_id: leadId, from_who: "lead", kind: "comment", text: input.commentText },
      { lead_id: leadId, from_who: "you", kind: "comment", text: input.replyText },
    ]);
    await client
      .from("leads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", leadId)
      .eq("workspace_id", workspaceId);
  } catch {
    // Lead tracking is a bonus on top of a reply that already succeeded — never fail over it.
  }
}
