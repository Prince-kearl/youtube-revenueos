import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ANALYTICS_REVENUE_DAYS,
  analyticsSummaryUrl,
  analyticsVideoEarningsUrl,
  formatRevenuePerView,
  mapAnalyticsRevenue,
  mapVideoEarnings,
  videoEarningsText,
} from "../src/lib/analytics-revenue";
import { dashboardRevenueUrls, mapDashboardRevenue } from "../src/lib/dashboard-revenue";
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
  A_OFF,
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

// The Analytics page's revenue is tested below the React layer, the same way the Dashboard's is:
// the real canonical handlers answer the exact URLs the page requests, and the page's own
// mapping turns the responses into what each surface prints.

const NOW = new Date("2026-10-10T08:00:00Z");
const DAY_MS = 86_400_000;
const PERIOD_DAYS = Array.from({ length: 365 }, (_, i) =>
  new Date(Date.parse("2026-10-07T00:00:00Z") - (364 - i) * DAY_MS).toISOString().slice(0, 10),
);
const PREVIOUS_DAYS = PERIOD_DAYS.map((day) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 365 * DAY_MS).toISOString().slice(0, 10),
);
const YT = { top: "TOPTOPTOP01", second: "SECONDSEC01", gone: "GONEGONE001", idle: "IDLEIDLE001" };

async function summaryFor(db: FakeDb, channelId: string | null, workspaceId = WS_A) {
  const url = analyticsSummaryUrl(channelId);
  const response = await handleRevenueSummaryRequest(new Request(`https://app.test${url}`), {
    getContext: async () => ({ client: db.clientFor(workspaceId), workspaceId }),
    canViewDeals: async () => true,
    now: () => NOW,
  });
  const body = (await response.json()) as { data?: RevenueSummaryResponse; error?: string };
  return { url, status: response.status, body, summary: body.data as RevenueSummaryResponse };
}

async function videosFor(db: FakeDb, url: string, workspaceId: string | null = WS_A) {
  const response = await handleRevenueVideosRequest(new Request(`https://app.test${url}`), {
    getContext: async () => {
      if (!workspaceId)
        throw new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401 });
      return { client: db.clientFor(workspaceId), workspaceId };
    },
    now: () => NOW,
  });
  const body = (await response.json()) as { data?: RevenueVideosResponse; error?: string };
  return { status: response.status, body, videos: body.data as RevenueVideosResponse };
}

/** Alpha: $4/day this year ($3 ads + $0.60 Premium + $0.40 other) over 2,000 views a day, and
 * $2/day over 2,000 views the year before. Workspace B has a far larger channel. */
function seed(revenue: (day: string, index: number) => Row = () => ({})) {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, B1, WS_B, "Bravo");
  synced(db, A1);
  synced(db, B1);
  video(db, "v-top", A1, { youtube_video_id: YT.top });
  video(db, "v-second", A1, { youtube_video_id: YT.second });
  video(db, "v-gone", A1, { youtube_video_id: YT.gone, status: "deleted" });
  video(db, "v-idle", A1, { youtube_video_id: YT.idle });
  video(db, "v-bravo", B1, { youtube_video_id: "BRAVOBRAVO1" });
  PERIOD_DAYS.forEach((day, index) => {
    channelDay(db, A1, day, {
      estimated_revenue_usd: 4,
      ad_revenue_usd: 3,
      premium_revenue_usd: 0.6,
      views: 2000,
      ...revenue(day, index),
    });
    videoDay(db, "v-top", A1, day, { estimated_revenue_usd: 2.5, views: 1200 });
    if (index >= 300) videoDay(db, "v-second", A1, day, { estimated_revenue_usd: 0.5, views: 300 });
    if (index < 40) videoDay(db, "v-gone", A1, day, { estimated_revenue_usd: 0.25, views: 50 });
    channelDay(db, B1, day, { estimated_revenue_usd: 999, views: 99999 });
    videoDay(db, "v-bravo", B1, day, { estimated_revenue_usd: 999, views: 99999 });
  });
  PREVIOUS_DAYS.forEach((day) =>
    channelDay(db, A1, day, { estimated_revenue_usd: 2, views: 2000 }),
  );
  return db;
}

