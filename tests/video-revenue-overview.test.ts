import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  handleRevenueVideosRequest,
  type RevenueVideoItem,
  type RevenueVideosResponse,
} from "../src/lib/server/revenue-videos";
import { calculateRpm } from "../src/lib/server/revenue-metrics";
import { DEMO_REVENUE_AS_OF, demoRevenuePeriod, demoRpm } from "../src/lib/demo-revenue";
import {
  NO_FIGURE,
  VIDEO_REVENUE_RANGE_DAYS,
  VIDEO_REVENUE_SCOPE_NOTE,
  formatVideoRevenue,
  mapVideoRevenueOverview,
  videoRevenueUrl,
} from "../src/lib/video-revenue-overview";
import {
  A1,
  B1,
  FakeDb,
  NOW,
  SEPT,
  WS_A,
  WS_B,
  channel,
  channelDay,
  synced,
  video,
  videoDay,
} from "./helpers/revenue-fake-db";

// Phase 2A. The Revenue overview on a video's page is the canonical per-video revenue response,
// run through one pure mapper. These tests drive the real endpoint handler over stored rows and
// map its answer, so what is pinned is what the section prints.

const sept = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
const aug = (d: number) => `2026-08-${String(d).padStart(2, "0")}`;

const YT = {
  earning: "EARNEARN001",
  zero: "ZEROZERO001",
  partial: "PARTIALPAR1",
  unreported: "UNREPORTED1",
  noSplit: "NOSPLITNOS1",
  adsOnly: "ADSONLYADS1",
  idle: "IDLEIDLE001",
  pending: "PENDINGPEN1",
  gone: "GONEGONE001",
  foreign: "FOREIGNFOR1",
} as const;

function seed() {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, B1, WS_B, "Bravo");
  synced(db, A1);
  synced(db, B1);
  const add = (key: keyof typeof YT, channelId = A1, values = {}) =>
    video(db, `v-${key}`, channelId, { youtube_video_id: YT[key], ...values });
  add("earning");
  add("zero");
  add("partial");
  add("unreported");
  add("noSplit");
  add("adsOnly");
  add("idle");
  add("pending", A1, { analytics_updated_at: null });
  add("gone", A1, { status: "deleted" });
  add("foreign", B1);
  for (let d = 1; d <= 30; d++) {
    channelDay(db, A1, sept(d), { estimated_revenue_usd: 50, views: 9000 });
    // $2.00 a day: $1.50 ads, $0.30 Premium, so $0.20 a day is neither.
    videoDay(db, "v-earning", A1, sept(d), {
      estimated_revenue_usd: 2,
      ad_revenue_usd: 1.5,
      premium_revenue_usd: 0.3,
      views: 1000,
    });
    videoDay(db, "v-zero", A1, sept(d), {
      estimated_revenue_usd: 0,
      ad_revenue_usd: 0,
      premium_revenue_usd: 0,
      views: 40,
    });
    videoDay(db, "v-unreported", A1, sept(d), {
      estimated_revenue_usd: null,
      ad_revenue_usd: null,
      premium_revenue_usd: null,
      views: 70,
    });
    videoDay(db, "v-noSplit", A1, sept(d), {
      estimated_revenue_usd: 1,
      ad_revenue_usd: null,
      premium_revenue_usd: null,
      views: 100,
    });
    // Ads and Premium account for all of it: there is no "other".
    videoDay(db, "v-adsOnly", A1, sept(d), {
      estimated_revenue_usd: 1,
      ad_revenue_usd: 0.9,
      premium_revenue_usd: 0.1,
      views: 100,
    });
    // Reported for the first ten days only.
    videoDay(db, "v-partial", A1, sept(d), {
      estimated_revenue_usd: d <= 10 ? 3 : null,
      ad_revenue_usd: d <= 10 ? 2 : null,
      premium_revenue_usd: d <= 10 ? 1 : null,
      views: 500,
    });
    channelDay(db, B1, sept(d), { estimated_revenue_usd: 999, views: 99999 });
    videoDay(db, "v-foreign", B1, sept(d), { estimated_revenue_usd: 999, views: 99999 });
  }
  // The previous period: half of what the earning video makes now.
  for (let d = 2; d <= 31; d++) {
    channelDay(db, A1, aug(d), { estimated_revenue_usd: 25, views: 4500 });
    videoDay(db, "v-earning", A1, aug(d), {
      estimated_revenue_usd: 1,
      ad_revenue_usd: 0.75,
      premium_revenue_usd: 0.15,
      views: 500,
    });
    videoDay(db, "v-gone", A1, aug(d), { estimated_revenue_usd: 4, views: 300 });
  }
  return db;
}

