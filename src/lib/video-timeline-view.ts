// How a video's "Performance over time" chart is drawn, kept out of the route file so it can be
// tested. A short history (a new video, or a quiet period) is a handful of days: drawn as a smooth
// curve across the whole width it leaves huge gaps between the dates and invents a shape between
// days YouTube never reported. So a short history is one bar per day; a long one stays a curve.

/** Up to this many days, the chart shows one bar per day instead of a curve. */
export const SHORT_TIMELINE_DAYS = 14;

export function isShortTimeline(days: number): boolean {
  return days > 0 && days <= SHORT_TIMELINE_DAYS;
}

/** "Oct 8" for "2026-10-08" — the day as YouTube reports it (a calendar date, not a moment). */
export function timelineDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Said under the chart's heading when there are only a few days to show; null otherwise. */
export function shortTimelineNote(days: number): string | null {
  if (!isShortTimeline(days)) return null;
  return `Only ${days} ${days === 1 ? "day" : "days"} of data so far — the video is new or had little activity in this period.`;
}
