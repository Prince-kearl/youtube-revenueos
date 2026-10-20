import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { isYoutubeTokenRefreshReauthError } from "@/lib/server/youtube-tokens";
import { YoutubeQuotaExceededError } from "@/lib/server/google-oauth";
import { generateCommentReply, getActiveProviderInfo } from "@/lib/server/ai-generation";
import { enforceAiQuota } from "@/lib/server/ai-usage";
import { loadVideoReplyContext } from "@/lib/server/comment-reply-context";
import {
  channelAccessToken,
  json,
  ownedCommentChannel,
  ownedCommentThread,
  recordQuota,
} from "@/lib/server/comment-channel";

// POST { youtubeCommentId, intent? } → an AI-written reply DRAFT for one comment on the caller's
// channel, for the creator to review and edit before anything is posted. Nothing is sent to
// YouTube here.
//
// The comment is confirmed with YouTube to be on the caller's channel, and its text and author
// come from YouTube, not the request. The reply is grounded in that video's own title,
// description, chapters, stored analysis and transcript (lib/server/comment-reply-context.ts).
// Counts against the caller's plan AI allowance (task "comment_reply_draft", per minute and per
// day), which is what bounds repeated calls.

const TASK = "comment_reply_draft";

const draftSchema = z
  .object({
    youtubeCommentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    /** The rule's template, if any: the intent to aim for, not text to copy. */
    intent: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export const Route = createFileRoute("/api/comment-replies/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
          const parsed = draftSchema.safeParse(body);
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (!getActiveProviderInfo())
            return json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });

          await enforceAiQuota(user.id, TASK);

          const { service, token } = await channelAccessToken(channel.id);
          let units = 0;
          try {
            units += 1;
            const comment = await ownedCommentThread(token, channel, parsed.data.youtubeCommentId);
            const context = await loadVideoReplyContext(service, {
              channelId: channel.id,
              youtubeChannelId: channel.youtubeChannelId,
              youtubeVideoId: comment.videoId,
              accessToken: token,
            });
            if (!context) return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
            const { channelName, ...video } = context;
            let text: string | null;
            try {
              text = await generateCommentReply({
                channelName,
                video,
                comment: { authorName: comment.authorName, text: comment.text },
                guidance: parsed.data.intent || null,
              });
            } catch {
              return json({ error: "AI_REPLY_FAILED" }, { status: 502 });
            }
            // null: the AI judged the comment spam or abuse and suggests not replying.
            return json({ data: { text, skip: text === null } });
          } finally {
            await recordQuota(service, {
              userId: user.id,
              channelId: channel.id,
              operation: "commentThreads.list",
              units,
            });
          }
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof YoutubeQuotaExceededError)
            return json({ error: "YOUTUBE_QUOTA_EXCEEDED" }, { status: 429 });
          if (isYoutubeTokenRefreshReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          console.error("Drafting a comment reply failed");
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
