import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiTrendCard } from "../src/components/KpiTrendCard";
import {
  RECENT_UPLOADS_PAGE,
  lastCompleteMonths,
  monthlyTrendRows,
  uploadsByMonth,
} from "../src/lib/dashboard-trends";

// The KPI cards' mini charts draw the real monthly values, end on the month the callout names,
// and every dashboard series covers the same last 12 complete calendar months.

const NOW = new Date("2026-11-08T12:00:00.000Z");
const WINDOW = lastCompleteMonths(12, NOW);

// --- the chart --------------------------------------------------------------------------------

const HEIGHT = 160;
const PAD_Y = 10;

function chart(series: number[]) {
  const html = renderToStaticMarkup(
    createElement(KpiTrendCard, {
      title: "Views",
      value: "1",
      deltaLabel: "+1",
      deltaSuffix: "in Oct",
      changePercent: 1,
      periodLabel: "vs Sep 2026",
      series,
      markerTitle: "TITLE",
      markerSubtitle: "Oct 2026",
      positive: true,
    }),
  );
  const line = [...html.matchAll(/<path d="([^"]+)" fill="none"/g)][0][1];
  // the end point of every segment is a data point (M x,y then C c1 c2 x,y)
  const points = [...line.matchAll(/(?:M|\s)(-?[\d.]+),(-?[\d.]+)(?= C|$)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  const circle = html.match(/<circle cx="([^"]+)" cy="([^"]+)"/)!;
  return { html, points, marker: { x: Number(circle[1]), y: Number(circle[2]) } };
}

test("the chart draws the real values: one point per month, heights proportional from zero", () => {
  const series = [10, 40, 20, 80, 0, 60];
  const { points, html } = chart(series);
  assert.equal(points.length, series.length);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const baseline = HEIGHT - PAD_Y;
  const heights = points.map((p) => baseline - p.y);
  // zero sits on the baseline, and every other height is in proportion to its value
  assert.ok(Math.abs(heights[4]) < 1e-9);
  for (let i = 0; i < series.length; i++)
    assert.ok(Math.abs(heights[i] / heights[3] - series[i] / 80) < 1e-9, `month ${i}`);
  // the peak leaves headroom inside the chart
  assert.ok(points[3].y > PAD_Y);
  // months are evenly spaced across the full width
  assert.equal(points[0].x, 0);
  assert.equal(points.at(-1)!.x, 280);
});

test("the marker and callout sit on the latest month, the one the callout names", () => {
  const { points, marker, html } = chart([5, 9, 3, 7]);
  assert.deepEqual(marker, points.at(-1));
  assert.match(html, /left:100%/);
  // anchored to the left of the end point so it stays inside the card
  assert.match(html, /-translate-x-full/);
  assert.match(html, /TITLE/);
});

test("flat, single, empty and negative series draw without breaking", () => {
  const flatZero = chart([0, 0, 0]);
  assert.ok(flatZero.points.every((p) => p.y === HEIGHT - PAD_Y));
  const single = chart([42]);
  assert.equal(single.points.length, 2);
  assert.equal(single.points[0].y, single.points[1].y);
  assert.ok(single.points[0].y < HEIGHT - PAD_Y, "a real value is not pinned to the baseline");
  const empty = chart([]);
  assert.doesNotMatch(empty.html, /NaN|Infinity/);
  const negative = chart([3, -2, 5]);
  assert.doesNotMatch(negative.html, /NaN|Infinity/);
  // the lowest (negative) month is at the bottom, the highest at the top
  const ys = negative.points.map((p) => p.y);
  assert.equal(Math.max(...ys), ys[1]);
  assert.equal(Math.min(...ys), ys[2]);
  assert.ok(ys.every((y) => y >= PAD_Y && y <= HEIGHT - PAD_Y));
});

test("the change badge is not a menu: no dropdown arrow", () => {
  const source = readFileSync("src/components/KpiTrendCard.tsx", "utf8");
  assert.doesNotMatch(source, /ChevronDown/);
  assert.doesNotMatch(source, /smoothSeries/);
});

// --- the months -------------------------------------------------------------------------------

test("the window is the last 12 complete calendar months, oldest first", () => {
  assert.equal(WINDOW.length, 12);
  assert.equal(WINDOW[0], "2025-11");
  assert.equal(WINDOW.at(-1), "2026-10");
  // across a year boundary
  assert.deepEqual(lastCompleteMonths(2, new Date("2026-01-01T00:00:00.000Z")), [
    "2025-11",
    "2025-12",
  ]);
});

test("analytics rows fill every month: the current month is left out and a missing month is zero", () => {
  const rows = monthlyTrendRows(
    [
      { month: "2025-10", views: 999 }, // before the window
      { month: "2026-03", views: 30, subscribersGained: -2, watchTimeMinutes: 90 },
      { month: "2026-10", views: 50, subscribersGained: 4, watchTimeMinutes: 120 },
      { month: "2026-11", views: 7 }, // the current, partial month
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => r.month),
    WINDOW,
  );
  assert.deepEqual(rows[4], {
    month: "2026-03",
    views: 30,
    subscribersGained: -2,
    watchTimeMinutes: 90,
  });
  assert.deepEqual(rows[5], {
    month: "2026-04",
    views: 0,
    subscribersGained: 0,
    watchTimeMinutes: 0,
  });
  assert.equal(rows.at(-1)!.views, 50);
  assert.equal(
    rows.reduce((sum, r) => sum + r.views, 0),
    80,
    "the 12-month total covers the same months as the chart",
  );
  assert.deepEqual(monthlyTrendRows([], NOW), [], "no data stays empty");
  assert.deepEqual(monthlyTrendRows(undefined, NOW), []);
});

test("uploads are counted per month over the same window, zero where nothing was published", () => {
  const months = uploadsByMonth(
    [
      { publishedAt: "2026-10-03T10:00:00Z" },
      { publishedAt: "2026-10-20T10:00:00Z" },
      { publishedAt: "2026-08-01T10:00:00Z" },
      { publishedAt: "2026-11-02T10:00:00Z" }, // current month
      { publishedAt: null },
    ],
    NOW,
  );
  assert.deepEqual(
    months.map((m) => m.month),
    WINDOW,
  );
  assert.equal(months.at(-1)!.count, 2);
  assert.equal(months.at(-2)!.count, 0);
  assert.equal(months.at(-3)!.count, 1);
});

test("a full page of uploads only covers the months after its oldest upload", () => {
  // 50 uploads, the oldest in June 2026: June itself may have more uploads beyond the page
  const videos = Array.from({ length: RECENT_UPLOADS_PAGE }, (_, i) => ({
    publishedAt: i === RECENT_UPLOADS_PAGE - 1 ? "2026-06-15T00:00:00Z" : "2026-09-10T00:00:00Z",
  }));
  const months = uploadsByMonth(videos, NOW);
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-07", "2026-08", "2026-09", "2026-10"],
  );
  assert.equal(months[2].count, RECENT_UPLOADS_PAGE - 1);
});

// --- the dashboard and the server -------------------------------------------------------------

test("the dashboard builds its cards from those months and labels the comparison", () => {
  const page = readFileSync("src/routes/dashboard.tsx", "utf8");
  assert.match(page, /monthlyTrendRows\(dashboardData\?\.analytics\)/);
  assert.match(page, /uploadsByMonth\(dashboardData\.videos/);
  // month-over-month badges name the month they compare against, not "Past 12 months"
  assert.doesNotMatch(page, /Past \$\{/);
  assert.match(page, /`vs \$\{monthLabel\(analyticsRows\.at\(-2\)\?\.month\)\}`/);
  // watch time totals the same months as its chart
  assert.match(page, /watchSeries\.reduce\(/);
  assert.doesNotMatch(page, /dashboardData\.analytics\.reduce\(/);
  // a month that lost subscribers reads "-2 subs", not "+-2 subs"
  assert.doesNotMatch(page, /markerTitle=\{`\+\$\{subsSeries/);
});

test("the server's monthly trend starts on the 1st, so its oldest month is complete", () => {
  const route = readFileSync("src/routes/api.youtube.dashboard.ts", "utf8").replace(/\r\n/g, "\n");
  assert.match(
    route,
    /const trendStart = new Date\(\s*Date\.UTC\(startDate\.getUTCFullYear\(\), startDate\.getUTCMonth\(\), 1\),?\s*\)/,
  );
  for (const metrics of ['["views", "subscribersGained"]', '["estimatedMinutesWatched"]']) {
    const at = route.indexOf(`metrics: ${metrics}`);
    assert.ok(at > 0, metrics);
    assert.match(route.slice(at - 120, at), /startDate: isoDate\(trendStart\)/, metrics);
  }
});
