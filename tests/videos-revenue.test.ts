import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EMPTY_VIDEOS_REVENUE,
  VIDEOS_CHANGE_DAYS,
  VIDEOS_MAX_IDS_PER_REQUEST,
  VIDEOS_REVENUE_DAYS,
  describeVideosRevenue,
  mapVideosRevenuePage,
  mergeVideosRevenue,
  videoRevenueText,
  videosRevenueRequests,
} from "../src/lib/videos-revenue";
import { analyticsSummaryUrl } from "../src/lib/analytics-revenue";
import { dashboardRevenueUrls } from "../src/lib/dashboard-revenue";
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
} from "./helpers/revenue-fake-db";

// The Videos page's revenue is tested below the React layer, like the Dashboard's and the
// Analytics page's: the real canonical handler answers the exact URLs the page requests for a
// page of videos, and the page's own mapping turns the answers into what each row shows.

const NOW = new Date("2026-10-10T08:00:00Z");
const DAY_MS = 86_400_000;
const day = (offset: number) =>
  new Date(Date.parse("2026-10-07T00:00:00Z") - offset * DAY_MS).toISOString().slice(0, 10);
// The page identifies videos by their public YouTube ids.
const YT = {
  big: "BIGBIGBIG01",
  mid: "MIDMIDMID01",
  small: "SMALLSMALL1",
  flat: "FLATFLAT001",
  falling: "FALLINGFAL1",
  fresh: "FRESHFRESH1",
  zero: "ZEROZERO001",
  unknown: "UNKNOWNUNK1",
  partial: "PARTIALPAR1",
  idle: "IDLEIDLE001",
  gone: "GONEGONE001",
  second: "SECONDSEC01",
  bravo: "BRAVOBRAVO1",
  off: "OFFOFFOFF01",
};

async function ask(db: FakeDb, url: string, workspaceId: string | null = WS_A) {
  const response = await handleRevenueVideosRequest(new Request(`https://app.test${url}`), {
    getContext: async () => {
      if (!workspaceId)
        throw new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401 });
      return { client: db.clientFor(workspaceId), workspaceId };
    },
    now: () => NOW,
  });
  const body = (await response.json()) as { data?: RevenueVideosResponse; error?: string };
  return { status: response.status, body, data: body.data as RevenueVideosResponse };
}

/** Loads one page of the Videos list exactly as the page does: its requests, then its mapping. */
async function loadPage(db: FakeDb, channelId: string | null, ids: string[], workspaceId = WS_A) {
  const requests = videosRevenueRequests(channelId, ids);
  let page = EMPTY_VIDEOS_REVENUE;
  const asked: string[] = [];
  for (const request of requests) {
    asked.push(request.revenueUrl, request.changeUrl);
    const revenue = await ask(db, request.revenueUrl, workspaceId);
    const change = await ask(db, request.changeUrl, workspaceId);
    page = mergeVideosRevenue(page, mapVideosRevenuePage(revenue.data, change.data));
  }
  return { page, asked, requests };
}

function addVideo(
  db: FakeDb,
  key: keyof typeof YT,
  channelId: string,
  days: Array<[offset: number, revenue: number | null, views: number]>,
  status = "active",
) {
  video(db, `v-${key}`, channelId, { youtube_video_id: YT[key], status });
  for (const [offset, revenue, views] of days)
    videoDay(db, `v-${key}`, channelId, day(offset), { estimated_revenue_usd: revenue, views });
}

/** `count` consecutive days ending `from` days ago, each with the same revenue and views. */
const span = (
  from: number,
  count: number,
  revenue: number | null,
  views: number,
): Array<[number, number | null, number]> =>
  Array.from({ length: count }, (_, i) => [from + i, revenue, views]);

