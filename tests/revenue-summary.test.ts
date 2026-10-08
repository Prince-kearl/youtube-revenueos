import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attributionStateFor,
  handleRevenueSummaryRequest,
  parseRevenueSummaryQuery,
  summarizeDeals,
  RevenueSummaryError,
  type ChannelSyncFacts,
  type RevenueSummaryResponse,
} from "../src/lib/server/revenue-summary";
import { sumRevenue } from "../src/lib/server/revenue-metrics";

import {
  A1,
  A2,
  A_OFF,
  B1,
  FakeDb,
  NOW,
  SEPT,
  WS_A,
  WS_B,
  channel,
  channelDay,
  deal,
  synced,
  video,
  videoDay,
  type Row,
} from "./helpers/revenue-fake-db";

interface CallOptions {
  /** Workspace the caller is signed in to; null = not signed in. */
  as?: string | null;
  deals?: boolean;
  now?: Date;
}

async function call(db: FakeDb, query: string, options: CallOptions = {}) {
  const workspaceId = options.as === undefined ? WS_A : options.as;
  const response = await handleRevenueSummaryRequest(
    new Request(`https://app.test/api/revenue/summary${query ? `?${query}` : ""}`),
    {
      getContext: async () => {
        if (!workspaceId)
          throw new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401 });
        return { client: db.clientFor(workspaceId), workspaceId };
      },
      canViewDeals: async () => options.deals ?? true,
      now: () => options.now ?? NOW,
    },
  );
  const body = (await response.json()) as { data?: RevenueSummaryResponse; error?: string };
  return { status: response.status, body, data: body.data as RevenueSummaryResponse, response };
}

/** Workspace A with one fully attributed channel across September, plus workspace B. */
function seed() {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, B1, WS_B, "Bravo");
  synced(db, A1);
  synced(db, B1);
  video(db, "v-big", A1);
  video(db, "v-small", A1);
  video(db, "v-bravo", B1);
  for (let d = 1; d <= 30; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    channelDay(db, A1, day, { estimated_revenue_usd: 10, ad_revenue_usd: 7, views: 2000 });
    videoDay(db, "v-big", A1, day, { estimated_revenue_usd: 8, views: 1500 });
    videoDay(db, "v-small", A1, day, { estimated_revenue_usd: 2, views: 500 });
    channelDay(db, B1, day, { estimated_revenue_usd: 999, views: 99999 });
    videoDay(db, "v-bravo", B1, day, { estimated_revenue_usd: 999, views: 99999 });
  }
  for (let d = 2; d <= 31; d++)
    channelDay(db, A1, `2026-08-${String(d).padStart(2, "0")}`, {
      estimated_revenue_usd: 5,
      views: 2000,
    });
  return db;
}

// ---------- 1. authenticated workspace request ----------

test("a signed-in member gets the summary for their workspace", async () => {
  const { status, data, response } = await call(seed(), SEPT);
  assert.equal(status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(data.status, "connected");
  assert.equal(data.currency, "USD");
  assert.equal(data.dateBasis, "youtube_reporting_day");
  assert.deepEqual(data.period, {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    days: 30,
    defaulted: false,
  });
  assert.deepEqual(data.previousPeriod, { startDate: "2026-08-02", endDate: "2026-08-31" });
  assert.deepEqual(
    data.channels.map((c) => c.name),
    ["Alpha"],
  );
});

// ---------- 2. unauthenticated request ----------

test("a signed-out request is refused before anything is read", async () => {
  const db = seed();
  const { status, body } = await call(db, SEPT, { as: null });
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "AUTH_REQUIRED" });
  assert.deepEqual(db.reads, []);
});

// ---------- 3. workspace isolation ----------

test("another workspace's revenue, videos and deals never appear", async () => {
  const db = seed();
  deal(db, WS_B, "contracted", 77777);
  const { data } = await call(db, SEPT);
  assert.equal(data.earned.revenue.usd, 300, "only Alpha's 30 days at $10");
  assert.equal(data.earned.views, 60000);
  assert.ok(data.videos.top.every((v) => v.channelId === A1));
  assert.ok(!JSON.stringify(data).includes("Bravo"));
  assert.ok(!JSON.stringify(data).includes("77777"));

  const other = await call(db, SEPT, { as: WS_B });
  assert.equal(other.data.earned.revenue.usd, 29970);
  assert.deepEqual(
    other.data.channels.map((c) => c.name),
    ["Bravo"],
  );
});

test("a workspace id in the query string is ignored — the workspace comes from the session", async () => {
  const db = seed();
  const plain = await call(db, SEPT);
  for (const param of ["workspaceId", "workspace_id", "workspace"]) {
    const spoofed = await call(db, `${SEPT}&${param}=${WS_B}`);
    assert.equal(spoofed.status, 200);
    assert.deepEqual(spoofed.data, plain.data, `${param} changed nothing`);
  }
});

// ---------- 4. channel filter ----------

