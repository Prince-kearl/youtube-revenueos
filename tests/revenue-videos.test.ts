import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  handleRevenueVideosRequest,
  parseRevenueVideosQuery,
  sortRevenueVideos,
  type RevenueVideoItem,
  type RevenueVideosResponse,
} from "../src/lib/server/revenue-videos";
import {
  handleRevenueSummaryRequest,
  parseRevenueSummaryQuery,
  RevenueSummaryError,
  type RevenueSummaryResponse,
} from "../src/lib/server/revenue-summary";
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
} from "./helpers/revenue-fake-db";

interface CallOptions {
  /** Workspace the caller is signed in to; null = not signed in; "none" = no workspace. */
  as?: string | null;
  now?: Date;
}

async function call(db: FakeDb, query: string, options: CallOptions = {}) {
  const workspaceId = options.as === undefined ? WS_A : options.as;
  const response = await handleRevenueVideosRequest(
    new Request(`https://app.test/api/revenue/videos${query ? `?${query}` : ""}`),
    {
      getContext: async () => {
        if (!workspaceId)
          throw new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401 });
        if (workspaceId === "none")
          throw new Response(JSON.stringify({ error: "NO_WORKSPACE" }), { status: 403 });
        return { client: db.clientFor(workspaceId), workspaceId };
      },
      now: () => options.now ?? NOW,
    },
  );
  const body = (await response.json()) as { data?: RevenueVideosResponse; error?: string };
  return { status: response.status, body, data: body.data as RevenueVideosResponse, response };
}

const sept = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
const aug = (d: number) => `2026-08-${String(d).padStart(2, "0")}`;

/**
 * Workspace A, September 2026 against 2–31 August, with non-zero revenue throughout:
 *
 *   Alpha   earns $10/day (2,000 views); $5/day (1,000 views) in August
 *     v-big      $6/day, 1,200 views, 2,400 min        August: $3/day, 600 views
 *     v-small    $1/day, 500 views                     no August rows (a new video)
 *     v-gone     $2/day on 1–10 Sep, 100 views         August: $2/day — no longer listed
 *     v-partial  1 Sep $4 (100 views), 2 Sep revenue not reported (300 views)
 *     v-zero     3 Sep $0 (200 views)                  5 Aug: $0 (100 views)
 *     v-unknown  5 Sep revenue not reported (50 views)
 *   Second  earns $2/day (100 views), all of it from v-second
 *
 * Alpha's videos explain only part of Alpha's $300; the rest is unattributed.
 * Workspace B has its own, much larger, channel that must never appear.
 */
function seed() {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, A2, WS_A, "Second");
  channel(db, B1, WS_B, "Bravo");
  for (const id of [A1, A2, B1]) synced(db, id);
  for (const id of ["v-big", "v-small", "v-partial", "v-zero", "v-unknown"]) video(db, id, A1);
  video(db, "v-gone", A1, { status: "deleted" });
  video(db, "v-second", A2);
  video(db, "v-bravo", B1);
  for (let d = 1; d <= 30; d++) {
    channelDay(db, A1, sept(d), { estimated_revenue_usd: 10, views: 2000, watch_minutes: 4000 });
    videoDay(db, "v-big", A1, sept(d), {
      estimated_revenue_usd: 6,
      views: 1200,
      watch_minutes: 2400,
    });
    videoDay(db, "v-small", A1, sept(d), {
      estimated_revenue_usd: 1,
      views: 500,
      watch_minutes: 100,
    });
    if (d <= 10)
      videoDay(db, "v-gone", A1, sept(d), {
        estimated_revenue_usd: 2,
        views: 100,
        watch_minutes: 50,
      });
    channelDay(db, A2, sept(d), { estimated_revenue_usd: 2, views: 100, watch_minutes: 300 });
    videoDay(db, "v-second", A2, sept(d), {
      estimated_revenue_usd: 2,
      views: 100,
      watch_minutes: 300,
    });
    channelDay(db, B1, sept(d), { estimated_revenue_usd: 999, views: 99999 });
    videoDay(db, "v-bravo", B1, sept(d), { estimated_revenue_usd: 999, views: 99999 });
  }
  for (let d = 2; d <= 31; d++) {
    channelDay(db, A1, aug(d), { estimated_revenue_usd: 5, views: 1000, watch_minutes: 2000 });
    videoDay(db, "v-big", A1, aug(d), {
      estimated_revenue_usd: 3,
      views: 600,
      watch_minutes: 1200,
    });
    videoDay(db, "v-gone", A1, aug(d), { estimated_revenue_usd: 2, views: 100, watch_minutes: 50 });
    channelDay(db, A2, aug(d), { estimated_revenue_usd: 2, views: 100, watch_minutes: 300 });
  }
  videoDay(db, "v-partial", A1, sept(1), {
    estimated_revenue_usd: 4,
    views: 100,
    watch_minutes: 10,
  });
  videoDay(db, "v-partial", A1, sept(2), {
    estimated_revenue_usd: null,
    views: 300,
    watch_minutes: 30,
  });
  videoDay(db, "v-zero", A1, sept(3), { estimated_revenue_usd: 0, views: 200, watch_minutes: 20 });
  videoDay(db, "v-zero", A1, aug(5), { estimated_revenue_usd: 0, views: 100, watch_minutes: 10 });
  videoDay(db, "v-unknown", A1, sept(5), {
    estimated_revenue_usd: null,
    views: 50,
    watch_minutes: 5,
  });
  return db;
}

const ids = (data: RevenueVideosResponse) => data.videos.map((v) => v.videoId);
const byId = (data: RevenueVideosResponse, id: string) =>
  data.videos.find((v) => v.videoId === id)!;

// ---------- 1. authentication ----------

