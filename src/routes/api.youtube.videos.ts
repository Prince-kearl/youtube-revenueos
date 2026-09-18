import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import {
  fetchAuthorizedYoutubeChannel,
  fetchYoutubeVideosPage,
  queryYoutubeAnalytics,
} from "@/lib/server/google-oauth";

const idSchema = z.string().uuid();

type AnalyticsPayload = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

type VideoStats = { views: number; revenue: number | null; cpm: number | null };

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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function analyticsRows(payload: AnalyticsPayload | null): Array<Record<string, string | number>> {
  const headers = payload?.columnHeaders?.map((header) => header.name) ?? [];
  return (payload?.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? 0])),
  );
}

// Ranked by revenue when the account's analytics grant includes the monetary scope, by
// period views otherwise — same "no fabricated numbers" rule as the rest of the app: a
// video with no comparable prior-period data gets status/change left null rather than guessed.
function computeStatus(params: {
  rank: number;
  totalRanked: number;
  changePercent: number | null;
  revenueAvailable: boolean;
}): string {
  const { rank, totalRanked, changePercent, revenueAvailable } = params;
  if (rank === 0) return "Top Performer";
  if (revenueAvailable && rank < Math.max(1, Math.ceil(totalRanked * 0.25))) return "High Revenue";
  if (changePercent !== null && changePercent >= 5) return "Growing";
  if (changePercent !== null && changePercent <= -5) return "Declining";
  return "Steady";
}

