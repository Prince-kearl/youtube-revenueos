import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function analyticsRows(payload: unknown): Array<Record<string, string | number>> {
  const report = payload as AnalyticsPayload;
  const headers = report.columnHeaders?.map((header) => header.name) ?? [];
  return (report.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? 0])),
  );
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
  event: {
    user_id: string;
    channel_id: string;
    operation: string;
    quota_units: number;
    succeeded: boolean;
  },
) {
  void serviceClient
    .from("youtube_quota_events")
    .insert(event)
    .then(({ error }) => {
      if (error) logOptionalFailure("quota_audit", event.user_id, event.channel_id, error);
    });
}

// "forbidden" is distinct from "unavailable": the request reached YouTube and was rejected for
// auth/permission reasons (401/403) — most commonly a token that predates a scope being added to
// YOUTUBE_OAUTH_SCOPES (e.g. yt-analytics-monetary.readonly for revenue), fixable by
// reconnecting — versus "unavailable", which means the request succeeded but YouTube genuinely
// has nothing to report for the period (e.g. an unmonetized channel). The two need different UI:
// one is actionable, the other isn't.
type AnalyticsAvailability = "available" | "unavailable" | "disabled" | "forbidden";

function isPermissionError(error: unknown): boolean {
  const reason = safeProviderReason(error);
  return reason === "401" || reason === "403";
}