test("signed out is 401 and no workspace is 403, before anything is read", async () => {
  const db = seed();
  const out = await call(db, SEPT, { as: null });
  assert.deepEqual([out.status, out.body], [401, { error: "AUTH_REQUIRED" }]);
  const none = await call(db, SEPT, { as: "none" });
  assert.deepEqual([none.status, none.body], [403, { error: "NO_WORKSPACE" }]);
  assert.deepEqual(db.reads, []);
});

test("a signed-in member gets their videos in the documented shape", async () => {
  const { status, data, response } = await call(seed(), SEPT);
  assert.equal(status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(Object.keys(data), [
    "status",
    "currency",
    "dateBasis",
    "period",
    "previousPeriod",
    "channels",
    "sort",
    "videos",
    "pagination",
    "attribution",
    "dataQuality",
  ]);
  assert.equal(data.status, "connected");
  assert.equal(data.currency, "USD");
  assert.equal(data.dateBasis, "youtube_reporting_day");
  assert.deepEqual(data.sort, { by: "revenue", direction: "desc" });
  assert.deepEqual(Object.keys(data.videos[0]).sort(), [
    "change",
    "channelId",
    "channelTitle",
    "currentlyListed",
    "dataQuality",
    "previous",
    "publishedAt",
    "revenue",
    "revenueShare",
    "rpm",
    "thumbnail",
    "title",
    "videoId",
    "viewShare",
    "views",
    "watchMinutes",
    "youtubeVideoId",
  ]);
});

// ---------- 2 & 3. workspace and channel isolation ----------

test("another workspace's videos never appear, and a workspace id in the query is ignored", async () => {
  const db = seed();
  const plain = await call(db, SEPT);
  assert.ok(plain.data.videos.every((v) => [A1, A2].includes(v.channelId)));
  assert.ok(!JSON.stringify(plain.data).includes("bravo"));
  assert.ok(!JSON.stringify(plain.data).includes("999"));
  for (const param of ["workspaceId", "workspace_id", "workspace"]) {
    const spoofed = await call(db, `${SEPT}&${param}=${WS_B}`);
    assert.deepEqual(spoofed.data, plain.data, `${param} changed nothing`);
  }
  const other = await call(db, SEPT, { as: WS_B });
  assert.deepEqual(ids(other.data), ["v-bravo"]);
});

test("a foreign, unknown or disconnected channel id is the same 404", async () => {
  const db = seed();
  channel(db, A_OFF, WS_A, "Disconnected", false);
  video(db, "v-off", A_OFF);
  videoDay(db, "v-off", A_OFF, sept(4), { estimated_revenue_usd: 5000 });
  for (const id of [B1, "cccccccc-0000-4000-8000-000000000009", A_OFF]) {
    const { status, body } = await call(db, `${SEPT}&channelId=${id}`);
    assert.deepEqual([id, status, body], [id, 404, { error: "CHANNEL_NOT_FOUND" }]);
  }
});

// ---------- 4. connected vs disconnected ----------

test("only connected channels are included by default", async () => {
  const db = seed();
  channel(db, A_OFF, WS_A, "Disconnected", false);
  video(db, "v-off", A_OFF);
  videoDay(db, "v-off", A_OFF, sept(4), { estimated_revenue_usd: 5000 });
  const { data } = await call(db, SEPT);
  assert.deepEqual(data.channels.map((c) => c.name).sort(), ["Alpha", "Second"]);
  assert.ok(!ids(data).includes("v-off"));
});

// ---------- 5, 6, 7. default period, explicit range, days ----------

test("the period rules are the summary endpoint's, not a second set", async () => {
  const today = "2026-10-10";
  for (const query of ["", "days=7", "days=366", SEPT, "start=2026-10-10&end=2026-10-10"]) {
    const url = new URL(`https://app.test/x?${query}`);
    const videos = parseRevenueVideosQuery(url, today);
    const summary = parseRevenueSummaryQuery(url, today);
    assert.deepEqual(
      [videos.period, videos.defaulted],
      [summary.period, summary.defaulted],
      `same period for "${query}"`,
    );
  }
});

test("default period: 28 days ending on the newest day YouTube should have reported", async () => {
  const { data } = await call(seed(), "");
  assert.deepEqual(data.period, {
    startDate: "2026-09-10",
    endDate: "2026-10-07",
    days: 28,
    defaulted: true,
  });
  assert.deepEqual(data.previousPeriod, { startDate: "2026-08-13", endDate: "2026-09-09" });
  assert.deepEqual(data.dataQuality.freshness.pendingDays, [], "no unreported days are included");
});

test("an explicit range and a day count", async () => {
  const explicit = await call(seed(), SEPT);
  assert.deepEqual(explicit.data.period, {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    days: 30,
    defaulted: false,
  });
  assert.deepEqual(explicit.data.previousPeriod, {
    startDate: "2026-08-02",
    endDate: "2026-08-31",
  });

  const week = await call(seed(), "days=7");
  assert.deepEqual(week.data.period, {
    startDate: "2026-10-01",
    endDate: "2026-10-07",
    days: 7,
    defaulted: false,
  });
  assert.deepEqual(week.data.videos, [], "nothing stored in that week");
  assert.equal(week.data.pagination.total, 0);
});

// ---------- 8, 9, 10. invalid combinations, future end, maximum range ----------

test("invalid requests are 422 and read nothing", async () => {
  const bad = [
    "start=2026-09-30&end=2026-09-01", // reversed
    "start=2026-09-01", // one end only
    "end=2026-09-30",
    "start=2026-09-01&end=2026-09-30&days=7", // a range and a day count
    "start=2026-02-30&end=2026-03-01", // not a real date
    "start=09/01/2026&end=09/30/2026",
    "start=2026-10-01&end=2026-10-11", // ends tomorrow
    "start=2026-09-01&end=2027-01-01", // far future
    "start=2025-10-09&end=2026-10-10", // 367 days
    "days=0",
    "days=367",
    "days=abc",
    "channelId=not-a-uuid",
    "limit=0",
    "limit=101",
    "limit=abc",
    "offset=-1",
    "offset=abc",
    "sort=cpm",
    "sort=title",
    "direction=up",
  ];
  for (const query of bad) {
    const db = seed();
    const { status, body } = await call(db, query);
    assert.deepEqual([query, status, body], [query, 422, { error: "VALIDATION_ERROR" }]);
    assert.deepEqual(db.reads, [], `${query} read nothing`);
  }
});

test("the boundaries themselves are accepted: today, and exactly 366 days", async () => {
  assert.equal((await call(seed(), "start=2026-10-10&end=2026-10-10")).status, 200);
  const longest = await call(seed(), "start=2025-10-10&end=2026-10-10");
  assert.equal(longest.status, 200);
  assert.equal(longest.data.period.days, 366);
  assert.equal((await call(seed(), "days=366")).status, 200);
  assert.throws(
    () =>
      parseRevenueVideosQuery(
        new URL("https://app.test/x?start=2026-10-11&end=2026-10-11"),
        "2026-10-10",
      ),
    RevenueSummaryError,
  );
});

// ---------- 15, 16, 17. revenue, NULL vs zero, RPM, share ----------

test("each video carries its own stored revenue, views, watch time and RPM", async () => {
  const { data } = await call(seed(), SEPT);
  const big = byId(data, "v-big");
  assert.deepEqual(big.revenue, {
    usd: 180,
    availability: "available",
    knownDays: 30,
    unknownDays: 0,
  });
  assert.equal(big.views, 36000);
  assert.equal(big.watchMinutes, 72000);
  assert.equal(big.rpm, 5, "180 / 36,000 × 1,000");
  assert.equal(big.title, "Title v-big");
  assert.equal(big.youtubeVideoId, "yt-v-big");
  assert.equal(big.channelId, A1);
  assert.equal(big.channelTitle, "Alpha");
  assert.equal(byId(data, "v-small").rpm, 2);
  assert.equal(byId(data, "v-gone").rpm, 20);
  assert.equal(byId(data, "v-second").channelTitle, "Second");
});

test("unreported revenue is null, a reported zero is zero, and partial is flagged", async () => {
  const { data } = await call(seed(), SEPT);

  const unknown = byId(data, "v-unknown");
  assert.deepEqual(unknown.revenue, {
    usd: null,
    availability: "unavailable",
    knownDays: 0,
    unknownDays: 1,
  });
  assert.equal(unknown.rpm, null);
  assert.equal(unknown.revenueShare, null);
  assert.equal(unknown.views, 50, "its activity is still reported");
  assert.equal(unknown.dataQuality.availability, "unavailable");

  const zero = byId(data, "v-zero");
  assert.deepEqual(zero.revenue, {
    usd: 0,
    availability: "available",
    knownDays: 1,
    unknownDays: 0,
  });
  assert.equal(zero.rpm, 0, "a real zero, not unknown");
  assert.equal(zero.revenueShare, 0);
  assert.equal(zero.dataQuality.availability, "complete");

  const partial = byId(data, "v-partial");
  assert.deepEqual(partial.revenue, {
    usd: 4,
    availability: "partial",
    knownDays: 1,
    unknownDays: 1,
  });
  assert.equal(partial.views, 400);
  assert.equal(partial.rpm, 40, "$4 over the 100 views of the day revenue is known, not over 400");
  assert.equal(partial.revenueShare, null, "no share is claimed from partly known revenue");
  assert.equal(partial.dataQuality.availability, "partial");
});

test("revenue share is of the channel-level total, and the shares do not add up to 1", async () => {
  const { data } = await call(seed(), SEPT);
  // Channel total across both channels: Alpha 300 + Second 60 = 360.
  assert.equal(byId(data, "v-big").revenueShare, 0.5);
  assert.equal(byId(data, "v-second").revenueShare, 0.166667);
  assert.equal(byId(data, "v-small").revenueShare, 0.083333);
  assert.equal(byId(data, "v-gone").revenueShare, 0.055556);
  assert.equal(byId(data, "v-big").viewShare, 0.571429, "36,000 of 63,000 channel views");
  const total = data.videos.reduce((sum, v) => sum + (v.revenueShare ?? 0), 0);
  assert.ok(total < 0.81 && total > 0.8, `shares total ${total}, well short of 1`);

  // Narrowed to one channel, the share is of that channel's total.
  const alpha = await call(seed(), `${SEPT}&channelId=${A1}`);
  assert.equal(byId(alpha.data, "v-big").revenueShare, 0.6, "180 of Alpha's 300");
});

// ---------- 13 & 14. previous period and change ----------

test("previous-period figures and changes use the same definitions as the summary", async () => {
  const { data } = await call(seed(), SEPT);
  const big = byId(data, "v-big");
  assert.deepEqual(big.previous, {
    revenue: { usd: 90, availability: "available", knownDays: 30, unknownDays: 0 },
    views: 18000,
    watchMinutes: 36000,
    rpm: 5,
  });
  assert.deepEqual(big.change.revenue, { current: 180, previous: 90, absolute: 90, percent: 100 });
  assert.deepEqual(big.change.views, {
    current: 36000,
    previous: 18000,
    absolute: 18000,
    percent: 100,
  });
  assert.equal(big.change.watchMinutes.percent, 100);
  assert.deepEqual(big.change.rpm, { current: 5, previous: 5, absolute: 0, percent: 0 });

  const gone = byId(data, "v-gone");
  assert.equal(gone.previous.revenue.usd, 60);
  assert.deepEqual(gone.change.revenue, {
    current: 20,
    previous: 60,
    absolute: -40,
    percent: -66.67,
  });
});

test("no percentage is made up when the previous value is zero or unknown", async () => {
  const { data } = await call(seed(), SEPT);

  const zero = byId(data, "v-zero");
  assert.equal(zero.previous.revenue.usd, 0, "previous revenue was a reported zero");
  assert.deepEqual(zero.change.revenue, { current: 0, previous: 0, absolute: 0, percent: null });
  assert.deepEqual(zero.change.views, { current: 200, previous: 100, absolute: 100, percent: 100 });
  assert.deepEqual(zero.change.rpm, { current: 0, previous: 0, absolute: 0, percent: null });

  // A video with nothing stored in the previous period: revenue there is unknown, not zero.
  const fresh = byId(data, "v-small");
  assert.deepEqual(fresh.previous, {
    revenue: { usd: null, availability: "unavailable", knownDays: 0, unknownDays: 0 },
    views: 0,
    watchMinutes: 0,
    rpm: null,
  });
  assert.deepEqual(fresh.change.revenue, {
    current: 30,
    previous: null,
    absolute: null,
    percent: null,
  });
  assert.deepEqual(fresh.change.views, {
    current: 15000,
    previous: 0,
    absolute: 15000,
    percent: null,
  });
  assert.equal(fresh.change.rpm.percent, null);

  const unknown = byId(data, "v-unknown");
  assert.deepEqual(unknown.change.revenue, {
    current: null,
    previous: null,
    absolute: null,
    percent: null,
  });
});

// ---------- 18 & 19. listing state ----------

test("a video YouTube no longer returns stays visible with its history, marked not listed", async () => {
  const { data } = await call(seed(), SEPT);
  const gone = byId(data, "v-gone");
  assert.equal(gone.currentlyListed, false);
  assert.equal(gone.revenue.usd, 20);
  assert.equal(gone.views, 1000);
  assert.equal(gone.title, "Title v-gone");
  assert.equal(byId(data, "v-big").currentlyListed, true);
  assert.ok(!/deleted/i.test(JSON.stringify(data)), "the internal status word is never exposed");
});

test("a video with stored rows but no catalogue entry is still returned, with unknown listing", async () => {
  const db = seed();
  videoDay(db, "v-orphan", A1, sept(7), { estimated_revenue_usd: 3, views: 30 });
  const orphan = byId((await call(db, SEPT)).data, "v-orphan");
  assert.equal(orphan.revenue.usd, 3);
  assert.equal(orphan.currentlyListed, null);
  assert.equal(orphan.title, null);
  assert.equal(orphan.dataQuality.historyLoaded, null);
});

// ---------- attribution: partly attributable channel revenue ----------

test("channel revenue, attributed revenue and the unattributed remainder are three separate figures", async () => {
  const { data } = await call(seed(), `${SEPT}&channelId=${A1}`);
  const { attribution } = data;
  assert.equal(attribution.channelRevenue.usd, 300, "what the channel earned");
  // Day by day, Alpha's videos explain: 1 Sep 13, 2 Sep unknown (one video unreported),
  // 3–4 Sep 9, 5 Sep unknown, 6–10 Sep 9, 11–30 Sep 7.
  assert.equal(attribution.attributedRevenue.usd, 13 + 9 * 2 + 9 * 5 + 7 * 20);
  assert.equal(attribution.attributedRevenue.availability, "partial");
  assert.equal(attribution.unattributedRevenue.usd, 0 + 1 * 2 + 1 * 5 + 3 * 20, "never negative");
  assert.equal(attribution.unattributedRevenue.availability, "partial", "two days are unknown");
  assert.equal(attribution.channelViews, 60000);
  assert.ok(attribution.unattributedViews > 0);
  assert.equal(attribution.state, "videos_no_longer_listed");
  assert.equal(attribution.byChannel[0].videosNoLongerListed, 1);

  // The remainder is not handed to any video: each keeps exactly its own stored revenue.
  const listed = data.videos.reduce((sum, v) => sum + (v.revenue.usd ?? 0), 0);
  assert.equal(listed, 180 + 30 + 20 + 4 + 0);
  assert.ok(listed < attribution.channelRevenue.usd!);
  assert.equal(byId(data, "v-big").revenue.usd, 180);
});

test("attribution matches the summary endpoint for the same request", async () => {
  const db = seed();
  const videos = (await call(db, SEPT)).data;
  const summaryResponse = await handleRevenueSummaryRequest(
    new Request(`https://app.test/api/revenue/summary?${SEPT}&limit=50`),
    {
      getContext: async () => ({ client: db.clientFor(WS_A), workspaceId: WS_A }),
      canViewDeals: async () => false,
      now: () => NOW,
    },
  );
  const summary = ((await summaryResponse.json()) as { data: RevenueSummaryResponse }).data;
  assert.deepEqual(videos.attribution, summary.videos.attribution);
  assert.deepEqual(videos.dataQuality.freshness, summary.dataQuality.freshness);
  assert.equal(videos.pagination.total, summary.videos.count);
  for (const top of summary.videos.top) {
    const same = byId(videos, top.videoId);
    assert.deepEqual(
      [same.revenue, same.views, same.rpm, same.revenueShare, same.viewShare, same.currentlyListed],
      [top.revenue, top.views, top.rpm, top.revenueShare, top.viewShare, top.currentlyListed],
      `${top.videoId} agrees between the two endpoints`,
    );
  }
});

test("a fully attributed channel reports no remainder", async () => {
  const { attribution } = (await call(seed(), `${SEPT}&channelId=${A2}`)).data;
  assert.equal(attribution.state, "fully_attributed");
  assert.equal(attribution.channelRevenue.usd, 60);
  assert.equal(attribution.attributedRevenue.usd, 60);
  assert.equal(attribution.unattributedRevenue.usd, 0);
});

// ---------- 12. sorting ----------

test("default order is revenue, highest first, with unknown revenue last", async () => {
  const { data } = await call(seed(), SEPT);
  assert.deepEqual(ids(data), [
    "v-big", // 180
    "v-second", // 60
    "v-small", // 30
    "v-gone", // 20
    "v-partial", // 4
    "v-zero", // 0
    "v-unknown", // not known
  ]);
});

test("every sort key orders by the calculated value, in both directions, unknowns always last", async () => {
  const order = async (query: string) => ids((await call(seed(), `${SEPT}&${query}`)).data);

  assert.deepEqual(await order("sort=revenue&direction=asc"), [
    "v-zero",
    "v-partial",
    "v-gone",
    "v-small",
    "v-second",
    "v-big",
    "v-unknown", // still last: "lowest revenue" must not start with "revenue not known"
  ]);
  assert.deepEqual(await order("sort=views"), [
    "v-big", // 36,000
    "v-small", // 15,000
    "v-second", // 3,000
    "v-gone", // 1,000
    "v-partial", // 400
    "v-zero", // 200
    "v-unknown", // 50
  ]);
  assert.deepEqual(await order("sort=views&direction=asc"), [
    "v-unknown",
    "v-zero",
    "v-partial",
    "v-gone",
    "v-second",
    "v-small",
    "v-big",
  ]);
  assert.deepEqual(await order("sort=watchMinutes"), [
    "v-big", // 72,000
    "v-second", // 9,000
    "v-small", // 3,000
    "v-gone", // 500
    "v-partial", // 40
    "v-zero", // 20
    "v-unknown", // 5
  ]);
  assert.deepEqual(await order("sort=rpm"), [
    "v-partial", // 40
    "v-second", // 20 — tie with v-gone, more views first
    "v-gone", // 20
    "v-big", // 5
    "v-small", // 2
    "v-zero", // 0
    "v-unknown", // none
  ]);
  assert.deepEqual(await order("sort=rpm&direction=asc"), [
    "v-zero",
    "v-small",
    "v-big",
    "v-second", // tie: the tie-break does not flip with direction
    "v-gone",
    "v-partial",
    "v-unknown",
  ]);
  assert.deepEqual(await order("sort=revenueShare"), [
    "v-big", // 0.5
    "v-second",
    "v-small",
    "v-gone",
    "v-zero", // a real 0
    "v-partial", // no share (partly known revenue) — more views than v-unknown
    "v-unknown", // no share
  ]);
});

test("sorting is pure, stable and leaves its input untouched", () => {
  const item = (videoId: string, usd: number | null, views: number) =>
    ({ videoId, views, revenue: { usd } }) as unknown as RevenueVideoItem;
  const input = [item("b", 5, 10), item("a", 5, 10), item("c", null, 999), item("d", 5, 20)];
  const before = input.map((v) => v.videoId);
  const sorted = sortRevenueVideos(input, "revenue", "desc").map((v) => v.videoId);
  assert.deepEqual(sorted, ["d", "a", "b", "c"], "ties: more views first, then id");
  assert.deepEqual(
    input.map((v) => v.videoId),
    before,
  );
});

// ---------- 11. pagination ----------

test("pagination walks the full sorted list without gaps or repeats", async () => {
  const db = seed();
  const full = ids((await call(db, SEPT)).data);
  const first = await call(db, `${SEPT}&limit=3`);
  assert.deepEqual(first.data.pagination, { limit: 3, offset: 0, total: 7, hasMore: true });
  const second = await call(db, `${SEPT}&limit=3&offset=3`);
  assert.deepEqual(second.data.pagination, { limit: 3, offset: 3, total: 7, hasMore: true });
  const third = await call(db, `${SEPT}&limit=3&offset=6`);
  assert.deepEqual(third.data.pagination, { limit: 3, offset: 6, total: 7, hasMore: false });
  assert.deepEqual([...ids(first.data), ...ids(second.data), ...ids(third.data)], full);

  const past = await call(db, `${SEPT}&offset=50`);
  assert.deepEqual(past.data.videos, []);
  assert.deepEqual(past.data.pagination, { limit: 50, offset: 50, total: 7, hasMore: false });

  // Shares and the attribution picture describe the whole period, not the page.
  assert.equal(byId(second.data, "v-gone").revenueShare, 0.055556);
  assert.deepEqual(second.data.attribution, first.data.attribution);
  assert.equal((await call(db, `${SEPT}&limit=100`)).data.pagination.limit, 100);
});

// ---------- 20. partial / incomplete data ----------

test("a period that reaches into unsettled days marks every video's trend as incomplete", async () => {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  synced(db, A1);
  video(db, "v-early", A1);
  video(db, "v-recent", A1, { analytics_updated_at: null });
  for (const day of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-06", "2026-10-07"])
    channelDay(db, A1, day, { estimated_revenue_usd: 4, views: 400 });
  videoDay(db, "v-early", A1, "2026-10-02", { estimated_revenue_usd: 4, views: 400 });
  videoDay(db, "v-recent", A1, "2026-10-06", { estimated_revenue_usd: 4, views: 400 });

  const { data } = await call(db, "start=2026-10-01&end=2026-10-10");
  const { freshness } = data.dataQuality;
  assert.deepEqual(freshness.provisionalDays, ["2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(freshness.pendingDays, ["2026-10-08", "2026-10-09", "2026-10-10"]);
  assert.deepEqual(freshness.missingDays, ["2026-10-04", "2026-10-05"]);
  assert.equal(freshness.complete, false);

  const early = byId(data, "v-early");
  assert.deepEqual(early.dataQuality, {
    availability: "provisional",
    incompleteTrend: true,
    hasProvisionalDays: false,
    historyLoaded: true,
  });
  const recent = byId(data, "v-recent");
  assert.equal(recent.dataQuality.hasProvisionalDays, true);
  assert.equal(recent.dataQuality.historyLoaded, false);
  assert.equal(recent.revenue.usd, 4, "provisional figures are still reported");

  const settled = (await call(seed(), SEPT)).data;
  assert.equal(settled.dataQuality.freshness.complete, true);
  assert.equal(byId(settled, "v-big").dataQuality.incompleteTrend, false);
  assert.equal(byId(settled, "v-big").dataQuality.availability, "complete");
});

test("sync state is summarised without exposing raw errors", async () => {
  const db = seed();
  db.tables.youtube_sync_state[0].last_error = "YOUTUBE_VIDEOS_FAILED:503";
  const { data } = await call(db, SEPT);
  assert.equal(data.dataQuality.sync.find((s) => s.channelId === A1)!.hasSyncError, true);
  assert.ok(!JSON.stringify(data).includes("503"));
});

// ---------- 21. multiple channels ----------

test("several channels: videos from each, the channel filter narrows to one", async () => {
  const both = (await call(seed(), SEPT)).data;
  assert.deepEqual([...new Set(both.videos.map((v) => v.channelId))].sort(), [A1, A2]);
  assert.equal(both.pagination.total, 7);
  assert.equal(both.attribution.byChannel.length, 2);

  const second = (await call(seed(), `${SEPT}&channelId=${A2}`)).data;
  assert.deepEqual(ids(second), ["v-second"]);
  assert.deepEqual(
    second.channels.map((c) => c.id),
    [A2],
  );
  assert.equal(byId(second, "v-second").revenueShare, 1);
});

test("a workspace with no connected channel gets an explicit empty answer", async () => {
  const { status, data } = await call(new FakeDb(), SEPT);
  assert.equal(status, 200);
  assert.equal(data.status, "not_connected");
  assert.deepEqual(data.videos, []);
  assert.deepEqual(data.pagination, { limit: 50, offset: 0, total: 0, hasMore: false });
  assert.equal(data.attribution.channelRevenue.usd, null);
});

// ---------- 22. no live YouTube / network dependency ----------

test("no network request is made and only stored tables are read", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error("network access is not allowed here");
  }) as typeof fetch;
  try {
    const db = seed();
    const { status, data } = await call(db, SEPT);
    assert.equal(status, 200);
    assert.equal(data.pagination.total, 7);
    assert.deepEqual(calls, []);
    assert.deepEqual([...new Set(db.reads)].sort(), [
      "channel_daily_stats",
      "video_daily_stats",
      "videos",
      "youtube_channels",
      "youtube_sync_state",
    ]);
    // Not one query per video: the number of reads does not grow with the number of videos.
    assert.equal(db.reads.length, 5);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the endpoint's code cannot reach the YouTube client or the service-role client", () => {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // `import type` is erased at build time and loads nothing; only real imports are followed.
    for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/g)) {
      if (match[1]) continue;
      const spec = match[2];
      if (spec.startsWith("@/lib/server/")) visit(`src/lib/server/${spec.slice(13)}.ts`);
      else if (spec.startsWith("./") && file.startsWith("src/lib/server/"))
        visit(`src/lib/server/${spec.slice(2)}.ts`);
    }
  };
  visit("src/routes/api.revenue.videos.ts");
  const reached = [...seen].map((file) => file.split("/").pop()!.replace(".ts", ""));
  for (const name of [
    "google-oauth",
    "youtube-tokens",
    "youtube-stats-store",
    "youtube-reporting",
    "supabase",
  ])
    assert.ok(!reached.includes(name), `${name} is not reachable`);
  assert.ok(reached.includes("revenue-store") && reached.includes("revenue-metrics"));
  for (const file of seen) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/googleapis\.com|youtubeanalytics/.test(source), file);
    assert.ok(!/createServiceSupabaseClient/.test(source), `${file} has no service-role client`);
  }
});

