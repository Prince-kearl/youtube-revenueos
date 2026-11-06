import { ApiRequestError, fetchJson } from "../api-client";
import {
  dashboardRevenueUrls,
  mapDashboardRevenue,
  mapTopRevenueVideos,
  type DashboardRevenueView,
  type DashboardTopVideo,
} from "../dashboard-revenue";
import type { RevenueSummaryResponse } from "../server/revenue-summary";
import type { RevenueVideosResponse } from "../server/revenue-videos";

type RevenueSummaryEnvelope = { data?: RevenueSummaryResponse };
type RevenueVideosEnvelope = { data?: RevenueVideosResponse };

export type DashboardRevenueData = {
  view: DashboardRevenueView;
  topVideos: DashboardTopVideo[];
};

export type YoutubeDashboardData<T> =
  | { status: "connected"; data: T }
  | { status: "not_connected"; data: null }
  | { status: "reauth"; data: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Fetch the required summary and the optional top-video detail as one cacheable view. */
export async function fetchDashboardRevenue(
  channelId: string | null,
  signal: AbortSignal,
): Promise<DashboardRevenueData> {
  const urls = dashboardRevenueUrls(channelId);
  const [summaryBody, videosBody] = await Promise.all([
    fetchJson<RevenueSummaryEnvelope>(urls.summary, { cache: "no-store", signal }),
    fetchJson<RevenueVideosEnvelope>(urls.videos, { cache: "no-store", signal }).catch((error) => {
      // Video detail is optional; preserve the channel summary if that endpoint alone fails.
      if (signal.aborted) throw error;
      return null;
    }),
  ]);

  if (!summaryBody?.data) throw new ApiRequestError(502);
  return {
    view: mapDashboardRevenue(summaryBody.data),
    topVideos: videosBody?.data ? mapTopRevenueVideos(videosBody.data) : [],
  };
}

/** Read non-revenue YouTube dashboard data; revenue remains in its separately authorized API. */
export async function fetchYoutubeDashboard<T>(
  channelId: string | null,
  signal: AbortSignal,
  forceRefresh = false,
): Promise<YoutubeDashboardData<T>> {
  const params = new URLSearchParams({ revenue: "0" });
  if (channelId) params.set("channelId", channelId);
  if (forceRefresh) params.set("refresh", "1");

  const response = await fetch(`/api/youtube/dashboard?${params.toString()}`, {
    cache: forceRefresh ? "no-store" : "default",
    signal,
    headers: { Accept: "application/json" },
  });
  const body: unknown = await response.json().catch(() => null);

  if (response.status === 401 && isRecord(body) && body.error === "YOUTUBE_REAUTH_REQUIRED") {
    return { status: "reauth", data: null };
  }
  if (!response.ok) throw new ApiRequestError(response.status);
  if (isRecord(body) && body.status === "not_connected") {
    return { status: "not_connected", data: null };
  }
  if (isRecord(body) && body.status === "connected" && "data" in body && body.data) {
    return { status: "connected", data: body.data as T };
  }
  throw new ApiRequestError(502);
}