// ---------- requests ----------

test("the Analytics page asks the canonical summary for one year by month, scoped to its channel", () => {
  assert.equal(ANALYTICS_REVENUE_DAYS, 365);
  assert.equal(
    analyticsSummaryUrl(A1),
    `/api/revenue/summary?days=365&granularity=month&channelId=${A1}`,
  );
  assert.equal(analyticsSummaryUrl(null), "/api/revenue/summary?days=365&granularity=month");
});

// ---------- 1 & 2. KPI and change ----------

test("Estimated Revenue and its change are the canonical figures", async () => {
  const { summary } = await summaryFor(seed(), A1);
  const view = mapAnalyticsRevenue(summary);
  assert.equal(view.kpi.state, "ready");
  assert.equal(view.kpi.total.usd, summary.earned.revenue.usd);
  assert.equal(view.kpi.total.text, "$1,460");
  assert.equal(view.kpi.changePercent, summary.earned.change.revenue.percent);
  assert.equal(view.kpi.changePercent, 100, "$1,460 against $730 the year before");
  assert.equal(view.kpi.changeText, "+$730");
  assert.equal(view.kpi.periodLabel, "Last 365 days");
  assert.equal(view.kpi.comparisonLabel, "vs previous 365 days");
  // Exactly the Dashboard's view of the same response: one definition, two pages.
  assert.deepEqual(view.kpi, mapDashboardRevenue(summary));
});

test("no percentage is shown against a zero or missing previous period", async () => {
  const fromZero = seed();
  for (const row of fromZero.tables.channel_daily_stats)
    if (PREVIOUS_DAYS.includes(row.day as string)) row.estimated_revenue_usd = 0;
  const zero = mapAnalyticsRevenue((await summaryFor(fromZero, A1)).summary);
  assert.equal(zero.kpi.changePercent, null);
  assert.equal(zero.kpi.changeText, "+$1,460");
  assert.equal(zero.perView.changePercent, null);

  const noHistory = seed();
  noHistory.tables.channel_daily_stats = noHistory.tables.channel_daily_stats.filter(
    (row) => !PREVIOUS_DAYS.includes(row.day as string),
  );
  const unknown = mapAnalyticsRevenue((await summaryFor(noHistory, A1)).summary);
  assert.equal(unknown.kpi.changePercent, null);
  assert.equal(unknown.kpi.changeText, "—");
  assert.equal(unknown.perView.changeText, "—");
});

// ---------- 4. trend ----------

test("the revenue sparkline is the canonical monthly trend", async () => {
  const { summary } = await summaryFor(seed(), A1);
  const view = mapAnalyticsRevenue(summary);
  assert.equal(summary.granularity, "month");
  assert.deepEqual(
    view.kpi.trend.map((point) => [point.monthKey, point.revenueUsd]),
    summary.earned.trend.map((point) => [point.bucket, point.revenue.usd]),
  );
  assert.equal(view.kpi.series.length, 13);
  assert.equal(
    view.kpi.series.reduce((sum, value) => sum + value, 0),
    view.kpi.total.usd,
  );
  assert.equal(view.kpi.latest!.label, "Oct 2026");
  assert.equal(view.kpi.latest!.incomplete, true);
  assert.match(view.kpi.freshnessNote, /^Estimated YouTube revenue through Oct 7/);
});

// ---------- 3. Revenue by Source ----------