/**
 * Alpha's videos (offsets are days before 7 Oct 2026, the newest reported day):
 *   big      $2/day for 300 days; 100 views/day recently, 50/day the four weeks before  (+100%)
 *   mid      $1/day for 100 days; steady 40 views/day                                    (0%)
 *   small    $0.10/day for 56 days; 30 views/day recently, 20/day before                 (+50%)
 *   flat     $0.05/day for 56 days; steady 10 views/day                                  (0%)
 *   falling  $0.02/day for 56 days; 5 views/day recently, 20/day before                  (−75%)
 *   fresh    $0.50/day for the last 10 days only                                         (new)
 *   zero     a reported $0 on 20 days
 *   unknown  activity on 5 days, revenue never reported
 *   partial  $3 reported on 2 days, not reported on 3
 *   gone     $0.30/day for 30 days long ago — no longer listed on YouTube
 *   idle     known, but nothing stored
 */
function seed() {
  const db = new FakeDb();
  channel(db, A1, WS_A, "Alpha");
  channel(db, A2, WS_A, "Second");
  channel(db, A_OFF, WS_A, "Disconnected", false);
  channel(db, B1, WS_B, "Bravo");
  for (const id of [A1, A2, B1]) synced(db, id);
  for (let offset = 0; offset < 365; offset++) {
    channelDay(db, A1, day(offset), { estimated_revenue_usd: 5, views: 400 });
    channelDay(db, A2, day(offset), { estimated_revenue_usd: 1, views: 50 });
    channelDay(db, B1, day(offset), { estimated_revenue_usd: 999, views: 99999 });
  }
  addVideo(db, "big", A1, [
    ...span(0, 28, 2, 100),
    ...span(28, 28, 2, 50),
    ...span(56, 244, 2, 50),
  ]);
  addVideo(db, "mid", A1, span(0, 100, 1, 40));
  addVideo(db, "small", A1, [...span(0, 28, 0.1, 30), ...span(28, 28, 0.1, 20)]);
  addVideo(db, "flat", A1, span(0, 56, 0.05, 10));
  addVideo(db, "falling", A1, [...span(0, 28, 0.02, 5), ...span(28, 28, 0.02, 20)]);
  addVideo(db, "fresh", A1, span(0, 10, 0.5, 70));
  addVideo(db, "zero", A1, span(0, 20, 0, 8));
  addVideo(db, "unknown", A1, span(0, 5, null, 60));
  addVideo(db, "partial", A1, [...span(0, 2, 3, 10), ...span(2, 3, null, 10)]);
  addVideo(db, "gone", A1, span(200, 30, 0.3, 15), "deleted");
  video(db, "v-idle", A1, { youtube_video_id: YT.idle });
  addVideo(db, "second", A2, span(0, 28, 1, 50));
  addVideo(db, "bravo", B1, span(0, 28, 999, 99999));
  addVideo(db, "off", A_OFF, span(0, 28, 500, 500));
  return db;
}

const PAGE = [
  YT.big,
  YT.mid,
  YT.small,
  YT.flat,
  YT.falling,
  YT.fresh,
  YT.zero,
  YT.unknown,
  YT.partial,
  YT.gone,
  YT.idle,
];

// ---------- 9, 10. requests ----------

test("a page of videos is asked about in two requests naming exactly its ids — never one per video", () => {
  const requests = videosRevenueRequests(A1, PAGE);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].ids, PAGE);
  assert.equal(
    requests[0].revenueUrl,
    `/api/revenue/videos?days=365&limit=100&videoIds=${PAGE.join(",")}&channelId=${A1}`,
  );
  assert.equal(
    requests[0].changeUrl,
    `/api/revenue/videos?days=28&limit=100&videoIds=${PAGE.join(",")}&channelId=${A1}`,
  );
  assert.deepEqual(
    [VIDEOS_REVENUE_DAYS, VIDEOS_CHANGE_DAYS, VIDEOS_MAX_IDS_PER_REQUEST],
    [365, 28, 100],
  );
  // A full page of 50 is still a single pair of requests.
  const fifty = Array.from({ length: 50 }, (_, i) => `VID${String(i).padStart(8, "0")}`);
  assert.equal(videosRevenueRequests(A1, fifty).length, 1);
  assert.equal(videosRevenueRequests(A1, fifty)[0].ids.length, 50);
});

