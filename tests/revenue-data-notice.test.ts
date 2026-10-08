import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runRoute } from "./helpers/live-youtube-stub";
import {
  dashboardRevenueUrls,
  mapDashboardRevenue,
  revenueDataNotice,
  revenueDataNoticeText,
  strongerRevenueDataNotice,
} from "../src/lib/dashboard-revenue";
import { analyticsSummaryUrl, mapAnalyticsRevenue } from "../src/lib/analytics-revenue";
import {
  EMPTY_VIDEOS_REVENUE,
  describeVideosRevenue,
  mapVideosRevenuePage,
  mergeVideosRevenue,
  videosRevenueRequests,
} from "../src/lib/videos-revenue";
import {
  YOUTUBE_SYNC_COMPLETE,
  YOUTUBE_SYNC_REAUTH,
  YOUTUBE_SYNC_WARNINGS,
  youtubeSyncToast,
} from "../src/lib/youtube-sync-toast";
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
  FakeDb,
  NOW,
  WS_A,
  channel,
  channelDay,
  synced,
  video,
  videoDay,
} from "./helpers/revenue-fake-db";

// The revenue-data sync (the one that fills the stored statistics the revenue figures are read
// from) has its own outcome, separate from the channel's sync status. The canonical revenue APIs
// already report it per channel in scope, together with any days that have nothing stored. These
// tests cover the consumers that word those two facts for the creator — and that nothing else
// about the sync changes.
//
// Dashboard, Analytics and Videos are exercised below the React layer: the real canonical
// handlers answer the exact URLs each page requests, and each page's own mapping words the note.

const SYNC_ERROR = "the latest update didn't complete";
const MISSING = "some data for this period is still unavailable";
const VIDEO_ID = "VIDEOVIDEO1";
const SECOND_VIDEO_ID = "VIDEOVIDEO2";
const DAY_MS = 86_400_000;
// NOW is 10 Oct 2026; YouTube has reported through 7 Oct by then.
const LAST_REPORTED = Date.parse("2026-10-07T00:00:00Z");
const dayBefore = (offset: number) =>
  new Date(LAST_REPORTED - offset * DAY_MS).toISOString().slice(0, 10);

interface ChannelSeed {
  /** The error the channel's most recent revenue-data sync recorded, if any. */
  lastError?: string | null;
  /** How many of the newest reported days have nothing stored. */
  missingNewestDays?: number;
}

/** Two connected channels in one workspace, each with a year of stored days and one video. */
function seed(alpha: ChannelSeed = {}, second: ChannelSeed = {}) {
  const db = new FakeDb();
  for (const [id, name, videoId, options] of [
    [A1, "Alpha", VIDEO_ID, alpha],
    [A2, "Second", SECOND_VIDEO_ID, second],
  ] as const) {
    channel(db, id, WS_A, name);
    synced(db, id, { last_error: options.lastError ?? null });
    video(db, `v-${id}`, id, { youtube_video_id: videoId });
    for (let offset = options.missingNewestDays ?? 0; offset < 365; offset++) {
      channelDay(db, id, dayBefore(offset), { estimated_revenue_usd: 2, views: 100 });
      if (offset < 40) videoDay(db, `v-${id}`, id, dayBefore(offset), { views: 50 });
    }
  }
  return db;
}

const context = (db: FakeDb) => async () => ({ client: db.clientFor(WS_A), workspaceId: WS_A });

async function summary(db: FakeDb, url: string) {
  const response = await handleRevenueSummaryRequest(new Request(`https://app.test${url}`), {
    getContext: context(db),
    canViewDeals: async () => true,
    now: () => NOW,
  });
  return ((await response.json()) as { data: RevenueSummaryResponse }).data;
}

async function videos(db: FakeDb, url: string) {
  const response = await handleRevenueVideosRequest(new Request(`https://app.test${url}`), {
    getContext: context(db),
    now: () => NOW,
  });
  return ((await response.json()) as { data: RevenueVideosResponse }).data;
}

/** The three notes exactly as each page produces them for one channel. */
async function notes(db: FakeDb, channelId: string | null, videoId = VIDEO_ID) {
  const dashboard = mapDashboardRevenue(
    await summary(db, dashboardRevenueUrls(channelId).summary),
  ).freshnessNote;
  const analytics = mapAnalyticsRevenue(await summary(db, analyticsSummaryUrl(channelId))).kpi
    .freshnessNote;
  let page = EMPTY_VIDEOS_REVENUE;
  for (const request of videosRevenueRequests(channelId, [videoId]))
    page = mergeVideosRevenue(
      page,
      mapVideosRevenuePage(
        await videos(db, request.revenueUrl),
        await videos(db, request.changeUrl),
      ),
    );
  return { dashboard, analytics, videos: describeVideosRevenue(page), page };
}

const HEALTHY_NOTE =
  "Estimated YouTube revenue through Oct 7 · the most recent days can still change";