// ---------- 23. no deal revenue contamination ----------

test("deals have no effect on this endpoint and the deals table is never read", async () => {
  const withDeals = seed();
  deal(withDeals, WS_A, "contracted", 5000);
  deal(withDeals, WS_A, "negotiating", 300);
  deal(withDeals, WS_A, "completed", 9000, { closed_at: "2026-09-15T10:00:00Z" });
  const a = await call(withDeals, SEPT);
  const b = await call(seed(), SEPT);
  assert.deepEqual(a.data, b.data);
  assert.ok(!withDeals.reads.includes("deals"));
  assert.ok(!/deal|contracted|pipeline/i.test(JSON.stringify(a.data)));
});

test("a database failure is a 500 with a stable code and no details", async () => {
  const response = await handleRevenueVideosRequest(
    new Request(`https://app.test/api/revenue/videos?${SEPT}`),
    {
      getContext: async () => ({
        workspaceId: WS_A,
        client: {
          from: () => {
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "eq", "not", "order", "in", "gte", "lte", "range"])
              builder[method] = () => builder;
            builder.then = (resolve: (r: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { code: "XX000", message: "secret" } }).then(
                resolve,
              );
            return builder;
          },
        } as never,
      }),
      now: () => NOW,
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "DATABASE_ERROR" });
});