function mergeAnalyticsReports(
  ...payloads: Array<AnalyticsPayload | null>
): AnalyticsPayload | null {
  const reports = payloads.filter((payload): payload is AnalyticsPayload => Boolean(payload));
  if (!reports.length) return null;

  const headers = [
    "month",
    ...new Set(
      reports.flatMap(
        (report) =>
          report.columnHeaders
            ?.map((header) => header.name)
            .filter((name) => name !== "day" && name !== "month")
            .map((name) => (name === "estimatedMinutesWatched" ? "watchTimeMinutes" : name)) ?? [],
      ),
    ),
  ];

  const rows = new Map<string, Array<string | number>>();
  for (const report of reports) {
    const reportHeaders = report.columnHeaders?.map((header) => header.name) ?? [];
    const dayIndex = reportHeaders.indexOf("day");
    const monthIndex = reportHeaders.indexOf("month");

    for (const row of report.rows ?? []) {
      const dateStr = String(row[dayIndex >= 0 ? dayIndex : monthIndex] ?? "");
      const monthKey = dateStr.slice(0, 7); // YYYY-MM
      if (!monthKey || monthKey.length !== 7) continue;

      const merged = rows.get(monthKey) ?? headers.map((h) => (h === "month" ? monthKey : 0));
      for (let i = 0; i < reportHeaders.length; i++) {
        const header = reportHeaders[i];
        if (header === "day" || header === "month") continue;
        const targetHeader = header === "estimatedMinutesWatched" ? "watchTimeMinutes" : header;
        const targetIndex = headers.indexOf(targetHeader);
        if (targetIndex >= 0) {
          const val = row[i];
          if (typeof val === "number") {
            merged[targetIndex] = (Number(merged[targetIndex]) || 0) + val;
          } else {
            merged[targetIndex] = val;
          }
        }
      }
      rows.set(monthKey, merged);
    }
  }

  const sortedRows = [...rows.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { columnHeaders: headers.map((name) => ({ name })), rows: sortedRows };
}

export const Route = createFileRoute("/api/youtube/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const requestUrl = new URL(request.url);
          const requestedChannelId = requestUrl.searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const forceRefresh = requestUrl.searchParams.get("refresh") === "1";
          const cacheHeaders = forceRefresh ? { "Cache-Control": "private, no-store" } : undefined;
          let channelQuery = client

            .from("youtube_channels")
            .select(
              "id, user_id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, token_expiry",
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
              : json({ data: null, status: "not_connected" });
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
          recordQuotaEvent(serviceClient, {
            user_id: channelRow.user_id,
            channel_id: channelRow.id,
            operation: "channels.list",
            quota_units: 1,
            succeeded: true,
          });
          const { data: integrationSettings } = await client
            .from("youtube_integration_settings")
            .select("auto_sync_videos, import_analytics")
            .eq("channel_id", channelRow.id)
            .maybeSingle();
          const settings = { ...defaults, ...(integrationSettings ?? {}) };
          let videos = [] as Awaited<ReturnType<typeof fetchRecentYoutubeVideos>>;
          let videosStatus: "available" | "unavailable" | "disabled" = settings.auto_sync_videos
            ? "available"
            : "disabled";
          let videosRequestSucceeded = false;
          if (settings.auto_sync_videos) {
            try {
              videos = await fetchRecentYoutubeVideos(accessToken, channel.uploadsPlaylistId);
              videosRequestSucceeded = true;
            } catch (error) {
              videosStatus = "unavailable";
              logOptionalFailure("recent_videos", channelRow.user_id, channelRow.id, error);
            }
          }
          if (settings.auto_sync_videos) {
            recordQuotaEvent(serviceClient, {
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "playlistItems.list,videos.list",
              quota_units: 101,
              succeeded: videosRequestSucceeded,
            });
          }

          const startDate = new Date();
          startDate.setUTCMonth(startDate.getUTCMonth() - 12);
          const endDate = new Date();
          let analytics: AnalyticsPayload | null = null;
          let analyticsRequestSucceeded = false;
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
                dimensions: ["day"],
              })) as AnalyticsPayload;
              analyticsRequestSucceeded = true;
            } catch (error) {
              analyticsStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("analytics_core", channelRow.user_id, channelRow.id, error);
            }
            let revenue: AnalyticsPayload | null = null;
            try {
              revenue = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(startDate),
                endDate: isoDate(endDate),
                // estimatedAdRevenue / estimatedRedPartnerRevenue (YouTube Premium's revenue
                // share) are real per-source breakdowns YouTube itself reports — used by the
                // Revenue Split card. Anything not covered by those two (Shorts fund, Super
                // Chat/Thanks, etc.) is shown there as "Other", computed client-side as the
                // remainder against estimatedRevenue rather than fabricated categories YouTube
                // doesn't actually track (e.g. brand deals, affiliate links).
                metrics: ["estimatedRevenue", "estimatedAdRevenue", "estimatedRedPartnerRevenue"],
                dimensions: ["day"],
              })) as AnalyticsPayload;
              analyticsRequestSucceeded = true;
            } catch (error) {
              revenueStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("analytics_revenue", channelRow.user_id, channelRow.id, error);
            }
            let watchTime: AnalyticsPayload | null = null;
            try {
              watchTime = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(startDate),
                endDate: isoDate(endDate),
                metrics: ["estimatedMinutesWatched"],
                dimensions: ["day"],
              })) as AnalyticsPayload;
              analyticsRequestSucceeded = true;
            } catch (error) {
              watchTimeStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("analytics_watch_time", channelRow.user_id, channelRow.id, error);
            }
            analytics = mergeAnalyticsReports(coreAnalytics, revenue, watchTime);
            // Only downgrades a still-"available" status (the request succeeded but came back
            // empty) — must not run when the catch blocks above already classified the failure as
            // "forbidden", since the payload is null there too and this would otherwise silently
            // relabel a permission error as "no data reported".
            if (analyticsStatus === "available" && !coreAnalytics?.rows?.length) analyticsStatus = "unavailable";
            if (revenueStatus === "available" && !revenue?.rows?.length) revenueStatus = "unavailable";
            if (watchTimeStatus === "available" && !watchTime?.rows?.length) watchTimeStatus = "unavailable";
          }
          if (settings.import_analytics) {
            recordQuotaEvent(serviceClient, {
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "reports.query",
              quota_units: 3,
              succeeded: analyticsRequestSucceeded,
            });
          }

          let audienceStatus: AnalyticsAvailability = settings.import_analytics
            ? "available"
            : "disabled";
          let topCountries: Array<{ country: string; views: number }> = [];
          let ageGroups: Array<{ ageGroup: string; viewerPercentage: number }> = [];
          let genders: Array<{ gender: string; viewerPercentage: number }> = [];
          if (settings.import_analytics) {
            let audienceRequestSucceeded = false;
            try {
              const [countryPayload, agePayload, genderPayload] = await Promise.all([
                queryYoutubeAnalytics(accessToken, {
                  channelId: channel.channelId,
                  startDate: isoDate(startDate),
                  endDate: isoDate(endDate),
                  metrics: ["views"],
                  dimensions: ["country"],
                  sort: "-views",
                  maxResults: 10,
                }) as Promise<AnalyticsPayload>,
                queryYoutubeAnalytics(accessToken, {
                  channelId: channel.channelId,
                  startDate: isoDate(startDate),
                  endDate: isoDate(endDate),
                  metrics: ["viewerPercentage"],
                  dimensions: ["ageGroup"],
                }) as Promise<AnalyticsPayload>,
                queryYoutubeAnalytics(accessToken, {
                  channelId: channel.channelId,
                  startDate: isoDate(startDate),
                  endDate: isoDate(endDate),
                  metrics: ["viewerPercentage"],
                  dimensions: ["gender"],
                }) as Promise<AnalyticsPayload>,
              ]);
              audienceRequestSucceeded = true;
              topCountries = analyticsRows(countryPayload).map((row) => ({
                country: String(row.country ?? ""),
                views: Number(row.views ?? 0),
              }));
              ageGroups = analyticsRows(agePayload).map((row) => ({
                ageGroup: String(row.ageGroup ?? ""),
                viewerPercentage: Number(row.viewerPercentage ?? 0),
              }));
              genders = analyticsRows(genderPayload).map((row) => ({
                gender: String(row.gender ?? ""),
                viewerPercentage: Number(row.viewerPercentage ?? 0),
              }));
              if (!topCountries.length && !ageGroups.length && !genders.length)
                audienceStatus = "unavailable";
            } catch (error) {
              audienceStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("audience_breakdown", channelRow.user_id, channelRow.id, error);
            }
            recordQuotaEvent(serviceClient, {
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "reports.query.audience",
              quota_units: 3,
              succeeded: audienceRequestSucceeded,
            });
          }

          // Video Insights — the latest synced video's own performance. Views/engagement (likes +
          // comments) come straight from the already-fetched `videos` list (zero extra API calls);
          // only subscribersGained and the device-type split need a video-filtered analytics query.
          const latestVideo = videos[0] ?? null;
          let videoInsightsStatus: AnalyticsAvailability =
            settings.import_analytics && settings.auto_sync_videos ? "available" : "disabled";
          let videoSubscribersGained = 0;
          let deviceViews: { desktop: number; mobile: number; tablet: number } = {
            desktop: 0,
            mobile: 0,
            tablet: 0,
          };
          if (videoInsightsStatus === "available" && latestVideo) {
            try {
              const [subsPayload, devicePayload] = await Promise.all([
                queryYoutubeAnalytics(accessToken, {
                  channelId: channel.channelId,
                  startDate: isoDate(startDate),
                  endDate: isoDate(endDate),
                  metrics: ["subscribersGained"],
                  filters: `video==${latestVideo.id}`,
                }) as Promise<AnalyticsPayload>,
                queryYoutubeAnalytics(accessToken, {
                  channelId: channel.channelId,
                  startDate: isoDate(startDate),
                  endDate: isoDate(endDate),
                  metrics: ["views"],
                  dimensions: ["deviceType"],
                  filters: `video==${latestVideo.id}`,
                }) as Promise<AnalyticsPayload>,
              ]);
              videoSubscribersGained = Number(analyticsRows(subsPayload)[0]?.subscribersGained ?? 0);
              for (const row of analyticsRows(devicePayload)) {
                const device = String(row.deviceType ?? "").toUpperCase();
                const views = Number(row.views ?? 0);
                if (device === "DESKTOP") deviceViews.desktop += views;
                else if (device === "MOBILE") deviceViews.mobile += views;
                else if (device === "TABLET") deviceViews.tablet += views;
              }
            } catch (error) {
              videoInsightsStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("video_insights", channelRow.user_id, channelRow.id, error);
            }
            recordQuotaEvent(serviceClient, {
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "reports.query.video_insights",
              quota_units: 2,
              succeeded: videoInsightsStatus === "available",
            });
          } else if (videoInsightsStatus === "available" && !latestVideo) {
            videoInsightsStatus = "unavailable";
          }

          // Weekly Engagement heatmap — daily channel views for the last 5 weeks, independent of
          // the 12-month monthly trend above (that one merges daily rows into months and discards
          // day-level granularity, which the heatmap needs).
          let engagementHeatmapStatus: AnalyticsAvailability = settings.import_analytics
            ? "available"
            : "disabled";
          let engagementHeatmap: Array<{ date: string; views: number }> = [];
          if (engagementHeatmapStatus === "available") {
            const heatmapStart = new Date();
            heatmapStart.setUTCDate(heatmapStart.getUTCDate() - 34);
            try {
              const heatmapPayload = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(heatmapStart),
                endDate: isoDate(endDate),
                metrics: ["views"],
                dimensions: ["day"],
              })) as AnalyticsPayload;
              engagementHeatmap = analyticsRows(heatmapPayload).map((row) => ({
                date: String(row.day ?? ""),
                views: Number(row.views ?? 0),
              }));
              if (!engagementHeatmap.length) engagementHeatmapStatus = "unavailable";
            } catch (error) {
              engagementHeatmapStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("engagement_heatmap", channelRow.user_id, channelRow.id, error);
            }
            recordQuotaEvent(serviceClient, {
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "reports.query.heatmap",
              quota_units: 1,
              succeeded: engagementHeatmapStatus === "available",
            });
          }

          // Top Revenue Videos — ranked over the same 12-month window as the rest of the
          // dashboard via YouTube Analytics' "video" dimension (one row per video, no per-video
          // filtering needed). "Change" is a separate, more recent signal: trailing-30-days views
          // vs the 30 days before that, for just these top videos — a longer ranking window and a
          // shorter trend window answer different questions, so they're intentionally not the same
          // date range.
          let topRevenueVideosStatus: AnalyticsAvailability = settings.import_analytics
            ? "available"
            : "disabled";
          let topRevenueVideos: Array<{
            videoId: string;
            views: number;
            revenue: number;
            changePercent: number | null;
          }> = [];
          if (topRevenueVideosStatus === "available") {
            try {
              const revenuePayload = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.channelId,
                startDate: isoDate(startDate),
                endDate: isoDate(endDate),
                metrics: ["views", "estimatedRevenue"],
                dimensions: ["video"],
                sort: "-estimatedRevenue",
                maxResults: 10,
              })) as AnalyticsPayload;
              const revenueRows = analyticsRows(revenuePayload)
                .map((row) => ({
                  videoId: String(row.video ?? ""),
                  views: Number(row.views ?? 0),
                  revenue: Number(row.estimatedRevenue ?? 0),
                }))
                .filter((row) => row.videoId && row.revenue > 0);

              if (revenueRows.length) {
                const trendEnd = new Date();
                const trendStart = new Date();
                trendStart.setUTCDate(trendStart.getUTCDate() - 30);
                const prevTrendEnd = new Date(trendStart);
                const prevTrendStart = new Date(trendStart);
                prevTrendStart.setUTCDate(prevTrendStart.getUTCDate() - 30);
                const videoIdFilter = revenueRows.map((row) => row.videoId).join(",");

                const [currentTrendPayload, prevTrendPayload] = await Promise.all([
                  queryYoutubeAnalytics(accessToken, {
                    channelId: channel.channelId,
                    startDate: isoDate(trendStart),
                    endDate: isoDate(trendEnd),
                    metrics: ["views"],
                    dimensions: ["video"],
                    filters: `video==${videoIdFilter}`,
                  }).catch(() => null) as Promise<AnalyticsPayload | null>,
                  queryYoutubeAnalytics(accessToken, {
                    channelId: channel.channelId,
                    startDate: isoDate(prevTrendStart),
                    endDate: isoDate(prevTrendEnd),
                    metrics: ["views"],
                    dimensions: ["video"],
                    filters: `video==${videoIdFilter}`,
                  }).catch(() => null) as Promise<AnalyticsPayload | null>,
                ]);
                const currentTrendById = new Map(
                  analyticsRows(currentTrendPayload).map((row) => [String(row.video ?? ""), Number(row.views ?? 0)]),
                );
                const prevTrendById = new Map(
                  analyticsRows(prevTrendPayload).map((row) => [String(row.video ?? ""), Number(row.views ?? 0)]),
                );

                topRevenueVideos = revenueRows.map((row) => {
                  const prevViews = prevTrendById.get(row.videoId) ?? 0;
                  const currentViews = currentTrendById.get(row.videoId) ?? 0;
                  const changePercent = prevViews > 0 ? ((currentViews - prevViews) / prevViews) * 100 : null;
                  return { ...row, changePercent };
                });
              } else {
                topRevenueVideosStatus = "unavailable";
              }
            } catch (error) {
              topRevenueVideosStatus = isPermissionError(error) ? "forbidden" : "unavailable";
              logOptionalFailure("top_revenue_videos", channelRow.user_id, channelRow.id, error);
            }
            recordQuotaEvent(serviceClient, {
              user_id: channelRow.user_id,
              channel_id: channelRow.id,
              operation: "reports.query.top_revenue_videos",
              quota_units: 3,
              succeeded: topRevenueVideosStatus === "available",
            });
          }

          const { error: channelSyncError } = await client
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
          if (channelSyncError)
            logOptionalFailure(
              "persist_channel",
              channelRow.user_id,
              channelRow.id,
              channelSyncError,
            );
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
                status: video.privacyStatus === "public" ? "active" : "archived",
              })),
              { onConflict: "channel_id,youtube_video_id" },
            );
            if (videosSyncError)
              logOptionalFailure(
                "persist_videos",
                channelRow.user_id,
                channelRow.id,
                videosSyncError,
              );
          }
          const fetchedAt = new Date().toISOString();
          return json(
            {
              status: "connected",
              data: {
                channel: { ...channel, url: channelUrl(channel) },
                videos,
                videosStatus,
                analytics: analyticsRows(analytics),
                analyticsStatus,
                revenueStatus,
                watchTimeStatus,
                audience: { topCountries, ageGroups, genders },
                audienceStatus,
                videoInsights: { subscribersGained: videoSubscribersGained, devices: deviceViews },
                videoInsightsStatus,
                engagementHeatmap,
                engagementHeatmapStatus,
                topRevenueVideos,
                topRevenueVideosStatus,
                fetchedAt,
                meta: { lastUpdated: fetchedAt },
                sections: {
                  channel: { available: true },
                  videos: { available: videosStatus === "available" },
                  analytics: { available: analyticsStatus === "available" },
                  revenue: { available: revenueStatus === "available" },
                  watchTime: { available: watchTimeStatus === "available" },
                  audience: { available: audienceStatus === "available" },
                  videoInsights: { available: videoInsightsStatus === "available" },
                  engagementHeatmap: { available: engagementHeatmapStatus === "available" },
                  topRevenueVideos: { available: topRevenueVideosStatus === "available" },
                },
              },
            },
            { headers: cacheHeaders },
          );
        } catch (error) {
          if (error instanceof Response) return error;
          const message = error instanceof Error ? error.message : "";
          const reason = safeProviderReason(error);
          console.error("YouTube dashboard required operation failed", {
            reason,
            timestamp: new Date().toISOString(),
          });
          if (isYoutubeReauthError(error)) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          if (message === "YOUTUBE_CONNECTED_CHANNEL_MISMATCH") {
            return json({ error: "YOUTUBE_CONNECTED_CHANNEL_MISMATCH" }, { status: 409 });
          }
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