test("the channel filter narrows to one of the caller's channels", async () => {
  const db = seed();
  channel(db, A2, WS_A, "Second");
  synced(db, A2);
  for (let d = 1; d <= 30; d++)
    channelDay(db, A2, `2026-09-${String(d).padStart(2, "0")}`, { estimated_revenue_usd: 1 });

  const both = await call(db, SEPT);
  assert.equal(both.data.earned.revenue.usd, 330);
  assert.equal(both.data.channels.length, 2);

  const one = await call(db, `${SEPT}&channelId=${A2}`);
  assert.equal(one.data.earned.revenue.usd, 30);
  assert.deepEqual(
    one.data.channels.map((c) => c.id),
    [A2],
  );
});

test("the channel filter cannot reach another workspace's channel", async () => {
  const db = seed();
  const { status, body } = await call(db, `${SEPT}&channelId=${B1}`);
  assert.equal(status, 404);
  assert.deepEqual(body, { error: "CHANNEL_NOT_FOUND" });
  // Same answer as for an id that does not exist at all, so ids cannot be probed.
  const missing = await call(db, `${SEPT}&channelId=cccccccc-0000-4000-8000-000000000009`);
  assert.deepEqual([missing.status, missing.body], [404, { error: "CHANNEL_NOT_FOUND" }]);
});

test("a disconnected channel is not included and cannot be selected", async () => {
  const db = seed();
  channel(db, A_OFF, WS_A, "Disconnected", false);
  channelDay(db, A_OFF, "2026-09-10", { estimated_revenue_usd: 5000 });
  const all = await call(db, SEPT);
  assert.equal(all.data.earned.revenue.usd, 300);
  assert.equal((await call(db, `${SEPT}&channelId=${A_OFF}`)).status, 404);
});

// ---------- 5. invalid date range ----------

test("invalid requests are rejected with 422 and read nothing", async () => {
  const bad = [
    "start=2026-09-30&end=2026-09-01", // reversed
    "start=2026-09-01", // one end only
    "end=2026-09-30",
    "start=2026-02-30&end=2026-03-01", // not a real date
    "start=09/01/2026&end=09/30/2026", // wrong format
    "start=2026-09-01&end=2026-12-31", // ends in the future
    "start=2024-01-01&end=2026-09-30", // longer than the maximum
    "start=2026-09-01&end=2026-09-30&days=7", // a range and a day count
    "days=0",
    "days=9999",
    "days=abc",
    "channelId=not-a-uuid",
    "granularity=week",
    "limit=0",
    "limit=500",
  ];
  for (const query of bad) {
    const db = seed();
    const { status, body } = await call(db, query);
    assert.deepEqual([query, status, body], [query, 422, { error: "VALIDATION_ERROR" }]);
    assert.deepEqual(db.reads, [], `${query} read nothing`);
  }
});

// ---------- 6. default date period ----------

test("with no dates, the period is the 28 days ending on the newest day YouTube should have reported", async () => {
  const { data } = await call(seed(), "");
  assert.deepEqual(data.period, {
    startDate: "2026-09-10",
    endDate: "2026-10-07",
    days: 28,
    defaulted: true,
  });
  assert.equal(data.granularity, "day");
  assert.deepEqual(data.dataQuality.freshness.pendingDays, [], "it stops before unreported days");

  const week = await call(seed(), "days=7");
  assert.deepEqual(week.data.period, {
    startDate: "2026-10-01",
    endDate: "2026-10-07",
    days: 7,
    defaulted: false,
  });
});

test("parsing: today is the UTC date and stored day labels are never shifted", () => {
  const parse = (query: string, today = "2026-10-10") =>
    parseRevenueSummaryQuery(new URL(`https://app.test/x?${query}`), today);
  assert.deepEqual(parse("start=2026-10-10&end=2026-10-10").period, {
    startDate: "2026-10-10",
    endDate: "2026-10-10",
  });
  assert.throws(() => parse("start=2026-10-11&end=2026-10-11"), RevenueSummaryError);
  assert.equal(parse("start=2026-01-01&end=2026-09-30").granularity, "month");
  assert.equal(parse("start=2026-01-01&end=2026-09-30&granularity=day").granularity, "day");
  assert.equal(parse("").topVideos, 10);
  assert.equal(parse("limit=3").topVideos, 3);
  assert.equal(parse("channelId=").channelId, null, "an empty parameter is the same as none");
});

// ---------- 7, 10, 11. earned revenue, RPM, period-over-period ----------

test("earned revenue, split, RPM and change against the previous period", async () => {
  const { data } = await call(seed(), SEPT);
  assert.deepEqual(data.earned.revenue, {
    usd: 300,
    availability: "available",
    knownDays: 30,
    unknownDays: 0,
  });
  assert.equal(data.earned.views, 60000);
  assert.equal(data.earned.watchMinutes, 60000);
  assert.equal(data.earned.rpm, 5);
  assert.equal(data.earned.split.ad.usd, 210);
  assert.equal(data.earned.split.premium.usd, 15);
  assert.equal(data.earned.split.other.usd, 75);
  assert.equal(data.earned.previous.revenue.usd, 150);
  assert.equal(data.earned.previous.rpm, 2.5);
  assert.deepEqual(data.earned.change.revenue, {
    current: 300,
    previous: 150,
    absolute: 150,
    percent: 100,
  });
  assert.equal(data.earned.change.views.percent, 0);
  assert.equal(data.earned.change.rpm.percent, 100);
  assert.equal(data.earned.change.revenueComparable, true);
});

