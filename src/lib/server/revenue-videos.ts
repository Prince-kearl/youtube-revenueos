// GET /api/revenue/videos — per-video revenue performance from stored data.
//
//   route  →  this file  →  revenue-store  →  revenue-metrics  →  stored P0 data
//
// Like the summary endpoint, this reads stored rows through the caller's own (RLS-scoped) client,
// never calls YouTube, and computes nothing itself: per-video revenue, RPM and shares come from
// videoPerformance, changes from compareValues, the channel-versus-video picture from
// reconcilePeriod, and freshness from assessFreshness. Request dates use the same definition as
// the summary (resolveRevenuePeriod).
//
// A video's revenue is what its own stored rows say. It is never topped up from the channel
// total, and the videos listed here are not expected to add up to that total: whatever no video
// row explains is reported once, under `attribution`, and is not spread across videos.

import { z } from "zod";
import {
  assessFreshness,
  channelTotals,
  compareValues,
  periodLengthDays,
  previousPeriod,
  reconcilePeriod,
  videoPerformance,
  type MetricChange,
  type RevenueFreshness,
  type RevenuePeriod,
  type VideoRevenuePerformance,
} from "./revenue-metrics";
import { loadRevenueData, type RevenueChannel, type RevenueReadContext } from "./revenue-store";
import {
  amountView,
  describeAttribution,
  describeSync,
  readQueryParams,
  readSyncFacts,
  readVideos,
  resolveRevenuePeriod,
  revenueErrorResponse,
  revenueJson,
  revenuePeriodParams,
  RevenueSummaryError,
  type AttributionView,
  type ChannelSyncFacts,
  type RevenueAmountView,
  type SyncView,
} from "./revenue-summary";
import { isoDay } from "./youtube-stats-sync";

// ============================================================================================
// Request
// ============================================================================================

export const DEFAULT_VIDEO_PAGE_SIZE = 50;
export const MAX_VIDEO_PAGE_SIZE = 100;

export const VIDEO_SORT_KEYS = ["revenue", "views", "rpm", "watchMinutes", "revenueShare"] as const;
export type VideoSortKey = (typeof VIDEO_SORT_KEYS)[number];

