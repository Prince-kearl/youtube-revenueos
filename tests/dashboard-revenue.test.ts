import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DASHBOARD_REVENUE_DAYS,
  EMPTY_DASHBOARD_REVENUE,
  dashboardRevenueUrls,
  demoDashboardRevenue,
  emptyRevenueTrend,
  formatUsd,
  formatUsdCompact,
  mapDashboardRevenue,
  mapTopRevenueVideos,
  trendForRange,
} from "../src/lib/dashboard-revenue";
import {
  handleRevenueSummaryRequest,
  type RevenueSummaryResponse,
} from "../src/lib/server/revenue-summary";
import {
  handleRevenueVideosRequest,
  type RevenueVideosResponse,
} from "../src/lib/server/revenue-videos";
import {
  A1,
  A2,
  B1,
  FakeDb,
  WS_A,
  WS_B,
  channel,
  channelDay,
  synced,
  video,
  videoDay,
  type Row,
} from "./helpers/revenue-fake-db";

// The Dashboard's revenue is tested end to end below the React layer: the real canonical
// handlers answer the exact URLs the Dashboard requests, and the Dashboard's own mapping turns
// those responses into what each card prints.

const NOW = new Date("2026-10-10T08:00:00Z");
const DAY_MS = 86_400_000;
/** Every day of the Dashboard's 365-day period ending 2026-10-07, oldest first. */
const PERIOD_DAYS = Array.from({ length: 365 }, (_, i) =>
  new Date(Date.parse("2026-10-07T00:00:00Z") - (364 - i) * DAY_MS).toISOString().slice(0, 10),
);
/** The 365 days before that. */
const PREVIOUS_DAYS = PERIOD_DAYS.map((day) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 365 * DAY_MS).toISOString().slice(0, 10),
);

async function load(db: FakeDb, activeChannelId: string | null, workspaceId = WS_A) {
  const urls = dashboardRevenueUrls(activeChannelId);
  const context = async () => ({ client: db.clientFor(workspaceId), workspaceId });
  const summaryResponse = await handleRevenueSummaryRequest(
    new Request(`https://app.test${urls.summary}`),
    { getContext: context, canViewDeals: async () => true, now: () => NOW },
  );
  const videosResponse = await handleRevenueVideosRequest(
    new Request(`https://app.test${urls.videos}`),
    { getContext: context, now: () => NOW },
  );
  const summary = ((await summaryResponse.json()) as { data: RevenueSummaryResponse }).data;
  const videos = ((await videosResponse.json()) as { data: RevenueVideosResponse }).data;
  return {
    urls,
    summary,
    videos,
    view: mapDashboardRevenue(summary),
    topVideos: mapTopRevenueVideos(videos),
  };
}

/** Alpha earns $3/day this year ($2 ads + $0.50 Premium + $0.50 other) and $2/day the year
 * before; two videos explain part of it. Workspace B has a much larger channel. */
function seed(revenue: (day: string, index: number) => Row = () => ({})) {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, B1, WS_B, "Bravo");
  synced(db, A1);
  synced(db, B1);
  video(db, "v-top", A1, { youtube_video_id: "TOPTOPTOP01" });
  video(db, "v-second", A1, { youtube_video_id: "SECONDSEC01" });
  video(db, "v-gone", A1, { youtube_video_id: "GONEGONE001", status: "deleted" });
  PERIOD_DAYS.forEach((day, index) => {
    channelDay(db, A1, day, {
      estimated_revenue_usd: 3,
      ad_revenue_usd: 2,
      premium_revenue_usd: 0.5,
      views: 1000,
      ...revenue(day, index),
    });
    videoDay(db, "v-top", A1, day, { estimated_revenue_usd: 2, views: 600 });
    if (index >= 335) videoDay(db, "v-second", A1, day, { estimated_revenue_usd: 0.5, views: 100 });
    if (index < 30) videoDay(db, "v-gone", A1, day, { estimated_revenue_usd: 0.25, views: 50 });
    channelDay(db, B1, day, { estimated_revenue_usd: 999, views: 99999 });
  });
  PREVIOUS_DAYS.forEach((day) => {
    channelDay(db, A1, day, { estimated_revenue_usd: 2, views: 800 });
    videoDay(db, "v-top", A1, day, { estimated_revenue_usd: 1, views: 300 });
  });
  return db;
}