// ---------- 8. NULL / partial revenue ----------

test("unreported revenue stays null and partial revenue is flagged, never filled with zero", async () => {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  synced(db, A1);
  const blank = { estimated_revenue_usd: null, ad_revenue_usd: null, premium_revenue_usd: null };
  for (let d = 1; d <= 30; d++) channelDay(db, A1, `2026-09-${String(d).padStart(2, "0")}`, blank);

  const none = await call(db, SEPT);
  assert.deepEqual(none.data.earned.revenue, {
    usd: null,
    availability: "unavailable",
    knownDays: 0,
    unknownDays: 30,
  });
  assert.equal(none.data.earned.rpm, null);
  assert.equal(none.data.earned.split.ad.usd, null);
  assert.equal(none.data.earned.change.revenue.percent, null);
  assert.equal(none.data.earned.change.revenueComparable, false);
  assert.equal(none.data.earned.views, 30000, "activity is still reported");
  assert.ok(none.data.earned.trend.every((point) => point.revenue.usd === null));
  assert.equal(none.data.videos.attribution.channelRevenue.usd, null);

  db.tables.channel_daily_stats[0].estimated_revenue_usd = 12;
  const partial = await call(db, SEPT);
  assert.deepEqual(partial.data.earned.revenue, {
    usd: 12,
    availability: "partial",
    knownDays: 1,
    unknownDays: 29,
  });
  assert.equal(partial.data.earned.rpm, 12, "RPM uses only the views of the day revenue is known");
});

// ---------- 9. zero revenue ----------

test("a reported zero is a real, available zero", async () => {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  synced(db, A1);
  const zero = { estimated_revenue_usd: 0, ad_revenue_usd: 0, premium_revenue_usd: 0 };
  for (let d = 1; d <= 30; d++) channelDay(db, A1, `2026-09-${String(d).padStart(2, "0")}`, zero);
  const { data } = await call(db, SEPT);
  assert.equal(data.earned.revenue.usd, 0);
  assert.equal(data.earned.revenue.availability, "available");
  assert.equal(data.earned.rpm, 0);
  assert.equal(data.earned.split.other.usd, 0);
});

test("a workspace with no connected channel gets an explicit empty answer", async () => {
  const db = new FakeDb();
  deal(db, WS_A, "contracted", 500);
  const { status, data } = await call(db, SEPT);
  assert.equal(status, 200);
  assert.equal(data.status, "not_connected");
  assert.deepEqual(data.channels, []);
  assert.equal(data.earned.revenue.usd, null);
  assert.equal(data.earned.revenue.availability, "unavailable");
  assert.deepEqual(data.videos.top, []);
  assert.equal(data.videos.attribution.state, "fully_attributed");
  assert.equal(data.deals.available && data.deals.byCurrency[0].contracted.value, 500);
});

// ---------- 12. trend ----------

test("trend: daily by default for a month, monthly on request, unreported buckets stay empty", async () => {
  const db = seed();
  const daily = await call(db, SEPT);
  assert.equal(daily.data.granularity, "day");
  assert.equal(daily.data.earned.trend.length, 30);
  assert.deepEqual(
    {
      bucket: daily.data.earned.trend[0].bucket,
      usd: daily.data.earned.trend[0].revenue.usd,
      views: daily.data.earned.trend[0].views,
      rpm: daily.data.earned.trend[0].rpm,
    },
    { bucket: "2026-09-01", usd: 10, views: 2000, rpm: 5 },
  );

  const monthly = await call(db, "start=2026-07-01&end=2026-09-30&granularity=month");
  assert.deepEqual(
    monthly.data.earned.trend.map((p) => [p.bucket, p.revenue.usd, p.hasData]),
    [
      ["2026-07", null, false],
      ["2026-08", 150, true],
      ["2026-09", 300, true],
    ],
  );
  const total = monthly.data.earned.trend.reduce((sum, p) => sum + (p.revenue.usd ?? 0), 0);
  assert.equal(total, monthly.data.earned.revenue.usd, "the trend adds up to the headline");
});

// ---------- 13. top revenue videos ----------

test("top videos are ranked by stored revenue and carry their title and share", async () => {
  const { data } = await call(seed(), SEPT);
  assert.equal(data.videos.count, 2);
  assert.deepEqual(
    data.videos.top.map((v) => v.videoId),
    ["v-big", "v-small"],
  );
  const [big, small] = data.videos.top;
  assert.equal(big.title, "Title v-big");
  assert.equal(big.youtubeVideoId, "yt-v-big");
  assert.equal(big.currentlyListed, true);
  assert.equal(big.revenue.usd, 240);
  assert.equal(big.views, 45000);
  assert.equal(big.rpm, 5.333333);
  assert.equal(big.revenueShare, 0.8);
  assert.equal(small.revenueShare, 0.2);
  assert.equal(small.viewShare, 0.25);

  const limited = await call(seed(), `${SEPT}&limit=1`);
  assert.equal(limited.data.videos.top.length, 1);
  assert.equal(limited.data.videos.count, 2, "the count is of all videos, not of the page");
});