test("Revenue by Source is the canonical split: per month for the bars, the period for the donut", async () => {
  const { summary } = await summaryFor(seed(), A1);
  const { sources } = mapAnalyticsRevenue(summary);
  assert.equal(sources.hasData, true);
  assert.equal(sources.partial, false);
  assert.deepEqual(
    sources.series.map((p) => [p.monthKey, p.ads, p.premium, p.other]),
    summary.earned.trend.map((p) => [
      p.bucket,
      p.split.ad.usd,
      p.split.premium.usd,
      p.split.other.usd,
    ]),
  );
  const september = sources.series.find((p) => p.monthKey === "2026-09")!;
  assert.deepEqual(
    [september.month, september.ads, september.premium, september.other],
    ["Sep 2026", 90, 18, 12],
  );
  assert.deepEqual(
    sources.shares.map((row) => [row.key, row.label, row.usd, row.text, row.sharePercent]),
    [
      ["ads", "Ad Revenue", summary.earned.split.ad.usd, "$1,095", 75],
      ["premium", "YouTube Premium", summary.earned.split.premium.usd, "$219", 15],
      ["other", "Other", summary.earned.split.other.usd, "$146", 10],
    ],
  );
  // The months add up to the period, and the period's parts to the headline.
  const monthlyAds = sources.series.reduce((sum, p) => sum + (p.ads ?? 0), 0);
  assert.equal(monthlyAds, 1095);
  assert.equal(1095 + 219 + 146, summary.earned.revenue.usd);
});

test("a source that was not reported is a gap and is left out of the shares, never $0", async () => {
  const db = seed((day) =>
    day >= "2026-09-01"
      ? { ad_revenue_usd: null }
      : day >= "2026-08-01"
        ? { premium_revenue_usd: null }
        : {},
  );
  const { summary } = await summaryFor(db, A1);
  const { sources } = mapAnalyticsRevenue(summary);
  const month = (key: string) => sources.series.find((p) => p.monthKey === key)!;
  assert.deepEqual(
    [month("2026-09").ads, month("2026-09").premium, month("2026-09").other],
    [null, 18, null],
    "no ad revenue reported: 'other' cannot be known either",
  );
  assert.deepEqual(
    [month("2026-08").ads, month("2026-08").premium, month("2026-08").other],
    [93, null, null],
  );
  assert.equal(sources.partial, true);
  assert.equal(sources.hasData, true);
  assert.ok(sources.shares.every((row) => row.usd > 0));
});

// ---------- 5, 6, 7. zero / unavailable / partial ----------

test("a channel that earned $0 shows $0 with real zero bars, not an empty state", async () => {
  const zero = { estimated_revenue_usd: 0, ad_revenue_usd: 0, premium_revenue_usd: 0 };
  const { summary } = await summaryFor(
    seed(() => zero),
    A1,
  );
  const view = mapAnalyticsRevenue(summary);
  assert.equal(view.kpi.total.text, "$0");
  assert.equal(view.kpi.total.available, true);
  assert.equal(view.perView.text, "$0.000");
  assert.equal(view.perView.available, true);
  assert.equal(view.sources.hasData, true);
  assert.ok(view.sources.series.every((p) => p.ads === 0 && p.premium === 0 && p.other === 0));
  assert.deepEqual(
    view.sources.shares.map((row) => [row.key, row.text, row.sharePercent]),
    [
      ["ads", "$0", 0],
      ["premium", "$0", 0],
      ["other", "$0", 0],
    ],
  );
});

test("revenue that was never reported is a dash everywhere and never $0", async () => {
  const blank = { estimated_revenue_usd: null, ad_revenue_usd: null, premium_revenue_usd: null };
  const { summary } = await summaryFor(
    seed(() => blank),
    A1,
  );
  const view = mapAnalyticsRevenue(summary);
  assert.equal(view.kpi.total.text, "—");
  assert.equal(view.kpi.total.available, false);
  assert.deepEqual(view.kpi.series, []);
  assert.equal(view.perView.text, "—");
  assert.equal(view.perView.available, false);
  assert.deepEqual(view.perView.series, []);
  assert.equal(view.perView.latestText, "—");
  assert.equal(view.sources.hasData, false);
  assert.deepEqual(view.sources.shares, []);
  assert.ok(
    view.sources.series.every((p) => p.ads === null && p.premium === null && p.other === null),
  );
  assert.ok(!JSON.stringify(view).includes("$0"), "no zero is invented anywhere in the view");
});