// ============================================================
// videoIds filter (public YouTube video ids)
// ============================================================

// Real YouTube ids are 11 characters; the shared fixture's placeholder ids are not, so the
// filter tests give each video a well-formed one.
const YT: Record<string, string> = {
  "v-big": "BIGBIGBIG01",
  "v-small": "SMALLSMALL1",
  "v-gone": "GONEGONE001",
  "v-partial": "PARTIALPAR1",
  "v-zero": "ZEROZERO001",
  "v-unknown": "UNKNOWNUNK1",
  "v-second": "SECONDSEC01",
  "v-bravo": "BRAVOBRAVO1",
  "v-off": "OFFOFFOFF01",
  "v-idle": "IDLEIDLE001",
};

function seedWithYoutubeIds() {
  const db = seed();
  channel(db, A_OFF, WS_A, "Disconnected", false);
  video(db, "v-off", A_OFF);
  videoDay(db, "v-off", A_OFF, sept(4), { estimated_revenue_usd: 5000, views: 777 });
  video(db, "v-idle", A1); // known and listed, but no stored activity in the period
  for (const row of db.tables.videos) row.youtube_video_id = YT[row.id as string];
  return db;
}

const idsParam = (...keys: string[]) => `videoIds=${keys.map((key) => YT[key]).join(",")}`;

