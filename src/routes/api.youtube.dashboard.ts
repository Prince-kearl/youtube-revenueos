import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import {
  fetchAuthorizedYoutubeChannel,
  fetchRecentYoutubeVideos,
  queryYoutubeAnalytics,
  type YoutubeChannelSummary,
} from "@/lib/server/google-oauth";

type AnalyticsPayload = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

const defaults = { auto_sync_videos: true, import_analytics: true };

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60", ...init?.headers },
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function analyticsRows(payload: unknown): Array<Record<string, string | number>> {
  const report = payload as AnalyticsPayload;
  const headers = report.columnHeaders?.map((header) => header.name) ?? [];
  return (report.rows ?? []).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? 0])));
}

function channelUrl(channel: YoutubeChannelSummary): string | null {
  return channel.handle
    ? `https://www.youtube.com/${channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`}`
    : `https://www.youtube.com/channel/${channel.channelId}`;
}

function safeProviderReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const match = error.message.match(/:(\d{3})(?::|$)/);
  return match?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

function logOptionalFailure(operation: string, userId: string, channelId: string, error: unknown) {
  console.warn("YouTube dashboard optional operation failed", {
    operation,
    userId,
    channelId,
    reason: safeProviderReason(error),
    timestamp: new Date().toISOString(),
  });
}

export const Route = createFileRoute("/api/youtube/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const channelQuery = client
            .from("youtube_channels")
            .select("id, user_id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, token_expiry")
            .order("connected_at", { ascending: false });
          const { data: channelRow, error: channelError } = await channelQuery.limit(1).maybeSingle();

          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channelRow) return json({ data: null, status: "not_connected" });

          const serviceClient = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await serviceClient
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channelRow.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const accessToken = await getValidAccessToken(serviceClient, secretRow);
          const channel = await fetchAuthorizedYoutubeChannel(accessToken);
          await serviceClient.from("youtube_quota_events").insert({ user_id: channelRow.user_id, channel_id: channelRow.id, operation: "channels.list", quota_units: 1, succeeded: true });
          const { data: integrationSettings } = await client
            .from("youtube_integration_settings")
            .select("auto_sync_videos, import_analytics")
            .eq("channel_id", channelRow.id)
            .maybeSingle();
          const settings = { ...defaults, ...(integrationSettings ?? {}) };
          let videos = [] as Awaited<ReturnType<typeof fetchRecentYoutubeVideos>>;
          if (settings.auto_sync_videos) {
            try {
              videos = await fetchRecentYoutubeVideos(accessToken, channel.uploadsPlaylistId);
            } catch (error) {
              logOptionalFailure("recent_videos", channelRow.user_id, channelRow.id, error);
            }
          }
          if (settings.auto_sync_videos) {
            void serviceClient.from("youtube_quota_events").insert({ user_id: channelRow.user_id, channel_id: channelRow.id, operation: "playlistItems.list,videos.list", quota_units: 101, succeeded: videos.length > 0 });
          }

          const startDate = new Date();
          startDate.setUTCMonth(startDate.getUTCMonth() - 12);
          const endDate = new Date();
          let analytics: AnalyticsPayload | null = null;
          let analyticsStatus: "available" | "unavailable" | "disabled" = "available";
          try {
            if (!settings.import_analytics) {
              analyticsStatus = "disabled";
              throw new Error("ANALYTICS_IMPORT_DISABLED");
            }
            analytics = (await queryYoutubeAnalytics(accessToken, {
              channelId: channel.channelId,
              startDate: isoDate(startDate),
              endDate: isoDate(endDate),
              metrics: ["views", "estimatedRevenue", "subscribersGained", "watchTimeMinutes"],
              dimensions: ["month"],
            })) as AnalyticsPayload;
          } catch (error) {
            analytics = null;
            if (analyticsStatus === "available") analyticsStatus = "unavailable";
            logOptionalFailure("analytics", channelRow.user_id, channelRow.id, error);
          }
          if (settings.import_analytics) {
            void serviceClient.from("youtube_quota_events").insert({ user_id: channelRow.user_id, channel_id: channelRow.id, operation: "reports.query", quota_units: 1, succeeded: analyticsStatus === "available" });
          }

          const { error: channelSyncError } = await client.from("youtube_channels").update({
            channel_name: channel.title,
            channel_handle: channel.handle,
            thumbnail: channel.thumbnail,
            subscriber_count: channel.subscriberCount,
            last_synced_at: new Date().toISOString(),
          }).eq("id", channelRow.id);
          if (channelSyncError) logOptionalFailure("persist_channel", channelRow.user_id, channelRow.id, channelSyncError);
          if (settings.auto_sync_videos) {
            const { error: videosSyncError } = await client.from("videos").upsert(
              videos.map((video) => ({
                channel_id: channelRow.id,
                youtube_video_id: video.id,
                title: video.title,
                description: video.description,
                thumbnail: video.thumbnail,
                published_at: video.publishedAt,
                duration_seconds: video.durationSeconds,
                status: video.privacyStatus === "private" ? "archived" : "active",
              })),
              { onConflict: "channel_id,youtube_video_id" },
            );
            if (videosSyncError) logOptionalFailure("persist_videos", channelRow.user_id, channelRow.id, videosSyncError);
          }
          return json({
            status: "connected",
            data: {
              channel: { ...channel, url: channelUrl(channel) },
              videos,
              analytics: analyticsRows(analytics),
              analyticsStatus,
              fetchedAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          const message = error instanceof Error ? error.message : "";
          if (message.includes("YOUTUBE_") && message.includes(":401")) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