test("a partly reported year shows the known amount and says it is partial", async () => {
  const db = seed((day) =>
    day >= "2026-09-01"
      ? { estimated_revenue_usd: null, ad_revenue_usd: null, premium_revenue_usd: null }
      : {},
  );
  const { summary } = await summaryFor(db, A1);
  const view = mapAnalyticsRevenue(summary);
  assert.equal(summary.earned.revenue.availability, "partial");
  assert.equal(view.kpi.total.partial, true);
  assert.equal(view.kpi.total.text, "$1,312", "328 reported days × $4");
  assert.equal(view.kpi.changePercent, null, "a partial period is not compared as a percentage");
  assert.equal(view.kpi.latest!.label, "Aug 2026", "the newest month that has revenue");
  assert.equal(view.kpi.trend.at(-1)!.revenueUsd, null);
  assert.equal(view.sources.partial, true);
  assert.equal(view.sources.series.at(-1)!.ads, null);
});

test("an unsynced or unconnected workspace maps to an explicit empty state", async () => {
  const unsynced = new FakeDb();
  channel(unsynced, A1, WS_A, "Alpha");
  const empty = mapAnalyticsRevenue((await summaryFor(unsynced, A1)).summary);
  assert.equal(empty.kpi.state, "empty");
  assert.equal(empty.sources.hasData, false);
  const none = mapAnalyticsRevenue((await summaryFor(new FakeDb(), null)).summary);
  assert.equal(none.kpi.state, "not_connected");
  assert.equal(none.kpi.total.text, "—");
});

// ---------- Revenue per View ----------

test("Revenue per View is the canonical revenue-per-view figure, not recomputed from live data", async () => {
  const { summary } = await summaryFor(seed(), A1);
  const { perView } = mapAnalyticsRevenue(summary);
  // $1,460 over 730,000 views. The canonical layer reports this per thousand views; the card
  // has always shown it per single view.
  assert.equal(summary.earned.rpm, 2);
  assert.equal(perView.text, "$0.002");
  assert.equal(perView.changePercent, summary.earned.change.rpm.percent);
  assert.equal(perView.changePercent, 100);
  assert.equal(perView.changeText, "+$0.001");
  assert.equal(perView.series.length, 13);
  assert.equal(perView.series[5], 0.002);
  assert.equal(perView.latestText, "$0.002");
  assert.equal(perView.positive, true);
  assert.equal(formatRevenuePerView(null), "—");
  assert.equal(formatRevenuePerView(0), "$0.000");
  assert.equal(formatRevenuePerView(0.0125), "$0.013");
});

// ---------- 8, 9, 10. CPM removed, RPM not substituted ----------

test("the Analytics page has no CPM surface and no RPM put in its place", () => {
  const source = readFileSync("src/routes/analytics.tsx", "utf8");
  assert.ok(
    !/cpm/i.test(source),
    "no CPM anywhere on the page: no card, no chart, no tab, no data",
  );
  assert.ok(!/\brpm\b/i.test(source), "and no RPM surface was added");
  assert.ok(!source.includes("Avg CPM"));
  assert.ok(!source.includes("CPM Trend"));
  assert.ok(!source.includes("LineChart"), "the CPM line chart is gone");
  assert.ok(!source.includes("sourceTab"), "the Revenue Sources / CPM Trend toggle is gone");
  // The four remaining KPI cards, in order.
  const titles = [...source.matchAll(/<KpiTrendCard\s+title="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Estimated Revenue", "Views", "Watch Time", "Revenue per View"]);
  assert.match(source, /<h2 className="text-lg font-semibold">Revenue by Source<\/h2>/);
});