test("videoIds: a single id returns that video, with exactly the figures it has unfiltered", async () => {
  const db = seedWithYoutubeIds();
  const all = (await call(db, SEPT)).data;
  const one = (await call(db, `${SEPT}&${idsParam("v-small")}`)).data;
  assert.deepEqual(ids(one), ["v-small"]);
  assert.deepEqual(one.pagination, { limit: 50, offset: 0, total: 1, hasMore: false });
  assert.deepEqual(
    one.videos[0],
    byId(all, "v-small"),
    "revenue, RPM, shares and change unchanged",
  );
  assert.equal(one.videos[0].youtubeVideoId, "SMALLSMALL1");
  assert.equal(one.videos[0].revenueShare, 0.083333, "still a share of the whole channel total");
});

test("videoIds: several ids return those videos and nothing else", async () => {
  const db = seedWithYoutubeIds();
  const { data } = await call(db, `${SEPT}&${idsParam("v-zero", "v-big", "v-second")}`);
  assert.deepEqual(ids(data), ["v-big", "v-second", "v-zero"], "in the normal revenue order");
  assert.equal(data.pagination.total, 3);
  // Order in the request does not matter, and a repeated id is harmless.
  const shuffled = await call(db, `${SEPT}&${idsParam("v-second", "v-big", "v-zero", "v-big")}`);
  assert.deepEqual(shuffled.data, data);
});