test("ids are de-duplicated, malformed ids are left out, and no ids means no request", () => {
  assert.deepEqual(videosRevenueRequests(A1, []), []);
  assert.deepEqual(
    videosRevenueRequests(A1, ["not-an-id", "", "aaaaaaaa-0000-4000-8000-000000000001"]),
    [],
  );
  const [request] = videosRevenueRequests(null, [YT.big, YT.big, "bad id", YT.mid]);
  assert.deepEqual(request.ids, [YT.big, YT.mid]);
  assert.ok(!request.revenueUrl.includes("channelId"));
  // Placeholder ids are only ever sent by the local demo preview.
  assert.deepEqual(videosRevenueRequests(null, ["demo-video-1"]), []);
  assert.deepEqual(videosRevenueRequests(null, ["demo-video-1"], { demoIds: true })[0].ids, [
    "demo-video-1",
  ]);
});

// ---------- 12. more than 100 videos ----------

test("more than 100 videos are split into full groups of at most 100 — none dropped, none repeated", () => {
  const many = Array.from({ length: 230 }, (_, i) => `VID${String(i).padStart(8, "0")}`);
  const requests = videosRevenueRequests(A1, many);
  assert.deepEqual(
    requests.map((request) => request.ids.length),
    [100, 100, 30],
  );
  assert.deepEqual(
    requests.flatMap((request) => request.ids),
    many,
  );
  for (const request of requests) {
    assert.equal(
      request.revenueUrl.split("videoIds=")[1].split("&")[0].split(",").length,
      request.ids.length,
    );
    assert.match(request.revenueUrl, /limit=100/);
  }
});

// ---------- 1. revenue column ----------

test("the Revenue column shows each video's canonical stored revenue", async () => {
  const db = seed();
  const { page, requests } = await loadPage(db, A1, PAGE);
  const canonical = (await ask(db, requests[0].revenueUrl)).data;
  for (const record of canonical.videos) {
    const cell = page.cells.get(record.youtubeVideoId!)!;
    assert.equal(
      cell.revenue.usd,
      record.revenue.usd,
      `${record.youtubeVideoId} matches its record`,
    );
    assert.equal(cell.knownDays, record.revenue.knownDays);
    assert.equal(cell.unknownDays, record.revenue.unknownDays);
  }
  assert.equal(videoRevenueText(page, YT.big), "$600", "300 stored days × $2");
  assert.equal(videoRevenueText(page, YT.mid), "$100");
  assert.equal(videoRevenueText(page, YT.small), "$5.60");
  assert.equal(videoRevenueText(page, YT.fresh), "$5.00");
  assert.equal(
    videoRevenueText(page, YT.gone),
    "$9.00",
    "history kept for a video no longer listed",
  );
  assert.equal(page.dataThrough, "2026-10-07");
});

// ---------- 2, 3, 4, 13. zero / unavailable / partial / nothing stored ----------

test("a reported $0 is $0; unreported revenue and a video with nothing stored are a dash", async () => {
  const { page } = await loadPage(seed(), A1, PAGE);

  const zero = page.cells.get(YT.zero)!;
  assert.equal(zero.revenue.text, "$0");
  assert.equal(zero.revenue.available, true);
  assert.equal(zero.revenue.partial, false);
  assert.deepEqual([zero.knownDays, zero.unknownDays], [20, 0]);

  const unknown = page.cells.get(YT.unknown)!;
  assert.equal(unknown.revenue.text, "—");
  assert.equal(unknown.revenue.usd, null);
  assert.equal(unknown.revenue.available, false, "stored activity, but revenue was not reported");
  assert.deepEqual([unknown.knownDays, unknown.unknownDays], [0, 5]);

  const partial = page.cells.get(YT.partial)!;
  assert.equal(partial.revenue.text, "$6.00", "the two reported days");
  assert.equal(partial.revenue.partial, true);
  assert.deepEqual([partial.knownDays, partial.unknownDays], [2, 3]);

  // Nothing stored at all: no cell, so the row shows a dash — no value is fabricated.
  assert.equal(page.cells.has(YT.idle), false);
  assert.equal(videoRevenueText(page, YT.idle), "—");
  assert.equal(videoRevenueText(page, "NOSUCHVID01"), "—");
  assert.equal(videoRevenueText(EMPTY_VIDEOS_REVENUE, YT.big), "—");
  // Only the genuinely reported zero prints "$0".
  const zeros = [...page.cells].filter(([, cell]) => cell.revenue.text === "$0").map(([id]) => id);
  assert.deepEqual(zeros, [YT.zero]);
});