test("the mapping module offers no CPM value and no RPM-labelled field", () => {
  const source = readFileSync("src/lib/analytics-revenue.ts", "utf8");
  const code = source
    .split("\n")
    .filter(
      (line) =>
        !line.trim().startsWith("//") &&
        !line.trim().startsWith("*") &&
        !line.trim().startsWith("/*"),
    )
    .join("\n");
  assert.ok(!/cpm/i.test(code), "no CPM in the module's code");
  assert.ok(!/["'`][^"'`]*\bRPM\b[^"'`]*["'`]/.test(code), "no user-facing RPM label");
});

// ---------- 11. earnings by video ----------

test("the earnings request names exactly the table's videos over the table's range, once", () => {
  const range = { startDate: "2025-10-10", endDate: "2026-10-10" };
  const url = analyticsVideoEarningsUrl(A1, range, [
    YT.top,
    YT.second,
    YT.top,
    null,
    "bad id",
    undefined,
  ]);
  assert.equal(
    url,
    `/api/revenue/videos?start=2025-10-10&end=2026-10-10&limit=100&videoIds=${YT.top},${YT.second}&channelId=${A1}`,
  );
  assert.equal(analyticsVideoEarningsUrl(A1, range, []), null, "nothing to ask for no rows");
  assert.equal(analyticsVideoEarningsUrl(A1, range, ["not-an-id"]), null);
  assert.equal(analyticsVideoEarningsUrl(A1, { startDate: "x", endDate: "y" }, [YT.top]), null);
  // A 12-month range spanning 29 February is 367 days: the first day is dropped, not refused.
  const leap = analyticsVideoEarningsUrl(null, { startDate: "2027-10-10", endDate: "2028-10-10" }, [
    YT.top,
  ])!;
  assert.match(leap, /start=2027-10-11&end=2028-10-10/);
  assert.ok(!leap.includes("channelId"));
  // More than the endpoint's maximum: the first 100 only, never an oversized request.
  const many = Array.from({ length: 130 }, (_, i) => `VID${String(i).padStart(8, "0")}`);
  assert.equal(
    analyticsVideoEarningsUrl(null, range, many)!.split("videoIds=")[1].split(",").length,
    100,
  );
});

test("Earnings by video shows each listed video's canonical earnings, and a dash where none is stored", async () => {
  const db = seed();
  const range = { startDate: "2025-10-10", endDate: "2026-10-10" };
  // The live table lists these videos (by YouTube id), including one with no stored activity.
  const listed = [YT.top, YT.second, YT.gone, YT.idle, "NOSUCHVID01"];
  const url = analyticsVideoEarningsUrl(A1, range, listed)!;
  const { status, videos } = await videosFor(db, url);
  assert.equal(status, 200);
  const earnings = mapVideoEarnings(videos);
  assert.equal(videoEarningsText(earnings, YT.top), "$908", "363 stored days × $2.50");
  assert.equal(
    earnings.get(YT.top)!.usd,
    videos.videos.find((v) => v.youtubeVideoId === YT.top)!.revenue.usd,
  );
  assert.equal(videoEarningsText(earnings, YT.second), "$32.50");
  assert.equal(
    videoEarningsText(earnings, YT.gone),
    "$9.50",
    "38 stored days × $0.25 — history kept for a video no longer listed",
  );
  assert.equal(videoEarningsText(earnings, YT.idle), "—", "no stored activity: a dash, not $0");
  assert.equal(videoEarningsText(earnings, "NOSUCHVID01"), "—");
  assert.equal(videoEarningsText(earnings, null), "—");
  assert.equal(videoEarningsText(null, YT.top), "—", "before the request answers, or if it failed");
  assert.equal(earnings.size, 3);
});