// ---------- requests ----------

test("the Dashboard asks the canonical API for one year by month, and one page of top videos", () => {
  const urls = dashboardRevenueUrls(null);
  assert.equal(urls.summary, "/api/revenue/summary?days=365&granularity=month");
  assert.equal(urls.videos, "/api/revenue/videos?days=365&limit=5&sort=revenue&direction=desc");
  assert.equal(DASHBOARD_REVENUE_DAYS, 365);
});

// ---------- 12. active channel scoping ----------

test("the active channel is passed to both requests, and scopes the revenue shown", async () => {
  const urls = dashboardRevenueUrls(A1);
  assert.ok(urls.summary.endsWith(`&channelId=${A1}`));
  assert.ok(urls.videos.endsWith(`&channelId=${A1}`));

  const db = seed();
  channel(db, A2, WS_A, "Second");
  synced(db, A2);
  for (const day of PERIOD_DAYS) channelDay(db, A2, day, { estimated_revenue_usd: 10 });

  const alpha = await load(db, A1);
  assert.deepEqual(
    alpha.summary.channels.map((c) => c.name),
    ["Alpha"],
  );
  assert.equal(alpha.view.total.usd, 1095, "Alpha only: 365 × $3");
  const second = await load(db, A2);
  assert.equal(second.view.total.usd, 3650);
  // With no channel selected yet, the workspace's connected channels are shown together.
  const all = await load(db, null);
  assert.equal(all.view.total.usd, 4745);
  assert.ok(!JSON.stringify(all.summary).includes("Bravo"), "never another workspace");
});

// ---------- 1 & 2. KPI and change ----------

test("Estimated Revenue is the canonical earned revenue, and its change is the canonical change", async () => {
  const { view, summary } = await load(seed(), A1);
  assert.equal(view.state, "ready");
  assert.equal(view.total.usd, summary.earned.revenue.usd);
  assert.equal(view.total.text, "$1,095");
  assert.equal(view.total.partial, false);
  assert.equal(view.periodLabel, "Last 365 days");
  assert.equal(view.comparisonLabel, "vs previous 365 days");
  // $1,095 against $730 the year before — exactly what the API reports, not recomputed here.
  assert.equal(view.changePercent, summary.earned.change.revenue.percent);
  assert.equal(view.changePercent, 50);
  assert.equal(view.changeText, "+$365");
  assert.equal(view.positive, true);
});

test("a decline is negative, and a change from a zero or unknown previous period has no percentage", async () => {
  const falling = await load(
    seed(() => ({ estimated_revenue_usd: 1 })),
    A1,
  );
  assert.equal(falling.view.changePercent, -50);
  assert.equal(falling.view.changeText, "-$365");
  assert.equal(falling.view.positive, false);

  // Previous year reported as zero: growth has an amount but no percentage.
  const fromZero = seed();
  for (const row of fromZero.tables.channel_daily_stats)
    if (PREVIOUS_DAYS.includes(row.day as string)) row.estimated_revenue_usd = 0;
  const zeroView = (await load(fromZero, A1)).view;
  assert.equal(zeroView.changePercent, null);
  assert.equal(zeroView.changeText, "+$1,095");

  // No previous year stored at all: nothing to compare against.
  const noHistory = seed();
  noHistory.tables.channel_daily_stats = noHistory.tables.channel_daily_stats.filter(
    (row) => !PREVIOUS_DAYS.includes(row.day as string),
  );
  const unknownView = (await load(noHistory, A1)).view;
  assert.equal(unknownView.changePercent, null);
  assert.equal(unknownView.changeText, "—");
  assert.equal(unknownView.total.text, "$1,095", "the total itself is unaffected");
});

