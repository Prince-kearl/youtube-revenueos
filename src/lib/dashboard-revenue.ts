// Dashboard revenue: turns the canonical revenue API responses into exactly what the Dashboard
// displays.
//
//   Dashboard  →  GET /api/revenue/summary + GET /api/revenue/videos  →  stored revenue data
//
// Nothing here calculates revenue. Totals, the period-over-period change, the trend, the split
// and per-video figures all arrive calculated from the canonical layer; this module only picks
// the fields each card shows and words the states honestly:
//
//   a reported $0          → "$0"            (real data)
//   revenue not available  → "—"             (never "$0")
//   partly reported        → the known amount, flagged as partial
//
// It is a pure module (no React, no fetch) so every one of those decisions is unit-tested.

import type { RevenueAmountView, RevenueSummaryResponse } from "@/lib/server/revenue-summary";
import type { RevenueVideosResponse } from "@/lib/server/revenue-videos";

/** The Dashboard shows a trailing year, by month — the same window it has always shown. */
export const DASHBOARD_REVENUE_DAYS = 365;
export const DASHBOARD_TOP_VIDEOS = 5;

export type DashboardRevenueRange = "3M" | "6M" | "12M";

/** The two canonical requests behind the Dashboard's revenue cards. The active channel is always
 * passed when one is selected, so revenue is scoped exactly like the rest of the page. */
export function dashboardRevenueUrls(activeChannelId: string | null): {
  summary: string;
  videos: string;
} {
  const scope = activeChannelId ? `&channelId=${encodeURIComponent(activeChannelId)}` : "";
  return {
    summary: `/api/revenue/summary?days=${DASHBOARD_REVENUE_DAYS}&granularity=month${scope}`,
    videos: `/api/revenue/videos?days=${DASHBOARD_REVENUE_DAYS}&limit=${DASHBOARD_TOP_VIDEOS}&sort=revenue&direction=desc${scope}`,
  };
}

// ---------- formatting ----------

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const withCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const UNAVAILABLE = "—";

/** "$1,234" for larger amounts, cents kept below $100 so a small channel's revenue is not
 * rounded away to "$0". A null amount is "—": unavailable is never shown as zero. */
export function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return UNAVAILABLE;
  return Math.abs(usd) > 0 && Math.abs(usd) < 100
    ? withCents.format(usd)
    : wholeDollars.format(usd);
}

function signedUsd(usd: number): string {
  return `${usd >= 0 ? "+" : "-"}${formatUsd(Math.abs(usd))}`;
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shortMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    timeZone: "UTC",
  });
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------- data-quality notice ----------

/**
 * Whether the stored revenue data behind a response has a known problem, from the two facts the
 * canonical revenue APIs already report for the channels in scope:
 *
 *   "sync_error"    the most recent revenue-data sync of a channel in scope did not complete
 *   "missing_days"  days in the period that should have been reported by now have nothing stored
 *
 * They are different things — a failed run can leave the data fully current, and data can be
 * missing without any run having failed — so each has its own wording. When both hold, the sync
 * error is the one reported: it is the more specific statement, and one notice is enough.
 */
export type RevenueDataNotice = "sync_error" | "missing_days" | null;

const REVENUE_DATA_NOTICE_TEXT: Record<Exclude<RevenueDataNotice, null>, string> = {
  sync_error: "the latest update didn't complete",
  missing_days: "some data for this period is still unavailable",
};

export function revenueDataNotice(dataQuality: {
  freshness: { missingDays: string[] };
  sync: Array<{ hasSyncError: boolean }>;
}): RevenueDataNotice {
  if (dataQuality.sync.some((channel) => channel.hasSyncError)) return "sync_error";
  return dataQuality.freshness.missingDays.length > 0 ? "missing_days" : null;
}

/** The notice as a lower-case phrase without a full stop ("" when there is none), so it can be
 * joined onto an existing note or used as a sentence. */
export function revenueDataNoticeText(
  notice: RevenueDataNotice,
  options: { sentence?: boolean } = {},
): string {
  if (!notice) return "";
  const text = REVENUE_DATA_NOTICE_TEXT[notice];
  return options.sentence ? `${text[0].toUpperCase()}${text.slice(1)}.` : text;
}