interface CallOptions {
  as?: string;
  hidden?: boolean;
  query?: string;
}

async function fetchRevenue(db: FakeDb, youtubeVideoId: string, options: CallOptions = {}) {
  const workspaceId = options.as ?? WS_A;
  const response = await handleRevenueVideosRequest(
    new Request(
      `https://app.test/api/revenue/videos?${options.query ?? SEPT}&videoIds=${youtubeVideoId}`,
    ),
    {
      getContext: async () => ({
        client: db.clientFor(workspaceId),
        workspaceId,
        ...(options.hidden ? { revenue: { visible: false as const } } : {}),
      }),
      now: () => NOW,
    },
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  return { text, data: (JSON.parse(text) as { data: RevenueVideosResponse }).data };
}

async function overview(key: keyof typeof YT, options: CallOptions = {}) {
  const { data, text } = await fetchRevenue(seed(), YT[key], options);
  return { view: mapVideoRevenueOverview(data, YT[key]), data, text };
}

const sourcesOf = (view: { sources: Array<{ key: string; text: string }> }) =>
  view.sources.map((source) => [source.key, source.text]);

// ---------- the request ----------

test("the range control maps to 90, 180 and 365 stored days", () => {
  assert.deepEqual(VIDEO_REVENUE_RANGE_DAYS, { "3M": 90, "6M": 180, "12M": 365 });
  assert.equal(
    videoRevenueUrl(YT.earning, "3M"),
    "/api/revenue/videos?days=90&videoIds=EARNEARN001",
  );
  assert.equal(
    videoRevenueUrl(YT.earning, "6M"),
    "/api/revenue/videos?days=180&videoIds=EARNEARN001",
  );
  assert.equal(
    videoRevenueUrl(YT.earning, "12M"),
    "/api/revenue/videos?days=365&videoIds=EARNEARN001",
  );
});

test("the request names one video and nothing else: no channel, no workspace, no dates", () => {
  const url = new URL(videoRevenueUrl(YT.earning, "12M")!, "https://app.test");
  assert.deepEqual([...url.searchParams.keys()], ["days", "videoIds"]);
  // An id the endpoint would reject is never sent.
  for (const bad of ["", "short", "TOOLONGTOOLONG", "has space01", "a,b", "../../etc01"])
    assert.equal(videoRevenueUrl(bad, "12M"), null, bad);
  // The local demo preview's sample ids are not YouTube ids.
  assert.equal(
    videoRevenueUrl("demo-video-1", "3M", { demo: true }),
    "/api/revenue/videos?days=90&videoIds=demo-video-1",
  );
  assert.equal(videoRevenueUrl("", "3M", { demo: true }), null);
});

// ---------- reported ----------

test("reported revenue: the total, RPM, sources and change are the endpoint's own figures", async () => {
  const { view, data } = await overview("earning");
  const item = data.videos[0];
  assert.equal(view.state, "reported");
  assert.equal(item.revenue.usd, 60);
  assert.equal(view.headline, "$60.00");
  assert.equal(view.hasAmount, true);
  assert.equal(view.note, "Estimated by YouTube for this period.");
  // $60 over 30,000 views.
  assert.equal(item.rpm, 2);
  assert.equal(view.rpm, "$2.00");
  assert.deepEqual(sourcesOf(view), [
    ["ads", "$45.00"],
    ["premium", "$9.00"],
    ["other", "$6.00"],
  ]);
  assert.equal(view.sourcesNote, null);
  // $30 the period before.
  assert.equal(item.previous.revenue.usd, 30);
  assert.deepEqual(view.change, {
    text: "+100.0%",
    positive: true,
    comparedWith: "2 Aug 2026 – 31 Aug 2026",
  });
  assert.equal(view.periodLabel, `1 ${septLabel()} 2026 – 30 ${septLabel()} 2026`);
  assert.equal(view.periodDays, 30);
});

// Node's en-GB short month for September is "Sep" or "Sept" depending on its ICU version.
function septLabel() {
  return new Date("2026-09-01T00:00:00Z")
    .toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
    .trim();
}

test("the single-video figures are exactly that video's row in the unfiltered response", async () => {
  const db = seed();
  const one = (await fetchRevenue(db, YT.earning)).data;
  const response = await handleRevenueVideosRequest(
    new Request(`https://app.test/api/revenue/videos?${SEPT}`),
    {
      getContext: async () => ({ client: db.clientFor(WS_A), workspaceId: WS_A }),
      now: () => NOW,
    },
  );
  const all = ((await response.json()) as { data: RevenueVideosResponse }).data;
  assert.deepEqual(
    one.videos[0],
    all.videos.find((item) => item.youtubeVideoId === YT.earning),
  );
  assert.deepEqual(one.period, all.period);
  assert.deepEqual(one.previousPeriod, all.previousPeriod);
});

test("a source that accounts for nothing is not listed as Other", async () => {
  const { view, data } = await overview("adsOnly");
  assert.equal(view.headline, "$30.00");
  assert.equal(data.videos[0].split.other.usd, 0);
  assert.deepEqual(sourcesOf(view), [
    ["ads", "$27.00"],
    ["premium", "$3.00"],
  ]);
  assert.equal(view.sourcesNote, null);
});

test("no breakdown reported: the total stands alone and no source is invented", async () => {
  const { view, data } = await overview("noSplit");
  assert.equal(view.state, "reported");
  assert.equal(view.headline, "$30.00");
  assert.deepEqual(
    [data.videos[0].split.ad.usd, data.videos[0].split.premium.usd, data.videos[0].split.other.usd],
    [null, null, null],
  );
  assert.deepEqual(view.sources, []);
  assert.equal(view.sourcesNote, "YouTube did not report a breakdown by source for this period.");
});

// ---------- zero, partial, unavailable ----------

test("YouTube-reported zero is $0.00 — a figure, not a missing one — and says nothing about monetisation", async () => {
  const { view, text } = await overview("zero");
  assert.equal(view.state, "zero");
  assert.equal(view.headline, "$0.00");
  assert.equal(view.hasAmount, true);
  assert.equal(view.note, "YouTube reported $0.00 for this period.");
  assert.equal(view.rpm, "$0.00");
  assert.deepEqual(view.sources, [], "nothing to break down");
  assert.equal(view.sourcesNote, null);
  assert.equal(view.change, null, "no earlier period to compare with");
  assert.doesNotMatch(JSON.stringify(view) + text, /moneti[sz]/i);
});

test("partly reported revenue: the amount is shown as covering only the reported days", async () => {
  const { view, data } = await overview("partial");
  assert.equal(view.state, "partial");
  assert.equal(view.headline, "$30.00");
  assert.deepEqual(
    [data.videos[0].revenue.knownDays, data.videos[0].revenue.unknownDays],
    [10, 20],
  );
  assert.equal(
    view.note,
    "Reported for 10 of 30 days with activity. The amount covers those days only.",
  );
  // RPM is the endpoint's: revenue over the views of the days that have revenue.
  assert.equal(data.videos[0].rpm, 6);
  assert.equal(view.rpm, "$6.00");
  assert.equal(view.change, null, "a partial period is never compared");
  assert.deepEqual(sourcesOf(view), [
    ["ads", "$20.00"],
    ["premium", "$10.00"],
  ]);
  assert.ok(view.sources.every((source) => source.partial));
  assert.match(view.sourcesNote ?? "", /only part of this period/);
});

test("activity without reported revenue is unavailable — a dash, never $0.00", async () => {
  const { view, data } = await overview("unreported");
  assert.equal(data.videos[0].views, 2100, "the video does have activity");
  assert.equal(view.state, "unavailable");
  assert.equal(view.headline, NO_FIGURE);
  assert.equal(view.hasAmount, false);
  assert.equal(view.note, "YouTube has not reported revenue for this video in this period.");
  assert.equal(view.rpm, null);
  assert.equal(view.change, null);
  assert.deepEqual(view.sources, []);
  assert.doesNotMatch(JSON.stringify(view), /\$0/);
});

// ---------- no row for the video ----------

test("no stored rows: history not imported, nothing in the period, and delisted are told apart", async () => {
  const pending = await overview("pending");
  assert.deepEqual(pending.data.videos, []);
  assert.equal(pending.view.state, "history_pending");
  assert.match(pending.view.note, /hasn't been imported yet/);

  const idle = await overview("idle");
  assert.equal(idle.view.state, "no_data_in_period");
  assert.equal(idle.view.note, "Nothing is stored for this video in this period.");

  // Stored activity before the period only, and no longer listed by YouTube.
  const gone = await overview("gone");
  assert.equal(gone.view.state, "no_data_in_period");
  assert.match(gone.view.note, /YouTube no longer lists this video\.$/);

  for (const { view } of [pending, idle, gone]) {
    assert.equal(view.headline, NO_FIGURE);
    assert.equal(view.hasAmount, false);
    assert.deepEqual([view.rpm, view.change, view.sources], [null, null, []]);
    assert.doesNotMatch(JSON.stringify(view), /\$0|no views|no activity/i);
  }
});

test("another workspace's video and a video that does not exist give the same answer, with no figures", async () => {
  const foreign = await overview("foreign");
  const missing = await fetchRevenue(seed(), "NOSUCHVID01");
  const missingView = mapVideoRevenueOverview(missing.data, "NOSUCHVID01");
  assert.equal(foreign.view.state, "unknown_video");
  assert.deepEqual(foreign.view, missingView);
  assert.equal(foreign.view.headline, NO_FIGURE);
  assert.equal(foreign.view.note, "No stored revenue data was found for this video.");
  assert.ok(!foreign.text.includes("999"), "none of the other workspace's figures");
  assert.ok(!foreign.text.includes("Bravo"));
  // Its owner does see it.
  const owner = await overview("foreign", { as: WS_B });
  assert.equal(owner.view.state, "reported");
});

test("a response without the requested entries (an older deployment) is unknown, not zero", async () => {
  const { data } = await fetchRevenue(seed(), YT.idle);
  const { requested: _dropped, ...legacy } = data;
  const view = mapVideoRevenueOverview(legacy as RevenueVideosResponse, YT.idle);
  assert.equal(view.state, "unknown_video");
  assert.equal(view.headline, NO_FIGURE);
});

test("no connected channel: a prompt to connect, and no figure", async () => {
  const db = new FakeDb();
  const { data } = await fetchRevenue(db, YT.earning);
  const view = mapVideoRevenueOverview(data, YT.earning);
  assert.equal(view.state, "not_connected");
  assert.equal(view.headline, NO_FIGURE);
});

// ---------- hidden ----------

test("hidden: the response carries no amount for the video, and the view says Hidden — not $0.00, not a dash", async () => {
  for (const key of ["earning", "zero", "partial", "unreported", "idle", "foreign"] as const) {
    const { view, data, text } = await overview(key, { hidden: true });
    assert.equal(data.visibility.revenue, "hidden");
    assert.equal(view.state, "hidden", key);
    assert.equal(view.headline, "Hidden");
    assert.equal(view.hasAmount, false);
    assert.equal(view.note, "Revenue hidden by workspace settings.");
    assert.deepEqual(
      [view.rpm, view.change, view.sources, view.sourcesNote],
      [null, null, [], null],
    );
    assert.doesNotMatch(JSON.stringify(view), /\$|—/, key);
    // Nothing about the money is in the response: not the total, the parts, the RPM or a change.
    for (const item of data.videos as RevenueVideoItem[]) {
      assert.deepEqual(
        [
          item.revenue.usd,
          item.split.ad.usd,
          item.split.premium.usd,
          item.split.other.usd,
          item.rpm,
          item.revenueShare,
          item.previous.revenue.usd,
          item.change.revenue.percent,
        ],
        [null, null, null, null, null, null, null, null],
        key,
      );
    }
    assert.doesNotMatch(text, /"usd":\s*[0-9]/, `${key}: no amount of any kind`);
  }
});

test("hidden: a reported zero and a withheld amount cannot be told apart", async () => {
  const zero = await overview("zero", { hidden: true });
  const earning = await overview("earning", { hidden: true });
  assert.deepEqual(zero.view, earning.view);
  assert.deepEqual(zero.data.videos[0].revenue, earning.data.videos[0].revenue);
  assert.deepEqual(zero.data.videos[0].split, earning.data.videos[0].split);
});

// ---------- period, freshness ----------

test("the period shown is the one the endpoint used, and freshness comes from the stored data", async () => {
  const { view, data } = await overview("earning", { query: "days=90" });
  assert.equal(data.period.days, 90);
  assert.equal(view.periodDays, 90);
  assert.ok(view.periodLabel.includes(" – "));
  assert.ok(
    view.periodLabel.endsWith(
      String(new Date(`${data.period.endDate}T00:00:00Z`).getUTCFullYear()),
    ),
  );
  assert.ok(data.period.endDate < NOW.toISOString().slice(0, 10), "stored data runs behind today");
  assert.match(view.freshnessNote, /^Stored data through /);
  // The default period reaches past the stored rows, so the gap is said, not hidden.
  assert.ok(data.dataQuality.freshness.missingDays.length > 0);
  assert.match(view.completenessNote ?? "", /no stored data yet/);
});

test("a fully stored period carries no completeness warning", async () => {
  const { view, data } = await overview("earning");
  assert.deepEqual(data.dataQuality.freshness.missingDays, []);
  assert.equal(view.completenessNote, null);
});

test("formatting: two decimals, and a missing amount is never a zero", () => {
  assert.equal(formatVideoRevenue(0), "$0.00");
  assert.equal(formatVideoRevenue(0.004), "$0.00");
  assert.equal(formatVideoRevenue(1234.5), "$1,234.50");
  assert.equal(formatVideoRevenue(null), NO_FIGURE);
  assert.equal(formatVideoRevenue(Number.NaN), NO_FIGURE);
});

test("the scope note says what the figure is and what it leaves out", () => {
  assert.equal(
    VIDEO_REVENUE_SCOPE_NOTE,
    "YouTube estimated revenue for this video. Brand deals, affiliate commissions and tracked-link activity are not included.",
  );
});

// ---------- the page ----------

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ");

test("the mapper and the component calculate nothing", () => {
  const mapper = code("src/lib/video-revenue-overview.ts");
  // No totals, ratios or percentages are derived here: every figure is read off the response.
  assert.doesNotMatch(mapper, /reduce\(|\/ ?item\.views|\* ?1000|- ?item\.previous/);
  const component = code("src/components/VideoRevenueOverview.tsx");
  assert.doesNotMatch(component, /reduce\(|toFixed|\.usd\b|Intl\.NumberFormat|Math\./);
  assert.match(component, /mapVideoRevenueOverview\(body\.data, youtubeVideoId\)/);
});

test("the section loads on its own request, with its own loading and error states", () => {
  const component = flat("src/components/VideoRevenueOverview.tsx");
  assert.match(component, /videoRevenueUrl\(youtubeVideoId, range, \{ demo: IS_LOCAL_DEMO \}\)/);
  assert.match(component, /aria-label="Loading revenue"/);
  assert.match(component, /title="We couldn't load this video's revenue"/);
  assert.match(component, /onRetry=\{\(\) => setRetryNonce/);
  assert.doesNotMatch(component, /api\/youtube\//, "never the live route");
  // A failed request shows the error state and no figure at all.
  assert.match(component, /setState\(\{ status: "error" \}\)/);

  const page = flat("src/routes/videos.$videoId.tsx");
  const header = page.indexOf("Open on YouTube");
  const section = page.indexOf("<VideoRevenueOverview");
  const cards = page.indexOf('title="Views in period"');
  assert.ok(header > 0 && header < section && section < cards, "below the header, above the cards");
  // It is not inside the block that waits for the live request.
  const before = page.slice(0, section);
  const opened = before.match(/\{data && result\.status === "connected" && \(/g)?.length ?? 0;
  assert.equal(opened, 1, "only the identity header's own condition precedes it");
  assert.match(before, /<\/a> <\/div> \)\} (\{\/\*.*?\*\/\} )?$/, "that condition is closed");
  assert.match(page, /<VideoRevenueOverview [^>]*youtubeVideoId=\{videoId\} range=\{range\}/);
});

test("the live revenue card is gone: four activity cards, and no revenue from the live route", () => {
  const page = code("src/routes/videos.$videoId.tsx");
  assert.equal(page.match(/<KpiTrendCard /g)?.length, 4);
  for (const title of ["Views in period", "Watch time", "Average view duration", "Average viewed"])
    assert.ok(page.includes(`title="${title}"`), title);
  assert.doesNotMatch(
    page,
    /estimatedRevenue|revenueAvailable|playbackBasedCpm|\bcpm\b|formatCurrency|Estimated revenue|Revenue unavailable/,
  );
  assert.doesNotMatch(page, /2xl:grid-cols-5/);

  const route = code("src/routes/api.youtube.video.ts");
  assert.doesNotMatch(
    route,
    /estimatedRevenue|estimatedAdRevenue|estimatedRedPartnerRevenue|grossRevenue|playbackBasedCpm|["'`]cpm["'`]|revenueAvailable|includeRevenue|revenue-visibility/,
  );
});

// ---------- demo ----------

test("demo: the sample revenue response carries the split and the requested entries; the sample detail carries no revenue", () => {
  const source = flat("src/lib/demo-api.ts");
  assert.match(source, /split: splitOf\(row\.estimatedRevenue\)/);
  assert.match(source, /requested: wanted\.map\(/);
  const detail = source.slice(source.indexOf("function demoVideoDetail"));
  assert.doesNotMatch(
    detail.slice(0, detail.indexOf("// ====")),
    /estimatedRevenue|cpm|revenueAvailable/,
    "the demo video detail carries no revenue either",
  );
});

// ---------- demo: period and RPM ----------

test("demo: 3M, 6M and 12M produce 90-, 180- and 365-day periods ending where the sample ends", () => {
  const expected = {
    "3M": ["2026-06-22", "2026-03-24", "2026-06-21"],
    "6M": ["2026-03-24", "2025-09-25", "2026-03-23"],
    "12M": ["2025-09-20", "2024-09-20", "2025-09-19"],
  } as const;
  for (const range of ["3M", "6M", "12M"] as const) {
    const url = new URL(videoRevenueUrl("demo-video-1", range, { demo: true })!, "https://x.test");
    const { period, previousPeriod } = demoRevenuePeriod(url.searchParams);
    const [start, previousStart, previousEnd] = expected[range];
    assert.deepEqual(period, {
      startDate: start,
      endDate: DEMO_REVENUE_AS_OF,
      days: VIDEO_REVENUE_RANGE_DAYS[range],
      defaulted: false,
    });
    // The previous period is the same length, immediately before.
    assert.deepEqual(previousPeriod, { startDate: previousStart, endDate: previousEnd });
  }
});

test("demo: the period follows the request like the real endpoint's does", () => {
  const of = (query: string) => demoRevenuePeriod(new URLSearchParams(query)).period;
  assert.deepEqual(of(""), {
    startDate: "2026-08-23",
    endDate: "2026-09-19",
    days: 28,
    defaulted: true,
  });
  assert.equal(of("days=1").startDate, DEMO_REVENUE_AS_OF);
  assert.equal(of("days=9999").days, 366, "capped like the real endpoint");
  assert.equal(of("days=abc").defaulted, true);
  assert.deepEqual(of("start=2026-01-01&end=2026-01-31"), {
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    days: 31,
    defaulted: false,
  });
});

test("demo: RPM is the canonical calculation on the sample's own revenue and views", () => {
  for (const [revenue, views] of [
    [74.1, 842],
    [41.52, 519],
    [0, 300],
    [12.345678, 7],
    [5, 0],
    [null, 100],
  ] as Array<[number | null, number]>)
    assert.equal(demoRpm(revenue, views), calculateRpm(revenue, views), `${revenue} / ${views}`);
  assert.equal(demoRpm(74.1, 842), 88.004751);
  assert.equal(demoRpm(null, 100), null);
  assert.equal(demoRpm(5, 0), null, "no views, no RPM");
  // The demo response takes its period and RPM from these and nowhere else.
  const source = flat("src/lib/demo-api.ts");
  assert.match(
    source,
    /const \{ period, previousPeriod \} = demoRevenuePeriod\(url\.searchParams\);/,
  );
  assert.match(source, /rpm: demoRpm\(row\.estimatedRevenue, row\.views\),/);
  const videos = code("src/lib/demo-api.ts");
  const handler = videos.slice(
    videos.indexOf("function demoRevenueVideos"),
    videos.indexOf("function demoBreakdowns"),
  );
  assert.ok(handler.length > 500);
  assert.doesNotMatch(handler, /rpm: [0-9]|20\d\d-\d\d-\d\d/, "no hard-coded RPM or dates");
});

test("demo: sample data is labelled, and the demo handlers answer without the network", () => {
  const component = flat("src/components/VideoRevenueOverview.tsx");
  assert.match(component, /\{IS_LOCAL_DEMO && \( <span [^>]*> Sample data <\/span> \)\}/);
  const source = flat("src/lib/demo-api.ts");
  // A demo answer is built in the page from bundled sample numbers; the real fetch is used only
  // for requests the demo has no handler for.
  assert.match(
    source,
    /if \(!IS_LOCAL_DEMO \|\| installed \|\| typeof window === "undefined"\) return;/,
  );
  assert.match(source, /if \(method === "GET" && handler\) \{ const body = handler\(url\);/);
  assert.match(source, /"\/api\/revenue\/videos": demoRevenueVideos,/);
});

// ---------- loading layout ----------

test("while the live request loads, placeholders hold the header's and the cards' places around the section", () => {
  const page = flat("src/routes/videos.$videoId.tsx");
  const at = (text: string) => {
    const index = page.indexOf(text);
    assert.ok(index > 0, text);
    return index;
  };
  const identitySkeleton = at('{result.status === "loading" && <IdentityLoading />}');
  const header = at("Open on YouTube");
  const section = at("<VideoRevenueOverview");
  const activitySkeleton = at('{result.status === "loading" && <ActivityLoading />}');
  const cards = at('title="Views in period"');
  assert.ok(identitySkeleton < header && header < section, "header (or its placeholder) first");
  assert.ok(section < activitySkeleton && activitySkeleton < cards, "cards (or theirs) after");
  assert.doesNotMatch(page, /DetailLoading/);
  // The placeholders use the real boxes' own layout classes, so arriving content does not move
  // what is below it.
  const box =
    'className="mt-5 flex flex-col gap-4 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center"';
  assert.equal(page.split(box).length - 1, 2, "header and its placeholder share one box");
  const grid = 'className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"';
  assert.equal(page.split(grid).length - 1, 2, "cards and their placeholder share one grid");
});

test("a refresh or a change of range keeps the loaded figures in place; a failure shows none", () => {
  const component = flat("src/components/VideoRevenueOverview.tsx");
  assert.match(
    component,
    /previous\.status === "ready" \? \{ \.\.\.previous, refreshing: true \} : \{ status: "loading" \}/,
  );
  assert.match(component, /aria-busy=\{state\.refreshing\}/);
  // A different video never shows the previous video's figures.
  assert.match(
    component,
    /useEffect\(\(\) => setState\(\{ status: "loading" \}\), \[youtubeVideoId\]\);/,
  );
  // The error state replaces whatever was showing.
  assert.match(component, /setState\(\{ status: "error" \}\); \}\);/);
});