// ---------- 5, 6. change ----------

test("the Change column is the canonical 28-day change in views, never recomputed", async () => {
  const db = seed();
  const { page, requests } = await loadPage(db, A1, PAGE);
  const recent = (await ask(db, requests[0].changeUrl)).data;
  assert.equal(recent.period.days, 28);
  assert.deepEqual(recent.previousPeriod, { startDate: "2026-08-13", endDate: "2026-09-09" });
  for (const record of recent.videos) {
    const cell = page.cells.get(record.youtubeVideoId!)!;
    if (record.change.views.percent !== null)
      assert.deepEqual(cell.change, { kind: "percent", percent: record.change.views.percent });
  }
  assert.deepEqual(page.cells.get(YT.big)!.change, { kind: "percent", percent: 100 });
  assert.deepEqual(page.cells.get(YT.small)!.change, { kind: "percent", percent: 50 });
  assert.deepEqual(page.cells.get(YT.flat)!.change, { kind: "percent", percent: 0 });
  assert.deepEqual(page.cells.get(YT.falling)!.change, { kind: "percent", percent: -75 });
});

test("no percentage is shown when there is no earlier period or no recent activity", async () => {
  const { page } = await loadPage(seed(), A1, PAGE);
  // Views now, none in the four weeks before: "New", exactly as the canonical null means.
  assert.deepEqual(page.cells.get(YT.fresh)!.change, { kind: "new" });
  assert.deepEqual(page.cells.get(YT.zero)!.change, { kind: "new" });
  // No activity in the last 28 days at all: nothing to say.
  assert.deepEqual(page.cells.get(YT.gone)!.change, { kind: "none" });
});

test("if the trend request fails, revenue still stands and no change is invented", async () => {
  const db = seed();
  const [request] = videosRevenueRequests(A1, PAGE);
  const page = mapVideosRevenuePage((await ask(db, request.revenueUrl)).data, null);
  assert.equal(videoRevenueText(page, YT.big), "$600");
  assert.ok([...page.cells.values()].every((cell) => cell.change.kind === "none"));
  assert.equal(page.cells.get(YT.big)!.status, "Top Performer");
  assert.equal(page.cells.get(YT.small)!.status, "Steady", "no trend, so not Growing");
});

// ---------- status ----------

test("Status keeps its rule, applied to canonical figures", async () => {
  const { page } = await loadPage(seed(), A1, PAGE);
  const status = (key: keyof typeof YT) => page.cells.get(YT[key])?.status ?? null;
  // Ten videos have stored activity; ranked by revenue: big, mid, gone, partial, small, fresh …
  assert.equal(status("big"), "Top Performer");
  assert.equal(status("mid"), "High Revenue", "top quarter (3 of 10) by revenue");
  assert.equal(status("gone"), "High Revenue");
  assert.equal(status("small"), "Growing", "+50% views");
  assert.equal(status("falling"), "Declining", "−75% views");
  assert.equal(status("flat"), "Steady");
  assert.equal(status("fresh"), "Steady", "new: no trend to call it growing");
  assert.equal(status("idle"), null, "nothing stored: no badge");
});

test("nothing is called High Revenue when no video on the page has earned anything", async () => {
  const db = seed();
  for (const row of db.tables.video_daily_stats) row.estimated_revenue_usd = 0;
  const { page } = await loadPage(db, A1, [YT.big, YT.mid, YT.small, YT.flat, YT.falling]);
  const labels = [...page.cells.values()].map((cell) => cell.status);
  assert.ok(!labels.includes("High Revenue"));
  assert.equal(page.cells.get(YT.big)!.status, "Top Performer", "ranked by views instead");
  assert.equal(page.cells.get(YT.falling)!.status, "Declining");
  assert.ok([...page.cells.values()].every((cell) => cell.revenue.text === "$0"));
});

// ---------- 14. listing state ----------