test("a video's reported $0 is $0 and its unreported revenue is a dash", async () => {
  const db = seed();
  for (const row of db.tables.video_daily_stats) {
    if (row.video_id === "v-top") row.estimated_revenue_usd = 0;
    if (row.video_id === "v-second") row.estimated_revenue_usd = null;
  }
  const url = analyticsVideoEarningsUrl(A1, { startDate: "2025-10-10", endDate: "2026-10-10" }, [
    YT.top,
    YT.second,
  ])!;
  const earnings = mapVideoEarnings((await videosFor(db, url)).videos);
  assert.equal(videoEarningsText(earnings, YT.top), "$0");
  assert.equal(earnings.get(YT.top)!.available, true);
  assert.equal(videoEarningsText(earnings, YT.second), "—");
  assert.equal(earnings.get(YT.second)!.available, false);
});

// ---------- 14. channel / workspace isolation ----------

test("revenue is scoped to the page's channel and never crosses workspaces", async () => {
  const db = seed();
  channel(db, A2, WS_A, "Second");
  synced(db, A2);
  for (const day of PERIOD_DAYS) channelDay(db, A2, day, { estimated_revenue_usd: 10 });
  channel(db, A_OFF, WS_A, "Disconnected", false);

  const alpha = await summaryFor(db, A1);
  assert.deepEqual(
    alpha.summary.channels.map((c) => c.name),
    ["Alpha"],
  );
  assert.equal(mapAnalyticsRevenue(alpha.summary).kpi.total.usd, 1460);
  assert.equal(mapAnalyticsRevenue((await summaryFor(db, A2)).summary).kpi.total.usd, 3650);

  for (const foreign of [B1, A_OFF, "cccccccc-0000-4000-8000-000000000009"]) {
    const refused = await summaryFor(db, foreign);
    assert.deepEqual([refused.status, refused.body], [404, { error: "CHANNEL_NOT_FOUND" }]);
  }
  // Another workspace's video id in the earnings request returns nothing.
  const range = { startDate: "2025-10-10", endDate: "2026-10-10" };
  const leaked = await videosFor(
    db,
    analyticsVideoEarningsUrl(A1, range, ["BRAVOBRAVO1", YT.top])!,
  );
  assert.deepEqual(
    leaked.videos.videos.map((v) => v.youtubeVideoId),
    [YT.top],
  );
  assert.ok(!JSON.stringify(leaked.videos).includes("999"));
  const foreignChannel = await videosFor(
    db,
    analyticsVideoEarningsUrl(B1, range, ["BRAVOBRAVO1"])!,
  );
  assert.equal(foreignChannel.status, 404);
  const signedOut = await videosFor(db, analyticsVideoEarningsUrl(A1, range, [YT.top])!, null);
  assert.equal(signedOut.status, 401);
});

