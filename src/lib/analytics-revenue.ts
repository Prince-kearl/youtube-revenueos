// Analytics page revenue: turns the canonical revenue API responses into what the Analytics
// page's revenue surfaces display.
//
//   Analytics  →  GET /api/revenue/summary + GET /api/revenue/videos  →  stored revenue data
//
// Like the Dashboard's mapping (which this builds on), nothing here calculates revenue: totals,
// the period-over-period change, the monthly trend, the ad / Premium / other split and each
// video's earnings arrive calculated from the canonical layer. This module picks fields and words
// the states: a reported $0 is "$0", unavailable revenue is "—" and never "$0", a partly reported
// figure is flagged.
//
// CPM is deliberately absent. The canonical layer does not provide it, and RPM is NOT offered
// under a CPM label in its place.

import {
  DASHBOARD_REVENUE_DAYS,
  UNAVAILABLE,
  formatUsd,
  mapDashboardRevenue,
  type DashboardRevenueView,
  type RevenueFigure,
} from "@/lib/dashboard-revenue";
import type { RevenueAmountView, RevenueSummaryResponse } from "@/lib/server/revenue-summary";
import type { RevenueVideosResponse } from "@/lib/server/revenue-videos";

/** The Analytics KPI row and Revenue by Source chart show a trailing year by month — the window
 * they have always shown. */
export const ANALYTICS_REVENUE_DAYS = DASHBOARD_REVENUE_DAYS;
/** The canonical videos endpoint accepts at most this many ids and this many days. */
const MAX_VIDEO_IDS = 100;
const MAX_PERIOD_DAYS = 366;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The canonical summary request behind the KPI row and Revenue by Source. Always scoped to the
 * channel the rest of the page is showing. */
export function analyticsSummaryUrl(channelId: string | null): string {
  const scope = channelId ? `&channelId=${encodeURIComponent(channelId)}` : "";
  return `/api/revenue/summary?days=${ANALYTICS_REVENUE_DAYS}&granularity=month${scope}`;
}

/**
 * The canonical request for the "Earnings by video" column: one request for exactly the videos
 * the table lists, over the table's own date range — never one request per video.
 *
 * Returns null when there is nothing to ask (no rows, or no well-formed video ids). The range is
 * the breakdown's own; if it is a day longer than the canonical maximum (a 12-month range that
 * spans 29 February), its first day is dropped rather than the request being refused.
 */
export function analyticsVideoEarningsUrl(
  channelId: string | null,
  range: { startDate: string; endDate: string },
  youtubeVideoIds: Array<string | null | undefined>,
  // The local demo preview uses placeholder video ids that are not shaped like YouTube's; its
  // request is answered inside the page and never reaches the API, so the shape check is skipped
  // there. Everywhere else an id that is not a YouTube video id is left out of the request.
  options: { demoIds?: boolean } = {},
): string | null {
  const ids = [
    ...new Set(
      youtubeVideoIds.filter(
        (id): id is string =>
          typeof id === "string" && (options.demoIds ? id.length > 0 : YOUTUBE_VIDEO_ID.test(id)),
      ),
    ),
  ].slice(0, MAX_VIDEO_IDS);
  if (!ids.length) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(range.endDate))
    return null;
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  const earliest = end - (MAX_PERIOD_DAYS - 1) * 86_400_000;
  const start = Math.max(Date.parse(`${range.startDate}T00:00:00Z`), earliest);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  const scope = channelId ? `&channelId=${encodeURIComponent(channelId)}` : "";
  return (
    `/api/revenue/videos?start=${new Date(start).toISOString().slice(0, 10)}&end=${range.endDate}` +
    `&limit=${MAX_VIDEO_IDS}&videoIds=${ids.join(",")}${scope}`
  );
}

// ---------- view model ----------

export interface RevenueSourcePoint {
  monthKey: string;
  /** Axis label, e.g. "Oct 2026". */
  month: string;
  /** USD, or null when that part was not reported for the month (drawn as no bar, not $0). */
  ads: number | null;
  premium: number | null;
  other: number | null;
}

export interface RevenueSourceShare {
  key: "ads" | "premium" | "other";
  label: string;
  color: string;
  usd: number;
  text: string;
  /** Share of the reported parts, 0–100. */
  sharePercent: number;
}

export interface AnalyticsRevenueView {
  /** Estimated Revenue card: total, canonical change, sparkline, latest month, freshness. */
  kpi: DashboardRevenueView;
  /** "Revenue per View" card: earned revenue divided by views, for the same period. */
  perView: {
    text: string;
    available: boolean;
    changePercent: number | null;
    changeText: string;
    series: number[];
    latestText: string;
    positive: boolean;
  };
  /** Revenue by Source: one stacked bar per month, and the period's split for the donut. */
  sources: {
    series: RevenueSourcePoint[];
    shares: RevenueSourceShare[];
    /** True when at least one month has at least one reported part. */
    hasData: boolean;
    /** True when some part of the period's split was not reported. */
    partial: boolean;
  };
}

const perViewFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Revenue per single view, from the canonical revenue-per-thousand-views figure. The card has
 * always been "Revenue per View"; this is the same quantity in the same unit, now sourced from
 * stored data. */
function perViewUsd(revenuePerThousandViews: number | null): number | null {
  return revenuePerThousandViews === null ? null : revenuePerThousandViews / 1000;
}

export function formatRevenuePerView(usd: number | null): string {
  return usd === null || !Number.isFinite(usd) ? UNAVAILABLE : perViewFormat.format(usd);
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const SOURCES = [
  { key: "ads", label: "Ad Revenue", color: "var(--color-brand-blue)", pick: "ad" },
  { key: "premium", label: "YouTube Premium", color: "var(--color-brand-purple)", pick: "premium" },
  { key: "other", label: "Other", color: "var(--color-brand-green)", pick: "other" },
] as const;

export function mapAnalyticsRevenue(summary: RevenueSummaryResponse): AnalyticsRevenueView {
  const { earned } = summary;
  const kpi = mapDashboardRevenue(summary);

  const perViewNow = perViewUsd(earned.rpm);
  const perViewChange = earned.change.rpm;
  const perViewPercent = earned.change.revenueComparable ? perViewChange.percent : null;
  const perViewSeries = earned.trend.flatMap((point) =>
    point.rpm === null ? [] : [point.rpm / 1000],
  );
  const perViewAbsolute = perViewUsd(perViewChange.absolute);

  const series = earned.trend.map((point) => ({
    monthKey: point.bucket,
    month: monthLabel(point.bucket),
    ads: point.split.ad.usd,
    premium: point.split.premium.usd,
    other: point.split.other.usd,
  }));
  // The donut is the period's own canonical split. A part that was not reported is left out
  // rather than counted as $0; shares are of the parts that were reported.
  const parts = SOURCES.map((source) => ({
    source,
    amount: earned.split[source.pick] as RevenueAmountView,
  }));
  const reportedTotal = parts.reduce((sum, part) => sum + (part.amount.usd ?? 0), 0);
  const shares = parts.flatMap(({ source, amount }) =>
    amount.usd === null
      ? []
      : [
          {
            key: source.key,
            label: source.label,
            color: source.color,
            usd: amount.usd,
            text: formatUsd(amount.usd),
            sharePercent: reportedTotal > 0 ? Math.round((amount.usd / reportedTotal) * 100) : 0,
          },
        ],
  );

  return {
    kpi,
    perView: {
      text: formatRevenuePerView(perViewNow),
      available: perViewNow !== null,
      changePercent: perViewPercent,
      changeText:
        perViewAbsolute === null
          ? UNAVAILABLE
          : `${perViewAbsolute >= 0 ? "+" : "-"}${formatRevenuePerView(Math.abs(perViewAbsolute))}`,
      series: perViewSeries,
      latestText: formatRevenuePerView(perViewSeries.at(-1) ?? null),
      positive: (perViewPercent ?? perViewAbsolute ?? 0) >= 0,
    },
    sources: {
      series,
      shares,
      hasData: series.some(
        (point) => point.ads !== null || point.premium !== null || point.other !== null,
      ),
      partial: parts.some((part) => part.amount.availability === "partial"),
    },
  };
}

// ---------- earnings by video ----------

/** Canonical earnings for the videos the table lists, keyed by YouTube video id. A video that
 * is not in the map has no stored revenue for the period: it is shown as "—", never as $0. */
export function mapVideoEarnings(response: RevenueVideosResponse): Map<string, RevenueFigure> {
  const earnings = new Map<string, RevenueFigure>();
  for (const video of response.videos) {
    if (!video.youtubeVideoId) continue;
    earnings.set(video.youtubeVideoId, {
      text: formatUsd(video.revenue.usd),
      usd: video.revenue.usd,
      partial: video.revenue.availability === "partial",
      available: video.revenue.usd !== null,
    });
  }
  return earnings;
}

/** What the "Estimated earnings" cell prints for one row of the table. */
export function videoEarningsText(
  earnings: Map<string, RevenueFigure> | null,
  youtubeVideoId: unknown,
): string {
  if (!earnings || typeof youtubeVideoId !== "string") return UNAVAILABLE;
  return earnings.get(youtubeVideoId)?.text ?? UNAVAILABLE;
}