/** The notice to keep when two responses are combined. */
export function strongerRevenueDataNotice(
  a: RevenueDataNotice,
  b: RevenueDataNotice,
): RevenueDataNotice {
  return a === "sync_error" || b === "sync_error" ? "sync_error" : (a ?? b);
}

// ---------- view model ----------

export interface RevenueFigure {
  /** What to print: "$0", "$12.40", "$1,234" or "—". */
  text: string;
  usd: number | null;
  /** True when only part of the period was reported; `text` is then the known part. */
  partial: boolean;
  /** False when there is nothing to show at all (text is "—"). */
  available: boolean;
}

export interface DashboardRevenueTrendPoint {
  monthKey: string;
  /** Axis label, e.g. "Oct". */
  month: string;
  /** Revenue for the month, in USD; null when not available (drawn as a gap, not as $0). */
  revenueUsd: number | null;
  incomplete: boolean;
}

export interface DashboardRevenueSplitRow {
  key: "ads" | "premium" | "other";
  label: string;
  usd: number;
  text: string;
  /** Bar and dot colour (a theme token). */
  color: string;
  /** Share of the month's revenue, 0–100, for the bar width; 0 when the month earned nothing. */
  sharePercent: number;
}

export interface DashboardRevenueView {
  /** ready: figures below are real. empty: connected, but nothing has been stored yet.
   * not_connected: no channel. */
  state: "ready" | "empty" | "not_connected";
  /** Earned YouTube revenue over the whole period. */
  total: RevenueFigure;
  /** Canonical change against the equal-length period before; null when it cannot be stated. */
  changePercent: number | null;
  /** e.g. "+$120" — the canonical absolute change; "—" when unknown. */
  changeText: string;
  /** e.g. "vs previous 365 days". */
  comparisonLabel: string;
  /** e.g. "Last 365 days". */
  periodLabel: string;
  positive: boolean;
  /** Monthly revenue for the sparkline — only months whose revenue is known. */
  series: number[];
  /** The most recent month with known revenue, or null when there is none. */
  latest: (RevenueFigure & { monthKey: string; label: string; incomplete: boolean }) | null;
  /** Every month in the period, oldest first. */
  trend: DashboardRevenueTrendPoint[];
  /** Ad / Premium / other for the latest month. Empty when the split is not known. */
  split: DashboardRevenueSplitRow[];
  /** One short line saying how current the data is; "" when there is nothing to say. */
  freshnessNote: string;
}

function figure(amount: RevenueAmountView): RevenueFigure {
  return {
    text: formatUsd(amount.usd),
    usd: amount.usd,
    partial: amount.availability === "partial",
    available: amount.usd !== null,
  };
}

const EMPTY_FIGURE: RevenueFigure = {
  text: UNAVAILABLE,
  usd: null,
  partial: false,
  available: false,
};

export const EMPTY_DASHBOARD_REVENUE: DashboardRevenueView = {
  state: "empty",
  total: EMPTY_FIGURE,
  changePercent: null,
  changeText: UNAVAILABLE,
  comparisonLabel: "",
  periodLabel: "",
  positive: true,
  series: [],
  latest: null,
  trend: [],
  split: [],
  freshnessNote: "",
};

const SPLIT_LABELS = { ads: "Ad Revenue", premium: "YouTube Premium", other: "Other" } as const;
const SPLIT_COLORS = {
  ads: "var(--brand-blue)",
  premium: "var(--brand-purple)",
  other: "var(--brand-green)",
} as const;

