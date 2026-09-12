import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import {
  fetchAuthorizedYoutubeChannel,
  fetchRecentYoutubeVideos,
  fetchRecentYoutubeComments,
} from "@/lib/server/google-oauth";

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

export const Route = createFileRoute("/api/youtube/comments")({
  server: {
    handlers: {
      // Always fetches live from YouTube (not the separate background-synced youtube_comments
      // table, which depends on the "Sync comment data" setting being on) — Comment Automation
      // needs current comments to match rules against, not whatever was last synced.
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireWorkspaceFeature(request, "comment_automation");
          const requestedChannelId = new URL(request.url).searchParams.get("channelId");
          let channelQuery = client
            .from("youtube_channels")
            .select("id, youtube_channel_id")
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ status: "not_connected", data: null });

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channel.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const accessToken = await getValidAccessToken(service, secretRow);

          const liveChannel = await fetchAuthorizedYoutubeChannel(
            accessToken,
            channel.youtube_channel_id,
          );
          const videos = await fetchRecentYoutubeVideos(
            accessToken,
            liveChannel.uploadsPlaylistId,
            10,
          );
          const comments = await fetchRecentYoutubeComments(
            accessToken,
            videos.map((v) => v.id),
          );

          void service.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "commentThreads.list",
            quota_units: videos.length,
            succeeded: true,
          });

          return json({
            status: "connected",
            data: {
              comments,
              videos: videos.map((v) => ({ id: v.id, title: v.title })),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (isYoutubeReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          console.error("Comment fetch failed");
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