test("with no channel selected the page resolves the same default the live routes use", () => {
  const hook = readFileSync("src/lib/revenue-channel.ts", "utf8");
  assert.match(hook, /fetch\("\/api\/youtube\/channels"/);
  assert.match(hook, /body\.data\?\.\[0\]\?\.id/, "the first, most recently connected channel");
  assert.match(hook, /return activeChannelId \?\? defaultChannelId;/);
  const page = readFileSync("src/routes/analytics.tsx", "utf8");
  assert.match(page, /const revenueChannelId = useRevenueChannelId\(activeChannelId\);/);
  assert.match(page, /analyticsSummaryUrl\(revenueChannelId\)/);
  assert.match(
    page,
    /if \(revenueChannelId === undefined\) return;/,
    "no request before the channel is known",
  );
  // Both revenue requests are cancelled when superseded.
  assert.equal(page.match(/signal: controller\.signal/g)?.length, 4);
});

// ---------- 13. no live revenue on the page ----------

test("the Analytics page reads no live revenue except traffic-source revenue, and asks the live routes to skip it", () => {
  const source = readFileSync("src/routes/analytics.tsx", "utf8");
  for (const forbidden of [
    "estimatedAdRevenue",
    "estimatedRedPartnerRevenue",
    "revenueStatus",
    "trendTotalRevenue",
    "trendRevenueSeries",
    "revenueSourceSeries",
    "video.revenueAvailable",
  ])
    assert.ok(!source.includes(forbidden), `analytics.tsx no longer mentions ${forbidden}`);
  // The only remaining live revenue field is the traffic-source one, which has no stored equivalent.
  const liveRevenueLines = source
    .split("\n")
    .filter((line) => line.includes("estimatedRevenue") && !line.trim().startsWith("//"));
  assert.equal(liveRevenueLines.length, 2);
  assert.match(source, /trafficSources\.revenueAvailable/);
  assert.match(source, /new URLSearchParams\(\{ revenue: "0" \}\)/);
  assert.match(source, /new URLSearchParams\(\{ range, videoRevenue: "0" \}\)/);
  assert.match(source, /value=\{revenueText\(revenueKpi\.total\.text\)\}/);
  assert.match(source, /changePercent=\{revenueKpi\.changePercent\}/);
  assert.match(source, /videoEarningsText\(videoEarnings\.byVideo, row\.video\)/);
});

// ---------- 12. non-revenue metrics untouched ----------

test("views, watch time and the traffic-source breakdown are still read from the live routes", () => {
  const source = readFileSync("src/routes/analytics.tsx", "utf8");
  assert.match(source, /title="Views"[\s\S]*?value=\{formatCount\(trendTotalViews\)\}/);
  assert.match(source, /title="Watch Time"[\s\S]*?trend\.data\?\.watchTimeStatus === "available"/);
  assert.match(source, /fetch\(`\/api\/youtube\/dashboard/);
  assert.match(source, /fetch\(`\/api\/youtube\/breakdowns/);
  assert.match(source, /formatCount\(numericValue\(row\.views\)\)/);
  assert.match(source, /formatWatchTime\(row\.estimatedMinutesWatched\)/);
  assert.match(source, /formatTrafficSource\(row\.insightTrafficSourceType\)/);
});

// ---------- 15. demo mode ----------

test("demo mode answers both canonical revenue requests itself", () => {
  const demo = readFileSync("src/lib/demo-api.ts", "utf8");
  assert.match(demo, /"\/api\/revenue\/summary": demoRevenueSummary,/);
  assert.match(demo, /"\/api\/revenue\/videos": demoRevenueVideos,/);
  assert.match(
    demo,
    /"\/api\/youtube\/channels": demoYoutubeChannels,/,
    "and the default-channel lookup",
  );
  assert.match(demo, /granularity: "month"/);
});

// ---------- 16. the Dashboard from Step 4A is unchanged ----------

test("the Dashboard's requests and mapping are unchanged", async () => {
  assert.deepEqual(dashboardRevenueUrls(A1), {
    summary: `/api/revenue/summary?days=365&granularity=month&channelId=${A1}`,
    videos: `/api/revenue/videos?days=365&limit=5&sort=revenue&direction=desc&channelId=${A1}`,
  });
  const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");
  assert.match(dashboard, /new URLSearchParams\(\{ revenue: "0" \}\)/);
  assert.match(dashboard, /dashboardRevenueUrls\(activeChannelId\)/);
  const { summary } = await summaryFor(seed(), A1);
  assert.equal(mapDashboardRevenue(summary).total.text, "$1,460");
});

test("only the local demo preview may send placeholder video ids", () => {
  const range = { startDate: "2025-09-19", endDate: "2026-09-19" };
  assert.equal(analyticsVideoEarningsUrl(null, range, ["demo-video-1"]), null);
  assert.match(
    analyticsVideoEarningsUrl(null, range, ["demo-video-1", ""], { demoIds: true })!,
    /videoIds=demo-video-1$/,
  );
  const page = readFileSync("src/routes/analytics.tsx", "utf8");
  assert.match(page, /\{ demoIds: IS_LOCAL_DEMO \}/);
});
