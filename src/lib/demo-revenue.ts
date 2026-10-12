// Local demo preview only: the two things its sample revenue responses must get right for the
// pages to read coherently — the reporting period a request asked for, and RPM.
//
// Pure (no bundled sample data, no environment), so it is unit-tested. Nothing here is used
// outside the demo preview, and nothing here reads real data.

/** The day the bundled sample data runs to. A demo period always ends here, the way a real one
 * ends at the newest day YouTube has reported. */
export const DEMO_REVENUE_AS_OF = "2026-09-19";

const DEFAULT_DAYS = 28;
const MAX_DAYS = 366;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string): number {
  const ms =
    new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface DemoRevenuePeriod {
  period: { startDate: string; endDate: string; days: number; defaulted: boolean };
  previousPeriod: { startDate: string; endDate: string };
}

/**
 * The period a demo request covers, by the same rules as the real endpoint: `start`/`end` as
 * given, otherwise the last `days` days (28 when not stated, at most 366), and the previous
 * period is the same number of days immediately before.
 */
export function demoRevenuePeriod(params: URLSearchParams): DemoRevenuePeriod {
  const start = params.get("start");
  const end = params.get("end");
  let startDate: string;
  let endDate: string;
  let defaulted = false;
  if (start && end && DAY.test(start) && DAY.test(end) && start <= end) {
    startDate = start;
    endDate = end;
  } else {
    const asked = Number(params.get("days"));
    const valid = Number.isInteger(asked) && asked >= 1;
    defaulted = !valid;
    const days = valid ? Math.min(asked, MAX_DAYS) : DEFAULT_DAYS;
    endDate = DEMO_REVENUE_AS_OF;
    startDate = addDays(endDate, -(days - 1));
  }
  const days = daysBetween(startDate, endDate);
  const previousEnd = addDays(startDate, -1);
  return {
    period: { startDate, endDate, days, defaulted },
    previousPeriod: { startDate: addDays(previousEnd, -(days - 1)), endDate: previousEnd },
  };
}

/**
 * RPM for a sample figure, by the canonical definition (revenue-metrics' calculateRpm): revenue
 * per 1,000 of the views it was earned on, to six decimals; null unless the revenue is known and
 * there are views. In the sample data every day's revenue is known, so those are all the views.
 * The value is whatever the sample revenue and views give — it is never set by hand.
 */
export function demoRpm(revenueUsd: number | null, views: number): number | null {
  if (revenueUsd === null || !Number.isFinite(revenueUsd)) return null;
  if (!Number.isFinite(views) || views <= 0) return null;
  return Math.round((revenueUsd / views) * 1000 * 1e6) / 1e6;
}