export function mapDashboardRevenue(summary: RevenueSummaryResponse): DashboardRevenueView {
  const { earned, period, dataQuality } = summary;
  const { freshness } = dataQuality;
  const trend = earned.trend.map((point) => ({
    monthKey: point.bucket,
    month: shortMonth(point.bucket),
    revenueUsd: point.revenue.usd,
    incomplete: point.incomplete,
  }));
  const latestPoint = [...earned.trend].reverse().find((point) => point.revenue.usd !== null);
  const latest = latestPoint
    ? {
        ...figure(latestPoint.revenue),
        monthKey: latestPoint.bucket,
        label: monthLabel(latestPoint.bucket),
        incomplete: latestPoint.incomplete,
      }
    : null;

  // The split is the latest month's own, taken as the API reports it. A part that was not
  // reported is left out rather than shown as $0; a reported $0 is kept.
  const split: DashboardRevenueSplitRow[] = [];
  if (latestPoint) {
    const total = latestPoint.revenue.usd ?? 0;
    const parts = [
      ["ads", latestPoint.split.ad.usd],
      ["premium", latestPoint.split.premium.usd],
      ["other", latestPoint.split.other.usd],
    ] as const;
    for (const [key, usd] of parts) {
      if (usd === null) continue;
      split.push({
        key,
        label: SPLIT_LABELS[key],
        color: SPLIT_COLORS[key],
        usd,
        text: formatUsd(usd),
        sharePercent: total > 0 ? Math.round((usd / total) * 100) : 0,
      });
    }
  }

  const change = earned.change.revenue;
  // A percentage is shown only when both periods' revenue is fully known; the API already
  // leaves it null when the previous period is zero or unknown.
  const changePercent = earned.change.revenueComparable ? change.percent : null;
  const hasStoredData = freshness.latestStoredDay !== null;
  const notice = revenueDataNotice(dataQuality);
  const freshnessNote = hasStoredData
    ? `Estimated YouTube revenue through ${dayLabel(freshness.latestStoredDay!)}` +
      (freshness.provisionalDays.length > 0 || freshness.pendingDays.length > 0
        ? " · the most recent days can still change"
        : "") +
      (notice ? ` · ${revenueDataNoticeText(notice)}` : "")
    : // Nothing stored yet is the ordinary empty state; only a failed update is worth saying.
      notice === "sync_error"
      ? revenueDataNoticeText(notice, { sentence: true }).slice(0, -1)
      : "";
  return {
    state: summary.status === "not_connected" ? "not_connected" : hasStoredData ? "ready" : "empty",
    total: figure(earned.revenue),
    changePercent,
    changeText: change.absolute === null ? UNAVAILABLE : signedUsd(change.absolute),
    comparisonLabel: `vs previous ${period.days} days`,
    periodLabel: `Last ${period.days} days`,
    positive: (changePercent ?? change.absolute ?? 0) >= 0,
    series: trend.flatMap((point) => (point.revenueUsd === null ? [] : [point.revenueUsd])),
    latest,
    trend,
    split,
    freshnessNote,
  };
}

/** The last 3, 6 or 12 months of the trend — a slice of the one response, never another request. */
export function trendForRange(
  trend: DashboardRevenueTrendPoint[],
  range: DashboardRevenueRange,
): DashboardRevenueTrendPoint[] {
  return trend.slice(-(range === "3M" ? 3 : range === "6M" ? 6 : 12));
}

// ---------- top revenue videos ----------

export interface DashboardTopVideo {
  videoId: string;
  title: string;
  thumbnail: string | null;
  /** Link to the video on YouTube; null when it is no longer there or its id is unknown. */
  url: string | null;
  publishedAt: string | null;
  views: number;
  revenue: RevenueFigure;
  /** Canonical change in views against the previous period; null when it cannot be stated. */
  changePercent: number | null;
  /** False when YouTube no longer returns the video; its stored history is still shown. */
  currentlyListed: boolean;
}

export function mapTopRevenueVideos(response: RevenueVideosResponse): DashboardTopVideo[] {
  return response.videos.slice(0, DASHBOARD_TOP_VIDEOS).map((video) => {
    const listed = video.currentlyListed !== false;
    return {
      videoId: video.videoId,
      title: video.title ?? "Untitled video",
      thumbnail: video.thumbnail,
      url:
        listed && video.youtubeVideoId
          ? `https://www.youtube.com/watch?v=${video.youtubeVideoId}`
          : null,
      publishedAt: video.publishedAt,
      views: video.views,
      revenue: figure(video.revenue),
      changePercent: video.change.views.percent,
      currentlyListed: listed,
    };
  });
}

// ---------- demo mode ----------

