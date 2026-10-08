// Canonical revenue calculations over the stored P0 rows (channel_daily_stats and
// video_daily_stats — see docs/REVENUE_DATA_FOUNDATION.md).
//
// Pure: no database, no network, no UI. revenue-store.ts reads the rows; this module is the one
// place that turns them into numbers, so no screen or route computes revenue on its own.
//
// Rules this module enforces:
//
//   1. Channel totals are authoritative. Earned revenue, views and watch time for a period come
//      from channel rows only. Video rows are the attribution layer and are never summed into a
//      channel figure; the part of a channel total no video row explains is reported as
//      "unattributed" and never spread over other videos. Why it is unattributed (videos no
//      longer returned by YouTube, per-video history not backfilled yet, catalogue incomplete)
//      is NOT known here — that is a question for the sync state, not for these rows.
//   2. NULL revenue means unavailable and 0 means YouTube reported zero. A null is never turned
//      into 0: sums add only known values and say how much of the period they cover.
//   3. Everything here is EARNED YouTube revenue in USD. Contracted deal value and pipeline value
//      are different money states and do not belong in any of these numbers.
//   4. Recent days are revisable. Nothing is dropped; the result says which days are provisional
//      or not reported yet.
//   5. RPM = earned revenue / views * 1000. CPM is deliberately absent: it needs monetised
//      playback counts, which are not stored.

import { addDays, reconcileDay, type DailyStats, type VideoDailyStats } from "./youtube-stats-sync";

// ============================================================================================
// Inputs
// ============================================================================================

type RevenueFields = Pick<
  DailyStats,
  "day" | "views" | "watchMinutes" | "estimatedRevenueUsd" | "adRevenueUsd" | "premiumRevenueUsd"
>;

/** One channel_daily_stats row. */
export interface ChannelRevenueDay extends RevenueFields {
  channelId: string;
}

/** One video_daily_stats row. */
export interface VideoRevenueDay extends RevenueFields, Pick<VideoDailyStats, "videoId"> {
  channelId: string;
}

/** Inclusive range of YouTube reporting days (YYYY-MM-DD). */
export interface RevenuePeriod {
  startDate: string;
  endDate: string;
}

export interface RevenueMetricsConfig {
  /** YouTube reports a day roughly this many days later; newer days are not expected yet. */
  dataLagDays: number;
  /** The newest reported days that are still likely to be revised. */
  provisionalDays: number;
}

export const DEFAULT_REVENUE_METRICS_CONFIG: RevenueMetricsConfig = {
  dataLagDays: 3,
  provisionalDays: 3,
};

// ============================================================================================
// Money that may be unavailable
// ============================================================================================

/**
 * available   every row in scope reported revenue
 * partial     some rows reported revenue and some did not — `usd` covers only the known rows
 * unavailable no row reported revenue (including: there were no rows at all)
 */
export type RevenueAvailability = "available" | "partial" | "unavailable";

export interface RevenueAmount {
  /** Sum of the KNOWN values only; null when nothing is known. Never a guess, never a filled-in 0. */
  usd: number | null;
  availability: RevenueAvailability;
  /** Rows whose value was known / unknown (NULL). */
  knownRows: number;
  unknownRows: number;
}

