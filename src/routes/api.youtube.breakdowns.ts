import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import {
  fetchRecentYoutubeVideos,
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

async function queryBreakdown(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string,
  dimension: "video" | "insightTrafficSourceType",
) {
  let revenueReport: YoutubeAnalyticsPayload | null = null;
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
          const { client, user } = await requireSessionUser(request);
          const requestUrl = new URL(request.url);
          const requestedChannelId = requestUrl.searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const input = querySchema.parse(Object.fromEntries(requestUrl.searchParams));
          const { startDate, endDate } = dateRange(input.range);
          let channelQuery = client
            .from("youtube_channels")
            .select(
              "id, youtube_channel_id, uploads_playlist_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry",
            )
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError || !channel)
            return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const serviceClient = createServiceSupabaseClient();
          const accessToken = await getValidAccessToken(serviceClient, channel);
          const [videoBreakdown, trafficBreakdown, recentVideos] = await Promise.all([
            queryBreakdown(accessToken, channel.youtube_channel_id, startDate, endDate, "video"),
            queryBreakdown(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              "insightTrafficSourceType",
            ),
            channel.uploads_playlist_id
              ? fetchRecentYoutubeVideos(accessToken, channel.uploads_playlist_id).catch(() => [])
              : Promise.resolve([]),
          ]);

          const videoMetadata = new Map(
            recentVideos.map((video) => [
              video.id,
              {
                title: video.title,
                thumbnail: video.thumbnail,
                publishedAt: video.publishedAt,
                url: video.url,
              },
            ]),
          );
          const videoRows = rowsFromPayload(videoBreakdown.payload).map((row) => ({
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
          if (isYoutubeReauthError(error)) {
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