// ---------- 3 & 4. sparkline, latest, trend ----------

test("the sparkline and Revenue Trends come from the canonical monthly trend", async () => {
  const { view, summary } = await load(seed(), A1);
  assert.equal(summary.granularity, "month");
  assert.deepEqual(
    view.trend.map((point) => point.monthKey),
    summary.earned.trend.map((point) => point.bucket),
  );
  assert.equal(view.trend.length, 13, "8 Oct 2025 … 7 Oct 2026 touches 13 calendar months");
  assert.deepEqual(
    view.trend.map((point) => point.revenueUsd),
    summary.earned.trend.map((point) => point.revenue.usd),
  );
  assert.deepEqual(
    view.series,
    view.trend.map((point) => point.revenueUsd),
  );
  assert.equal(view.trend.at(-2)!.revenueUsd, 90, "September: 30 × $3");
  assert.equal(view.trend.at(-2)!.month, "Sep");
  const sum = view.series.reduce((total, value) => total + value, 0);
  assert.equal(sum, view.total.usd, "the months add up to the headline");

  // 3M / 6M / 12M are slices of the same response.
  assert.deepEqual(
    trendForRange(view.trend, "3M").map((p) => p.monthKey),
    ["2026-08", "2026-09", "2026-10"],
  );
  assert.equal(trendForRange(view.trend, "6M").length, 6);
  assert.equal(trendForRange(view.trend, "12M").length, 12);
  assert.equal(trendForRange(view.trend, "12M")[0].monthKey, "2025-11");
});

test("Latest Revenue is the newest month with reported revenue, flagged while it is still moving", async () => {
  const { view, summary } = await load(seed(), A1);
  assert.equal(view.latest!.monthKey, "2026-10");
  assert.equal(view.latest!.label, "Oct 2026");
  assert.equal(view.latest!.usd, 21, "1–7 October, 7 × $3 — nothing from days not yet reported");
  assert.equal(view.latest!.text, "$21.00");
  assert.equal(view.latest!.incomplete, true);
  assert.equal(summary.earned.trend.at(-1)!.incomplete, true);
  assert.equal(summary.period.endDate, "2026-10-07", "the period stops before pending days");
});

test("when the newest month has no revenue reported, Latest Revenue falls back to the month that does", async () => {
  const db = seed((day) =>
    day >= "2026-10-01"
      ? { estimated_revenue_usd: null, ad_revenue_usd: null, premium_revenue_usd: null }
      : {},
  );
  const { view } = await load(db, A1);
  assert.equal(view.latest!.monthKey, "2026-09");
  assert.equal(view.latest!.usd, 90);
  assert.equal(view.latest!.incomplete, false);
  assert.equal(view.trend.at(-1)!.revenueUsd, null, "October is a gap in the chart, not $0");
  assert.equal(view.series.length, 12, "the sparkline skips the unknown month");
  assert.equal(view.total.partial, true);
  assert.equal(view.total.text, "$1,074", "the known part, flagged as partial");
});

// ---------- 5. split ----------

test("Revenue Split is the latest month's canonical split, as reported", async () => {
  const { view, summary } = await load(seed(), A1);
  const latest = summary.earned.trend.at(-1)!;
  assert.deepEqual(
    view.split.map((row) => [row.key, row.label, row.usd, row.text, row.sharePercent]),
    [
      ["ads", "Ad Revenue", latest.split.ad.usd, "$14.00", 67],
      ["premium", "YouTube Premium", latest.split.premium.usd, "$3.50", 17],
      ["other", "Other", latest.split.other.usd, "$3.50", 17],
    ],
  );
  assert.deepEqual(
    view.split.map((row) => row.usd),
    [14, 3.5, 3.5],
  );
  assert.ok(view.split.every((row) => row.color.startsWith("var(--")));
});