test("videoIds: an id that does not exist, or has no stored activity, is simply absent", async () => {
  const db = seedWithYoutubeIds();
  const unknown = await call(db, `${SEPT}&videoIds=NOSUCHVID01`);
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.data.videos, []);
  assert.deepEqual(unknown.data.pagination, { limit: 50, offset: 0, total: 0, hasMore: false });

  const idle = await call(db, `${SEPT}&${idsParam("v-idle")}`);
  assert.deepEqual(idle.data.videos, [], "no row is manufactured for a video with no activity");

  const mixed = await call(db, `${SEPT}&videoIds=NOSUCHVID01,${YT["v-big"]},${YT["v-idle"]}`);
  assert.deepEqual(ids(mixed.data), ["v-big"]);
});

test("videoIds: another workspace's video id returns nothing, alone or mixed with own ids", async () => {
  const db = seedWithYoutubeIds();
  const foreign = await call(db, `${SEPT}&${idsParam("v-bravo")}`);
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.data.videos, []);
  assert.equal(foreign.data.pagination.total, 0);
  assert.ok(!JSON.stringify(foreign.data).includes("999"));
  // Indistinguishable from an id that does not exist at all.
  const missing = await call(db, `${SEPT}&videoIds=NOSUCHVID01`);
  assert.deepEqual(foreign.data, missing.data);

  const mixed = await call(db, `${SEPT}&${idsParam("v-bravo", "v-small")}`);
  assert.deepEqual(ids(mixed.data), ["v-small"]);

  // The owner of that video does get it.
  const owner = await call(db, `${SEPT}&${idsParam("v-bravo")}`, { as: WS_B });
  assert.deepEqual(ids(owner.data), ["v-bravo"]);
  // And cannot reach workspace A's videos the same way.
  const reverse = await call(db, `${SEPT}&${idsParam("v-big", "v-second")}`, { as: WS_B });
  assert.deepEqual(reverse.data.videos, []);
});