const HEALTHY_VIDEOS_NOTE =
  "Revenue is estimated YouTube revenue for the last 365 days through Oct 7. " +
  "Change compares views in the last 28 days with the 28 before. " +
  "The most recent days can still change.";

// ---------- Settings: the "Sync now" toast ----------

test("Settings: a clean sync with a completed revenue-data sync keeps the success message", () => {
  const complete = { status: "success", revenueData: { status: "complete" } };
  assert.deepEqual(youtubeSyncToast(complete), { kind: "success", message: YOUTUBE_SYNC_COMPLETE });
  assert.equal(YOUTUBE_SYNC_COMPLETE, "YouTube sync complete");
  // "paused" is the revenue-data sync stopping at its request budget to resume next run — not a
  // problem. A response without the field (older servers) is not one either.
  for (const revenueData of [{ status: "paused" }, null, undefined])
    assert.equal(
      youtubeSyncToast({ status: "success", revenueData }).message,
      YOUTUBE_SYNC_COMPLETE,
    );
});

test("Settings: a failed revenue-data sync is a warning, and never an authorization message", () => {
  const toast = youtubeSyncToast({ status: "success", revenueData: { status: "failed" } });
  assert.deepEqual(toast, { kind: "success", message: YOUTUBE_SYNC_WARNINGS });
  assert.equal(toast.message, "YouTube sync completed with warnings");
  assert.doesNotMatch(toast.message, /authoriz|reconnect|renew/i);
  // A partly failed channel sync is the warning it always was, whatever the revenue-data sync did.
  for (const revenueData of [{ status: "complete" }, { status: "failed" }, null])
    assert.equal(
      youtubeSyncToast({ status: "partial", revenueData }).message,
      YOUTUBE_SYNC_WARNINGS,
    );
});

test("Settings: a genuine reauthorization result keeps its own error message", () => {
  assert.deepEqual(youtubeSyncToast({ status: "reauth_required", revenueData: null }), {
    kind: "error",
    message: YOUTUBE_SYNC_REAUTH,
  });
  assert.equal(YOUTUBE_SYNC_REAUTH, "YouTube authorization needs to be renewed before syncing.");
  // Still that message even if a revenue-data result were attached.
  assert.equal(
    youtubeSyncToast({ status: "reauth_required", revenueData: { status: "failed" } }).message,
    YOUTUBE_SYNC_REAUTH,
  );
});

test("Settings uses that mapping and nothing else to word the toast", () => {
  const source = readFileSync(new URL("../src/routes/settings.tsx", import.meta.url), "utf8");
  assert.match(source, /const result = youtubeSyncToast\(body\);/);
  assert.doesNotMatch(source, /"YouTube sync complete"|"YouTube sync completed with warnings"/);
});

// ---------- Dashboard / Analytics / Videos: the freshness note ----------

test("no sync error and no missing days: every note is worded exactly as before", async () => {
  const result = await notes(seed(), A1);
  assert.equal(result.dashboard, HEALTHY_NOTE);
  assert.equal(result.analytics, HEALTHY_NOTE);
  assert.equal(result.videos, HEALTHY_VIDEOS_NOTE);
  assert.equal(result.page.notice, null);
});

test("a failed latest update is said on all three pages, with the date kept", async () => {
  const result = await notes(seed({ lastError: "YOUTUBE_ANALYTICS_QUERY_FAILED:401" }), A1);
  assert.equal(result.dashboard, `${HEALTHY_NOTE} · ${SYNC_ERROR}`);
  assert.equal(result.analytics, `${HEALTHY_NOTE} · ${SYNC_ERROR}`);
  assert.equal(result.videos, `${HEALTHY_VIDEOS_NOTE} The latest update didn't complete.`);
  for (const note of Object.values({ ...result, page: "" }))
    assert.doesNotMatch(
      String(note),
      /401|YOUTUBE_|reconnect|authoriz/i,
      "no raw error, no reauth",
    );
});

