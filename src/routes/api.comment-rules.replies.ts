import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import { postYoutubeCommentReply, YoutubeInsufficientScopeError } from "@/lib/server/google-oauth";

const replySchema = z.object({
  ruleId: z.string().uuid().nullable().optional(),
  youtubeCommentId: z.string().min(1),
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

type SupabaseClientLike = Awaited<ReturnType<typeof requireSessionUser>>["client"];

async function findOwnedChannel(client: SupabaseClientLike, requestedId: string | null) {
  let query = client
    .from("youtube_channels")
    .select("id")
    .order("connected_at", { ascending: false });
  if (requestedId) query = query.eq("id", requestedId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
  return data.id as string;
}

// Real lead capture for a real sent reply — the commenter's stable YouTube channel id is used to
// recognize the same person across multiple comments instead of creating a duplicate lead each
// time. Best-effort: the YouTube reply itself already succeeded by the time this runs, so a
// failure here is swallowed rather than surfaced as a reply failure.
async function upsertLeadForReply(
  client: SupabaseClientLike,
  userId: string,
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
      .eq("user_id", userId)
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
    await client.from("leads").update({ updated_at: new Date().toISOString() }).eq("id", leadId);
  } catch {
    // Lead tracking is a bonus on top of a reply that already succeeded — never fail the request over it.
  }
}

export const Route = createFileRoute("/api/comment-rules/replies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const url = new URL(request.url);
          const channelId = await findOwnedChannel(client, url.searchParams.get("channelId"));
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
      // a simulation. Failures are still logged (status: "failed") so they show up in the trigger
      // history instead of silently vanishing.
      POST: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const url = new URL(request.url);
          const channelId = await findOwnedChannel(client, url.searchParams.get("channelId"));
          const input = replySchema.parse(await parseJson(request));

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channelId)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          try {
            const accessToken = await getValidAccessToken(service, secretRow);
            await postYoutubeCommentReply(accessToken, input.youtubeCommentId, input.replyText);
            void service.from("youtube_quota_events").insert({
              user_id: user.id,
              channel_id: channelId,
              operation: "comments.insert",
              quota_units: 50,
              succeeded: true,
            });
            const { data, error } = await client
              .from("comment_automation_replies")
              .insert({
                channel_id: channelId,
                rule_id: input.ruleId ?? null,
                youtube_comment_id: input.youtubeCommentId,
                youtube_video_id: input.youtubeVideoId,
                author_name: input.authorName ?? null,
                comment_text: input.commentText,
                reply_text: input.replyText,
                status: "sent",
              })
              .select()
              .single();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            void upsertLeadForReply(client, user.id, {
              authorName: input.authorName ?? null,
              authorChannelId: input.authorChannelId ?? null,
              authorAvatarUrl: input.authorAvatarUrl ?? null,
              commentText: input.commentText,
              replyText: input.replyText,
            });
            return json({ data }, { status: 201 });
          } catch (postError) {
            const insufficientScope = postError instanceof YoutubeInsufficientScopeError;
            const reauthRequired = isYoutubeReauthError(postError);
            await client.from("comment_automation_replies").insert({
              channel_id: channelId,
              rule_id: input.ruleId ?? null,
              youtube_comment_id: input.youtubeCommentId,
              youtube_video_id: input.youtubeVideoId,
              author_name: input.authorName ?? null,
              comment_text: input.commentText,
              reply_text: input.replyText,
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