test("a top video with unknown revenue is ranked last and is not given a zero", async () => {
  const db = seed();
  video(db, "v-unknown", A1);
  videoDay(db, "v-unknown", A1, "2026-09-05", { estimated_revenue_usd: null, views: 999999 });
  const { data } = await call(db, SEPT);
  const last = data.videos.top.at(-1)!;
  assert.equal(last.videoId, "v-unknown");
  assert.equal(last.revenue.usd, null);
  assert.equal(last.revenue.availability, "unavailable");
  assert.equal(last.rpm, null);
  assert.equal(last.revenueShare, null);
});

// ---------- 14. unattributed revenue / data-quality state ----------

test("fully attributed: video revenue accounts for the channel total", async () => {
  const { attribution } = (await call(seed(), SEPT)).data.videos;
  assert.equal(attribution.state, "fully_attributed");
  assert.equal(attribution.channelRevenue.usd, 300);
  assert.equal(attribution.attributedRevenue.usd, 300);
  assert.equal(attribution.unattributedRevenue.usd, 0);
  assert.equal(attribution.unattributedViews, 0);
});

/** Alpha earns $10 a day but its only stored video explains $4 of it. */
function gapChannel(videoValues: Row = {}, syncValues: Row | null = {}) {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  if (syncValues) synced(db, A1, syncValues);
  video(db, "v-kept", A1, videoValues);
  for (let d = 1; d <= 30; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    channelDay(db, A1, day, { estimated_revenue_usd: 10, views: 1000 });
    videoDay(db, "v-kept", A1, day, { estimated_revenue_usd: 4, views: 300 });
  }
  return db;
}

test("unattributed revenue is reported separately and never spread across videos", async () => {
  const db = gapChannel();
  video(db, "v-gone", A1, { status: "deleted" });
  const { data } = await call(db, SEPT);
  const { attribution } = data.videos;
  assert.equal(data.earned.revenue.usd, 300, "the headline is the channel total");
  assert.equal(attribution.channelRevenue.usd, 300);
  assert.equal(attribution.attributedRevenue.usd, 120);
  assert.equal(attribution.unattributedRevenue.usd, 180);
  assert.equal(attribution.unattributedViews, 21000);
  assert.equal(data.videos.top[0].revenue.usd, 120, "the video keeps exactly its own revenue");
  assert.equal(data.videos.top[0].revenueShare, 0.4, "shares do not add up to 1");
  assert.equal(attribution.state, "videos_no_longer_listed");
  assert.equal(attribution.byChannel[0].videosNoLongerListed, 1);
});

test("the reason for a gap follows the sync state, most uncertain first", async () => {
  const stateOf = async (db: FakeDb) => (await call(db, SEPT)).data.videos.attribution.state;

  assert.equal(await stateOf(gapChannel({}, null)), "catalogue_pending", "never synced");
  assert.equal(
    await stateOf(gapChannel({}, { catalogue_full_synced_at: null })),
    "catalogue_pending",
    "no full read of the video list yet",
  );
  assert.equal(
    await stateOf(gapChannel({}, { catalogue_pass_started_at: "2026-10-09T00:00:00Z" })),
    "catalogue_pending",
    "a full read is in progress",
  );
  assert.equal(
    await stateOf(gapChannel({}, { stats_pass_kind: "backfill" })),
    "video_history_pending",
  );
  assert.equal(await stateOf(gapChannel({}, { stats_synced_at: null })), "video_history_pending");
  assert.equal(
    await stateOf(gapChannel({ analytics_updated_at: null })),
    "video_history_pending",
    "a listed video whose history has not been loaded",
  );
  assert.equal(await stateOf(gapChannel()), "unexplained", "complete, and nothing accounts for it");

  // Pending states win over "no longer listed": while the catalogue is incomplete, missing
  // videos are not yet a conclusion.
  const pendingWithGone = gapChannel({}, { catalogue_full_synced_at: null });
  video(pendingWithGone, "v-gone", A1, { status: "deleted" });
  assert.equal(await stateOf(pendingWithGone), "catalogue_pending");
});

test("the response never claims a video was deleted", async () => {
  const db = gapChannel();
  video(db, "v-gone", A1, { status: "deleted" });
  videoDay(db, "v-gone", A1, "2026-09-02", { estimated_revenue_usd: 1, views: 10 });
  const { data } = await call(db, SEPT);
  const gone = data.videos.top.find((v) => v.videoId === "v-gone")!;
  assert.equal(gone.currentlyListed, false);
  assert.equal(gone.revenue.usd, 1, "its stored history is still shown");
  assert.ok(!/deleted/i.test(JSON.stringify(data)), "the internal status word is not exposed");
});