test("a split part that was not reported is left out, never shown as $0", async () => {
  const db = seed((day) => (day >= "2026-10-01" ? { ad_revenue_usd: null } : {}));
  const { view } = await load(db, A1);
  assert.deepEqual(
    view.split.map((row) => [row.key, row.usd]),
    [["premium", 3.5]],
    "ads unknown, and 'other' cannot be known without it",
  );
});

// ---------- 6. top revenue videos ----------

test("Top Revenue Videos are the canonical videos, in revenue order, with their own figures", async () => {
  const { topVideos, videos } = await load(seed(), A1);
  assert.deepEqual(
    topVideos.map((v) => v.videoId),
    ["v-top", "v-second", "v-gone"],
  );
  const [top, second, gone] = topVideos;
  assert.equal(top.title, "Title v-top");
  assert.equal(top.thumbnail, "https://img.test/v-top.jpg");
  assert.equal(top.url, "https://www.youtube.com/watch?v=TOPTOPTOP01");
  assert.equal(top.revenue.usd, 730);
  assert.equal(top.revenue.text, "$730");
  assert.equal(top.views, 219000);
  assert.equal(top.changePercent, videos.videos[0].change.views.percent);
  assert.equal(top.changePercent, 100, "219,000 views against 109,500 the year before");
  assert.equal(top.currentlyListed, true);
  assert.equal(second.revenue.text, "$15.00");
  assert.equal(second.changePercent, null, "a video with no earlier period has no percentage");
  // A video YouTube no longer returns keeps its history but is not linked.
  assert.equal(gone.currentlyListed, false);
  assert.equal(gone.url, null);
  assert.equal(gone.revenue.text, "$7.50");
  assert.ok(!/deleted/i.test(JSON.stringify(topVideos)));
});

test("a top video with unknown revenue shows a dash, and at most five are shown", async () => {
  const db = seed();
  for (let i = 0; i < 6; i++) {
    video(db, `v-extra-${i}`, A1, { youtube_video_id: `EXTRAEXTRA${i}` });
    videoDay(db, `v-extra-${i}`, A1, PERIOD_DAYS[364], {
      estimated_revenue_usd: i === 0 ? null : 0.01 * i,
      views: 5,
    });
  }
  const { topVideos, videos } = await load(db, A1);
  assert.equal(topVideos.length, 5);
  assert.equal(videos.pagination.limit, 5);
  const unknownOnly = mapTopRevenueVideos({
    ...videos,
    videos: videos.videos.map((v) => ({
      ...v,
      revenue: { usd: null, availability: "unavailable", knownDays: 0, unknownDays: 1 },
    })),
  });
  assert.ok(unknownOnly.every((v) => v.revenue.text === "—" && v.revenue.usd === null));
});

// ---------- 7 & 8. zero vs unavailable ----------

test("a channel that earned $0 shows $0 everywhere — real data, not an empty state", async () => {
  const zero = { estimated_revenue_usd: 0, ad_revenue_usd: 0, premium_revenue_usd: 0 };
  const db = seed(() => zero);
  for (const row of db.tables.video_daily_stats) row.estimated_revenue_usd = 0;
  const { view, topVideos } = await load(db, A1);
  assert.equal(view.state, "ready");
  assert.equal(view.total.text, "$0");
  assert.equal(view.total.usd, 0);
  assert.equal(view.total.available, true);
  assert.equal(view.latest!.text, "$0");
  assert.ok(
    view.trend.every((point) => point.revenueUsd === 0),
    "a flat line at zero, no gaps",
  );
  assert.equal(view.series.length, 13);
  assert.deepEqual(
    view.split.map((row) => [row.key, row.text, row.sharePercent]),
    [
      ["ads", "$0", 0],
      ["premium", "$0", 0],
      ["other", "$0", 0],
    ],
  );
  assert.equal(topVideos[0].revenue.text, "$0");
});