// Stored revenue is numeric(14,6); rounding sums to the same precision removes float noise
// without changing any stored value.
function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function validMoney(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Sum values that may be null. See RevenueAmount for exactly what the result means. */
export function sumRevenue(values: Array<number | null | undefined>): RevenueAmount {
  let total = 0;
  let knownRows = 0;
  for (const raw of values) {
    const value = validMoney(raw);
    if (value === null) continue;
    total += value;
    knownRows += 1;
  }
  const unknownRows = values.length - knownRows;
  return {
    usd: knownRows > 0 ? roundUsd(total) : null,
    availability: knownRows === 0 ? "unavailable" : unknownRows === 0 ? "available" : "partial",
    knownRows,
    unknownRows,
  };
}

/** RPM = revenue / views * 1000. Null unless revenue is known and there are views. */
export function calculateRpm(revenueUsd: number | null, views: number): number | null {
  if (revenueUsd === null || !Number.isFinite(revenueUsd)) return null;
  if (!Number.isFinite(views) || views <= 0) return null;
  return roundUsd((revenueUsd / views) * 1000);
}

// ============================================================================================
// Periods
// ============================================================================================

export function periodLengthDays(period: RevenuePeriod): number {
  const ms =
    new Date(`${period.endDate}T00:00:00Z`).getTime() -
    new Date(`${period.startDate}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** The period of the same length that ends the day before this one starts. */
export function previousPeriod(period: RevenuePeriod): RevenuePeriod {
  const endDate = addDays(period.startDate, -1);
  return { startDate: addDays(endDate, -(periodLengthDays(period) - 1)), endDate };
}

function inPeriod(day: string, period: RevenuePeriod): boolean {
  return day >= period.startDate && day <= period.endDate;
}

function daysIn(period: RevenuePeriod): string[] {
  const days: string[] = [];
  for (let day = period.startDate; day <= period.endDate; day = addDays(day, 1)) days.push(day);
  return days;
}

// ============================================================================================
// Totals (channel rows only)
// ============================================================================================

export interface RevenueSplit {
  ad: RevenueAmount;
  premium: RevenueAmount;
  /** Earned revenue that is neither ads nor Premium (YouTube does not itemise it further).
   * Computed only from rows where total, ad and Premium are all known. */
  other: RevenueAmount;
}

export interface RevenueTotals {
  /** Earned YouTube revenue (estimated, USD). */
  earned: RevenueAmount;
  views: number;
  watchMinutes: number;
  /** Views on the rows whose revenue is known — the only views RPM may be divided by. */
  viewsWithRevenue: number;
  rpm: number | null;
  split: RevenueSplit;
  /** Rows carrying a value that cannot be real (negative or non-numeric views/watch time, or
   * non-numeric revenue). The value is ignored — counted as 0 activity or unknown revenue — and
   * reported here rather than silently absorbed. */
  invalidRows: number;
  /** Rows with negative revenue. They are summed as stored (nothing is rewritten) and counted. */
  negativeRevenueRows: number;
}

function isInvalid(row: RevenueFields): boolean {
  const badCount = (value: unknown) =>
    typeof value !== "number" || !Number.isFinite(value) || value < 0;
  const badMoney = (value: unknown) =>
    value !== null && (typeof value !== "number" || !Number.isFinite(value));
  return (
    badCount(row.views) ||
    badCount(row.watchMinutes) ||
    badMoney(row.estimatedRevenueUsd) ||
    badMoney(row.adRevenueUsd) ||
    badMoney(row.premiumRevenueUsd)
  );
}

/** Totals over the given rows. Pass CHANNEL rows for a channel figure; the same arithmetic is
 * reused for one video's own rows. */
export function totalsFor(rows: RevenueFields[]): RevenueTotals {
  const earned = sumRevenue(rows.map((row) => row.estimatedRevenueUsd));
  let views = 0;
  let watchMinutes = 0;
  let viewsWithRevenue = 0;
  let invalidRows = 0;
  let negativeRevenueRows = 0;
  const otherValues: Array<number | null> = [];
  for (const row of rows) {
    const rowViews = validCount(row.views);
    views += rowViews;
    watchMinutes += validCount(row.watchMinutes);
    const revenue = validMoney(row.estimatedRevenueUsd);
    const ad = validMoney(row.adRevenueUsd);
    const premium = validMoney(row.premiumRevenueUsd);
    if (revenue !== null) viewsWithRevenue += rowViews;
    if (revenue !== null && revenue < 0) negativeRevenueRows += 1;
    if (isInvalid(row)) invalidRows += 1;
    otherValues.push(
      revenue === null || ad === null || premium === null ? null : revenue - ad - premium,
    );
  }
  const other = sumRevenue(otherValues);
  return {
    earned,
    views,
    watchMinutes,
    viewsWithRevenue,
    rpm: calculateRpm(earned.usd, viewsWithRevenue),
    split: {
      ad: sumRevenue(rows.map((row) => row.adRevenueUsd)),
      premium: sumRevenue(rows.map((row) => row.premiumRevenueUsd)),
      // Per-day rounding can leave the remainder a hair below zero; a share cannot be negative.
      other: other.usd === null ? other : { ...other, usd: Math.max(0, other.usd) },
    },
    invalidRows,
    negativeRevenueRows,
  };
}

/** Authoritative totals for a period, from channel rows. */
export function channelTotals(rows: ChannelRevenueDay[], period: RevenuePeriod): RevenueTotals {
  return totalsFor(rows.filter((row) => inPeriod(row.day, period)));
}

// ============================================================================================
// Period-over-period change
// ============================================================================================

export interface MetricChange {
  current: number | null;
  previous: number | null;
  /** current − previous; null when either side is unknown. */
  absolute: number | null;
  /** Percentage change; null when either side is unknown or the previous value is 0 (a change
   * from nothing has no percentage — it is not "+100%" and not "0%"). */
  percent: number | null;
}

export function compareValues(current: number | null, previous: number | null): MetricChange {
  const absolute = current === null || previous === null ? null : roundUsd(current - previous);
  const percent =
    absolute === null || previous === null || previous === 0
      ? null
      : Math.round((absolute / Math.abs(previous)) * 100 * 100) / 100;
  return { current, previous, absolute, percent };
}

export interface RevenueComparison {
  earned: MetricChange;
  views: MetricChange;
  watchMinutes: MetricChange;
  rpm: MetricChange;
  /** False when either period's revenue is partial or unavailable: the earned and RPM changes
   * then compare unlike things and should be shown with that caveat, or not at all. */
  revenueComparable: boolean;
}

export function compareTotals(current: RevenueTotals, previous: RevenueTotals): RevenueComparison {
  return {
    earned: compareValues(current.earned.usd, previous.earned.usd),
    views: compareValues(current.views, previous.views),
    watchMinutes: compareValues(current.watchMinutes, previous.watchMinutes),
    rpm: compareValues(current.rpm, previous.rpm),
    revenueComparable:
      current.earned.availability === "available" && previous.earned.availability === "available",
  };
}

// ============================================================================================
// Freshness
// ============================================================================================

export interface RevenueFreshness {
  asOf: string;
  /** Newest day YouTube is expected to have reported by `asOf`. */
  expectedThrough: string;
  /** Newest day with a channel row in the period, or null when there are none. */
  latestStoredDay: string | null;
  /** Days in the period that are reported but still likely to be revised. */
  provisionalDays: string[];
  /** Days in the period too recent for YouTube to have reported yet. */
  pendingDays: string[];
  /** Days in the period that should have been reported by now but have no channel row for at
   * least one channel (history not backfilled yet, or the sync is behind). */
  missingDays: string[];
  /** True when the period has no provisional, pending or missing days. */
  complete: boolean;
}

export function assessFreshness(
  rows: ChannelRevenueDay[],
  period: RevenuePeriod,
  asOf: string,
  config: RevenueMetricsConfig = DEFAULT_REVENUE_METRICS_CONFIG,
  /** Every channel in scope, so a channel with no rows at all still counts as missing. Defaults
   * to the channels that appear in `rows`. */
  channelIds?: string[],
): RevenueFreshness {
  const expectedThrough = addDays(asOf, -config.dataLagDays);
  const provisionalFrom = addDays(expectedThrough, -(config.provisionalDays - 1));
  const channels = new Set(channelIds ?? rows.map((row) => row.channelId));
  const channelsByDay = new Map<string, Set<string>>();
  let latestStoredDay: string | null = null;
  for (const row of rows) {
    if (!inPeriod(row.day, period)) continue;
    if (!channelsByDay.has(row.day)) channelsByDay.set(row.day, new Set());
    channelsByDay.get(row.day)!.add(row.channelId);
    if (latestStoredDay === null || row.day > latestStoredDay) latestStoredDay = row.day;
  }
  const provisionalDays: string[] = [];
  const pendingDays: string[] = [];
  const missingDays: string[] = [];
  for (const day of daysIn(period)) {
    if (day > expectedThrough) pendingDays.push(day);
    else {
      if (day >= provisionalFrom) provisionalDays.push(day);
      if ((channelsByDay.get(day)?.size ?? 0) < Math.max(1, channels.size)) missingDays.push(day);
    }
  }
  return {
    asOf,
    expectedThrough,
    latestStoredDay,
    provisionalDays,
    pendingDays,
    missingDays,
    complete: !provisionalDays.length && !pendingDays.length && !missingDays.length,
  };
}

// ============================================================================================
// Trend
// ============================================================================================

export type TrendGranularity = "day" | "month";

export interface RevenueTrendPoint {
  /** YYYY-MM-DD for a day, YYYY-MM for a month. */
  bucket: string;
  startDate: string;
  endDate: string;
  earned: RevenueAmount;
  /** Ad / Premium / other for this bucket alone — the same calculation as the period split,
   * applied to this bucket's channel rows. */
  split: RevenueSplit;
  views: number;
  watchMinutes: number;
  rpm: number | null;
  /** False when no channel row exists in this bucket at all. */
  hasData: boolean;
  /** True when the bucket contains provisional or not-yet-reported days. */
  incomplete: boolean;
}

/** One point per day or month in the period, in order, including buckets with no data (which
 * are shown as unavailable, not as zero). */
export function revenueTrend(
  rows: ChannelRevenueDay[],
  period: RevenuePeriod,
  granularity: TrendGranularity,
  freshness?: RevenueFreshness,
): RevenueTrendPoint[] {
  const bucketOf = (day: string) => (granularity === "day" ? day : day.slice(0, 7));
  const rowsByBucket = new Map<string, ChannelRevenueDay[]>();
  for (const row of rows) {
    if (!inPeriod(row.day, period)) continue;
    const bucket = bucketOf(row.day);
    if (!rowsByBucket.has(bucket)) rowsByBucket.set(bucket, []);
    rowsByBucket.get(bucket)!.push(row);
  }
  const unsettled = new Set([
    ...(freshness?.provisionalDays ?? []),
    ...(freshness?.pendingDays ?? []),
  ]);
  const daysByBucket = new Map<string, string[]>();
  for (const day of daysIn(period)) {
    const bucket = bucketOf(day);
    if (!daysByBucket.has(bucket)) daysByBucket.set(bucket, []);
    daysByBucket.get(bucket)!.push(day);
  }
  return [...daysByBucket].map(([bucket, days]) => {
    const bucketRows = rowsByBucket.get(bucket) ?? [];
    const totals = totalsFor(bucketRows);
    return {
      bucket,
      startDate: days[0],
      endDate: days[days.length - 1],
      earned: totals.earned,
      split: totals.split,
      views: totals.views,
      watchMinutes: totals.watchMinutes,
      rpm: totals.rpm,
      hasData: bucketRows.length > 0,
      incomplete: days.some((day) => unsettled.has(day)),
    };
  });
}

// ============================================================================================
// Per-video performance (attribution layer)
// ============================================================================================

export interface VideoRevenuePerformance {
  videoId: string;
  channelId: string;
  earned: RevenueAmount;
  views: number;
  watchMinutes: number;
  rpm: number | null;
  /** This video's share of the CHANNEL-level earned revenue for the period (0–1). The shares of
   * all videos add up to less than 1 whenever some revenue belongs to videos no longer
   * available. Null when either side is unknown or the channel earned nothing. */
  revenueShare: number | null;
  /** Share of channel-level views (0–1); null when the channel had no views. */
  viewShare: number | null;
}

function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.round((part / whole) * 1e6) / 1e6;
}

/** Per-video totals for the period, highest earner first (videos with unknown revenue last,
 * then by views). `channel` is the authoritative total the shares are measured against. */
export function videoPerformance(
  videoRows: VideoRevenueDay[],
  period: RevenuePeriod,
  channel: RevenueTotals,
): VideoRevenuePerformance[] {
  const byVideo = new Map<string, VideoRevenueDay[]>();
  for (const row of videoRows) {
    if (!inPeriod(row.day, period)) continue;
    if (!byVideo.has(row.videoId)) byVideo.set(row.videoId, []);
    byVideo.get(row.videoId)!.push(row);
  }
  // A share of revenue is only meaningful against a fully known channel total.
  const channelRevenue = channel.earned.availability === "available" ? channel.earned.usd : null;
  return [...byVideo]
    .map(([videoId, rows]) => {
      const totals = totalsFor(rows);
      return {
        videoId,
        channelId: rows[0].channelId,
        earned: totals.earned,
        views: totals.views,
        watchMinutes: totals.watchMinutes,
        rpm: totals.rpm,
        revenueShare:
          totals.earned.availability === "available"
            ? share(totals.earned.usd, channelRevenue)
            : null,
        viewShare: share(totals.views, channel.views),
      };
    })
    .sort((a, b) => {
      if ((a.earned.usd === null) !== (b.earned.usd === null))
        return a.earned.usd === null ? 1 : -1;
      return (
        (b.earned.usd ?? 0) - (a.earned.usd ?? 0) ||
        b.views - a.views ||
        a.videoId.localeCompare(b.videoId)
      );
    });
}

// ============================================================================================
// Channel vs video reconciliation
// ============================================================================================

export interface RevenueReconciliation {
  channelViews: number;
  attributedViews: number;
  /** Channel views no video row explains. This is a measurement, not a diagnosis: it does not
   * by itself mean the videos were deleted (see rule 1 at the top of this file). */
  unattributedViews: number;
  channelRevenue: RevenueAmount;
  /** Revenue explained by video rows, over the days where that could be established. */
  attributedRevenue: RevenueAmount;
  /** Channel revenue no video row explains, over the days where both sides are known. */
  unattributedRevenue: RevenueAmount;
  /** True when every channel day is fully explained by video rows. */
  fullyAttributed: boolean;
  /** Days on which video rows add up to more than the channel total (the two were fetched at
   * different moments). Reported for investigation; neither side is adjusted. */
  daysVideosExceedChannel: number;
  /** Channel days compared. */
  daysCompared: number;
  /** Video rows on a day with no channel row for that channel: they cannot be reconciled and
   * are left out of every figure above. */
  videoRowsWithoutChannelDay: number;
}

/** Compares channel totals with the sum of video rows, one channel-day at a time, using the same
 * reconcileDay the sync uses. Differences are reported, never redistributed. */
export function reconcilePeriod(
  channelRows: ChannelRevenueDay[],
  videoRows: VideoRevenueDay[],
  period: RevenuePeriod,
): RevenueReconciliation {
  const key = (row: { channelId: string; day: string }) => `${row.channelId}|${row.day}`;
  const videosByDay = new Map<string, VideoRevenueDay[]>();
  for (const row of videoRows) {
    if (!inPeriod(row.day, period)) continue;
    if (!videosByDay.has(key(row))) videosByDay.set(key(row), []);
    videosByDay.get(key(row))!.push(row);
  }
  const clean = <T extends RevenueFields>(row: T) => ({
    views: validCount(row.views),
    estimatedRevenueUsd: validMoney(row.estimatedRevenueUsd),
  });

  let channelViews = 0;
  let attributedViews = 0;
  let unattributedViews = 0;
  let daysVideosExceedChannel = 0;
  let daysCompared = 0;
  let fullyAttributed = true;
  const channelRevenue: Array<number | null> = [];
  const attributedRevenue: Array<number | null> = [];
  const unattributedRevenue: Array<number | null> = [];
  const seen = new Set<string>();
  for (const row of channelRows) {
    if (!inPeriod(row.day, period)) continue;
    seen.add(key(row));
    const day = reconcileDay(clean(row), (videosByDay.get(key(row)) ?? []).map(clean));
    daysCompared += 1;
    channelViews += day.channelViews;
    attributedViews += day.attributedViews;
    unattributedViews += day.unattributedViews;
    channelRevenue.push(day.channelRevenueUsd);
    attributedRevenue.push(day.attributedRevenueUsd);
    unattributedRevenue.push(day.unattributedRevenueUsd);
    if (day.videosExceedChannel) daysVideosExceedChannel += 1;
    if (!day.fullyAttributed) fullyAttributed = false;
  }
  let videoRowsWithoutChannelDay = 0;
  for (const [dayKey, rows] of videosByDay)
    if (!seen.has(dayKey)) videoRowsWithoutChannelDay += rows.length;
  return {
    channelViews,
    attributedViews,
    unattributedViews,
    channelRevenue: sumRevenue(channelRevenue),
    attributedRevenue: sumRevenue(attributedRevenue),
    unattributedRevenue: sumRevenue(unattributedRevenue),
    fullyAttributed,
    daysVideosExceedChannel,
    daysCompared,
    videoRowsWithoutChannelDay,
  };
}

// ============================================================================================
// Everything for one period
// ============================================================================================

export interface RevenueSummaryInput {
  /** Rows covering at least the period and the period before it. */
  channelRows: ChannelRevenueDay[];
  videoRows: VideoRevenueDay[];
  /** Every channel in scope (see assessFreshness). */
  channelIds?: string[];
  period: RevenuePeriod;
  /** Today, as YYYY-MM-DD. Passed in so the result is deterministic. */
  asOf: string;
  granularity?: TrendGranularity;
  config?: RevenueMetricsConfig;
}

export interface RevenueSummary {
  currency: "USD";
  period: RevenuePeriod;
  previousPeriod: RevenuePeriod;
  current: RevenueTotals;
  previous: RevenueTotals;
  change: RevenueComparison;
  trend: RevenueTrendPoint[];
  videos: VideoRevenuePerformance[];
  reconciliation: RevenueReconciliation;
  freshness: RevenueFreshness;
}

export function summarizeRevenue(input: RevenueSummaryInput): RevenueSummary {
  const { channelRows, videoRows, period, asOf } = input;
  const prior = previousPeriod(period);
  const current = channelTotals(channelRows, period);
  const previous = channelTotals(channelRows, prior);
  const freshness = assessFreshness(channelRows, period, asOf, input.config, input.channelIds);
  return {
    currency: "USD",
    period,
    previousPeriod: prior,
    current,
    previous,
    change: compareTotals(current, previous),
    trend: revenueTrend(channelRows, period, input.granularity ?? "day", freshness),
    videos: videoPerformance(videoRows, period, current),
    reconciliation: reconcilePeriod(channelRows, videoRows, period),
    freshness,
  };
}
