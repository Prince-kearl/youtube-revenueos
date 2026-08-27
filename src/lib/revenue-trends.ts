export type RevenueRange = "3M" | "6M" | "12M";

export type RevenueAnalyticsRow = {
  month?: string;
  estimatedRevenue?: number;
};

export type RevenueTrendPoint = {
  month: string;
  monthKey: string;
  revenue: number;
};

function monthLabel(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    timeZone: "UTC",
  });
}

export function buildRevenueTrend(
  analytics: RevenueAnalyticsRow[],
  range: RevenueRange,
): RevenueTrendPoint[] {
  const count = range === "3M" ? 3 : range === "6M" ? 6 : 12;
  const validMonths = analytics
    .map((row) => row.month)
    .filter((month): month is string => Boolean(month && /^\d{4}-\d{2}$/.test(month)))
    .sort();
  const endMonth = validMonths.at(-1) ?? new Date().toISOString().slice(0, 7);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const revenueByMonth = new Map<string, number>();

  for (const row of analytics) {
    if (!row.month || !/^\d{4}-\d{2}$/.test(row.month)) continue;
    revenueByMonth.set(
      row.month,
      (revenueByMonth.get(row.month) ?? 0) + Number(row.estimatedRevenue ?? 0),
    );
  }

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(endYear, endMonthNumber - count + index, 1));
    const monthKey = date.toISOString().slice(0, 7);
    return {
      month: monthLabel(monthKey),
      monthKey,
      revenue: (revenueByMonth.get(monthKey) ?? 0) / 1000,
    };
  });
}