test("the canonical listing state is carried without calling anything deleted", async () => {
  const { page } = await loadPage(seed(), A1, PAGE);
  assert.equal(page.cells.get(YT.gone)!.currentlyListed, false);
  assert.equal(page.cells.get(YT.big)!.currentlyListed, true);
  assert.ok(!/deleted/i.test(JSON.stringify([...page.cells])));
  assert.ok(!/deleted/i.test(readFileSync("src/routes/videos.tsx", "utf8")));
});

// ---------- 11. pagination ----------

test("each newly loaded page is asked about on its own and merged with what is already shown", async () => {
  const db = seed();
  const first = await loadPage(db, A1, [YT.big, YT.mid, YT.small]);
  const second = await loadPage(db, A1, [YT.flat, YT.falling, YT.idle]);
  assert.equal(first.asked.length, 2);
  assert.equal(second.asked.length, 2);
  assert.ok(
    first.asked.every((url) => !url.includes(YT.flat)),
    "page 1 asks only about page 1",
  );
  assert.ok(
    second.asked.every((url) => !url.includes(YT.big)),
    "page 2 asks only about page 2",
  );

  const merged = mergeVideosRevenue(first.page, second.page);
  assert.deepEqual(
    [...merged.cells.keys()].sort(),
    [YT.big, YT.falling, YT.flat, YT.mid, YT.small].sort(),
  );
  assert.equal(videoRevenueText(merged, YT.big), "$600", "page 1's rows are untouched by page 2");
  assert.equal(videoRevenueText(merged, YT.flat), "$2.80");
  assert.equal(merged.dataThrough, "2026-10-07");
  // The figures do not depend on which other videos were on the page.
  const whole = await loadPage(db, A1, PAGE);
  for (const id of [YT.big, YT.mid, YT.small, YT.flat, YT.falling])
    assert.deepEqual(merged.cells.get(id)!.revenue, whole.page.cells.get(id)!.revenue);
  assert.deepEqual(mergeVideosRevenue(EMPTY_VIDEOS_REVENUE, first.page), first.page);
});

// ---------- 20. isolation ----------

test("revenue is scoped to the page's channel and never crosses workspaces", async () => {
  const db = seed();
  const mixed = [YT.big, YT.second, YT.bravo, YT.off, "NOSUCHVID01"];
  const alpha = await loadPage(db, A1, mixed);
  assert.deepEqual([...alpha.page.cells.keys()], [YT.big], "only the page's own channel's video");
  assert.ok(!JSON.stringify([...alpha.page.cells]).includes("999"));

  const second = await loadPage(db, A2, mixed);
  assert.deepEqual([...second.page.cells.keys()], [YT.second]);

  // A foreign, disconnected or unknown channel is the same 404.
  for (const channelId of [B1, A_OFF, "cccccccc-0000-4000-8000-000000000009"]) {
    const [request] = videosRevenueRequests(channelId, [YT.big]);
    const refused = await ask(db, request.revenueUrl);
    assert.deepEqual([refused.status, refused.body], [404, { error: "CHANNEL_NOT_FOUND" }]);
  }
  // Another workspace asking for these ids gets nothing; signed out gets 401.
  const [request] = videosRevenueRequests(null, [YT.big, YT.mid]);
  assert.deepEqual((await ask(db, request.revenueUrl, WS_B)).data.videos, []);
  assert.equal((await ask(db, request.revenueUrl, null)).status, 401);
});

// ---------- date range / freshness ----------

test("the note under the table says what the columns cover and how current they are", async () => {
  const { page } = await loadPage(seed(), A1, PAGE);
  assert.equal(
    describeVideosRevenue(page),
    "Revenue is estimated YouTube revenue for the last 365 days through Oct 7. " +
      "Change compares views in the last 28 days with the 28 before. " +
      "The most recent days can still change.",
  );
  assert.match(describeVideosRevenue(EMPTY_VIDEOS_REVENUE), /last 365 days\. Change compares/);
});

// ---------- 7, 8. CPM removed, RPM not added ----------