const querySchema = z.object({
  ...revenuePeriodParams,
  limit: z.coerce.number().int().min(1).max(MAX_VIDEO_PAGE_SIZE).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  sort: z.enum(VIDEO_SORT_KEYS).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

export interface RevenueVideosQuery {
  period: RevenuePeriod;
  defaulted: boolean;
  channelId: string | null;
  limit: number;
  offset: number;
  sort: VideoSortKey;
  direction: "asc" | "desc";
}

/** Same period rules as the summary endpoint; unknown parameters (including any workspace id)
 * are ignored. */
export function parseRevenueVideosQuery(url: URL, today: string): RevenueVideosQuery {
  const parsed = querySchema.safeParse(readQueryParams(url));
  if (!parsed.success) throw new RevenueSummaryError("VALIDATION_ERROR", 422);
  const { channelId, limit, offset, sort, direction } = parsed.data;
  return {
    ...resolveRevenuePeriod(parsed.data, today),
    channelId: channelId ?? null,
    limit: limit ?? DEFAULT_VIDEO_PAGE_SIZE,
    offset: offset ?? 0,
    sort: sort ?? "revenue",
    direction: direction ?? "desc",
  };
}

// ============================================================================================
// Response
// ============================================================================================

/**
 * How far one video's figures for the period can be relied on.
 *
 *   unavailable  none of its stored days carries revenue
 *   partial      some of its stored days carry revenue and some do not
 *   provisional  revenue is known, but the period reaches into days YouTube may still revise or
 *                has not reported yet
 *   complete     revenue is known for every stored day and the period is settled
 */
export type VideoDataAvailability = "complete" | "provisional" | "partial" | "unavailable";

export interface VideoPeriodFigures {
  revenue: RevenueAmountView;
  views: number;
  watchMinutes: number;
  rpm: number | null;
}

export interface RevenueVideoItem extends VideoPeriodFigures {
  videoId: string;
  youtubeVideoId: string | null;
  title: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  channelId: string;
  channelTitle: string | null;
  /** False when YouTube no longer returns this video; its stored history is still reported.
   * Null when the video's catalogue entry could not be read. */
  currentlyListed: boolean | null;
  /** Share of the CHANNEL-level earned revenue of all channels in scope (0–1). Shares need not
   * add up to 1. Null when either side is unknown or the channel total is zero. */
  revenueShare: number | null;
  /** Share of channel-level views (0–1). */
  viewShare: number | null;
  /** The same video over the immediately preceding period of equal length. A video with no
   * stored days there has unavailable revenue and zero activity. */
  previous: VideoPeriodFigures;
  /** Each change has `absolute` and `percent`; percent is null when either side is unknown or
   * the previous value is zero. */
  change: {
    revenue: MetricChange;
    views: MetricChange;
    watchMinutes: MetricChange;
    rpm: MetricChange;
  };
  dataQuality: {
    availability: VideoDataAvailability;
    /** True when the period includes days that are provisional or not reported yet, so the
     * newest part of this video's trend may still move. */
    incompleteTrend: boolean;
    /** True when this video has stored activity on a provisional day. */
    hasProvisionalDays: boolean;
    /** False when the video is known but its history has never been loaded by the sync. */
    historyLoaded: boolean | null;
  };
}

export interface RevenueVideosResponse {
  status: "connected" | "not_connected";
  currency: "USD";
  dateBasis: "youtube_reporting_day";
  period: RevenuePeriod & { days: number; defaulted: boolean };
  previousPeriod: RevenuePeriod;
  channels: RevenueChannel[];
  sort: { by: VideoSortKey; direction: "asc" | "desc" };
  /** Videos with stored activity in the period — one page of them. */
  videos: RevenueVideoItem[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  /** The channel-level picture the videos sit inside. The videos above explain
   * `attributedRevenue`; `unattributedRevenue` is channel revenue no video row explains. */
  attribution: AttributionView;
  dataQuality: { freshness: RevenueFreshness; sync: SyncView };
}

const NO_ACTIVITY: VideoPeriodFigures = {
  revenue: { usd: null, availability: "unavailable", knownDays: 0, unknownDays: 0 },
  views: 0,
  watchMinutes: 0,
  rpm: null,
};

function figures(video: VideoRevenuePerformance | undefined): VideoPeriodFigures {
  if (!video) return NO_ACTIVITY;
  return {
    revenue: amountView(video.earned),
    views: video.views,
    watchMinutes: video.watchMinutes,
    rpm: video.rpm,
  };
}

const SORT_VALUE: Record<VideoSortKey, (video: RevenueVideoItem) => number | null> = {
  revenue: (video) => video.revenue.usd,
  views: (video) => video.views,
  rpm: (video) => video.rpm,
  watchMinutes: (video) => video.watchMinutes,
  revenueShare: (video) => video.revenueShare,
};

/**
 * Pure. Orders by the calculated value. A video whose value is unknown (null) always goes AFTER
 * every video with a known value, in both directions: "lowest revenue first" must not start
 * with the videos whose revenue is not known at all. Ties are broken by views (highest first)
 * and then by video id, so the order — and therefore pagination — is stable.
 */
export function sortRevenueVideos(
  videos: RevenueVideoItem[],
  sort: VideoSortKey,
  direction: "asc" | "desc",
): RevenueVideoItem[] {
  const value = SORT_VALUE[sort];
  const sign = direction === "asc" ? 1 : -1;
  return [...videos].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if ((left === null) !== (right === null)) return left === null ? 1 : -1;
    if (left !== null && right !== null && left !== right) return (left - right) * sign;
    return b.views - a.views || a.videoId.localeCompare(b.videoId);
  });
}

// ============================================================================================
// Build
// ============================================================================================

export async function buildRevenueVideos(
  ctx: RevenueReadContext,
  query: RevenueVideosQuery,
  options: { today: string },
): Promise<RevenueVideosResponse> {
  const { period } = query;
  const prior = previousPeriod(period);
  // One read covers the period and the one before it.
  const dataset = await loadRevenueData(
    ctx,
    { startDate: prior.startDate, endDate: period.endDate },
    { channelId: query.channelId ?? undefined },
  );
  // Unknown, foreign and disconnected channel ids are indistinguishable on purpose.
  if (query.channelId && dataset.channels.length === 0)
    throw new RevenueSummaryError("CHANNEL_NOT_FOUND", 404);

  const channelIds = dataset.channels.map((channel) => channel.id);
  const channelName = new Map(dataset.channels.map((channel) => [channel.id, channel.name]));
  const catalogue = channelIds.length ? await readVideos(ctx, channelIds) : [];
  const facts = channelIds.length
    ? await readSyncFacts(ctx, channelIds, catalogue)
    : new Map<string, ChannelSyncFacts>();
  const meta = new Map(catalogue.map((video) => [video.id, video]));

  const freshness = assessFreshness(
    dataset.channelRows,
    period,
    options.today,
    undefined,
    channelIds,
  );
  const unsettledPeriod = freshness.provisionalDays.length > 0 || freshness.pendingDays.length > 0;
  const provisional = new Set(freshness.provisionalDays);
  const videosOnProvisionalDays = new Set(
    dataset.videoRows.filter((row) => provisional.has(row.day)).map((row) => row.videoId),
  );

  const current = videoPerformance(
    dataset.videoRows,
    period,
    channelTotals(dataset.channelRows, period),
  );
  const previousById = new Map(
    videoPerformance(dataset.videoRows, prior, channelTotals(dataset.channelRows, prior)).map(
      (video) => [video.videoId, video],
    ),
  );

  const all = current.map((video): RevenueVideoItem => {
    const info = meta.get(video.videoId);
    const now = figures(video);
    const before = figures(previousById.get(video.videoId));
    const hasProvisionalDays = videosOnProvisionalDays.has(video.videoId);
    const availability: VideoDataAvailability =
      now.revenue.availability !== "available"
        ? now.revenue.availability
        : unsettledPeriod
          ? "provisional"
          : "complete";
    return {
      videoId: video.videoId,
      youtubeVideoId: info?.youtube_video_id ?? null,
      title: info?.title ?? null,
      thumbnail: info?.thumbnail ?? null,
      publishedAt: info?.published_at ?? null,
      channelId: video.channelId,
      channelTitle: channelName.get(video.channelId) ?? null,
      currentlyListed: info ? info.status !== "deleted" : null,
      ...now,
      revenueShare: video.revenueShare,
      viewShare: video.viewShare,
      previous: before,
      change: {
        revenue: compareValues(now.revenue.usd, before.revenue.usd),
        views: compareValues(now.views, before.views),
        watchMinutes: compareValues(now.watchMinutes, before.watchMinutes),
        rpm: compareValues(now.rpm, before.rpm),
      },
      dataQuality: {
        availability,
        incompleteTrend: unsettledPeriod,
        hasProvisionalDays,
        historyLoaded: info ? Boolean(info.analytics_updated_at) : null,
      },
    };
  });

  const sorted = sortRevenueVideos(all, query.sort, query.direction);
  const page = sorted.slice(query.offset, query.offset + query.limit);
  return {
    status: channelIds.length ? "connected" : "not_connected",
    currency: "USD",
    dateBasis: "youtube_reporting_day",
    period: { ...period, days: periodLengthDays(period), defaulted: query.defaulted },
    previousPeriod: prior,
    channels: dataset.channels,
    sort: { by: query.sort, direction: query.direction },
    videos: page,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: sorted.length,
      hasMore: query.offset + page.length < sorted.length,
    },
    attribution: describeAttribution(
      dataset,
      period,
      facts,
      reconcilePeriod(dataset.channelRows, dataset.videoRows, period),
    ),
    dataQuality: { freshness, sync: describeSync(channelIds, facts) },
  };
}

// ============================================================================================
// HTTP
// ============================================================================================

export interface RevenueVideosDeps {
  /** Resolves the signed-in caller and their workspace; throws a Response when there is none. */
  getContext(request: Request): Promise<RevenueReadContext>;
  now(): Date;
}

export async function handleRevenueVideosRequest(
  request: Request,
  deps: RevenueVideosDeps,
): Promise<Response> {
  try {
    const ctx = await deps.getContext(request);
    const today = isoDay(deps.now());
    const query = parseRevenueVideosQuery(new URL(request.url), today);
    return revenueJson({ data: await buildRevenueVideos(ctx, query, { today }) });
  } catch (error) {
    return revenueErrorResponse(error, "Revenue videos failed");
  }
}