interface DemoAnalyticsRow {
  month?: string;
  estimatedRevenue?: number;
  estimatedAdRevenue?: number;
  estimatedRedPartnerRevenue?: number;
}

interface DemoDashboard {
  analytics: readonly DemoAnalyticsRow[];
  videos: ReadonlyArray<{
    id: string;
    title: string;
    thumbnail: string | null;
    url: string;
    publishedAt: string | null;
  }>;
  topRevenueVideos: ReadonlyArray<{
    videoId: string;
    views: number;
    revenue: number;
    changePercent: number | null;
  }>;
}

/** Local demo preview only: the same view the real API would produce, built from the bundled
 * sample numbers so the demo Dashboard keeps showing coherent revenue without any request. */
export function demoDashboardRevenue(demo: DemoDashboard): {
  revenue: DashboardRevenueView;
  topVideos: DashboardTopVideo[];
} {
  const months = [...demo.analytics]
    .filter((row): row is DemoAnalyticsRow & { month: string } => Boolean(row.month))
    .sort((a, b) => a.month.localeCompare(b.month));
  const amount = (usd: number): RevenueFigure => ({
    text: formatUsd(usd),
    usd,
    partial: false,
    available: true,
  });
  const total = months.reduce((sum, row) => sum + (row.estimatedRevenue ?? 0), 0);
  const last = months.at(-1);
  const lastTotal = last?.estimatedRevenue ?? 0;
  const ads = last?.estimatedAdRevenue ?? 0;
  const premium = last?.estimatedRedPartnerRevenue ?? 0;
  const splitParts = [
    ["ads", ads],
    ["premium", premium],
    ["other", Math.max(0, lastTotal - ads - premium)],
  ] as const;
  const byId = new Map(demo.videos.map((video) => [video.id, video]));
  return {
    revenue: {
      state: "ready",
      total: amount(total),
      changePercent: null,
      changeText: `Past ${months.length} months`,
      comparisonLabel: "· sample data",
      periodLabel: `Past ${months.length} months`,
      positive: true,
      series: months.map((row) => row.estimatedRevenue ?? 0),
      latest: last
        ? {
            ...amount(lastTotal),
            monthKey: last.month,
            label: monthLabel(last.month),
            incomplete: false,
          }
        : null,
      trend: months.map((row) => ({
        monthKey: row.month,
        month: shortMonth(row.month),
        revenueUsd: row.estimatedRevenue ?? 0,
        incomplete: false,
      })),
      split: splitParts
        .filter(([, usd]) => usd > 0)
        .map(([key, usd]) => ({
          key,
          label: SPLIT_LABELS[key],
          color: SPLIT_COLORS[key],
          usd,
          text: formatUsd(usd),
          sharePercent: lastTotal > 0 ? Math.round((usd / lastTotal) * 100) : 0,
        })),
      freshnessNote: "Sample revenue for the local demo preview",
    },
    topVideos: demo.topRevenueVideos.flatMap((row) => {
      const video = byId.get(row.videoId);
      if (!video) return [];
      return [
        {
          videoId: row.videoId,
          title: video.title,
          thumbnail: video.thumbnail,
          url: video.url,
          publishedAt: video.publishedAt,
          views: row.views,
          revenue: amount(row.revenue),
          changePercent: row.changePercent,
          currentlyListed: true,
        },
      ];
    }),
  };
}

// ---------- chart helpers ----------

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Axis and tooltip amounts: "$0", "$12.4", "$1.2K". */
export function formatUsdCompact(usd: number): string {
  return Number.isFinite(usd) ? compactUsd.format(usd) : UNAVAILABLE;
}

/** The chart frame for a period with nothing to draw: the last 3, 6 or 12 month labels ending
 * at `now`, each at zero. Shown only underneath an explanatory message — never as data. */
export function emptyRevenueTrend(
  range: DashboardRevenueRange,
  now: Date,
): Array<{ month: string; revenue: number }> {
  const count = range === "3M" ? 3 : range === "6M" ? 6 : 12;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - index), 1),
    );
    return { month: shortMonth(date.toISOString().slice(0, 7)), revenue: 0 };
  });
}
