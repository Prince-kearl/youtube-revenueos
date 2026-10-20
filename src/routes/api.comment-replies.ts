import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  getValidAccessToken,
  isYoutubeTokenRefreshReauthError,
  normalizeYoutubeConnectionRow,
} from "@/lib/server/youtube-tokens";
import {
  fetchChannelCommentsPage,
  fetchCommentThreadsByIds,
  type YoutubeCommentSummary,
} from "@/lib/server/google-oauth";
import {
  cancelQueued,
  enqueueReplies,
  queueStatus,
  ReplyQueueError,
  type QueueItem,
} from "@/lib/server/comment-reply-queue";
import {
  AI_DEFAULT_INTENT,
  GENERIC_REPLY,
  matchRule,
  personalizeReply,
} from "@/lib/comment-rule-match";
import { getActiveProviderInfo } from "@/lib/server/ai-generation";

// The Comment Automation reply queue (see lib/server/comment-reply-queue.ts).
//
//   GET     progress and today's allowance for the caller's channel
//   POST    queue replies: { mode: "selected", items } or { mode: "all" }; with ai: true each
//           reply is written by AI for its own comment when it is sent
//   DELETE  cancel this channel's replies still waiting
//
// Every request is the caller's own: Comment Automation must be enabled for their workspace role,
// the channel is looked up through their RLS-scoped client and must belong to their workspace, and
// every queued comment is confirmed with YouTube to be on that channel — a comment id from
// anywhere else is never queued, whatever the request says. Reply text is validated and the
// commenter's name, text and video come from YouTube, never from the request.

const COMMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** "All on YouTube" reads at most this many pages of 100 comments per request. */
const MAX_ALL_PAGES = 20;

const queueSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("selected"),
      items: z
        .array(
          z
            .object({
              youtubeCommentId: z.string().regex(COMMENT_ID),
              replyText: z.string().trim().min(1).max(10_000),
              ruleId: z.string().uuid().nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(500),
      ai: z.boolean().optional(),
    })
    .strict(),
  z.object({ mode: z.literal("all"), ai: z.boolean().optional() }).strict(),
]);

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

type Client = Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"];

/** The caller's channel (their RLS-scoped view), which must be in their workspace. */
async function ownedChannel(client: Client, workspaceId: string, requestedId: string | null) {
  let query = client
    .from("youtube_channels")
    .select("id, youtube_channel_id, workspace_id")
    .not("connection_id", "is", null)
    .order("connected_at", { ascending: false });
  if (requestedId) query = query.eq("id", requestedId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data || data.workspace_id !== workspaceId)
    throw json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
  return { id: data.id as string, youtubeChannelId: data.youtube_channel_id as string };
}

async function accessTokenFor(channelId: string) {
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from("youtube_channels")
    .select(
      "id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
    )
    .eq("id", channelId)
    .single();
  const connection = normalizeYoutubeConnectionRow(data?.connection);
  if (error || !connection) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return { service, token: await getValidAccessToken(service, connection) };
}

/** The channel's active rules, matched exactly as the Comment Automation page matches them. */
async function channelRules(client: Client, channelId: string) {
  const { data: rules, error } = await client
    .from("comment_automation_rules")
    .select("id, active, trigger_type, keywords, reply_template, video_id")
    .eq("channel_id", channelId);
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  const videoIds = [...new Set((rules ?? []).map((r) => r.video_id).filter(Boolean))] as string[];
  const videoIdByRuleVideoId = new Map<string, string>();
  if (videoIds.length) {
    const { data: videos, error: videosError } = await client
      .from("videos")
      .select("id, youtube_video_id")
      .in("id", videoIds);
    if (videosError) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
    for (const v of videos ?? [])
      videoIdByRuleVideoId.set(v.id as string, v.youtube_video_id as string);
  }
  return {
    rules: (rules ?? []).map((r) => ({
      id: r.id as string,
      active: Boolean(r.active),
      trigger_type: r.trigger_type as "keyword" | "handle" | "question",
      keywords: (r.keywords as string[]) ?? [],
      reply_template: r.reply_template as string,
      video: r.video_id ? { id: r.video_id as string } : null,
    })),
    videoIdByRuleVideoId,
  };
}