test("revenue that was never reported is a dash everywhere and never $0", async () => {
  const blank = { estimated_revenue_usd: null, ad_revenue_usd: null, premium_revenue_usd: null };
  const db = seed(() => blank);
  for (const row of db.tables.video_daily_stats) row.estimated_revenue_usd = null;
  const { view, topVideos } = await load(db, A1);
  assert.equal(view.state, "ready", "the channel is synced; revenue just was not reported");
  assert.equal(view.total.text, "—");
  assert.equal(view.total.usd, null);
  assert.equal(view.total.available, false);
  assert.equal(view.latest, null);
  assert.deepEqual(view.series, []);
  assert.ok(view.trend.every((point) => point.revenueUsd === null));
  assert.deepEqual(view.split, []);
  assert.equal(view.changePercent, null);
  assert.equal(view.changeText, "—");
  assert.ok(topVideos.every((v) => v.revenue.text === "—"));
  assert.ok(!JSON.stringify(view).includes("$0"), "no zero is invented anywhere in the view");
});

test("amounts are formatted without losing small revenue or inventing zeros", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(Number.NaN), "—");
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.004), "$0.00");
  assert.equal(formatUsd(0.42), "$0.42");
  assert.equal(formatUsd(99.99), "$99.99");
  assert.equal(formatUsd(100), "$100");
  assert.equal(formatUsd(1234.56), "$1,235");
  assert.equal(formatUsd(-12.5), "-$12.50");
  assert.equal(formatUsdCompact(0), "$0");
  assert.equal(formatUsdCompact(1250), "$1.3K");
});

// ---------- 9. freshness ----------

test("the freshness note says how far the data goes and that recent days can change", async () => {
  const { view, summary } = await load(seed(), A1);
  assert.equal(summary.dataQuality.freshness.latestStoredDay, "2026-10-07");
  assert.equal(
    view.freshnessNote,
    "Estimated YouTube revenue through Oct 7 · the most recent days can still change",
  );
  // A fully settled period carries no caveat.
  const settled = mapDashboardRevenue({
    ...summary,
    dataQuality: {
      ...summary.dataQuality,
      freshness: { ...summary.dataQuality.freshness, provisionalDays: [], pendingDays: [] },
    },
  });
  assert.equal(settled.freshnessNote, "Estimated YouTube revenue through Oct 7");
});

test("a connected channel with nothing stored yet is 'empty', and no channel is 'not connected'", async () => {
  const unsynced = new FakeDb();
  channel(unsynced, A1, WS_A, "Alpha");
  const empty = (await load(unsynced, A1)).view;
  assert.equal(empty.state, "empty");
  assert.equal(empty.total.text, "—");
  assert.equal(empty.freshnessNote, "");
  assert.equal(empty.latest, null);

  const none = (await load(new FakeDb(), null)).view;
  assert.equal(none.state, "not_connected");
  assert.equal(none.total.text, "—");

  assert.equal(EMPTY_DASHBOARD_REVENUE.total.text, "—");
  assert.equal(EMPTY_DASHBOARD_REVENUE.changePercent, null);
});

test("the empty chart frame is month labels at zero, used only under a message", () => {
  const frame = emptyRevenueTrend("3M", new Date("2026-10-10T00:00:00Z"));
  assert.deepEqual(frame, [
    { month: "Aug", revenue: 0 },
    { month: "Sep", revenue: 0 },
    { month: "Oct", revenue: 0 },
  ]);
  assert.equal(emptyRevenueTrend("12M", new Date("2026-01-15T00:00:00Z")).length, 12);
  assert.equal(emptyRevenueTrend("6M", new Date("2026-01-15T00:00:00Z"))[0].month, "Aug");
});

// ---------- 13. demo mode ----------