test("videoIds: a video on another channel of the same workspace is outside a channel-scoped request", async () => {
  const db = seedWithYoutubeIds();
  const scoped = await call(db, `${SEPT}&channelId=${A1}&${idsParam("v-second", "v-big")}`);
  assert.deepEqual(ids(scoped.data), ["v-big"], "v-second belongs to the other channel");
  assert.deepEqual(
    scoped.data.channels.map((c) => c.id),
    [A1],
  );

  const unscoped = await call(db, `${SEPT}&${idsParam("v-second", "v-big")}`);
  assert.deepEqual(ids(unscoped.data), ["v-big", "v-second"]);

  // A foreign channel id is still a 404 whatever ids are asked for.
  const foreignChannel = await call(db, `${SEPT}&channelId=${B1}&${idsParam("v-bravo")}`);
  assert.deepEqual(
    [foreignChannel.status, foreignChannel.body],
    [404, { error: "CHANNEL_NOT_FOUND" }],
  );
});

test("videoIds: a disconnected channel's video cannot be retrieved by its id", async () => {
  const db = seedWithYoutubeIds();
  const { data } = await call(db, `${SEPT}&${idsParam("v-off")}`);
  assert.deepEqual(data.videos, []);
  assert.ok(!JSON.stringify(data).includes("5000"));
  const scoped = await call(db, `${SEPT}&channelId=${A_OFF}&${idsParam("v-off")}`);
  assert.equal(scoped.status, 404);
});

