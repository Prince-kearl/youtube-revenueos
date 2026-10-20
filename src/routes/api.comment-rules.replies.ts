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
  fetchCommentThreadsByIds,
  postYoutubeCommentReply,
  YoutubeInsufficientScopeError,
  YoutubeQuotaExceededError,
} from "@/lib/server/google-oauth";
import {
  REPLY_QUOTA_UNITS,
  replyAllowance,
  upsertLeadForReply,
} from "@/lib/server/comment-reply-queue";
import { personalizeReply } from "@/lib/comment-rule-match";

const replySchema = z.object({
  ruleId: z.string().uuid().nullable().optional(),
  youtubeCommentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  youtubeVideoId: z.string().min(1),
  authorName: z.string().nullable().optional(),
  authorChannelId: z.string().nullable().optional(),
  authorAvatarUrl: z.string().url().nullable().optional(),
  commentText: z.string().min(1).max(10_000),
  replyText: z.string().trim().min(1).max(10_000),
});

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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

type SupabaseClientLike = Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"];

async function findOwnedChannel(client: SupabaseClientLike, requestedId: string | null) {
  let query = client
    .from("youtube_channels")
    .select("id, youtube_channel_id, workspace_id")
    .not("connection_id", "is", null)
    .order("connected_at", { ascending: false });
  if (requestedId) query = query.eq("id", requestedId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
  return {
    id: data.id as string,
    youtubeChannelId: data.youtube_channel_id as string,
    workspaceId: data.workspace_id as string,
  };
}

export const Route = createFileRoute("/api/comment-rules/replies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const url = new URL(request.url);
          const channel = await findOwnedChannel(client, url.searchParams.get("channelId"));
          if (channel.workspaceId !== workspaceId)
            return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
          const channelId = channel.id;
          const limit = Math.min(Number(url.searchParams.get("limit") ?? "10") || 10, 50);
          const { data, error } = await client
            .from("comment_automation_replies")
            .select(
              "id, youtube_comment_id, youtube_video_id, author_name, comment_text, reply_text, status, created_at, rule:comment_automation_rules(id,name)",
            )
            .eq("channel_id", channelId)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          // Real counts via a proper DB query (not the `limit`-capped list above, which would
          // undercount for any channel with more than `limit` replies) — backs the Comment
          // Automation page's "Auto-replies" KPI trend card, comparing this 30-day window against
          // the one immediately before it.
          const now = Date.now();
          const dayMs = 24 * 60 * 60 * 1000;
          const last30Start = new Date(now - 30 * dayMs).toISOString();
          const prior30Start = new Date(now - 60 * dayMs).toISOString();
          const [last30, prior30] = await Promise.all([
            client
              .from("comment_automation_replies")
              .select("id", { count: "exact", head: true })
              .eq("channel_id", channelId)
              .eq("status", "sent")
              .gte("created_at", last30Start),
            client
              .from("comment_automation_replies")
              .select("id", { count: "exact", head: true })
              .eq("channel_id", channelId)
              .eq("status", "sent")
              .gte("created_at", prior30Start)
              .lt("created_at", last30Start),
          ]);

          return json({
            data,
            stats: { sentLast30d: last30.count ?? 0, sentPrior30d: prior30.count ?? 0 },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Posts a real, public reply to the comment on YouTube (comments.insert) — not a draft, not
      // a simulation. Before anything is sent:
      //   * the comment is confirmed with YouTube to be on the caller's own channel, and its text,
      //     author and video are taken from YouTube, never from the request;
      //   * a comment already replied to (or queued for a reply) is refused — never two replies;
      //   * the workspace's daily cap and the app-wide quota reserve must allow one more reply
      //     (the same limits as the reply queue, lib/server/comment-reply-queue.ts).
      // Failures are still logged (status: "failed") so they show up in the trigger history.
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const url = new URL(request.url);
          const channel = await findOwnedChannel(client, url.searchParams.get("channelId"));
          if (channel.workspaceId !== workspaceId)
            return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
          const channelId = channel.id;
          const input = replySchema.parse(await parseJson(request));
          const service = createServiceSupabaseClient();

          // Never two replies to one comment: sent already, or waiting in the queue.
          const [sent, queued] = await Promise.all([
            service
              .from("comment_automation_replies")
              .select("id", { count: "exact", head: true })
              .eq("channel_id", channelId)
              .eq("youtube_comment_id", input.youtubeCommentId)
              .eq("status", "sent"),
            service
              .from("comment_reply_jobs")
              .select("id", { count: "exact", head: true })
              .eq("channel_id", channelId)
              .eq("youtube_comment_id", input.youtubeCommentId)
              .in("status", ["queued", "sending", "sent"]),
          ]);
          if (sent.error || queued.error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if ((sent.count ?? 0) > 0) return json({ error: "ALREADY_REPLIED" }, { status: 409 });
          if ((queued.count ?? 0) > 0) return json({ error: "ALREADY_QUEUED" }, { status: 409 });

          // The same daily limits as the queue.
          const allowance = await replyAllowance(service, workspaceId, new Date());
          if (allowance.remaining <= 0)
            return json(
              {
                error:
                  allowance.workspaceRemaining <= 0 ? "DAILY_REPLY_LIMIT" : "QUOTA_RESERVE_REACHED",
              },
              { status: 429 },
            );

          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select(
              "id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
            )
            .eq("id", channelId)
            .single();
          const connection = normalizeYoutubeConnectionRow(secretRow?.connection);
          if (secretError || !connection) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          let verified: Awaited<ReturnType<typeof fetchCommentThreadsByIds>>[number] | undefined;
          let replyText = input.replyText;
          try {
            const accessToken = await getValidAccessToken(service, connection);
            // The comment must exist on THIS channel; a comment id from anywhere else is refused.
            [verified] = await fetchCommentThreadsByIds(accessToken, [input.youtubeCommentId]);
            if (!verified || verified.channelId !== channel.youtubeChannelId)
              return json({ error: "COMMENT_NOT_FOUND" }, { status: 404 });
            if (verified.canReply === false)
              return json({ error: "REPLIES_DISABLED" }, { status: 409 });
            replyText = personalizeReply(input.replyText, verified.authorName);

            const posted = await postYoutubeCommentReply(accessToken, verified.id, replyText);
            await service.from("youtube_quota_events").insert({
              user_id: user.id,
              channel_id: channelId,
              operation: "comments.insert",
              quota_units: REPLY_QUOTA_UNITS + 1, // the reply, and the lookup before it
              succeeded: true,
            });
            const { data, error } = await client
              .from("comment_automation_replies")
              .insert({
                channel_id: channelId,
                rule_id: input.ruleId ?? null,
                youtube_comment_id: verified.id,
                youtube_video_id: verified.videoId,
                author_name: verified.authorName,
                comment_text: verified.text,
                reply_text: replyText,
                status: "sent",
              })
              .select()
              .single();
            // 23505: a reply to this comment was recorded at the same moment another way.
            if (error?.code === "23505") return json({ error: "ALREADY_REPLIED" }, { status: 409 });
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            await upsertLeadForReply(client, user.id, workspaceId, {
              authorName: verified.authorName,
              authorChannelId: verified.authorChannelId,
              authorAvatarUrl: verified.authorAvatarUrl,
              commentText: verified.text,
              replyText,
              youtube: { channelId, threadId: verified.id, replyId: posted.id },
            });
            return json({ data }, { status: 201 });
          } catch (postError) {
            if (postError instanceof YoutubeQuotaExceededError)
              return json({ error: "YOUTUBE_QUOTA_EXCEEDED" }, { status: 429 });
            const insufficientScope = postError instanceof YoutubeInsufficientScopeError;
            const reauthRequired = isYoutubeTokenRefreshReauthError(postError);
            // Logged only for a comment confirmed to be on this channel.
            if (verified)
              await client.from("comment_automation_replies").insert({
                channel_id: channelId,
                rule_id: input.ruleId ?? null,
                youtube_comment_id: verified.id,
                youtube_video_id: verified.videoId,
                author_name: verified.authorName,
                comment_text: verified.text,
                reply_text: replyText,
                status: "failed",
                error: insufficientScope
                  ? "YOUTUBE_INSUFFICIENT_SCOPE"
                  : reauthRequired
                    ? "YOUTUBE_REAUTH_REQUIRED"
                    : "YOUTUBE_COMMENT_REPLY_FAILED",
              });
            if (insufficientScope)
              return json({ error: "YOUTUBE_INSUFFICIENT_SCOPE" }, { status: 403 });
            if (reauthRequired) return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
            throw postError;
          }
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          console.error("Comment reply failed");
          return json({ error: "YOUTUBE_COMMENT_REPLY_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