test("attribution state is pure and treats an unknown revenue gap as no claim", () => {
  const facts: ChannelSyncFacts = {
    channelId: A1,
    hasState: true,
    catalogueFullSyncedAt: "2026-10-08T00:00:00Z",
    cataloguePassInProgress: false,
    statsSyncedAt: "2026-10-09T00:00:00Z",
    statsBackfillInProgress: false,
    hasSyncError: false,
    videosAwaitingHistory: 0,
    videosNoLongerListed: 3,
  };
  const none = {
    unattributedViews: 0,
    unattributedRevenue: sumRevenue([null]),
    fullyAttributed: true,
  };
  assert.equal(attributionStateFor(none, facts), "fully_attributed");
  const views = { ...none, unattributedViews: 5, fullyAttributed: false };
  assert.equal(attributionStateFor(views, facts), "videos_no_longer_listed");
  assert.equal(attributionStateFor(views, { ...facts, videosNoLongerListed: 0 }), "unexplained");
});

test("with several channels the summary reports the least settled channel's state", async () => {
  const db = gapChannel();
  video(db, "v-gone", A1, { status: "deleted" });
  channel(db, A2, WS_A, "Second");
  channelDay(db, A2, "2026-09-03", { estimated_revenue_usd: 3, views: 50 }); // never synced
  const { attribution } = (await call(db, SEPT)).data.videos;
  assert.deepEqual(attribution.byChannel.map((c) => [c.channelId, c.state]).sort(), [
    [A1, "videos_no_longer_listed"],
    [A2, "catalogue_pending"],
  ]);
  assert.equal(attribution.state, "catalogue_pending");
});

// ---------- 15. pending / provisional days ----------

test("freshness comes straight from the canonical layer: provisional, pending and missing days", async () => {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  synced(db, A1, { last_error: "YOUTUBE_VIDEOS_FAILED:503" });
  for (const day of [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ])
    channelDay(db, A1, day);

  const { data } = await call(db, "start=2026-10-01&end=2026-10-10");
  const { freshness, sync } = data.dataQuality;
  assert.equal(freshness.asOf, "2026-10-10");
  assert.equal(freshness.expectedThrough, "2026-10-07");
  assert.deepEqual(freshness.provisionalDays, ["2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(freshness.pendingDays, ["2026-10-08", "2026-10-09", "2026-10-10"]);
  assert.deepEqual(freshness.missingDays, ["2026-10-04"]);
  assert.equal(freshness.complete, false);
  assert.equal(data.earned.trend.find((p) => p.bucket === "2026-10-06")!.incomplete, true);
  assert.equal(data.earned.trend.find((p) => p.bucket === "2026-10-02")!.incomplete, false);
  assert.equal(data.earned.trend.find((p) => p.bucket === "2026-10-09")!.revenue.usd, null);
  assert.deepEqual(sync, [
    {
      channelId: A1,
      lastStatsSyncAt: "2026-10-09T00:00:00Z",
      lastFullCatalogueAt: "2026-10-08T00:00:00Z",
      hasSyncError: true,
    },
  ]);
  assert.ok(!JSON.stringify(data).includes("503"), "raw sync errors are not exposed");

  const settled = await call(seed(), SEPT);
  assert.equal(settled.data.dataQuality.freshness.complete, true);
});

// ---------- 16, 17, 18. contracted / pipeline / completed ----------

test("contracted, pipeline and completed deals are three separate figures", async () => {
  const db = seed();
  deal(db, WS_A, "contracted", 5000);
  deal(db, WS_A, "contracted", 2500.5);
  deal(db, WS_A, "prospect", 100);
  deal(db, WS_A, "pitched", 200);
  deal(db, WS_A, "negotiating", 300);
  deal(db, WS_A, "completed", 9000, { closed_at: "2026-09-15T10:00:00Z" });
  deal(db, WS_A, "completed", 4000, { closed_at: "2026-08-15T10:00:00Z" }); // before the period
  deal(db, WS_A, "completed", 1234, { closed_at: null }); // no close date

  const { data } = await call(db, SEPT);
  assert.deepEqual(data.deals, {
    available: true,
    byCurrency: [
      {
        currency: "USD",
        contracted: { value: 7500.5, count: 2 },
        pipeline: { value: 600, count: 3 },
        dealsCompletedValue: 9000,
        dealsCompletedCount: 1,
      },
    ],
  });
});

test("deal money is never added to earned revenue and no combined total exists", async () => {
  const withDeals = seed();
  deal(withDeals, WS_A, "contracted", 5000);
  deal(withDeals, WS_A, "negotiating", 300);
  deal(withDeals, WS_A, "completed", 9000, { closed_at: "2026-09-15T10:00:00Z" });
  const a = (await call(withDeals, SEPT)).data;
  const b = (await call(seed(), SEPT)).data;

  assert.deepEqual(a.earned, b.earned, "earned is identical with or without deals");
  assert.deepEqual(a.videos, b.videos);
  assert.equal(a.earned.revenue.usd, 300);
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      walk(child);
    }
  };
  walk(a);
  for (const key of keys)
    assert.ok(!/^(total|combined|all)(revenue|money|income)/i.test(key), `no ${key} field`);
  // No number in the response equals any sum of earned and a deal figure.
  const text = JSON.stringify(a);
  for (const sum of [5300, 600, 9300, 14300, 14600])
    assert.ok(!new RegExp(`:${sum}[,}\\]]`).test(text), `${sum} does not appear`);
});