// Enriches the Data-API video list with real per-video revenue/CPM (12-month window, matching
// the rest of the app's "Estimated Revenue" framing) and a trailing-30-days-vs-prior-30-days view
// trend (same window the dashboard's Top Revenue Videos widget already uses). Revenue metrics are
// requested first and re-tried without them on a 401/403 — an account without the monetary
// analytics scope granted still gets views-based change/status instead of the whole enrichment
// silently failing.
async function enrichVideosWithAnalytics(
  accessToken: string,
  channelId: string,
  videoIds: string[],
): Promise<{
  revenueAvailable: boolean;
  byId: Map<
    string,
    { revenue: number | null; cpm: number | null; changePercent: number | null; status: string }
  >;
}> {
  const empty = { revenueAvailable: false, byId: new Map() };
  if (!videoIds.length) return empty;
  const idFilter = videoIds.join(",");

  const revenueEnd = new Date();
  const revenueStart = new Date(revenueEnd);
  revenueStart.setUTCMonth(revenueStart.getUTCMonth() - 12);
  const trendEnd = new Date();
  const trendStart = new Date(trendEnd);
  trendStart.setUTCDate(trendStart.getUTCDate() - 30);
  const prevTrendEnd = new Date(trendStart);
  const prevTrendStart = new Date(trendStart);
  prevTrendStart.setUTCDate(prevTrendStart.getUTCDate() - 30);

  let revenueAvailable = true;
  let statsPayload: AnalyticsPayload | null = null;
  try {
    statsPayload = (await queryYoutubeAnalytics(accessToken, {
      channelId,
      startDate: isoDate(revenueStart),
      endDate: isoDate(revenueEnd),
      metrics: ["views", "estimatedRevenue", "cpm"],
      dimensions: ["video"],
      filters: `video==${idFilter}`,
      maxResults: videoIds.length,
    })) as AnalyticsPayload;
  } catch (error) {
    console.warn("YouTube video-list revenue report unavailable", {
      reason: safeProviderReason(error),
    });
    revenueAvailable = false;
    try {
      statsPayload = (await queryYoutubeAnalytics(accessToken, {
        channelId,
        startDate: isoDate(revenueStart),
        endDate: isoDate(revenueEnd),
        metrics: ["views"],
        dimensions: ["video"],
        filters: `video==${idFilter}`,
        maxResults: videoIds.length,
      })) as AnalyticsPayload;
    } catch (fallbackError) {
      console.warn("YouTube video-list activity report unavailable", {
        reason: safeProviderReason(fallbackError),
      });
      return empty;
    }
  }

  const statsById = new Map<string, VideoStats>(
    analyticsRows(statsPayload).map((row) => [
      String(row.video ?? ""),
      {
        views: Number(row.views ?? 0),
        revenue: revenueAvailable ? Number(row.estimatedRevenue ?? 0) : null,
        cpm: revenueAvailable ? Number(row.cpm ?? 0) : null,
      },
    ]),
  );

  const [currentTrendPayload, prevTrendPayload] = await Promise.all([
    queryYoutubeAnalytics(accessToken, {
      channelId,
      startDate: isoDate(trendStart),
      endDate: isoDate(trendEnd),
      metrics: ["views"],
      dimensions: ["video"],
      filters: `video==${idFilter}`,
    }).catch(() => null) as Promise<AnalyticsPayload | null>,
    queryYoutubeAnalytics(accessToken, {
      channelId,
      startDate: isoDate(prevTrendStart),
      endDate: isoDate(prevTrendEnd),
      metrics: ["views"],
      dimensions: ["video"],
      filters: `video==${idFilter}`,
    }).catch(() => null) as Promise<AnalyticsPayload | null>,
  ]);
  const currentTrendById = new Map(
    analyticsRows(currentTrendPayload).map((row) => [
      String(row.video ?? ""),
      Number(row.views ?? 0),
    ]),
  );
  const prevTrendById = new Map(
    analyticsRows(prevTrendPayload).map((row) => [String(row.video ?? ""), Number(row.views ?? 0)]),
  );

  const ranked = [...statsById.entries()].sort(([, a], [, b]) => {
    const rankA = revenueAvailable ? (a.revenue ?? 0) : a.views;
    const rankB = revenueAvailable ? (b.revenue ?? 0) : b.views;
    return rankB - rankA;
  });

  const byId = new Map<
    string,
    { revenue: number | null; cpm: number | null; changePercent: number | null; status: string }
  >();
  ranked.forEach(([videoId, stats], rank) => {
    const prevViews = prevTrendById.get(videoId) ?? 0;
    const currentViews = currentTrendById.get(videoId) ?? 0;
    const changePercent = prevViews > 0 ? ((currentViews - prevViews) / prevViews) * 100 : null;
    byId.set(videoId, {
      revenue: stats.revenue,
      cpm: stats.cpm,
      changePercent,
      status: computeStatus({ rank, totalRanked: ranked.length, changePercent, revenueAvailable }),
    });
  });

  return { revenueAvailable, byId };
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
          const pageToken = url.searchParams.get("pageToken") ?? undefined;
          const rawLimit = Number(url.searchParams.get("limit") ?? "50");
          const limit = Number.isFinite(rawLimit)
            ? Math.min(Math.max(Math.floor(rawLimit), 1), 50)
            : 50;

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
            .select("auto_sync_videos, import_analytics")
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
                nextPageToken: null,
                videosStatus: "disabled",
                totalVideoCount: channelRow.video_count ?? 0,
                revenueAvailable: false,
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
          const videoPage = await fetchYoutubeVideosPage(
            accessToken,
            channel.uploadsPlaylistId,
            pageToken,
            limit,
          );

          let revenueAvailable = false;
          let enrichedVideos = videoPage.videos;
          if (integrationSettings?.import_analytics !== false && videoPage.videos.length) {
            const enrichment = await enrichVideosWithAnalytics(
              accessToken,
              channel.channelId,
              videoPage.videos.map((video) => video.id),
            );
            revenueAvailable = enrichment.revenueAvailable;
            enrichedVideos = videoPage.videos.map((video) => {
              const stats = enrichment.byId.get(video.id);
              return {
                ...video,
                estimatedRevenue: stats?.revenue ?? null,
                cpm: stats?.cpm ?? null,
                changePercent: stats?.changePercent ?? null,
                status: stats?.status ?? null,
              };
            });
            void serviceClient.from("youtube_quota_events").insert({
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "reports.query.video_list_stats",
              quota_units: 3,
              succeeded: enrichment.byId.size > 0,
            });
          } else {
            enrichedVideos = videoPage.videos.map((video) => ({
              ...video,
              estimatedRevenue: null,
              cpm: null,
              changePercent: null,
              status: null,
            }));
          }

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
              videos: enrichedVideos,
              nextPageToken: videoPage.nextPageToken,
              videosStatus: "available",
              totalVideoCount: channel.videoCount,
              revenueAvailable,
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
