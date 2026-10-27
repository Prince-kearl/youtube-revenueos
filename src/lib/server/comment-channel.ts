import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "./supabase";
import { getValidAccessToken, normalizeYoutubeConnectionRow } from "./youtube-tokens";
import { fetchCommentThreadsByIds, type YoutubeCommentSummary } from "./google-oauth";

// Shared by the Comment Automation thread and AI draft endpoints: the caller's own connected
// channel, its YouTube access token, and a comment confirmed WITH YOUTUBE to be on that channel.
// Failures are thrown as JSON Responses (the route handlers return a thrown Response as is). A
// channel or comment that is not the caller's gets the same 404 as one that does not exist.

export function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

export interface OwnedChannel {
  id: string;
  youtubeChannelId: string;
}

/** The caller's channel through their RLS-scoped client; it must be in their workspace. */
export async function ownedCommentChannel(
  client: SupabaseClient,
  workspaceId: string,
  requestedId: string | null,
): Promise<OwnedChannel> {
  let query = client
    .from("youtube_channels")
    .select("id, youtube_channel_id, workspace_id")
    .eq("workspace_id", workspaceId)
    .not("connection_id", "is", null)
    .order("connected_at", { ascending: false });
  if (requestedId) query = query.eq("id", requestedId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data || data.workspace_id !== workspaceId)
    throw json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
  return { id: data.id as string, youtubeChannelId: data.youtube_channel_id as string };
}

/** The channel's YouTube access token (service role, for a channel already authorized). */
export async function channelAccessToken(channelId: string) {
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

/** The top-level comment, confirmed with YouTube to be on this channel (1 quota unit). */
export async function ownedCommentThread(
  token: string,
  channel: OwnedChannel,
  commentId: string,
): Promise<YoutubeCommentSummary> {
  const [thread] = await fetchCommentThreadsByIds(token, [commentId]);
  if (!thread || thread.channelId !== channel.youtubeChannelId)
    throw json({ error: "COMMENT_NOT_FOUND" }, { status: 404 });
  return thread;
}

export async function recordQuota(
  service: SupabaseClient,
  entry: { userId: string; channelId: string; operation: string; units: number },
) {
  if (entry.units <= 0) return;
  await service.from("youtube_quota_events").insert({
    user_id: entry.userId,
    channel_id: entry.channelId,
    operation: entry.operation,
    quota_units: entry.units,
    succeeded: true,
  });
}