test("a role without access to brand deals gets no deal figures", async () => {
  const db = seed();
  deal(db, WS_A, "contracted", 5000);
  const { data } = await call(db, SEPT, { deals: false });
  assert.deepEqual(data.deals, { available: false, reason: "FEATURE_UNAVAILABLE" });
  assert.ok(!db.reads.includes("deals"), "the deals table is not even read");
  assert.equal(data.earned.revenue.usd, 300, "earned revenue is unaffected");
});

// ---------- 19. multiple currencies ----------

test("deals in different currencies are grouped, never summed together or converted", async () => {
  const db = seed();
  deal(db, WS_A, "contracted", 1000, { currency: "USD" });
  deal(db, WS_A, "contracted", 2000, { currency: "EUR" });
  deal(db, WS_A, "contracted", 400, { currency: "eur" });
  deal(db, WS_A, "pitched", 50000, { currency: "GHS" });
  deal(db, WS_A, "completed", 700, { currency: "EUR", closed_at: "2026-09-02T00:00:00Z" });
  deal(db, WS_A, "prospect", 5, { currency: null });

  const { data } = await call(db, SEPT);
  assert.ok(data.deals.available);
  const byCurrency = Object.fromEntries(data.deals.byCurrency.map((c) => [c.currency, c]));
  assert.deepEqual(Object.keys(byCurrency).sort(), ["EUR", "GHS", "UNKNOWN", "USD"]);
  assert.deepEqual(byCurrency.USD.contracted, { value: 1000, count: 1 });
  assert.deepEqual(byCurrency.EUR.contracted, { value: 2400, count: 2 }, "case is normalised");
  assert.equal(byCurrency.EUR.dealsCompletedValue, 700);
  assert.deepEqual(byCurrency.GHS.pipeline, { value: 50000, count: 1 });
  assert.deepEqual(byCurrency.UNKNOWN.pipeline, { value: 5, count: 1 });
  assert.ok(!JSON.stringify(data.deals).includes("3400"), "USD + EUR is never produced");
});

test("deal summary is pure: bad values are skipped and unknown stages are ignored", () => {
  const period = { startDate: "2026-09-01", endDate: "2026-09-30" };
  assert.deepEqual(summarizeDeals([], period), []);
  const result = summarizeDeals(
    [
      { value: "1500.25", currency: "USD", stage: "contracted", closed_at: null },
      { value: "not a number", currency: "USD", stage: "contracted", closed_at: null },
      { value: -5, currency: "USD", stage: "contracted", closed_at: null },
      { value: 10, currency: "USD", stage: "archived", closed_at: null },
      { value: 0.1, currency: "USD", stage: "prospect", closed_at: null },
      { value: 0.2, currency: "USD", stage: "prospect", closed_at: null },
      { value: 9, currency: "USD", stage: "completed", closed_at: "2026-09-30T23:59:59Z" },
      { value: 9, currency: "USD", stage: "completed", closed_at: "2026-10-01T00:00:00Z" },
    ],
    period,
  );
  assert.deepEqual(result, [
    {
      currency: "USD",
      contracted: { value: 1500.25, count: 1 },
      pipeline: { value: 0.3, count: 2 },
      dealsCompletedValue: 9,
      dealsCompletedCount: 1,
    },
  ]);
});

// ---------- 20. no live YouTube calls ----------

test("no network request of any kind is made while building the summary", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error("network access is not allowed here");
  }) as typeof fetch;
  try {
    const db = seed();
    deal(db, WS_A, "contracted", 5000);
    const { status, data } = await call(db, SEPT);
    assert.equal(status, 200);
    assert.equal(data.earned.revenue.usd, 300);
    assert.deepEqual(calls, []);
    assert.deepEqual(
      [...new Set(db.reads)].sort(),
      [
        "channel_daily_stats",
        "deals",
        "video_daily_stats",
        "videos",
        "youtube_channels",
        "youtube_sync_state",
      ],
      "only stored tables are read",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the endpoint's code cannot reach the YouTube client or the service-role client", () => {
  // Follow every relative import from the route file and check none of them is the Google/
  // YouTube API module, the token module, or the service-role Supabase client.
  const seen = new Set<string>();
  const forbidden = ["google-oauth", "youtube-tokens", "youtube-stats-store", "youtube-reporting"];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    assert.ok(!/createServiceSupabaseClient/.test(source) || file.endsWith("workspace.ts"), file);
    // `import type` is erased when the code is built, so it loads nothing at run time; only
    // real imports are followed.
    for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/g)) {
      if (match[1]) continue;
      const spec = match[2];
      if (spec.startsWith("@/lib/server/")) visit(`src/lib/server/${spec.slice(13)}.ts`);
      else if (spec.startsWith("./") && file.startsWith("src/lib/server/"))
        visit(`src/lib/server/${spec.slice(2)}.ts`);
    }
  };
  visit("src/routes/api.revenue.summary.ts");
  const reached = [...seen].map((file) => file.split("/").pop()!.replace(".ts", ""));
  for (const name of forbidden) assert.ok(!reached.includes(name), `${name} is not reachable`);
  assert.ok(reached.includes("revenue-store") && reached.includes("revenue-metrics"));
  for (const file of seen)
    assert.ok(!/googleapis\.com|youtubeanalytics/.test(readFileSync(file, "utf8")), file);
});

