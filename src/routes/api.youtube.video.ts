import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import {
  fetchYoutubeVideoById,
  queryYoutubeAnalytics,
  type YoutubeAnalyticsPayload,
} from "@/lib/server/google-oauth";

const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const channelIdSchema = z.string().uuid();
const rangeSchema = z.enum(["3M", "6M", "12M"]).default("12M");

const activityMetrics = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
];
const revenueMetrics = ["estimatedRevenue", "cpm", "playbackBasedCpm"];

type AnalyticsRow = Record<string, string | number | null>;

type ReportResult = {
  payload: YoutubeAnalyticsPayload | null;
  revenueAvailable: boolean;
};

type OptionalReport = YoutubeAnalyticsPayload | null;

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

function dateRange(range: "3M" | "6M" | "12M") {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCMonth(startDate.getUTCMonth() - (range === "3M" ? 3 : range === "6M" ? 6 : 12));
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

function rowsFromPayload(payload: YoutubeAnalyticsPayload | null): AnalyticsRow[] {
  if (!payload?.columnHeaders?.length) return [];
  const headers = payload.columnHeaders.map((header) => header.name);
  return (payload.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
  );
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasMetric(payload: YoutubeAnalyticsPayload | null, metric: string): boolean {
  return Boolean(
    payload?.columnHeaders?.some((header) => header.name === metric) && payload.rows?.length,
  );
}

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return error.message.match(/:(\d{3})(?::|$)/)?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

async function queryOptionalReport(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  filters: string,
  metrics: string[],
  maxResults = 100,
): Promise<OptionalReport> {
  try {
    return (await queryYoutubeAnalytics(accessToken, {
      channelId,
      startDate,
      endDate,
      dimensions,
      filters,
      metrics,
      maxResults,
    })) as YoutubeAnalyticsPayload;
  } catch (error) {
    console.warn("Optional YouTube video analytics report unavailable", {
      dimensions: dimensions.join(","),
      reason: safeReason(error),
    });
    return null;
  }
}

async function queryWithRevenueFallback(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string,
  dimensions: string[] | undefined,
  filters: string,
  metrics: string[],
): Promise<ReportResult> {
  try {
    const payload = (await queryYoutubeAnalytics(accessToken, {
      channelId,
      startDate,
      endDate,
      metrics: [...metrics, ...revenueMetrics],
      dimensions,
      filters,
      sort: dimensions?.includes("day") ? "day" : undefined,
      maxResults: dimensions?.includes("day") ? 400 : undefined,
    })) as YoutubeAnalyticsPayload;
    return { payload, revenueAvailable: hasMetric(payload, "estimatedRevenue") };
  } catch (error) {
    console.warn("YouTube video revenue report unavailable", { reason: safeReason(error) });
    try {
      const payload = (await queryYoutubeAnalytics(accessToken, {
        channelId,
        startDate,
        endDate,
        metrics,
        dimensions,
        filters,
        sort: dimensions?.includes("day") ? "day" : undefined,
        maxResults: dimensions?.includes("day") ? 400 : undefined,
      })) as YoutubeAnalyticsPayload;
      return { payload, revenueAvailable: false };
    } catch (activityError) {
      console.warn("YouTube video activity report unavailable", {
        reason: safeReason(activityError),
      });
      return { payload: null, revenueAvailable: false };
    }
  }
}

export const Route = createFileRoute("/api/youtube/video")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const url = new URL(request.url);
          const videoId = videoIdSchema.parse(url.searchParams.get("videoId"));
          const rawChannelId = url.searchParams.get("channelId");
          const channelId = rawChannelId ? channelIdSchema.parse(rawChannelId) : null;
          const range = rangeSchema.parse(url.searchParams.get("range") ?? undefined);
          const forceFresh = url.searchParams.get("fresh") === "1";
          const { startDate, endDate } = dateRange(range);

          let channelQuery = client
            .from("youtube_channels")
            .select("id, youtube_channel_id, channel_name, channel_handle")
            .order("connected_at", { ascending: false });
          if (channelId) channelQuery = channelQuery.eq("id", channelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channel.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const accessToken = await getValidAccessToken(service, secretRow);
          const video = await fetchYoutubeVideoById(
            accessToken,
            videoId,
            channel.youtube_channel_id,
          );
          const [timeline, summary, traffic, demographics, retention] = await Promise.all([
            queryWithRevenueFallback(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              ["day"],
              `video==${videoId}`,
              activityMetrics,
            ),
            queryWithRevenueFallback(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              undefined,
              `video==${videoId}`,
              activityMetrics,
            ),
            queryWithRevenueFallback(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              ["insightTrafficSourceType"],
              `video==${videoId}`,
              ["views", "estimatedMinutesWatched"],
            ),
            queryOptionalReport(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              ["ageGroup", "gender"],
              `video==${videoId}`,
              ["viewerPercentage"],
            ),
            queryOptionalReport(
              accessToken,
              channel.youtube_channel_id,
              startDate,
              endDate,
              ["elapsedVideoTimeRatio"],
              `video==${videoId}`,
              ["audienceWatchRatio", "relativeRetentionPerformance"],
            ),
          ]);

          const summaryRow = rowsFromPayload(summary.payload)[0] ?? {};
          const timelineRows = rowsFromPayload(timeline.payload).map((row) => ({
            date: String(row.day ?? ""),
            views: numberOrNull(row.views),
            watchTimeMinutes: numberOrNull(row.estimatedMinutesWatched),
            averageViewDurationSeconds: numberOrNull(row.averageViewDuration),
            averageViewPercentage: numberOrNull(row.averageViewPercentage),
            likes: numberOrNull(row.likes),
            comments: numberOrNull(row.comments),
            shares: numberOrNull(row.shares),
            subscribersGained: numberOrNull(row.subscribersGained),
            subscribersLost: numberOrNull(row.subscribersLost),
            estimatedRevenue: timeline.revenueAvailable ? numberOrNull(row.estimatedRevenue) : null,
          }));
          const trafficRows = rowsFromPayload(traffic.payload)
            .map((row) => ({
              source: String(row.insightTrafficSourceType ?? "UNSPECIFIED"),
              views: numberOrNull(row.views),
              watchTimeMinutes: numberOrNull(row.estimatedMinutesWatched),
              estimatedRevenue: traffic.revenueAvailable
                ? numberOrNull(row.estimatedRevenue)
                : null,
            }))
            .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
          const demographicRows = rowsFromPayload(demographics).map((row) => ({
            ageGroup: String(row.ageGroup ?? "UNKNOWN"),
            gender: String(row.gender ?? "UNKNOWN"),
            viewerPercentage: numberOrNull(row.viewerPercentage),
          }));
          const retentionRows = rowsFromPayload(retention)
            .map((row) => ({
              elapsedVideoTimeRatio: numberOrNull(row.elapsedVideoTimeRatio),
              audienceWatchRatio: numberOrNull(row.audienceWatchRatio),
              relativeRetentionPerformance: numberOrNull(row.relativeRetentionPerformance),
            }))
            .filter((row) => row.elapsedVideoTimeRatio !== null)
            .sort((a, b) => (a.elapsedVideoTimeRatio ?? 0) - (b.elapsedVideoTimeRatio ?? 0));

          const summaryAvailable = Boolean(summary.payload && Object.keys(summaryRow).length);

          const timelineAvailable = timelineRows.length > 0;
          const revenueAvailable = Boolean(
            summary.revenueAvailable || timeline.revenueAvailable || traffic.revenueAvailable,
          );
          const reportSucceeded = Boolean(
            summary.payload || timeline.payload || traffic.payload || demographics || retention,
          );

          void service.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "reports.query.video_detail",
            quota_units: 5,
            succeeded: reportSucceeded,
          });

          return json(
            {
              data: {
                range,
                startDate,
                endDate,
                channel: {
                  id: channel.id,
                  title: channel.channel_name,
                  handle: channel.channel_handle,
                },
                video,
                summary: {
                  available: summaryAvailable,
                  views: numberOrNull(summaryRow.views),
                  watchTimeMinutes: numberOrNull(summaryRow.estimatedMinutesWatched),
                  averageViewDurationSeconds: numberOrNull(summaryRow.averageViewDuration),
                  averageViewPercentage: numberOrNull(summaryRow.averageViewPercentage),
                  likes: numberOrNull(summaryRow.likes),
                  comments: numberOrNull(summaryRow.comments),
                  shares: numberOrNull(summaryRow.shares),
                  subscribersGained: numberOrNull(summaryRow.subscribersGained),
                  subscribersLost: numberOrNull(summaryRow.subscribersLost),
                  estimatedRevenue: summary.revenueAvailable
                    ? numberOrNull(summaryRow.estimatedRevenue)
                    : null,
                  cpm: summary.revenueAvailable ? numberOrNull(summaryRow.cpm) : null,
                  playbackBasedCpm: summary.revenueAvailable
                    ? numberOrNull(summaryRow.playbackBasedCpm)
                    : null,
                  revenueAvailable,
                },
                timeline: {
                  available: timelineAvailable,
                  rows: timelineRows,
                  revenueAvailable: timeline.revenueAvailable,
                },
                trafficSources: {
                  available: trafficRows.length > 0,
                  rows: trafficRows,
                  revenueAvailable: traffic.revenueAvailable,
                },
                demographics: {
                  available: demographicRows.length > 0,
                  rows: demographicRows,
                },
                retention: {
                  available: retentionRows.length > 0,
                  rows: retentionRows,
                },
              },
              meta: {
                source: "youtube_analytics_api",
                available: reportSucceeded,
                revenueAvailable,
                fetchedAt: new Date().toISOString(),
              },
            },
            {
              headers: {
                "Cache-Control": forceFresh
                  ? "private, no-store"
                  : "private, max-age=30, stale-while-revalidate=60",
              },
            },
          );
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND") {
            return json({ error: "YOUTUBE_VIDEO_NOT_FOUND" }, { status: 404 });
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_CHANNEL_MISMATCH") {
            return json({ error: "YOUTUBE_VIDEO_CHANNEL_MISMATCH" }, { status: 422 });
          }
          console.error("YouTube video analytics request failed", { reason: safeReason(error) });
          return json({ error: "YOUTUBE_ANALYTICS_ERROR" }, { status: 502 });
        }
      },
    },
  },
});
