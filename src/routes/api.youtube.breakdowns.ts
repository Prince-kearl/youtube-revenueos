import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { resolveRevenueAccess } from "@/lib/server/revenue-visibility";
import { REVENUE_HIDDEN, REVENUE_VISIBLE } from "@/lib/revenue-visibility";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  getValidAccessToken,
  isYoutubeTokenRefreshReauthError,
  normalizeYoutubeConnectionRow,
} from "@/lib/server/youtube-tokens";
import {
  fetchRecentYoutubeVideos,
  fetchYoutubeVideosByIds,
  queryYoutubeAnalytics,
  type YoutubeAnalyticsPayload,
} from "@/lib/server/google-oauth";

const querySchema = z.object({
  range: z.enum(["3M", "6M", "12M"]).default("12M"),
});

type BreakdownRow = Record<string, string | number | null>;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function dateRange(range: "3M" | "6M" | "12M") {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCMonth(startDate.getUTCMonth() - (range === "3M" ? 3 : range === "6M" ? 6 : 12));
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

function rowsFromPayload(payload: YoutubeAnalyticsPayload | null): BreakdownRow[] {
  if (!payload?.columnHeaders?.length) return [];
  const headers = payload.columnHeaders.map((header) => header.name);
  return (payload.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
  );
}

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return error.message.match(/:(\d{3})(?::|$)/)?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

// The traffic-source breakdown asks for revenue because it has no stored equivalent. The video
// breakdown does not: each video's earnings come from /api/revenue/videos (stored data).
async function queryBreakdown(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string,
  dimension: "video" | "insightTrafficSourceType",
  includeRevenue = true,
) {
  let revenueReport: YoutubeAnalyticsPayload | null = null;
  if (includeRevenue)
    try {
      revenueReport = (await queryYoutubeAnalytics(accessToken, {
        channelId,
        startDate,
        endDate,
        metrics: ["views", "estimatedMinutesWatched", "estimatedRevenue"],
        dimensions: [dimension],
        sort: "-views",
        maxResults: 50,
      })) as YoutubeAnalyticsPayload;
    } catch (error) {
      console.warn("YouTube breakdown revenue unavailable", {
        dimension,
        reason: safeReason(error),
        timestamp: new Date().toISOString(),
      });
    }

  const hasRevenueRows = Boolean(
    revenueReport?.rows?.length &&
    revenueReport.columnHeaders?.some((header) => header.name === "estimatedRevenue"),
  );
  if (hasRevenueRows) {
    return { payload: revenueReport, revenueAvailable: true };
  }

  let activityReport: YoutubeAnalyticsPayload | null = null;
  try {
    activityReport = (await queryYoutubeAnalytics(accessToken, {
      channelId,
      startDate,
      endDate,
      metrics: ["views", "estimatedMinutesWatched"],
      dimensions: [dimension],
      sort: "-views",
      maxResults: 50,
    })) as YoutubeAnalyticsPayload;
  } catch (error) {
    console.warn("YouTube breakdown activity unavailable", {
      dimension,
      reason: safeReason(error),
      timestamp: new Date().toISOString(),
    });
  }

  return { payload: activityReport, revenueAvailable: false };
}

export const Route = createFileRoute("/api/youtube/breakdowns")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "analytics");
          const { client, user } = ctx;
          // Revenue per traffic source follows the workspace's revenue visibility; for a caller
          // who may not see it the metric is not requested from YouTube at all.
          const revenueAccess = await resolveRevenueAccess(ctx);
          const requestUrl = new URL(request.url);
          const requestedChannelId = requestUrl.searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const input = querySchema.parse(Object.fromEntries(requestUrl.searchParams));
          const { startDate, endDate } = dateRange(input.range);
          let channelQuery = client
            .from("youtube_channels")
            .select(
              "id, youtube_channel_id, uploads_playlist_id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
            )
            .not("connection_id", "is", null)
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          const connection = normalizeYoutubeConnectionRow(channel?.connection);
          if (channelError || !channel || !connection)
            return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const serviceClient = createServiceSupabaseClient();
          const accessToken = await getValidAccessToken(serviceClient, connection);
          const [videoBreakdown, trafficBreakdown] = await Promise.all([
            queryBreakdown(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              "video",
              false,
            ),
            queryBreakdown(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              "insightTrafficSourceType",
              revenueAccess.canView,
            ),
          ]);

          // Titles and thumbnails for exactly the videos the table lists, looked up by id — in any
          // visibility (an unlisted or private upload is still the creator's own video) and however
          // old. Only this channel's videos are used. The recent public uploads are needed only
          // when YouTube returned no per-video rows at all (the fallback list below).
          const analyticsRows = rowsFromPayload(videoBreakdown.payload);
          const listedIds = [
            ...new Set(
              analyticsRows
                .map((row) => row.video)
                .filter((id): id is string => typeof id === "string" && id.length > 0),
            ),
          ].slice(0, 50);
          const [listedVideos, recentVideos] = await Promise.all([
            listedIds.length
              ? fetchYoutubeVideosByIds(accessToken, listedIds).catch(() => [])
              : Promise.resolve([]),
            !listedIds.length && channel.uploads_playlist_id
              ? fetchRecentYoutubeVideos(accessToken, channel.uploads_playlist_id).catch(() => [])
              : Promise.resolve([]),
          ]);
          const ownVideos = [...listedVideos, ...recentVideos].filter(
            (video) => !video.channelId || video.channelId === channel.youtube_channel_id,
          );

          const videoMetadata = new Map(
            ownVideos.map((video) => [
              video.id,
              {
                title: video.title,
                thumbnail: video.thumbnail,
                publishedAt: video.publishedAt,
                url: video.url,
              },
            ]),
          );
          const videoRows = analyticsRows.map((row) => ({
            ...row,
            ...(typeof row.video === "string" ? videoMetadata.get(row.video) : undefined),
          }));
          const fallbackVideoRows = videoRows.length
            ? videoRows
            : recentVideos.map((video) => ({
                video: video.id,
                title: video.title,
                thumbnail: video.thumbnail,
                publishedAt: video.publishedAt,
                url: video.url,
                views: video.views,
                estimatedMinutesWatched: null,
                estimatedRevenue: null,
              }));

          void serviceClient.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "reports.query.breakdowns",
            quota_units: 4,
            succeeded: Boolean(videoBreakdown.payload || trafficBreakdown.payload),
          });

          return json({
            data: {
              visibility: revenueAccess.canView ? REVENUE_VISIBLE : REVENUE_HIDDEN,
              range: input.range,
              startDate,
              endDate,
              video: {
                rows: fallbackVideoRows,
                revenueAvailable: videoBreakdown.revenueAvailable,
              },
              trafficSources: {
                rows: rowsFromPayload(trafficBreakdown.payload),
                revenueAvailable: trafficBreakdown.revenueAvailable,
              },
            },
            meta: { source: "youtube_analytics_api", fetchedAt: new Date().toISOString() },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          const message = error instanceof Error ? error.message : "";
          if (isYoutubeTokenRefreshReauthError(error)) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          console.error("YouTube breakdown request failed", {
            reason: safeReason(error),
            timestamp: new Date().toISOString(),
          });
          return json({ error: "YOUTUBE_BREAKDOWN_ERROR" }, { status: 502 });
        }
      },
    },
  },
});
