import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { isYoutubeTokenRefreshReauthError } from "@/lib/server/youtube-tokens";
import {
  YoutubeInsufficientScopeError,
  YoutubeQuotaExceededError,
} from "@/lib/server/google-oauth";
import { ReplyQueueError } from "@/lib/server/comment-reply-queue";
import { channelAccessToken, json, ownedCommentChannel } from "@/lib/server/comment-channel";
import {
  LeadYoutubeError,
  loadYoutubeLead,
  sendLeadReply,
  syncLeadConversation,
} from "@/lib/server/lead-youtube";

// The Lead Inbox conversation with a YouTube commenter (see lib/server/lead-youtube.ts).
//
//   GET   ?leadId=…   receive: brings the lead's new comments and replies in from YouTube, then
//                     returns the conversation
//   POST  { leadId, text, threadId? }   send: a public reply in the lead's own comment thread
//
// Lead Inbox must be enabled for the caller's workspace role; the lead must be in the caller's
// workspace (looked up through their RLS-scoped client) — another workspace's lead gets the same
// 404 as one that does not exist; the channel is the caller's own; every thread is confirmed with
// YouTube to be on that channel and started by this lead. Replies count towards the workspace's
// daily reply cap; receiving is throttled per lead and capped per workspace per day.

const leadId = z.string().uuid();
const sendSchema = z
  .object({
    leadId,
    text: z.string().trim().min(1).max(4_000),
    threadId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .nullable()
      .optional(),
  })
  .strict();

function failure(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof LeadYoutubeError)
    return json({ error: error.code }, { status: error.status });
  if (error instanceof ReplyQueueError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (error instanceof YoutubeQuotaExceededError)
    return json({ error: "YOUTUBE_QUOTA_EXCEEDED" }, { status: 429 });
  if (error instanceof YoutubeInsufficientScopeError)
    return json({ error: "YOUTUBE_INSUFFICIENT_SCOPE" }, { status: 403 });
  if (isYoutubeTokenRefreshReauthError(error))
    return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
  console.error("Lead YouTube conversation failed");
  return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
}

export const Route = createFileRoute("/api/leads/youtube")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(request, "leads");
          const url = new URL(request.url);
          const parsed = leadId.safeParse(url.searchParams.get("leadId"));
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const lead = await loadYoutubeLead(client, workspaceId, parsed.data);
          const channel = await ownedCommentChannel(
            client,
            workspaceId,
            url.searchParams.get("channelId"),
          );
          const { service, token } = await channelAccessToken(channel.id);
          const result = await syncLeadConversation(service, {
            userId: user.id,
            lead,
            channel,
            token,
          });
          const { data, error } = await client
            .from("lead_messages")
            .select("*")
            .eq("lead_id", lead.id)
            .order("created_at", { ascending: true });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: { messages: data, ...result } });
        } catch (error) {
          return failure(error);
        }
      },

      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(request, "leads");
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ error: "INVALID_JSON" }, { status: 400 });
          }
          const parsed = sendSchema.safeParse(body);
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const lead = await loadYoutubeLead(client, workspaceId, parsed.data.leadId);
          const channel = await ownedCommentChannel(
            client,
            workspaceId,
            new URL(request.url).searchParams.get("channelId"),
          );
          const { service, token } = await channelAccessToken(channel.id);
          const message = await sendLeadReply(service, {
            userId: user.id,
            lead,
            channel,
            token,
            text: parsed.data.text,
            threadId: parsed.data.threadId ?? null,
          });
          return json({ data: message }, { status: 201 });
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
