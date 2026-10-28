// The dashboard's Weekly Engagement heatmap: one cell per day of the window. YouTube Analytics
// leaves out days with no views — for a channel with no recent views it returns no rows at all —
// so a successful answer is filled out to every day of the window, missing days as 0 views.
// An empty answer is "no views", not "unavailable".

const DAY_MS = 86_400_000;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export function fillHeatmapDays(
  rows: Array<{ date: string; views: number }>,
  start: Date,
  end: Date,
): Array<{ date: string; views: number }> {
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.views);
  const days: Array<{ date: string; views: number }> = [];
  const from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const to = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let t = from; t <= to; t += DAY_MS) {
    const day = isoDay(new Date(t));
    days.push({ date: day, views: byDay.get(day) ?? 0 });
  }
  return days;
}