test("missing days without a sync error are called incomplete data, not a failed update", async () => {
  const result = await notes(seed({ missingNewestDays: 2 }), A1);
  assert.equal(
    result.dashboard,
    `Estimated YouTube revenue through Oct 5 · the most recent days can still change · ${MISSING}`,
  );
  assert.equal(result.analytics, result.dashboard);
  assert.match(
    result.videos,
    /through Oct 5\. .* Some data for this period is still unavailable\.$/,
  );
  for (const note of [result.dashboard, result.analytics, result.videos])
    assert.doesNotMatch(note, /didn't complete|failed|error/i);
});

test("a sync error together with missing days gives one notice, not two", async () => {
  const result = await notes(
    seed({ lastError: "YOUTUBE_PLAYLISTITEMS_FAILED:401", missingNewestDays: 2 }),
    A1,
  );
  assert.match(result.dashboard, /through Oct 5 .* · the latest update didn't complete$/);
  for (const note of [result.dashboard, result.analytics, result.videos]) {
    assert.equal(note.match(/the latest update didn't complete/gi)?.length, 1);
    assert.doesNotMatch(note, /still unavailable/i);
  }
});

test("a problem on one channel never appears while another channel is viewed", async () => {
  const db = seed({ lastError: "YOUTUBE_ANALYTICS_QUERY_FAILED:401", missingNewestDays: 3 });
  const healthy = await notes(db, A2, SECOND_VIDEO_ID);
  assert.equal(healthy.dashboard, HEALTHY_NOTE);
  assert.equal(healthy.analytics, HEALTHY_NOTE);
  assert.equal(healthy.videos, HEALTHY_VIDEOS_NOTE);
  // …and the affected channel still says so.
  assert.match((await notes(db, A1)).dashboard, /didn't complete$/);
});

test("a channel with nothing stored yet stays the plain empty state unless its update failed", async () => {
  const unsynced = new FakeDb();
  channel(unsynced, A1, WS_A, "Alpha");
  const url = dashboardRevenueUrls(A1).summary;
  assert.equal(mapDashboardRevenue(await summary(unsynced, url)).freshnessNote, "");
  synced(unsynced, A1, { last_error: "YOUTUBE_ANALYTICS_QUERY_FAILED:401", stats_synced_at: null });
  const failed = mapDashboardRevenue(await summary(unsynced, url));
  assert.equal(failed.state, "empty");
  assert.equal(failed.freshnessNote, "The latest update didn't complete");
});

test("the notice is decided only from what the canonical response reports", () => {
  const quality = (hasSyncError: boolean[], missingDays: string[]) => ({
    freshness: { missingDays },
    sync: hasSyncError.map((value) => ({ hasSyncError: value })),
  });
  assert.equal(revenueDataNotice(quality([false], [])), null);
  assert.equal(revenueDataNotice(quality([], [])), null);
  assert.equal(revenueDataNotice(quality([false, true], [])), "sync_error");
  assert.equal(revenueDataNotice(quality([false], ["2026-10-07"])), "missing_days");
  assert.equal(revenueDataNotice(quality([true], ["2026-10-07"])), "sync_error");
  assert.equal(revenueDataNoticeText(null), "");
  assert.equal(revenueDataNoticeText("sync_error"), SYNC_ERROR);
  assert.equal(revenueDataNoticeText("missing_days"), MISSING);
  assert.equal(
    revenueDataNoticeText("missing_days", { sentence: true }),
    "Some data for this period is still unavailable.",
  );
  // Combining pages of the Videos list keeps the more specific notice.
  assert.equal(strongerRevenueDataNotice(null, null), null);
  assert.equal(strongerRevenueDataNotice(null, "missing_days"), "missing_days");
  assert.equal(strongerRevenueDataNotice("missing_days", "sync_error"), "sync_error");
  assert.equal(strongerRevenueDataNotice("sync_error", null), "sync_error");
});

// ---------- the sync itself is unchanged ----------

const sync = await import("../src/routes/api.youtube.sync");

test("a failed revenue-data sync leaves the channel's sync status alone and is reported separately", async () => {
  // The channel sync asks for the uploads playlist once and succeeds; the revenue-data sync that
  // follows asks again and is refused. (500, so no token refresh is involved at all.)
  const run = await runRoute(sync, "POST", "/api/youtube/sync", {
    api: ({ resource, attempt }) => (resource === "playlistItems" && attempt > 1 ? 500 : undefined),
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.status, "success", "the channel sync's own outcome");
  const revenueData = run.body.revenueData as { status: string; error: string | null };
  assert.equal(revenueData.status, "failed");
  assert.match(revenueData.error ?? "", /YOUTUBE_PLAYLISTITEMS_FAILED:500/);
  assert.deepEqual(run.syncStatuses, ["syncing", "success"], "nothing downgraded it afterwards");
  assert.deepEqual(run.connectionStatuses, []);
  // The failure is recorded where it belongs: on the revenue-data sync's own state.
  const stateWrites = run.writes.filter((write) => write.table === "youtube_sync_state");
  assert.ok(
    stateWrites.some((write) =>
      /YOUTUBE_PLAYLISTITEMS_FAILED:500/.test(JSON.stringify(write.body)),
    ),
  );
  assert.equal(youtubeSyncToast(run.body).message, YOUTUBE_SYNC_WARNINGS);
});

test("when both parts succeed the response says so in both places", async () => {
  const run = await runRoute(sync, "POST", "/api/youtube/sync");
  assert.equal(run.body.status, "success");
  assert.notEqual((run.body.revenueData as { status: string }).status, "failed");
  assert.deepEqual(run.syncStatuses, ["syncing", "success"]);
  assert.equal(youtubeSyncToast(run.body).message, YOUTUBE_SYNC_COMPLETE);
});