test("videoIds: pagination runs over the matching videos only", async () => {
  const db = seedWithYoutubeIds();
  const filter = idsParam("v-big", "v-small", "v-gone", "v-zero", "v-bravo");
  const first = await call(db, `${SEPT}&${filter}&limit=2`);
  assert.deepEqual(ids(first.data), ["v-big", "v-small"]);
  assert.deepEqual(first.data.pagination, { limit: 2, offset: 0, total: 4, hasMore: true });
  const second = await call(db, `${SEPT}&${filter}&limit=2&offset=2`);
  assert.deepEqual(ids(second.data), ["v-gone", "v-zero"]);
  assert.deepEqual(second.data.pagination, { limit: 2, offset: 2, total: 4, hasMore: false });
  const past = await call(db, `${SEPT}&${filter}&limit=2&offset=4`);
  assert.deepEqual(past.data.videos, []);
  assert.equal(past.data.pagination.total, 4);
});

test("videoIds: sorting applies to the matching videos, with unknowns still last", async () => {
  const db = seedWithYoutubeIds();
  const filter = idsParam("v-unknown", "v-gone", "v-big", "v-partial");
  const order = async (query: string) => ids((await call(db, `${SEPT}&${filter}&${query}`)).data);
  assert.deepEqual(await order("sort=revenue"), ["v-big", "v-gone", "v-partial", "v-unknown"]);
  assert.deepEqual(await order("sort=revenue&direction=asc"), [
    "v-partial",
    "v-gone",
    "v-big",
    "v-unknown",
  ]);
  assert.deepEqual(await order("sort=views&direction=asc"), [
    "v-unknown",
    "v-partial",
    "v-gone",
    "v-big",
  ]);
  assert.deepEqual(await order("sort=rpm"), ["v-partial", "v-gone", "v-big", "v-unknown"]);
});

test("videoIds: malformed, empty and oversized lists are 422 and read nothing", async () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => `VID${String(i).padStart(8, "0")}`).join(",");
  const bad = [
    "videoIds=", // present but empty must not mean "everything"
    "videoIds=,",
    "videoIds=short",
    "videoIds=TOOLONGTOOLONG",
    `videoIds=${YT["v-big"]},`, // trailing comma = an empty id
    `videoIds=${YT["v-big"]},,${YT["v-small"]}`,
    "videoIds=BAD%20ID%20001", // spaces
    "videoIds=BADID%2F00001", // a slash
    "videoIds=aaaaaaaa-0000-4000-8000-000000000001", // an internal uuid is not a YouTube id
    `videoIds=${many(101)}`,
  ];
  for (const query of bad) {
    const db = seedWithYoutubeIds();
    const { status, body } = await call(db, `${SEPT}&${query}`);
    assert.deepEqual(
      [query.slice(0, 40), status, body],
      [query.slice(0, 40), 422, { error: "VALIDATION_ERROR" }],
    );
    assert.deepEqual(db.reads, [], `${query.slice(0, 40)} read nothing`);
  }
  // Exactly the maximum is accepted, and duplicates do not count against it.
  assert.equal((await call(seedWithYoutubeIds(), `${SEPT}&videoIds=${many(100)}`)).status, 200);
  const repeated = `${many(100)},${Array(50).fill(YT["v-big"]).join(",")},${YT["v-big"]}`;
  assert.equal(
    (await call(seedWithYoutubeIds(), `${SEPT}&videoIds=${repeated.split(",").slice(1).join(",")}`))
      .status,
    200,
  );
  assert.equal(parseRevenueVideosQuery(new URL("https://app.test/x"), "2026-10-10").videoIds, null);
  assert.deepEqual(
    parseRevenueVideosQuery(
      new URL(`https://app.test/x?videoIds=${YT["v-big"]},${YT["v-big"]}`),
      "2026-10-10",
    ).videoIds,
    [YT["v-big"]],
  );
});

test("videoIds: authentication still comes first, and the filter changes nothing else", async () => {
  const db = seedWithYoutubeIds();
  const out = await call(db, `${SEPT}&${idsParam("v-big")}`, { as: null });
  assert.deepEqual([out.status, out.body], [401, { error: "AUTH_REQUIRED" }]);
  assert.deepEqual(db.reads, []);

  const all = (await call(db, SEPT)).data;
  const filtered = (await call(db, `${SEPT}&${idsParam("v-big")}`)).data;
  // The channel-level picture is not narrowed by the filter: it still describes the channels.
  assert.deepEqual(filtered.attribution, all.attribution);
  assert.deepEqual(filtered.dataQuality, all.dataQuality);
  assert.deepEqual(filtered.channels, all.channels);
  assert.deepEqual(Object.keys(filtered), Object.keys(all), "no new top-level fields");
  // A spoofed workspace id alongside the filter is still ignored.
  const spoofed = await call(db, `${SEPT}&${idsParam("v-big")}&workspaceId=${WS_B}`);
  assert.deepEqual(spoofed.data, filtered);
});

test("videoIds: still a stored-data read — same five reads, no network, no deals", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error("network access is not allowed here");
  }) as typeof fetch;
  try {
    const db = seedWithYoutubeIds();
    deal(db, WS_A, "contracted", 5000);
    const { status, data } = await call(db, `${SEPT}&${idsParam("v-big", "v-small")}`);
    assert.equal(status, 200);
    assert.equal(data.pagination.total, 2);
    assert.deepEqual(calls, []);
    assert.equal(db.reads.length, 5);
    assert.ok(!db.reads.includes("deals"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("without videoIds the response is exactly what it was before the filter existed", async () => {
  const db = seedWithYoutubeIds();
  const { data } = await call(db, SEPT);
  assert.deepEqual(ids(data), [
    "v-big",
    "v-second",
    "v-small",
    "v-gone",
    "v-partial",
    "v-zero",
    "v-unknown",
  ]);
  assert.equal(data.pagination.total, 7);
});
