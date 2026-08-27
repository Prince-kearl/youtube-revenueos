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

function recordQuotaEvent(
  serviceClient: ReturnType<typeof createServiceSupabaseClient>,
  event: { user_id: string; channel_id: string; operation: string; quota_units: number; succeeded: boolean },
) {
  void serviceClient.from("youtube_quota_events").insert(event).then(({ error }) => {
    if (error) logOptionalFailure("quota_audit", event.user_id, event.channel_id, error);
  });
}

type AnalyticsAvailability = "available" | "unavailable" | "disabled";

function mergeAnalyticsReports(...payloads: Array<AnalyticsPayload | null>): AnalyticsPayload | null {
  const reports = payloads.filter((payload): payload is AnalyticsPayload => Boolean(payload));
  if (!reports.length) return null;
  const headers = [...new Set(reports.flatMap((report) => report.columnHeaders?.map((header) => header.name) ?? []))];
  const rows = new Map<string, Array<string | number>>();
  for (const report of reports) {
    const reportHeaders = report.columnHeaders?.map((header) => header.name) ?? [];
    for (const row of report.rows ?? []) {
      const key = String(row[reportHeaders.indexOf("month")] ?? row[0] ?? rows.size);
      const merged = rows.get(key) ?? headers.map(() => 0);
      for (const header of reportHeaders) {
        const index = headers.indexOf(header);
        if (index >= 0) merged[index] = row[reportHeaders.indexOf(header)] ?? 0;
      }
      rows.set(key, merged);
    }
  }
  return { columnHeaders: headers.map((name) => ({ name })), rows: [...rows.values()] };
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
          recordQuotaEvent(serviceClient, { user_id: channelRow.user_id, channel_id: channelRow.id, operation: "channels.list", quota_units: 1, succeeded: true });
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
            recordQuotaEvent(serviceClient, { user_id: channelRow.user_id, channel_id: channelRow.id, operation: "playlistItems.list,videos.list", quota_units: 101, succeeded: videos.length > 0 });
          }

          const startDate = new Date();
          startDate.setUTCMonth(startDate.getUTCMonth() - 12);
          const endDate = new Date();
          let analytics: AnalyticsPayload | null = null;
          let analyticsStatus: AnalyticsAvailability = "available";
          let revenueStatus: AnalyticsAvailability = "available";
          let watchTimeStatus: AnalyticsAvailability = "available";
          if (!settings.import_analytics) {
            analyticsStatus = "disabled";
            revenueStatus = "disabled";
            watchTimeStatus = "disabled";
          } else {
            let coreAnalytics: AnalyticsPayload | null = null;
            try {
              coreAnalytics = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(startDate),
                endDate: isoDate(endDate),
                metrics: ["views", "subscribersGained"],
                dimensions: ["month"],
              })) as AnalyticsPayload;
            } catch (error) {
              analyticsStatus = "unavailable";
              logOptionalFailure("analytics_core", channelRow.user_id, channelRow.id, error);
            }
            let revenue: AnalyticsPayload | null = null;
            try {
              revenue = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(startDate),
                endDate: isoDate(endDate),
                metrics: ["estimatedRevenue"],
                dimensions: ["month"],
              })) as AnalyticsPayload;
            } catch (error) {
              revenueStatus = "unavailable";
              logOptionalFailure("analytics_revenue", channelRow.user_id, channelRow.id, error);
            }
            let watchTime: AnalyticsPayload | null = null;
            try {
              watchTime = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(startDate),
                endDate: isoDate(endDate),
                metrics: ["watchTimeMinutes"],
                dimensions: ["month"],
              })) as AnalyticsPayload;
            } catch (error) {
              watchTimeStatus = "unavailable";
              logOptionalFailure("analytics_watch_time", channelRow.user_id, channelRow.id, error);
            }
            analytics = mergeAnalyticsReports(coreAnalytics, revenue, watchTime);
            if (!analytics) analyticsStatus = "unavailable";
          }
          if (settings.import_analytics) {
            recordQuotaEvent(serviceClient, { user_id: channelRow.user_id, channel_id: channelRow.id, operation: "reports.query", quota_units: 3, succeeded: analyticsStatus === "available" });
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
              revenueStatus,
              watchTimeStatus,
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