test("the Videos page has no CPM column and no RPM in its place", () => {
  const source = readFileSync("src/routes/videos.tsx", "utf8");
  assert.ok(!/cpm/i.test(source), "no CPM anywhere on the page");
  assert.ok(!/\brpm\b/i.test(source), "and no RPM was added");
  const headers = [...source.matchAll(/<th className="[^"]*">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headers, ["Video", "Views", "Revenue", "Likes", "Status", "Change"]);
  const moduleCode = readFileSync("src/lib/videos-revenue.ts", "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!/cpm|\brpm\b/i.test(moduleCode), "the mapping offers neither");
});

// ---------- 6, 16, 17. no live revenue on the page ----------

test("the Videos page reads no live revenue and asks the live route to skip its enrichment", () => {
  const source = readFileSync("src/routes/videos.tsx", "utf8");
  for (const forbidden of ["estimatedRevenue", "revenueAvailable", "changePercent", "formatMoney"])
    assert.ok(!source.includes(forbidden), `videos.tsx no longer mentions ${forbidden}`);
  // Both list requests (first page and "Load more") carry enrich=0.
  assert.match(source, /new URLSearchParams\(\{ limit: "50", enrich: "0" \}\)/);
  assert.match(source, /new URLSearchParams\(\{ pageToken: token, limit: "50", enrich: "0" \}\)/);
  // Revenue is requested for the page's own ids, scoped to the list's own channel.
  assert.match(
    source,
    /videosRevenueRequests\(data\.channel\.id, fresh, \{ demoIds: IS_LOCAL_DEMO \}\)/,
  );
  assert.match(source, /\.filter\(\(id\) => !revenueRequested\.current\.has\(id\)\)/);
  assert.match(source, /revenue=\{revenue\.page\.cells\.get\(video\.id\)\}/);
  // No arithmetic on revenue in the page: it prints the mapped text.
  assert.match(source, /\{revenue\.revenue\.text\}/);
  assert.ok(!/revenue\.usd\s*[*/+-]/.test(source));
});

// ---------- 15. list fields untouched ----------

test("title, thumbnail, views, likes, duration and the list's own sorting are unchanged", () => {
  const source = readFileSync("src/routes/videos.tsx", "utf8");
  assert.match(source, /fetch\(`\/api\/youtube\/videos\?\$\{params\.toString\(\)\}`/);
  assert.match(source, /\{video\.title\}/);
  assert.match(source, /<VideoThumbnail video=\{video\} \/>/);
  assert.match(source, /\{formatCount\(video\.views\)\}/);
  assert.match(source, /\{formatCount\(video\.likes\)\}/);
  assert.match(source, /video\.duration \? ` · \$\{video\.duration\}` : ""/);
  assert.match(source, /if \(sort === "views"\) return b\.views - a\.views;/);
  assert.match(source, /Load more videos/);
});

// ---------- 21. demo ----------

test("demo mode answers the page's canonical requests itself, with a coherent trend", () => {
  const demo = readFileSync("src/lib/demo-api.ts", "utf8");
  assert.match(demo, /"\/api\/revenue\/videos": demoRevenueVideos,/);
  assert.match(demo, /"\/api\/youtube\/videos": demoVideosList,/);
  assert.match(demo, /const viewTrend = \[22\.2, -4\.1, 12\.6, null\];/);
});

// ---------- 22. Dashboard and Analytics unchanged ----------

test("the Dashboard's and Analytics page's requests are unchanged", () => {
  assert.deepEqual(dashboardRevenueUrls(A1), {
    summary: `/api/revenue/summary?days=365&granularity=month&channelId=${A1}`,
    videos: `/api/revenue/videos?days=365&limit=5&sort=revenue&direction=desc&channelId=${A1}`,
  });
  assert.equal(
    analyticsSummaryUrl(A1),
    `/api/revenue/summary?days=365&granularity=month&channelId=${A1}`,
  );
  assert.match(
    readFileSync("src/routes/dashboard.tsx", "utf8"),
    /new URLSearchParams\(\{ revenue: "0" \}\)/,
  );
  assert.match(
    readFileSync("src/routes/analytics.tsx", "utf8"),
    /new URLSearchParams\(\{ range, videoRevenue: "0" \}\)/,
  );
});