test("demo mode builds the same view from the bundled sample numbers, with no request", () => {
  const demo = demoDashboardRevenue({
    analytics: [
      { month: "2026-07", estimatedRevenue: 61.2 },
      {
        month: "2026-08",
        estimatedRevenue: 74.8,
        estimatedAdRevenue: 50,
        estimatedRedPartnerRevenue: 10,
      },
    ],
    videos: [
      {
        id: "demo-1",
        title: "Demo one",
        thumbnail: "/a.png",
        url: "https://y.test/1",
        publishedAt: null,
      },
    ],
    topRevenueVideos: [
      { videoId: "demo-1", views: 842, revenue: 74.8, changePercent: 27.3 },
      { videoId: "missing", views: 1, revenue: 1, changePercent: null },
    ],
  });
  assert.equal(demo.revenue.state, "ready");
  assert.equal(demo.revenue.total.text, "$136");
  assert.deepEqual(demo.revenue.series, [61.2, 74.8]);
  assert.equal(demo.revenue.latest!.label, "Aug 2026");
  assert.equal(demo.revenue.latest!.text, "$74.80");
  assert.deepEqual(
    demo.revenue.split.map((row) => [row.key, row.sharePercent]),
    [
      ["ads", 67],
      ["premium", 13],
      ["other", 20],
    ],
  );
  assert.equal(demo.revenue.changePercent, null, "no comparison is invented for sample data");
  assert.match(demo.revenue.freshnessNote, /demo/i);
  assert.deepEqual(
    demo.topVideos.map((v) => [v.videoId, v.title, v.revenue.text, v.changePercent, v.url]),
    [["demo-1", "Demo one", "$74.80", 27.3, "https://y.test/1"]],
  );
});

test("demo mode still short-circuits both loaders before any request", () => {
  const source = readFileSync("src/routes/dashboard.tsx", "utf8");
  const loadRevenue = source.slice(
    source.indexOf("const loadRevenue = async"),
    source.indexOf("const loadYoutubeData = async"),
  );
  assert.ok(loadRevenue.indexOf("IS_LOCAL_DEMO") < loadRevenue.indexOf("fetch("));
  assert.match(loadRevenue, /demoDashboardRevenue\(DEMO_YOUTUBE_DASHBOARD\)/);
  const loadYoutube = source.slice(source.indexOf("const loadYoutubeData = async"));
  assert.ok(loadYoutube.indexOf("IS_LOCAL_DEMO") < loadYoutube.indexOf("fetch("));
});

// ---------- 11. no live revenue in the Dashboard page ----------

test("the Dashboard page no longer reads or calculates live YouTube revenue", () => {
  const source = readFileSync("src/routes/dashboard.tsx", "utf8");
  for (const forbidden of [
    "estimatedRevenue",
    "estimatedAdRevenue",
    "estimatedRedPartnerRevenue",
    "revenueStatus",
    "topRevenueVideosStatus",
    "buildRevenueTrend",
    "cpm",
  ])
    assert.ok(!source.includes(forbidden), `dashboard.tsx no longer mentions ${forbidden}`);
  // Its only requests: the two canonical revenue URLs, and the live route with revenue switched off.
  assert.equal(source.match(/fetch\(/g)?.length, 3);
  assert.match(source, /fetch\(urls\.summary/);
  assert.match(source, /fetch\(urls\.videos/);
  assert.match(source, /new URLSearchParams\(\{ revenue: "0" \}\)/);
  assert.match(source, /dashboardRevenueUrls\(activeChannelId\)/);
  // The revenue cards take their numbers from the mapped canonical view.
  assert.match(source, /value=\{revenueValue\(revenue\.total\.text\)\}/);
  assert.match(source, /changePercent=\{revenue\.changePercent\}/);
  assert.match(source, /series=\{revenue\.series\}/);
});

test("the mapping module calculates no revenue of its own and calls nothing", () => {
  const source = readFileSync("src/lib/dashboard-revenue.ts", "utf8");
  assert.ok(!/fetch\(|googleapis|youtubeanalytics|supabase/i.test(source));
  // Only type imports from the server modules: nothing server-side is bundled into the page.
  for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/g))
    assert.ok(match[1], `${match[2]} is imported as a type only`);
});