test("a database failure is a 500 with a stable code and no details", async () => {
  const response = await handleRevenueSummaryRequest(
    new Request(`https://app.test/api/revenue/summary?${SEPT}`),
    {
      getContext: async () => ({
        workspaceId: WS_A,
        client: {
          from: () => {
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "eq", "not", "order", "in", "gte", "lte", "range"])
              builder[method] = () => builder;
            builder.then = (resolve: (r: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: { code: "XX000", message: "secret table detail" },
              }).then(resolve);
            return builder;
          },
        } as unknown as SupabaseClient,
      }),
      canViewDeals: async () => true,
      now: () => NOW,
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "DATABASE_ERROR" });
});

// ============================================================
// Per-bucket revenue split on the trend (ad / Premium / other)
// ============================================================

const day = (month: number, d: number) =>
  `2026-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Alpha, July–September 2026:
 *   July       every day  $10 = $7 ads + $1 Premium + $2 other
 *   August     every day  $4, all of it ads
 *   September  1st: $6 with $1 Premium, ad revenue not reported
 *              2nd: nothing reported at all
 *              3rd–30th: a reported zero in every column
 * Second, 1–10 August only: $3 = $1 ads + $1 Premium + $1 other
 */
function seedSplit() {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, A2, WS_A, "Second");
  channel(db, B1, WS_B, "Bravo");
  for (const id of [A1, A2, B1]) synced(db, id);
  const money = (total: number | null, ad: number | null, premium: number | null) => ({
    estimated_revenue_usd: total,
    ad_revenue_usd: ad,
    premium_revenue_usd: premium,
  });
  for (let d = 1; d <= 31; d++) {
    channelDay(db, A1, day(7, d), money(10, 7, 1));
    channelDay(db, A1, day(8, d), money(4, 4, 0));
    channelDay(db, B1, day(8, d), money(999, 999, 0));
  }
  for (let d = 1; d <= 10; d++) channelDay(db, A2, day(8, d), money(3, 1, 1));
  channelDay(db, A1, day(9, 1), money(6, null, 1));
  channelDay(db, A1, day(9, 2), money(null, null, null));
  for (let d = 3; d <= 30; d++) channelDay(db, A1, day(9, d), money(0, 0, 0));
  return db;
}

const QUARTER = "start=2026-07-01&end=2026-09-30&granularity=month";
const usd = (split: RevenueSummaryResponse["earned"]["trend"][number]["split"]) => [
  split.ad.usd,
  split.premium.usd,
  split.other.usd,
];

test("trend split: each month carries its own ad, Premium and other revenue", async () => {
  const { data } = await call(seedSplit(), QUARTER);
  const [july, august] = data.earned.trend;
  assert.equal(july.bucket, "2026-07");
  assert.equal(july.revenue.usd, 310);
  assert.deepEqual(usd(july.split), [217, 31, 62]);
  assert.deepEqual(july.split.ad, {
    usd: 217,
    availability: "available",
    knownDays: 31,
    unknownDays: 0,
  });
  assert.equal(july.split.premium.availability, "available");
  assert.equal(july.split.other.availability, "available");
  // Where every part is known, the three parts are exactly the bucket's revenue.
  assert.equal(217 + 31 + 62, july.revenue.usd);
  assert.equal(august.bucket, "2026-08");
});

test("trend split: channels are added together within a month, and nothing is counted twice", async () => {
  const { data } = await call(seedSplit(), QUARTER);
  const august = data.earned.trend[1];
  // Alpha: 31 × $4 ads. Second: 10 × ($1 ads + $1 Premium + $1 other).
  assert.equal(august.revenue.usd, 154);
  assert.deepEqual(usd(august.split), [134, 10, 10]);
  assert.equal(134 + 10 + 10, august.revenue.usd);
  assert.equal(august.split.ad.knownDays, 41, "31 Alpha days + 10 Second days");

  const alphaOnly = await call(seedSplit(), `${QUARTER}&channelId=${A1}`);
  assert.deepEqual(usd(alphaOnly.data.earned.trend[1].split), [124, 0, 0]);
  assert.ok(!JSON.stringify(data).includes("999"), "another workspace is never included");
});

test("trend split: a reported zero is zero, an unreported part is null, and a partial month says so", async () => {
  const { data } = await call(seedSplit(), QUARTER);
  const september = data.earned.trend[2];
  assert.equal(september.bucket, "2026-09");
  assert.deepEqual(september.revenue, {
    usd: 6,
    availability: "partial",
    knownDays: 29,
    unknownDays: 1,
  });
  // Ad revenue was not reported on the 1st or the 2nd; the other 28 days are a real zero.
  assert.deepEqual(september.split.ad, {
    usd: 0,
    availability: "partial",
    knownDays: 28,
    unknownDays: 2,
  });
  assert.deepEqual(september.split.premium, {
    usd: 1,
    availability: "partial",
    knownDays: 29,
    unknownDays: 1,
  });
  // "Other" is not invented for the 1st: without ad revenue it cannot be known.
  assert.deepEqual(september.split.other, {
    usd: 0,
    availability: "partial",
    knownDays: 28,
    unknownDays: 2,
  });
  assert.notEqual(
    september.split.ad.usd! + september.split.premium.usd! + september.split.other.usd!,
    september.revenue.usd,
    "with unknown parts the split is not forced to add up",
  );
});

test("trend split: a month where nothing was reported is null throughout, not zero", async () => {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  synced(db, A1);
  const blank = { estimated_revenue_usd: null, ad_revenue_usd: null, premium_revenue_usd: null };
  for (let d = 1; d <= 31; d++) channelDay(db, A1, day(8, d), blank);
  const { data } = await call(db, QUARTER);
  const [july, august] = data.earned.trend;
  // July has no rows at all; August has rows with nothing reported.
  for (const point of [july, august]) {
    assert.deepEqual(usd(point.split), [null, null, null]);
    assert.equal(point.split.ad.availability, "unavailable");
    assert.equal(point.split.premium.availability, "unavailable");
    assert.equal(point.split.other.availability, "unavailable");
  }
  assert.equal(july.hasData, false);
  assert.equal(august.hasData, true);
  assert.equal(august.split.ad.unknownDays, 31);
});

test("trend split: an all-zero month is a real, available zero in every part", async () => {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  synced(db, A1);
  const zero = { estimated_revenue_usd: 0, ad_revenue_usd: 0, premium_revenue_usd: 0 };
  for (let d = 1; d <= 31; d++) channelDay(db, A1, day(8, d), zero);
  const august = (await call(db, QUARTER)).data.earned.trend[1];
  assert.deepEqual(usd(august.split), [0, 0, 0]);
  assert.equal(august.split.other.availability, "available");
});

test("trend split: the months add up to the period split and to the headline revenue", async () => {
  const { data } = await call(seedSplit(), QUARTER);
  const sum = (pick: (point: (typeof data.earned.trend)[number]) => number | null) =>
    Math.round(data.earned.trend.reduce((total, point) => total + (pick(point) ?? 0), 0) * 1e6) /
    1e6;
  assert.equal(
    sum((p) => p.split.ad.usd),
    data.earned.split.ad.usd,
  );
  assert.equal(
    sum((p) => p.split.premium.usd),
    data.earned.split.premium.usd,
  );
  assert.equal(
    sum((p) => p.split.other.usd),
    data.earned.split.other.usd,
  );
  assert.equal(
    sum((p) => p.revenue.usd),
    data.earned.revenue.usd,
  );
  assert.deepEqual(
    [data.earned.split.ad.usd, data.earned.split.premium.usd, data.earned.split.other.usd],
    [351, 42, 72],
  );
  assert.equal(data.earned.revenue.usd, 470);
});

test("trend split: it comes from channel rows only — video rows never change it", async () => {
  const plain = (await call(seedSplit(), QUARTER)).data;
  const db = seedSplit();
  video(db, "v-loud", A1);
  for (let d = 1; d <= 31; d++)
    videoDay(db, "v-loud", A1, day(7, d), {
      estimated_revenue_usd: 5000,
      ad_revenue_usd: 5000,
      premium_revenue_usd: 5000,
    });
  const withVideos = (await call(db, QUARTER)).data;
  assert.deepEqual(withVideos.earned.trend, plain.earned.trend);
  assert.deepEqual(withVideos.earned.split, plain.earned.split);
  assert.equal(withVideos.earned.revenue.usd, 470);
});

test("trend split: daily points carry it too, and a partly reported period stays partial", async () => {
  const { data } = await call(seedSplit(), "start=2026-08-30&end=2026-09-03");
  assert.equal(data.granularity, "day");
  assert.deepEqual(
    data.earned.trend.map((p) => [p.bucket, ...usd(p.split)]),
    [
      ["2026-08-30", 4, 0, 0],
      ["2026-08-31", 4, 0, 0],
      ["2026-09-01", null, 1, null],
      ["2026-09-02", null, null, null],
      ["2026-09-03", 0, 0, 0],
    ],
  );
  assert.equal(data.earned.split.ad.availability, "partial");
});

test("trend split: the rest of the summary contract is unchanged", async () => {
  const { data } = await call(seed(), SEPT);
  // Every field a trend point had before is still there with the same value; `split` is the
  // only addition.
  assert.deepEqual(Object.keys(data.earned.trend[0]), [
    "bucket",
    "startDate",
    "endDate",
    "revenue",
    "split",
    "views",
    "watchMinutes",
    "rpm",
    "hasData",
    "incomplete",
  ]);
  assert.deepEqual(Object.keys(data), [
    "status",
    "currency",
    "dateBasis",
    "period",
    "previousPeriod",
    "granularity",
    "channels",
    "earned",
    "videos",
    "dataQuality",
    "deals",
  ]);
  assert.deepEqual(Object.keys(data.earned), [
    "revenue",
    "views",
    "watchMinutes",
    "rpm",
    "split",
    "previous",
    "change",
    "trend",
  ]);
  const first = data.earned.trend[0];
  assert.deepEqual(
    [first.bucket, first.revenue.usd, first.views, first.rpm, first.hasData, first.incomplete],
    ["2026-09-01", 10, 2000, 5, true, false],
  );
  assert.deepEqual(usd(first.split), [7, 0.5, 2.5]);
});