export const Route = createFileRoute("/api/comment-replies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const channel = await ownedChannel(
            client,
            workspaceId,
            new URL(request.url).searchParams.get("channelId"),
          );
          const status = await queueStatus(
            createServiceSupabaseClient(),
            workspaceId,
            channel.id,
            new Date(),
          );
          return json({ data: { ...status, aiAvailable: getActiveProviderInfo() !== null } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof ReplyQueueError)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const channel = await ownedChannel(
            client,
            workspaceId,
            new URL(request.url).searchParams.get("channelId"),
          );
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ error: "INVALID_JSON" }, { status: 400 });
          }
          const parsed = queueSchema.safeParse(body);
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const input = parsed.data;
          // AI mode: each reply is written for its own comment when it is sent; the text queued
          // now is only the intent (the rule's template), never posted as is.
          const ai = input.ai === true;
          if (ai && !getActiveProviderInfo())
            return json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });

          const { service, token } = await accessTokenFor(channel.id);
          const items: QueueItem[] = [];
          let quotaUnits = 0;
          let notOnChannel = 0;
          let truncated = false;

          if (input.mode === "selected") {
            // Confirm each comment with YouTube: it exists, is on THIS channel, and can be replied to.
            const ids = [...new Set(input.items.map((item) => item.youtubeCommentId))];
            const threads = await fetchCommentThreadsByIds(token, ids);
            quotaUnits += Math.ceil(ids.length / 50);
            const owned = new Map<string, YoutubeCommentSummary>();
            for (const thread of threads)
              if (thread.channelId === channel.youtubeChannelId && thread.canReply !== false)
                owned.set(thread.id, thread);
            notOnChannel = ids.length - owned.size;
            // A rule id is kept only if it is one of this channel's rules.
            const ruleIds = [
              ...new Set(input.items.map((item) => item.ruleId).filter(Boolean)),
            ] as string[];
            const validRules = new Set<string>();
            if (ruleIds.length) {
              const { data, error } = await client
                .from("comment_automation_rules")
                .select("id")
                .eq("channel_id", channel.id)
                .in("id", ruleIds);
              if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
              for (const row of data ?? []) validRules.add(row.id as string);
            }
            for (const item of input.items) {
              const comment = owned.get(item.youtubeCommentId);
              if (!comment) continue;
              items.push({
                comment,
                replyText: ai
                  ? item.replyText
                  : personalizeReply(item.replyText, comment.authorName),
                ruleId: item.ruleId && validRules.has(item.ruleId) ? item.ruleId : null,
                mode: ai ? "ai" : "text",
              });
            }
          } else {
            // Every comment on every video of the channel, newest first, a page of 100 at a time.
            const { rules, videoIdByRuleVideoId } = await channelRules(client, channel.id);
            let pageToken: string | null = null;
            for (let page = 0; page < MAX_ALL_PAGES; page += 1) {
              const result = await fetchChannelCommentsPage(
                token,
                channel.youtubeChannelId,
                pageToken,
              );
              quotaUnits += 1;
              for (const comment of result.comments) {
                if (comment.canReply === false) continue;
                const rule = matchRule(comment, rules, videoIdByRuleVideoId);
                items.push({
                  comment,
                  replyText: ai
                    ? (rule?.reply_template ?? AI_DEFAULT_INTENT)
                    : personalizeReply(rule?.reply_template ?? GENERIC_REPLY, comment.authorName),
                  ruleId: rule?.id ?? null,
                  mode: ai ? "ai" : "text",
                });
              }
              pageToken = result.nextPageToken;
              if (!pageToken) break;
            }
            truncated = pageToken !== null;
          }

          await service.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "commentThreads.list",
            quota_units: quotaUnits,
            succeeded: true,
          });

          const outcome = await enqueueReplies(service, {
            workspaceId,
            channelId: channel.id,
            createdBy: user.id,
            items,
          });
          const status = await queueStatus(service, workspaceId, channel.id, new Date());
          return json({ data: { ...outcome, notOnChannel, truncated, status } }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof ReplyQueueError)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (isYoutubeTokenRefreshReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          console.error("Queueing comment replies failed");
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },

      DELETE: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const channel = await ownedChannel(
            client,
            workspaceId,
            new URL(request.url).searchParams.get("channelId"),
          );
          const cancelled = await cancelQueued(
            createServiceSupabaseClient(),
            workspaceId,
            channel.id,
          );
          return json({ data: { cancelled } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof ReplyQueueError)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
