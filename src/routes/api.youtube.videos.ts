import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import { fetchAuthorizedYoutubeChannel, fetchRecentYoutubeVideos } from "@/lib/server/google-oauth";

const idSchema = z.string().uuid();

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=60",
      ...init?.headers,
    },
  });
}

function safeProviderReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const match = error.message.match(/:(\d{3})(?::|$)/);
  return match?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

export const Route = createFileRoute("/api/youtube/videos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const url = new URL(request.url);
          const rawChannelId = url.searchParams.get("channelId");
          const requestedChannelId = rawChannelId ? idSchema.parse(rawChannelId) : null;

          let channelQuery = client
            .from("youtube_channels")
            .select(
              "id, user_id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, view_count, video_count, uploads_playlist_id, token_expiry",
            )
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channelRow, error: channelError } = await channelQuery
            .limit(1)
            .maybeSingle();

          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channelRow) {
            return requestedChannelId
              ? json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 })
              : json({ status: "not_connected", data: null });
          }

          const { data: integrationSettings, error: settingsError } = await client
            .from("youtube_integration_settings")
            .select("auto_sync_videos")
            .eq("channel_id", channelRow.id)
            .maybeSingle();
          if (settingsError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (integrationSettings?.auto_sync_videos === false) {
            return json({
              status: "connected",
              data: {
                channel: {
                  id: channelRow.id,
                  youtubeChannelId: channelRow.youtube_channel_id,
                  title: channelRow.channel_name,
                  handle: channelRow.channel_handle,
                  thumbnail: channelRow.thumbnail,
                  videoCount: channelRow.video_count ?? 0,
                },
                videos: [],
                videosStatus: "disabled",
                totalVideoCount: channelRow.video_count ?? 0,
              },
            });
          }

          const serviceClient = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await serviceClient
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channelRow.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const accessToken = await getValidAccessToken(serviceClient, secretRow);
          const channel = await fetchAuthorizedYoutubeChannel(
            accessToken,
            channelRow.youtube_channel_id,
          );
          const videos = await fetchRecentYoutubeVideos(accessToken, channel.uploadsPlaylistId, 50);

          const { error: channelUpdateError } = await client
            .from("youtube_channels")
            .update({
              channel_name: channel.title,
              channel_handle: channel.handle,
              thumbnail: channel.thumbnail,
              subscriber_count: channel.subscriberCount,
              view_count: channel.viewCount,
              video_count: channel.videoCount,
              uploads_playlist_id: channel.uploadsPlaylistId,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", channelRow.id);
          if (channelUpdateError) {
            console.warn("YouTube videos channel snapshot update failed", {
              channelId: channelRow.id,
              reason: safeProviderReason(channelUpdateError),
            });
          }

          return json({
            status: "connected",
            data: {
              channel: {
                id: channelRow.id,
                youtubeChannelId: channel.channelId,
                title: channel.title,
                handle: channel.handle,
                thumbnail: channel.thumbnail,
                videoCount: channel.videoCount,
              },
              videos,
              videosStatus: "available",
              totalVideoCount: channel.videoCount,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeReauthError(error)) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          console.error("YouTube videos request failed", {
            reason: safeProviderReason(error),
            timestamp: new Date().toISOString(),
          });
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
