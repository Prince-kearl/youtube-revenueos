// Monthly series behind the dashboard's KPI trend cards. Every series covers the same last 12
// complete calendar months: the current month is still being reported (YouTube also reports a day
// or two late), so comparing it with a full month would show a false drop, and a month without
// rows had no activity, so it counts as zero instead of disappearing from the chart.

export const TREND_MONTHS = 12;

// The dashboard receives the channel's latest public uploads, one page of this many.
export const RECENT_UPLOADS_PAGE = 50;

export type TrendAnalyticsRow = {
  month?: string;
  views?: number;
  subscribersGained?: number;
  watchTimeMinutes?: number;
};

export type MonthlyTrendRow = {
  month: string;
  views: number;
  subscribersGained: number;
  watchTimeMinutes: number;
};

/** The month `by` months after `key` (YYYY-MM). */
export function shiftMonth(key: string, by: number): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The last `count` complete calendar months before the current one, oldest first (YYYY-MM). */
export function lastCompleteMonths(count: number, now: Date = new Date()): string[] {
  const current = now.toISOString().slice(0, 7);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, i - count));
}

/** One row per complete month of the window, zero where nothing was reported. Empty when there are no rows at all. */
export function monthlyTrendRows(
  analytics: readonly TrendAnalyticsRow[] | undefined,
  now: Date = new Date(),
): MonthlyTrendRow[] {
  const byMonth = new Map<string, TrendAnalyticsRow>();
  for (const row of analytics ?? []) if (row.month) byMonth.set(row.month.slice(0, 7), row);
  if (!byMonth.size) return [];
  return lastCompleteMonths(TREND_MONTHS, now).map((month) => {
    const row = byMonth.get(month);
    return {
      month,
      views: Number(row?.views ?? 0),
      subscribersGained: Number(row?.subscribersGained ?? 0),
      watchTimeMinutes: Number(row?.watchTimeMinutes ?? 0),
    };
  });
}

/**
 * Uploads per month over the same complete months (a month without uploads is a zero, not a gap).
 * The list holds the latest page of uploads; when it is full, months up to and including its
 * oldest upload's month may be missing videos, so they are left out rather than shown short.
 */
export function uploadsByMonth(
  videos: readonly { publishedAt: string | null }[],
  now: Date = new Date(),
): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  let oldest: string | null = null;
  for (const v of videos) {
    if (!v.publishedAt) continue;
    const key = v.publishedAt.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (oldest === null || key < oldest) oldest = key;
  }
  const listFull = videos.length >= RECENT_UPLOADS_PAGE;
  return lastCompleteMonths(TREND_MONTHS, now)
    .filter((month) => !listFull || (oldest !== null && month > oldest))
    .map((month) => ({ month, count: counts.get(month) ?? 0 }));
}
