import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { isYoutubeTokenRefreshReauthError } from "@/lib/server/youtube-tokens";
import {
  fetchCommentReplies,
  fetchCommentsByIds,
  updateYoutubeComment,
  YoutubeInsufficientScopeError,
  YoutubeQuotaExceededError,
} from "@/lib/server/google-oauth";
import { REPLY_QUOTA_UNITS, replyAllowance } from "@/lib/server/comment-reply-queue";
import {
  channelAccessToken,
  json,
  ownedCommentChannel,
  ownedCommentThread,
  recordQuota,
} from "@/lib/server/comment-channel";

// One comment's thread on the caller's channel (Comment Automation).
//
//   GET    ?commentId=…            the comment and every reply to it, each marked isOwn when the
//                                  channel itself wrote it, and autoReply when it is the reply
//                                  Tubify recorded sending
//   PATCH  { commentId, replyId, text }   edits one of the channel's OWN replies on YouTube
//
// Authorization: Comment Automation must be enabled for the caller's workspace role; the channel
// is the caller's (RLS-scoped lookup, same workspace); the top-level comment is confirmed with
// YouTube to be on that channel. An edit is allowed only for a reply YouTube says is a reply to
// that comment AND written by that channel — anything else is the same 404 as a missing reply.
// An edit spends 50 units of the shared YouTube quota, so it is held to the same daily allowance
// as sending a reply.

const COMMENT_ID = /^[A-Za-z0-9_.-]{1,128}$/;
/** Replies read per thread: at most this many pages of 100. */
const MAX_REPLY_PAGES = 3;

const editSchema = z
  .object({
    commentId: z.string().regex(COMMENT_ID),
    replyId: z.string().regex(COMMENT_ID),
    text: z.string().trim().min(1).max(10_000),
  })
  .strict();

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();

function youtubeFailure(error: unknown) {
  if (error instanceof YoutubeQuotaExceededError)
    return json({ error: "YOUTUBE_QUOTA_EXCEEDED" }, { status: 429 });
  if (error instanceof YoutubeInsufficientScopeError)
    return json({ error: "YOUTUBE_INSUFFICIENT_SCOPE" }, { status: 403 });
  if (isYoutubeTokenRefreshReauthError(error))
    return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
  return null;
}

export const Route = createFileRoute("/api/comment-replies/thread")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const url = new URL(request.url);
          const commentId = url.searchParams.get("commentId") ?? "";
          if (!COMMENT_ID.test(commentId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const channel = await ownedCommentChannel(
            client,
            workspaceId,
            url.searchParams.get("channelId"),
          );
          const { service, token } = await channelAccessToken(channel.id);
          let units = 0;
          try {
            units += 1;
            const comment = await ownedCommentThread(token, channel, commentId);
            const { replies, pages, more } = await fetchCommentReplies(
              token,
              comment.id,
              MAX_REPLY_PAGES,
            );
            units += pages;
            const { data: recorded } = await service
              .from("comment_automation_replies")
              .select("reply_text")
              .eq("channel_id", channel.id)
              .eq("youtube_comment_id", comment.id)
              .eq("status", "sent")
              .maybeSingle();
            const recordedText = (recorded?.reply_text as string | undefined) ?? null;
            return json({
              data: {
                comment,
                more,
                replies: replies.map((reply) => {
                  const isOwn = reply.authorChannelId === channel.youtubeChannelId;
                  return {
                    ...reply,
                    isOwn,
                    autoReply: isOwn && recordedText !== null && sameText(reply.text, recordedText),
                  };
                }),
              },
            });
          } finally {
            await recordQuota(service, {
              userId: user.id,
              channelId: channel.id,
              operation: "comments.list",
              units,
            });
          }
        } catch (error) {
          if (error instanceof Response) return error;
          const failure = youtubeFailure(error);
          if (failure) return failure;
          console.error("Loading comment replies failed");
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },

      PATCH: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const channel = await ownedCommentChannel(
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
          const parsed = editSchema.safeParse(body);
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const input = parsed.data;

          const { service, token } = await channelAccessToken(channel.id);
          // The same daily limits as sending a reply: an edit costs as much quota.
          const allowance = await replyAllowance(service, workspaceId, new Date());
          if (allowance.remaining <= 0)
            return json(
              {
                error:
                  allowance.workspaceRemaining <= 0 ? "DAILY_REPLY_LIMIT" : "QUOTA_RESERVE_REACHED",
              },
              { status: 429 },
            );

          let units = 0;
          try {
            units += 1;
            const comment = await ownedCommentThread(token, channel, input.commentId);
            units += 1;
            const [reply] = await fetchCommentsByIds(token, [input.replyId]);
            if (
              !reply ||
              reply.parentId !== comment.id ||
              reply.authorChannelId !== channel.youtubeChannelId
            )
              return json({ error: "REPLY_NOT_FOUND" }, { status: 404 });

            units += REPLY_QUOTA_UNITS;
            await updateYoutubeComment(token, reply.id, input.text);

            // Keep Tubify's record in step when this is the reply it sent.
            const { data: recorded } = await service
              .from("comment_automation_replies")
              .select("id, reply_text")
              .eq("channel_id", channel.id)
              .eq("youtube_comment_id", comment.id)
              .eq("status", "sent")
              .maybeSingle();
            const wasAutoReply =
              recorded !== null && sameText(recorded.reply_text as string, reply.text);
            if (wasAutoReply)
              await service
                .from("comment_automation_replies")
                .update({ reply_text: input.text })
                .eq("id", recorded.id as string)
                .eq("channel_id", channel.id);

            return json({
              data: {
                ...reply,
                text: input.text,
                updatedAt: new Date().toISOString(),
                isOwn: true,
                autoReply: wasAutoReply,
              },
            });
          } finally {
            await recordQuota(service, {
              userId: user.id,
              channelId: channel.id,
              operation: "comments.update",
              units,
            });
          }
        } catch (error) {
          if (error instanceof Response) return error;
          const failure = youtubeFailure(error);
          if (failure) return failure;
          console.error("Editing a comment reply failed");
          return json({ error: "YOUTUBE_COMMENT_UPDATE_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
