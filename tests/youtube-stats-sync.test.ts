import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_STATS_SYNC_CONFIG,
  EMPTY_SYNC_STATE,
  RequestBudget,
  STATS_CURRENCY,
  addDays,
  isEmptyStats,
  parseStatsRows,
  reconcileDay,
  runChannelSync,
  runSyncBatch,
  splitDateRange,
  syncCatalogue,
  syncChannelStats,
  type AnalyticsRequest,
  type CatalogueVideo,
  type ChannelSyncContext,
  type DailyStats,
  type StatsSyncApi,
  type StatsSyncConfig,
  type StatsSyncStore,
  type StoredVideo,
  type SyncState,
  type VideoDailyStats,
} from "../src/lib/server/youtube-stats-sync";
import { createStatsSyncApi } from "../src/lib/server/youtube-stats-store";

// ============================================================
// In-memory model of the database
// ============================================================

class FakeStore implements StatsSyncStore {
  states = new Map<string, SyncState>();
  videos = new Map<
    string,
    StoredVideo & { channelId: string; seenAt: string | null; title: string }
  >();
  channelDays = new Map<string, DailyStats & { fetchedAt: string }>();
  videoDays = new Map<string, VideoDailyStats & { fetchedAt: string }>();
  private nextId = 1;

  async getState(channelId: string) {
    return { ...(this.states.get(channelId) ?? EMPTY_SYNC_STATE) };
  }
  async saveState(channelId: string, patch: Partial<SyncState>) {
    this.states.set(channelId, { ...(this.states.get(channelId) ?? EMPTY_SYNC_STATE), ...patch });
  }
  async listVideos(channelId: string) {
    return [...this.videos.values()]
      .filter((v) => v.channelId === channelId)
      .map(({ id, youtubeVideoId, publishedAt, status, analyticsUpdatedAt }) => ({
        id,
        youtubeVideoId,
        publishedAt,
        status,
        analyticsUpdatedAt,
      }));
  }
  async upsertCatalogueVideos(channelId: string, videos: CatalogueVideo[], seenAt: string) {
    for (const video of videos) {
      const key = `${channelId}:${video.youtubeVideoId}`;
      const existing = this.videos.get(key);
      this.videos.set(key, {
        id: existing?.id ?? `v${this.nextId++}`,
        channelId,
        youtubeVideoId: video.youtubeVideoId,
        title: video.title,
        publishedAt: video.publishedAt,
        status: video.privacyStatus === "private" ? "archived" : "active",
        analyticsUpdatedAt: existing?.analyticsUpdatedAt ?? null,
        seenAt,
      });
    }
  }
  async listVideosNotSeenSince(channelId: string, passStartedAt: string) {
    return [...this.videos.values()]
      .filter((video) => video.channelId === channelId && video.status !== "deleted")
      .filter((video) => video.seenAt === null || video.seenAt < passStartedAt)
      .map((video) => video.youtubeVideoId);
  }
  async markVideosDeleted(channelId: string, youtubeVideoIds: string[]) {
    let count = 0;
    for (const video of this.videos.values()) {
      if (video.channelId !== channelId || video.status === "deleted") continue;
      if (youtubeVideoIds.includes(video.youtubeVideoId)) {
        video.status = "deleted";
        count += 1;
      }
    }
    return count;
  }
  async upsertChannelDays(channelId: string, rows: DailyStats[], fetchedAt: string) {
    for (const row of rows) this.channelDays.set(`${channelId}:${row.day}`, { ...row, fetchedAt });
  }
  async replaceVideoDays(
    _channelId: string,
    videoIds: string[],
    startDate: string,
    endDate: string,
    rows: VideoDailyStats[],
    fetchedAt: string,
  ) {
    for (const row of rows) this.videoDays.set(`${row.videoId}:${row.day}`, { ...row, fetchedAt });
    for (const [key, row] of this.videoDays) {
      if (
        videoIds.includes(row.videoId) &&
        row.day >= startDate &&
        row.day <= endDate &&
        row.fetchedAt < fetchedAt
      )
        this.videoDays.delete(key);
    }
  }
  async markVideosSynced(videoIds: string[], at: string) {
    for (const video of this.videos.values()) {
      if (videoIds.includes(video.id)) video.analyticsUpdatedAt = at;
    }
  }

  video(youtubeVideoId: string) {
    return [...this.videos.values()].find((v) => v.youtubeVideoId === youtubeVideoId)!;
  }
  rowsFor(youtubeVideoId: string) {
    const id = this.video(youtubeVideoId).id;
    return [...this.videoDays.values()]
      .filter((r) => r.videoId === id)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
}

// ============================================================
// In-memory model of YouTube
// ============================================================

type Cell = { views: number; minutes: number; revenue: number };

class FakeYoutube implements StatsSyncApi {
  /** Videos currently on the channel, newest first. */
  catalogue: CatalogueVideo[] = [];
  pageSize = 2;
  /** youtubeVideoId -> day -> cell */
  activity = new Map<string, Map<string, Cell>>();
  /** Channel-level activity belonging to videos that no longer exist. */
  deletedVideoActivity = new Map<string, Cell>();
  requests: AnalyticsRequest[] = [];
  pagesListed = 0;
  revenueForbidden = false;
  /** "ok" | "rejected" (HTTP 400) | "truncated" (silently drops the last day of every video) */
  fastPath: "ok" | "rejected" | "truncated" = "ok";
  /** Throw a server error on the Nth analytics request (1-based), once. */
  failOnRequest: number | null = null;

  addVideo(id: string, publishedAt: string, privacyStatus = "public") {
    this.catalogue.unshift({
      youtubeVideoId: id,
      title: `Video ${id}`,
      description: null,
      thumbnail: null,
      publishedAt: `${publishedAt}T12:00:00Z`,
      durationSeconds: 300,
      privacyStatus,
    });
  }
  /** Real YouTube rounds watch minutes per day, so a period total differs from the sum of its
   * days. Non-zero here reproduces that in the per-video totals. */
  minutesRoundingDrift = 0;

  set(id: string, day: string, views: number, revenue = 0) {
    if (!this.activity.has(id)) this.activity.set(id, new Map());
    this.activity.get(id)!.set(day, { views, minutes: views * 2, revenue });
  }

  /** Videos that still exist on YouTube but that the uploads playlist does not list. */
  existsButNotListed: CatalogueVideo[] = [];
  /** Every direct id lookup made, one entry per request. */
  lookups: string[][] = [];
  /** "ok" | "error" (every lookup fails) | a number N (the Nth lookup fails, 1-based). */
  lookupFailure: "ok" | "error" | number = "ok";
  /** When true the playlist request itself fails, as it does for a channel with no playlist id. */
  playlistMissing = false;

  async lookupVideos(youtubeVideoIds: string[]) {
    this.lookups.push([...youtubeVideoIds]);
    if (this.lookupFailure === "error" || this.lookupFailure === this.lookups.length)
      throw new Error("YOUTUBE_VIDEOS_FAILED:503");
    return [...this.catalogue, ...this.existsButNotListed].filter((video) =>
      youtubeVideoIds.includes(video.youtubeVideoId),
    );
  }

  async listUploadsPage(pageToken: string | null) {
    if (this.playlistMissing) throw new Error("YOUTUBE_UPLOADS_PLAYLIST_MISSING");
    this.pagesListed += 1;
    const start = pageToken ? Number(pageToken) : 0;
    if (Number.isNaN(start)) throw new Error("YOUTUBE_PLAYLISTITEMS_FAILED:400");
    const slice = this.catalogue.slice(start, start + this.pageSize);
    const next =
      start + this.pageSize < this.catalogue.length ? String(start + this.pageSize) : null;
    return { videos: slice, listedIds: slice.map((v) => v.youtubeVideoId), nextPageToken: next };
  }

  private row(dims: Array<string | number>, cell: Cell, withRevenue: boolean) {
    return [
      ...dims,
      cell.views,
      cell.minutes,
      60,
      50,
      0,
      0,
      0,
      0,
      0,
      ...(withRevenue ? [cell.revenue, cell.revenue, 0] : []),
    ];
  }
  private headers(dims: string[], withRevenue: boolean) {
    return [
      ...dims,
      "views",
      "estimatedMinutesWatched",
      "averageViewDuration",
      "averageViewPercentage",
      "likes",
      "comments",
      "shares",
      "subscribersGained",
      "subscribersLost",
      ...(withRevenue
        ? ["estimatedRevenue", "estimatedAdRevenue", "estimatedRedPartnerRevenue"]
        : []),
    ].map((name) => ({ name }));
  }

  async queryAnalytics(request: AnalyticsRequest) {
    this.requests.push(request);
    if (this.failOnRequest === this.requests.length) {
      this.failOnRequest = null;
      throw new Error("YOUTUBE_ANALYTICS_QUERY_FAILED:500");
    }
    const withRevenue = request.metrics.includes("estimatedRevenue");
    if (withRevenue && this.revenueForbidden) throw new Error("YOUTUBE_ANALYTICS_QUERY_FAILED:403");
    const dims = request.dimensions ?? [];
    const ids = request.filters?.startsWith("video==") ? request.filters.slice(7).split(",") : null;
    const live = new Set(this.catalogue.map((v) => v.youtubeVideoId));
    const inRange = (day: string) => day >= request.startDate && day <= request.endDate;
    const days = splitDateRange(request.startDate, request.endDate, 1).map((r) => r.startDate);

    if (dims.join(",") === "day" && !ids) {
      // Channel totals: every video ever, including ones that no longer exist.
      const rows = days.map((day) => {
        const cell = { views: 0, minutes: 0, revenue: 0 };
        const add = (c: Cell | undefined) => {
          if (!c) return;
          cell.views += c.views;
          cell.minutes += c.minutes;
          cell.revenue += c.revenue;
        };
        for (const perDay of this.activity.values()) add(perDay.get(day));
        add(this.deletedVideoActivity.get(day));
        return this.row([day], cell, withRevenue);
      });
      return { columnHeaders: this.headers(["day"], withRevenue), rows };
    }

    if (dims.join(",") === "day" && ids) {
      // Documented shape: one video, dense days.
      assert.equal(ids.length, 1, "documented per-video query must name exactly one video");
      const perDay = live.has(ids[0]) ? this.activity.get(ids[0]) : undefined;
      const rows = days.map((day) =>
        this.row([day], perDay?.get(day) ?? { views: 0, minutes: 0, revenue: 0 }, withRevenue),
      );
      return { columnHeaders: this.headers(["day"], withRevenue), rows };
    }

    if (dims.join(",") === "day,video" && ids) {
      if (this.fastPath === "rejected") throw new Error("YOUTUBE_ANALYTICS_QUERY_FAILED:400");
      const rows: Array<Array<string | number>> = [];
      for (const id of ids) {
        if (!live.has(id)) continue; // videos that no longer exist are silently omitted
        const entries = [...(this.activity.get(id) ?? [])].filter(([day]) => inRange(day)).sort();
        const kept = this.fastPath === "truncated" ? entries.slice(0, -1) : entries;
        for (const [day, cell] of kept) rows.push(this.row([day, id], cell, withRevenue));
      }
      return { columnHeaders: this.headers(["day", "video"], withRevenue), rows };
    }

    if (dims.join(",") === "video" && ids) {
      if (this.fastPath === "rejected") throw new Error("YOUTUBE_ANALYTICS_QUERY_FAILED:400");
      const rows = ids
        .filter((id) => live.has(id))
        .map((id) => {
          const cell = { views: 0, minutes: 0, revenue: 0 };
          for (const [day, c] of this.activity.get(id) ?? []) {
            if (!inRange(day)) continue;
            cell.views += c.views;
            cell.minutes += c.minutes;
          }
          return [id, cell.views, cell.minutes + this.minutesRoundingDrift];
        });
      return {
        columnHeaders: [{ name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" }],
        rows,
      };
    }

    // The unfiltered per-video report must never be used for ingestion.
    throw new Error(
      `unexpected analytics query: dims=${dims.join(",")} filters=${request.filters}`,
    );
  }
}

const CHANNEL = "channel-1";
const NOW = new Date("2026-10-10T08:00:00Z");
const TODAY = "2026-10-10";

function context(
  store: FakeStore,
  api: StatsSyncApi,
  options: {
    now?: Date;
    budget?: number;
    config?: Partial<StatsSyncConfig>;
    channelId?: string;
  } = {},
): ChannelSyncContext {
  const config = { ...DEFAULT_STATS_SYNC_CONFIG, maxHistoryDays: 90, ...options.config };
  return {
    channelId: options.channelId ?? CHANNEL,
    api,
    store,
    config,
    budget: new RequestBudget(options.budget ?? 1000),
    now: options.now ?? NOW,
  };
}

function seedChannel() {
  const youtube = new FakeYoutube();
  youtube.addVideo("aaa", "2026-09-01");
  youtube.addVideo("bbb", "2026-09-20");
  youtube.addVideo("ccc", "2026-10-05");
  youtube.set("aaa", "2026-09-02", 100, 1.5);
  youtube.set("aaa", "2026-10-06", 40, 0.25);
  youtube.set("bbb", "2026-09-21", 10, 0);
  youtube.set("bbb", "2026-10-06", 5, 0.05);
  youtube.set("ccc", "2026-10-06", 7, 0);
  return youtube;
}

// ============================================================
// Catalogue
// ============================================================

test("catalogue: a first sync pages through the whole uploads playlist", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  for (let i = 1; i <= 7; i++) youtube.addVideo(`vid${i}`, `2026-09-0${i}`);

  const result = await syncCatalogue(context(store, youtube));

  assert.equal(result.mode, "full");
  assert.equal(result.status, "complete");
  assert.equal(result.pages, 4, "7 videos at 2 per page is 4 pages");
  assert.equal(store.videos.size, 7);
  const state = await store.getState(CHANNEL);
  assert.equal(state.catalogueFullSyncedAt, NOW.toISOString());
  assert.equal(state.cataloguePageToken, null);
});

test("catalogue: an incremental sync stops at the first page with nothing new", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  for (let i = 1; i <= 9; i++) youtube.addVideo(`vid${i}`, `2026-09-0${i}`);
  await syncCatalogue(context(store, youtube));
  youtube.pagesListed = 0;

  youtube.addVideo("fresh", "2026-10-09");
  const nextDay = new Date("2026-10-11T08:00:00Z");
  const result = await syncCatalogue(context(store, youtube, { now: nextDay }));

  assert.equal(result.mode, "incremental");
  assert.equal(result.newVideos, 1);
  assert.equal(
    youtube.pagesListed,
    2,
    "page 1 had a new video, page 2 had none, so it stops there",
  );
  assert.equal(store.videos.size, 10);
});

test("catalogue: running it twice does not duplicate videos or lose their internal ids", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await syncCatalogue(context(store, youtube));
  const idBefore = store.video("aaa").id;

  await syncCatalogue(context(store, youtube, { now: new Date("2026-10-10T09:00:00Z") }));

  assert.equal(store.videos.size, 3);
  assert.equal(store.video("aaa").id, idBefore);
});

test("catalogue: a video that disappears is marked deleted but kept, and restored if it returns", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));
  assert.ok(store.rowsFor("bbb").length > 0);

  const removed = youtube.catalogue.find((v) => v.youtubeVideoId === "bbb")!;
  youtube.catalogue = youtube.catalogue.filter((v) => v !== removed);
  const weekLater = new Date("2026-10-18T08:00:00Z");
  const result = await syncCatalogue(context(store, youtube, { now: weekLater }));

  assert.equal(result.mode, "full");
  assert.equal(result.markedDeleted, 1);
  assert.equal(store.video("bbb").status, "deleted");
  assert.equal(store.videos.size, 3, "the row is kept");
  assert.ok(store.rowsFor("bbb").length > 0, "its history is kept");

  youtube.catalogue.push(removed);
  await syncCatalogue(context(store, youtube, { now: new Date("2026-10-26T08:00:00Z") }));
  assert.equal(store.video("bbb").status, "active");
});

test("catalogue: an interrupted full pass resumes from its stored page and deletes nothing early", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  for (let i = 1; i <= 6; i++) youtube.addVideo(`vid${i}`, `2026-09-0${i}`);
  await syncCatalogue(context(store, youtube));
  // vid1 (oldest, last page) is removed; a weekly full pass starts but runs out of budget first.
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid1");
  const weekLater = new Date("2026-10-18T08:00:00Z");

  const first = await syncCatalogue(context(store, youtube, { now: weekLater, budget: 2 }));
  assert.equal(first.status, "paused");
  assert.equal(first.pages, 1);
  assert.equal(store.video("vid1").status, "active", "nothing is concluded before the pass ends");
  assert.equal((await store.getState(CHANNEL)).cataloguePageToken, "2");

  const second = await syncCatalogue(
    context(store, youtube, { now: new Date("2026-10-18T09:00:00Z") }),
  );
  assert.equal(second.status, "complete");
  assert.equal(second.pages, 2, "it continued from page 2, not from the beginning");
  assert.equal(store.video("vid1").status, "deleted");
  assert.equal(store.video("vid6").status, "active", "videos seen before the pause are not lost");
});

test("catalogue: private uploads are stored as archived, not dropped", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  youtube.addVideo("pub", "2026-09-01");
  youtube.addVideo("priv", "2026-09-02", "private");
  youtube.addVideo("unl", "2026-09-03", "unlisted");
  await syncCatalogue(context(store, youtube));
  assert.equal(store.video("priv").status, "archived");
  assert.equal(store.video("unl").status, "active");
});

// ------------------------------------------------------------
// Deletion safety: absence from the uploads playlist is never enough on its own. A known video
// becomes 'deleted' only after a completed pass AND a direct lookup that does not return it.
// ------------------------------------------------------------

const WEEK_LATER = new Date("2026-10-18T08:00:00Z");

async function syncedChannel(videoCount: number) {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  for (let i = 1; i <= videoCount; i++)
    youtube.addVideo(`vid${i}`, `2026-09-${String(((i - 1) % 28) + 1).padStart(2, "0")}`);
  await syncCatalogue(context(store, youtube));
  youtube.lookups = [];
  youtube.pagesListed = 0;
  return { store, youtube };
}

const statuses = (store: FakeStore) =>
  Object.fromEntries([...store.videos.values()].map((v) => [v.youtubeVideoId, v.status]));

test("deletion safety: an empty uploads playlist alone marks nothing — every known video is looked up first", async () => {
  const { store, youtube } = await syncedChannel(3);
  // The playlist comes back empty, but all three videos still exist on YouTube.
  youtube.existsButNotListed = youtube.catalogue;
  youtube.catalogue = [];

  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(result.status, "complete");
  assert.equal(result.videosSeen, 0, "the playlist really did list nothing");
  assert.deepEqual(
    youtube.lookups.map((ids) => [...ids].sort()),
    [["vid1", "vid2", "vid3"]],
    "all three were confirmed directly before any conclusion",
  );
  assert.equal(result.absentChecked, 3);
  assert.equal(result.stillAvailable, 3);
  assert.equal(result.markedDeleted, 0);
  assert.deepEqual(statuses(store), { vid1: "active", vid2: "active", vid3: "active" });
});

test("deletion safety: a missing uploads playlist id is an error, not an empty catalogue", async () => {
  const { store, youtube } = await syncedChannel(3);
  youtube.playlistMissing = true;

  const result = await runChannelSync(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /YOUTUBE_UPLOADS_PLAYLIST_MISSING/);
  assert.equal(result.stats, null, "stats are not attempted on an unfinished catalogue");
  assert.deepEqual(statuses(store), { vid1: "active", vid2: "active", vid3: "active" });
  assert.deepEqual(youtube.lookups, [], "it never got as far as asking whether anything is gone");
  const state = await store.getState(CHANNEL);
  assert.ok(state.cataloguePassStartedAt, "the pass is left open, not recorded as completed");
  assert.equal(state.catalogueFullSyncedAt, NOW.toISOString(), "still the earlier full pass");
  assert.match(state.lastError ?? "", /YOUTUBE_UPLOADS_PLAYLIST_MISSING/);

  // Once the playlist is known again the same pass completes normally.
  youtube.playlistMissing = false;
  const retry = await runChannelSync(
    context(store, youtube, { now: new Date("2026-10-19T08:00:00Z") }),
  );
  assert.equal(retry.status, "complete");
  assert.equal(retry.catalogue?.markedDeleted, 0);
  assert.equal((await store.getState(CHANNEL)).lastError, null);
});

test("deletion safety: the real API adapter refuses a channel with no playlist id without calling YouTube", async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const api = createStatsSyncApi("token", { youtubeChannelId: "UCx", uploadsPlaylistId: null });
    await assert.rejects(api.listUploadsPage(null), /YOUTUBE_UPLOADS_PLAYLIST_MISSING/);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("deletion safety: a video absent from the playlist and from the direct lookup is marked deleted", async () => {
  const { store, youtube } = await syncedChannel(3);
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid2");

  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));

  assert.deepEqual(youtube.lookups, [["vid2"]]);
  assert.equal(result.absentChecked, 1);
  assert.equal(result.stillAvailable, 0);
  assert.equal(result.markedDeleted, 1);
  assert.deepEqual(statuses(store), { vid1: "active", vid2: "deleted", vid3: "active" });
  assert.equal(store.videos.size, 3, "the row is kept");
});

test("deletion safety: a video the direct lookup still returns is kept and refreshed", async () => {
  const { store, youtube } = await syncedChannel(3);
  const hidden = youtube.catalogue.find((v) => v.youtubeVideoId === "vid2")!;
  youtube.catalogue = youtube.catalogue.filter((v) => v !== hidden);
  // Still on YouTube, now private and retitled, just not in the playlist response.
  youtube.existsButNotListed = [{ ...hidden, title: "Renamed", privacyStatus: "private" }];
  const idBefore = store.video("vid2").id;

  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(result.markedDeleted, 0);
  assert.equal(result.stillAvailable, 1);
  assert.equal(store.video("vid2").status, "archived", "its state follows what the lookup says");
  assert.equal(store.video("vid2").title, "Renamed");
  assert.equal(store.video("vid2").id, idBefore, "same row, no duplicate");
  assert.equal(store.videos.size, 3);
  assert.equal(store.video("vid2").seenAt, WEEK_LATER.toISOString());
});

test("deletion safety: a mixed answer marks only the ids the lookup did not return", async () => {
  const { store, youtube } = await syncedChannel(4);
  const stillThere = youtube.catalogue.find((v) => v.youtubeVideoId === "vid1")!;
  youtube.existsButNotListed = [stillThere];
  youtube.catalogue = youtube.catalogue.filter((v) => !["vid1", "vid3"].includes(v.youtubeVideoId));

  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));

  assert.deepEqual([result.absentChecked, result.stillAvailable, result.markedDeleted], [2, 1, 1]);
  assert.deepEqual(statuses(store), {
    vid1: "active",
    vid2: "active",
    vid3: "deleted",
    vid4: "active",
  });
});

test("deletion safety: a failed direct lookup marks nothing and the next sync retries it", async () => {
  const { store, youtube } = await syncedChannel(3);
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid2");
  youtube.lookupFailure = "error";

  const failed = await runChannelSync(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /YOUTUBE_VIDEOS_FAILED:503/);
  assert.deepEqual(statuses(store), { vid1: "active", vid2: "active", vid3: "active" });
  const state = await store.getState(CHANNEL);
  assert.ok(state.cataloguePassStartedAt, "the pass is still open");
  assert.equal(state.catalogueFullSyncedAt, NOW.toISOString(), "not recorded as a completed pass");
  assert.match(state.lastError ?? "", /YOUTUBE_VIDEOS_FAILED/);

  // Next run: the playlist is not walked again, only the confirmation is retried.
  youtube.lookupFailure = "ok";
  youtube.pagesListed = 0;
  const nextDay = new Date("2026-10-19T08:00:00Z");
  const retry = await syncCatalogue(context(store, youtube, { now: nextDay }));
  assert.equal(retry.status, "complete");
  assert.equal(youtube.pagesListed, 0, "the finished walk is not repeated");
  assert.equal(retry.markedDeleted, 1);
  assert.equal(store.video("vid2").status, "deleted");
  assert.equal((await store.getState(CHANNEL)).cataloguePassStartedAt, null);
});

test("deletion safety: when one lookup batch fails, only confirmed batches are acted on", async () => {
  const { store, youtube } = await syncedChannel(120);
  youtube.pageSize = 50;
  youtube.catalogue = [];
  youtube.lookupFailure = 2;

  const failed = await runChannelSync(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(failed.status, "failed");
  const afterFailure = Object.values(statuses(store));
  assert.equal(afterFailure.filter((s) => s === "deleted").length, 50, "batch 1 was confirmed");
  assert.equal(afterFailure.filter((s) => s === "active").length, 70, "batches 2 and 3 untouched");

  youtube.lookupFailure = "ok";
  youtube.lookups = [];
  const retry = await syncCatalogue(
    context(store, youtube, { now: new Date("2026-10-19T08:00:00Z") }),
  );
  assert.equal(retry.status, "complete");
  assert.deepEqual(
    youtube.lookups.map((ids) => ids.length),
    [50, 20],
    "only the 70 still-unconfirmed videos are asked about again",
  );
  assert.ok(Object.values(statuses(store)).every((s) => s === "deleted"));
});

test("deletion safety: an interrupted pass asks nothing and marks nothing", async () => {
  const { store, youtube } = await syncedChannel(6);
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid1");

  const paused = await syncCatalogue(context(store, youtube, { now: WEEK_LATER, budget: 4 }));

  assert.equal(paused.status, "paused");
  assert.equal(paused.pages, 2, "two of three pages");
  assert.deepEqual(youtube.lookups, [], "no confirmation is attempted before the walk is finished");
  assert.equal(paused.markedDeleted, 0);
  assert.ok(Object.values(statuses(store)).every((s) => s === "active"));
});

test("deletion safety: running out of budget at the confirmation step pauses there and resumes there", async () => {
  const { store, youtube } = await syncedChannel(4);
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid1");

  // 4 videos at 2 per page were 2 pages; 3 remain, still 2 pages = 4 requests, none left over.
  const paused = await syncCatalogue(context(store, youtube, { now: WEEK_LATER, budget: 4 }));
  assert.equal(paused.status, "paused");
  assert.equal(paused.pages, 2, "the walk itself finished");
  assert.deepEqual(youtube.lookups, []);
  assert.equal(store.video("vid1").status, "active");
  assert.equal((await store.getState(CHANNEL)).catalogueFullSyncedAt, NOW.toISOString());

  youtube.pagesListed = 0;
  const resumed = await syncCatalogue(
    context(store, youtube, { now: new Date("2026-10-18T09:00:00Z") }),
  );
  assert.equal(resumed.status, "complete");
  assert.equal(youtube.pagesListed, 0, "the playlist is not walked a second time");
  assert.deepEqual(youtube.lookups, [["vid1"]]);
  assert.equal(store.video("vid1").status, "deleted");
  const state = await store.getState(CHANNEL);
  assert.equal(state.cataloguePassStartedAt, null);
  assert.equal(state.cataloguePageToken, null, "no marker is left behind");
});

test("deletion safety: after a multi-page pass only the genuinely absent ids are looked up", async () => {
  const { store, youtube } = await syncedChannel(9);
  youtube.catalogue = youtube.catalogue.filter((v) => !["vid2", "vid7"].includes(v.youtubeVideoId));
  youtube.addVideo("brandnew", "2026-10-15");

  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(result.pages, 4, "8 videos at 2 per page");
  assert.equal(youtube.lookups.length, 1);
  assert.deepEqual([...youtube.lookups[0]].sort(), ["vid2", "vid7"]);
  assert.equal(result.newVideos, 1);
  assert.equal(store.video("brandnew").status, "active", "a newly discovered video is stored");
  assert.equal(result.markedDeleted, 2);
  assert.equal(store.videos.size, 10);
});

test("deletion safety: a pass that sees every known video makes no lookup at all", async () => {
  const { store, youtube } = await syncedChannel(5);
  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));
  assert.equal(result.mode, "full");
  assert.deepEqual(youtube.lookups, [], "no extra request when nothing is absent");
  assert.equal(result.absentChecked, 0);
});

test("deletion safety: videos already marked deleted are not looked up again every week", async () => {
  const { store, youtube } = await syncedChannel(3);
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid2");
  await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));
  youtube.lookups = [];

  await syncCatalogue(context(store, youtube, { now: new Date("2026-10-26T08:00:00Z") }));

  assert.deepEqual(youtube.lookups, []);
  assert.equal(store.video("vid2").status, "deleted");
});

test("deletion safety: a deleted video that reappears in the playlist is restored", async () => {
  const { store, youtube } = await syncedChannel(3);
  const removed = youtube.catalogue.find((v) => v.youtubeVideoId === "vid2")!;
  youtube.catalogue = youtube.catalogue.filter((v) => v !== removed);
  await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));
  assert.equal(store.video("vid2").status, "deleted");
  const idWhileDeleted = store.video("vid2").id;

  youtube.catalogue.push(removed);
  await syncCatalogue(context(store, youtube, { now: new Date("2026-10-26T08:00:00Z") }));

  assert.equal(store.video("vid2").status, "active");
  assert.equal(store.video("vid2").id, idWhileDeleted, "the same row, with its history");
  assert.equal(store.videos.size, 3);
});

test("deletion safety: direct lookups are sent in batches of at most 50 ids", async () => {
  const { store, youtube } = await syncedChannel(120);
  youtube.pageSize = 50;
  youtube.catalogue = [];

  const result = await syncCatalogue(context(store, youtube, { now: WEEK_LATER }));

  assert.deepEqual(
    youtube.lookups.map((ids) => ids.length),
    [50, 50, 20],
  );
  assert.equal(new Set(youtube.lookups.flat()).size, 120, "every id asked exactly once");
  assert.equal(result.absentChecked, 120);
  assert.equal(result.markedDeleted, 120);
});

test("deletion safety: an incremental pass never looks anything up or marks anything", async () => {
  const { store, youtube } = await syncedChannel(4);
  youtube.catalogue = youtube.catalogue.filter((v) => v.youtubeVideoId !== "vid1");

  const nextDay = new Date("2026-10-11T08:00:00Z");
  const result = await syncCatalogue(context(store, youtube, { now: nextDay }));

  assert.equal(result.mode, "incremental");
  assert.deepEqual(youtube.lookups, []);
  assert.equal(store.video("vid1").status, "active");
});

test("deletion safety: a channel whose videos are all gone ends in the same state, now confirmed per video", async () => {
  // The case seen in production: 8 known videos, a complete and genuinely empty playlist, and a
  // direct lookup that returns none of them.
  const { store, youtube } = await syncedChannel(8);
  youtube.catalogue = [];

  const result = await runChannelSync(context(store, youtube, { now: WEEK_LATER }));

  assert.equal(result.status, "complete");
  assert.equal(result.catalogue?.videosSeen, 0);
  assert.equal(youtube.lookups.length, 1, "one request confirms all 8");
  assert.equal(youtube.lookups[0].length, 8);
  assert.equal(result.catalogue?.absentChecked, 8);
  assert.equal(result.catalogue?.stillAvailable, 0);
  assert.equal(result.catalogue?.markedDeleted, 8);
  assert.ok(Object.values(statuses(store)).every((s) => s === "deleted"));
  assert.equal(store.videos.size, 8, "all rows kept");
  assert.equal((await store.getState(CHANNEL)).catalogueFullSyncedAt, WEEK_LATER.toISOString());
});

test("deletion safety: the by-id lookup helper asks YouTube once for up to 50 ids and refuses more", async () => {
  const realFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(new URL(String(input)));
    return new Response(
      JSON.stringify({
        items: [{ id: "keep", snippet: { title: "Kept" }, status: { privacyStatus: "private" } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const api = createStatsSyncApi("token", { youtubeChannelId: "UCx", uploadsPlaylistId: "UUx" });
    const found = await api.lookupVideos(["keep", "gone"]);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].pathname, "/youtube/v3/videos");
    assert.equal(urls[0].searchParams.get("id"), "keep,gone");
    assert.deepEqual(
      found.map((v) => [v.youtubeVideoId, v.privacyStatus]),
      [["keep", "private"]],
      "a private video is returned, an id with no video is simply absent",
    );
    await assert.rejects(
      api.lookupVideos(Array.from({ length: 51 }, (_, i) => `id${i}`)),
      /YOUTUBE_VIDEOS_TOO_MANY_IDS/,
    );
    assert.equal(urls.length, 1, "the oversized request was never sent");

    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await assert.rejects(api.lookupVideos(["keep"]), /YOUTUBE_VIDEOS_FAILED:403/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ============================================================
// Daily stats
// ============================================================

test("stats: the first sync backfills every video and every day with activity", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();

  const result = await runChannelSync(context(store, youtube));

  assert.equal(result.status, "complete");
  assert.equal(result.stats?.kind, "backfill");
  assert.deepEqual(
    store.rowsFor("aaa").map((r) => [r.day, r.views]),
    [
      ["2026-09-02", 100],
      ["2026-10-06", 40],
    ],
  );
  assert.deepEqual(
    store.rowsFor("bbb").map((r) => [r.day, r.views]),
    [
      ["2026-09-21", 10],
      ["2026-10-06", 5],
    ],
  );
  assert.equal(store.rowsFor("ccc").length, 1);
  assert.equal(store.rowsFor("aaa")[0].estimatedRevenueUsd, 1.5);
  assert.equal(store.rowsFor("aaa")[0].watchMinutes, 200);
});

test("stats: running the same sync again changes nothing and duplicates nothing", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));
  const before = JSON.stringify(
    [...store.videoDays.values()]
      .map(({ fetchedAt, ...row }) => row)
      .sort((a, b) => `${a.videoId}${a.day}`.localeCompare(`${b.videoId}${b.day}`)),
  );
  const channelBefore = store.channelDays.size;

  // A new pass a little later the same day, and another unit of the same work straight after.
  for (const hour of ["09", "10"]) {
    const again = await runChannelSync(
      context(store, youtube, { now: new Date(`2026-10-10T${hour}:00:00Z`) }),
    );
    assert.equal(again.status, "complete");
  }

  const after = JSON.stringify(
    [...store.videoDays.values()]
      .map(({ fetchedAt, ...row }) => row)
      .sort((a, b) => `${a.videoId}${a.day}`.localeCompare(`${b.videoId}${b.day}`)),
  );
  assert.equal(after, before);
  assert.equal(store.videoDays.size, 5);
  assert.ok(store.channelDays.size >= channelBefore);
});

test("stats: a revised value updates the existing row, and a day revised away is removed", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));

  // Google revises revenue for a recent day, and removes another day's views entirely.
  youtube.set("aaa", "2026-10-06", 40, 0.31);
  youtube.activity.get("bbb")!.delete("2026-10-06");
  await runChannelSync(context(store, youtube, { now: new Date("2026-10-11T08:00:00Z") }));

  const revised = store.rowsFor("aaa").find((r) => r.day === "2026-10-06")!;
  assert.equal(revised.estimatedRevenueUsd, 0.31, "same (video, day) row, new value");
  assert.equal(store.rowsFor("aaa").length, 2, "no second row was created");
  assert.deepEqual(
    store.rowsFor("bbb").map((r) => r.day),
    ["2026-09-21"],
    "the revised-away day is gone, older history untouched",
  );
});

test("stats: zero revenue and unavailable revenue are stored differently", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));
  assert.equal(store.rowsFor("ccc")[0].estimatedRevenueUsd, 0, "YouTube reported zero");

  const refused = new FakeStore();
  const noMonetary = seedChannel();
  noMonetary.revenueForbidden = true;
  const result = await runChannelSync(context(refused, noMonetary));

  assert.equal(result.status, "complete", "activity is still collected");
  assert.equal(result.stats?.revenueAvailable, false);
  assert.equal(refused.rowsFor("aaa")[0].views, 100);
  assert.equal(refused.rowsFor("aaa")[0].estimatedRevenueUsd, null, "refused is null, never 0");
  assert.equal([...refused.channelDays.values()][0].estimatedRevenueUsd, null);
});

test("stats: every analytics request asks for USD explicitly", async () => {
  assert.equal(STATS_CURRENCY, "USD");
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ columnHeaders: [], rows: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const api = createStatsSyncApi("token", { youtubeChannelId: "UCx", uploadsPlaylistId: "UUx" });
    await api.queryAnalytics({
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      metrics: ["views", "estimatedRevenue"],
      dimensions: ["day"],
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(seen.length, 1);
  assert.equal(new URL(seen[0]).searchParams.get("currency"), "USD");
});

// ============================================================
// Refresh windows
// ============================================================

test("refresh: ordinary runs re-fetch the recent window; a revision run re-fetches the long one", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube)); // backfill on 10 Oct (also counts as a revision)
  const startOfChannelQuery = () =>
    youtube.requests.find((r) => r.dimensions?.join() === "day" && !r.filters)!.startDate;

  youtube.requests = [];
  const recent = await runChannelSync(
    context(store, youtube, { now: new Date("2026-10-11T08:00:00Z") }),
  );
  assert.equal(recent.stats?.kind, "recent");
  assert.equal(
    startOfChannelQuery(),
    addDays("2026-10-11", -DEFAULT_STATS_SYNC_CONFIG.recentWindowDays),
  );

  youtube.requests = [];
  const revision = await runChannelSync(
    context(store, youtube, { now: new Date("2026-10-18T08:00:00Z") }),
  );
  assert.equal(revision.stats?.kind, "revision");
  assert.equal(
    startOfChannelQuery(),
    addDays("2026-10-18", -DEFAULT_STATS_SYNC_CONFIG.revisionWindowDays),
  );
});

test("refresh: an old row is still corrected by a revision run", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));
  // A month-end adjustment changes revenue for a day 5 weeks back.
  youtube.set("aaa", "2026-09-02", 100, 1.2);

  await runChannelSync(context(store, youtube, { now: new Date("2026-10-11T08:00:00Z") }));
  assert.equal(
    store.rowsFor("aaa")[0].estimatedRevenueUsd,
    1.5,
    "outside the recent window: not yet refreshed",
  );

  await runChannelSync(context(store, youtube, { now: new Date("2026-10-18T08:00:00Z") }));
  assert.equal(store.rowsFor("aaa")[0].estimatedRevenueUsd, 1.2, "the revision window reaches it");
});

test("refresh: the windows are configuration, not constants", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));
  youtube.requests = [];
  await runChannelSync(
    context(store, youtube, {
      now: new Date("2026-10-11T08:00:00Z"),
      config: { recentWindowDays: 3 },
    }),
  );
  assert.equal(youtube.requests.find((r) => !r.filters)!.startDate, "2026-10-08");
});

// ============================================================
// Reconciliation
// ============================================================

test("reconciliation: channel totals are stored independently and keep deleted-video activity", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  // 60 views and $0.90 on 6 Oct came from a video that has since been deleted.
  youtube.deletedVideoActivity.set("2026-10-06", { views: 60, minutes: 120, revenue: 0.9 });

  await runChannelSync(context(store, youtube));

  const channel = store.channelDays.get(`${CHANNEL}:2026-10-06`)!;
  const videoRows = [...store.videoDays.values()].filter((r) => r.day === "2026-10-06");
  assert.equal(channel.views, 40 + 5 + 7 + 60, "the channel total includes the deleted video");
  assert.equal(
    videoRows.reduce((s, r) => s + r.views, 0),
    52,
    "video rows cover only videos that exist",
  );

  const day = reconcileDay(channel, videoRows);
  assert.equal(day.unattributedViews, 60);
  assert.ok(Math.abs((day.unattributedRevenueUsd ?? 0) - 0.9) < 1e-9);
  assert.equal(day.fullyAttributed, false);
  assert.equal(day.videosExceedChannel, false);
  // Nothing was spread across the surviving videos.
  assert.deepEqual(
    videoRows.map((r) => r.views).sort((a, b) => a - b),
    [5, 7, 40],
  );
});

test("reconciliation: a day with no gap is reported as fully attributed", () => {
  const day = reconcileDay({ views: 12, estimatedRevenueUsd: 0.3 }, [
    { views: 7, estimatedRevenueUsd: 0.2 },
    { views: 5, estimatedRevenueUsd: 0.1 },
  ]);
  assert.equal(day.fullyAttributed, true);
  assert.equal(day.unattributedViews, 0);
});

test("reconciliation: unknown revenue stays unknown instead of becoming zero", () => {
  const day = reconcileDay({ views: 10, estimatedRevenueUsd: 1 }, [
    { views: 10, estimatedRevenueUsd: null },
  ]);
  assert.equal(day.attributedRevenueUsd, null);
  assert.equal(day.unattributedRevenueUsd, null);
});

test("reconciliation: video rows exceeding the channel total are flagged, not adjusted", () => {
  const day = reconcileDay({ views: 10, estimatedRevenueUsd: 0 }, [
    { views: 14, estimatedRevenueUsd: 0 },
  ]);
  assert.equal(day.videosExceedChannel, true);
  assert.equal(day.unattributedViews, 0);
});

test("fast path: a silently truncated response is caught and re-fetched the documented way", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  youtube.fastPath = "truncated";

  const result = await runChannelSync(context(store, youtube));

  assert.equal(result.status, "complete");
  assert.equal(result.stats?.usedFallback, true);
  assert.deepEqual(
    store.rowsFor("aaa").map((r) => r.day),
    ["2026-09-02", "2026-10-06"],
    "the dropped day is present",
  );
  assert.equal(store.videoDays.size, 5, "the stored data is complete despite the bad response");
});

test("fast path: per-day rounding of watch minutes does not trigger the fallback", async () => {
  // Found against the live API: daily watch minutes are rounded, so they never sum exactly to
  // the period total. Verification must rest on views alone or every batch is needlessly refetched.
  const store = new FakeStore();
  const youtube = seedChannel();
  youtube.minutesRoundingDrift = 3;

  const result = await runChannelSync(context(store, youtube));

  assert.equal(result.status, "complete");
  assert.equal(result.stats?.usedFallback, false);
  assert.equal(store.videoDays.size, 5);
});

test("fast path: if Google rejects the query shape, the documented shape takes over", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  youtube.fastPath = "rejected";

  const result = await runChannelSync(context(store, youtube));

  assert.equal(result.status, "complete");
  assert.equal(result.stats?.usedFallback, true);
  assert.equal(store.videoDays.size, 5);
  const fastAttempts = youtube.requests.filter((r) => r.dimensions?.join() === "day,video").length;
  assert.equal(fastAttempts, 1, "it does not keep retrying a shape that was refused");
});

test("ingestion never uses the unfiltered per-video report", async () => {
  const store = new FakeStore();
  const youtube = seedChannel();
  await runChannelSync(context(store, youtube));
  await runChannelSync(context(store, youtube, { now: new Date("2026-10-18T08:00:00Z") }));
  const unfiltered = youtube.requests.filter((r) => r.dimensions?.includes("video") && !r.filters);
  assert.equal(unfiltered.length, 0);
});

test("videos are requested in batches no larger than the configured size", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  youtube.pageSize = 50;
  for (let i = 0; i < 23; i++) {
    youtube.addVideo(`v${String(i).padStart(2, "0")}`, "2026-09-01");
    youtube.set(`v${String(i).padStart(2, "0")}`, "2026-10-06", i + 1);
  }
  await runChannelSync(context(store, youtube, { config: { videoBatchSize: 10 } }));
  const sizes = youtube.requests
    .filter((r) => r.dimensions?.join() === "day,video")
    .map((r) => r.filters!.slice(7).split(",").length);
  assert.deepEqual(sizes, [10, 10, 3]);
  assert.equal(store.videoDays.size, 23);
});

// ============================================================
// Resumability and isolation
// ============================================================

test("sync: a failure mid-pass is recorded, and the next run resumes without duplicating", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  youtube.pageSize = 50;
  for (let i = 0; i < 6; i++) {
    youtube.addVideo(`v${i}`, "2026-09-01");
    youtube.set(`v${i}`, "2026-10-06", 10 + i);
  }
  youtube.failOnRequest = 4; // channel totals, batch 1 (2 requests), then batch 2 fails

  const first = await runChannelSync(context(store, youtube, { config: { videoBatchSize: 2 } }));
  assert.equal(first.status, "failed");
  assert.match(first.error ?? "", /:500/);
  assert.equal((await store.getState(CHANNEL)).lastError, first.error);
  assert.equal(store.videoDays.size, 2, "the batch that completed before the failure is kept");
  const state = await store.getState(CHANNEL);
  assert.equal(state.statsPassKind, "backfill", "the pass is still open");

  youtube.requests = [];
  const second = await runChannelSync(
    context(store, youtube, {
      now: new Date("2026-10-10T09:00:00Z"),
      config: { videoBatchSize: 2 },
    }),
  );
  assert.equal(second.status, "complete");
  assert.equal(second.stats?.kind, "backfill", "it continued the same pass");
  assert.equal(store.videoDays.size, 6);
  assert.equal(
    youtube.requests.filter((r) => !r.filters).length,
    0,
    "channel totals were not fetched again",
  );
  assert.equal(second.stats?.videosSynced, 4, "only the videos that were still pending");
  assert.equal((await store.getState(CHANNEL)).lastError, null);
});

test("sync: work stops at the request budget and continues on the next invocation", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  youtube.pageSize = 50;
  for (let i = 0; i < 6; i++) {
    youtube.addVideo(`v${i}`, "2026-09-01");
    youtube.set(`v${i}`, "2026-10-06", 10 + i);
  }
  const config = { videoBatchSize: 2 };

  // 2 for the catalogue page, 1 for channel totals, 2 for one batch.
  const first = await runChannelSync(context(store, youtube, { budget: 5, config }));
  assert.equal(first.status, "paused");
  assert.ok(first.requestsUsed <= 5);
  assert.equal(first.stats?.videosRemaining, 4);

  let runs = 1;
  let last = first;
  while (last.status === "paused" && runs < 10) {
    last = await runChannelSync(
      context(store, youtube, {
        budget: 5,
        config,
        now: new Date(`2026-10-10T${String(8 + runs).padStart(2, "0")}:00:00Z`),
      }),
    );
    runs += 1;
  }
  assert.equal(last.status, "complete");
  assert.equal(store.videoDays.size, 6);
  assert.ok(runs > 2, "it genuinely took several bounded invocations");
});

test("sync: a paused catalogue pass finishes before any stats are collected", async () => {
  const store = new FakeStore();
  const youtube = new FakeYoutube();
  for (let i = 0; i < 6; i++) youtube.addVideo(`v${i}`, "2026-09-01");

  const result = await runChannelSync(context(store, youtube, { budget: 2 }));

  assert.equal(result.status, "paused");
  assert.equal(result.stats, null);
  assert.equal(youtube.requests.length, 0);
});

test("batch: one channel failing does not stop or corrupt another", async () => {
  const store = new FakeStore();
  const good = seedChannel();
  const order: string[] = [];

  const batch = await runSyncBatch(
    {
      listChannelIds: async () => ["broken-token", "broken-api", CHANNEL],
      contextFor: async (channelId) => {
        order.push(channelId);
        if (channelId === "broken-token") throw new Error("YOUTUBE_REAUTH_REQUIRED");
        if (channelId === "broken-api") {
          const failing = new FakeYoutube();
          failing.addVideo("zzz", "2026-09-01");
          failing.set("zzz", "2026-10-06", 99);
          failing.failOnRequest = 1;
          return context(store, failing, { channelId });
        }
        return context(store, good);
      },
      now: () => 0,
    },
    1,
  );

  assert.deepEqual(order, ["broken-token", "broken-api", CHANNEL]);
  assert.deepEqual(
    batch.results.map((r) => r.status),
    ["failed", "failed", "complete"],
  );
  assert.equal(batch.results[0].error, "YOUTUBE_REAUTH_REQUIRED");
  assert.equal(store.rowsFor("aaa").length, 2, "the healthy channel is fully synced");
  assert.equal(store.videoDays.size, 5, "only the healthy channel's rows exist");
  assert.equal(store.rowsFor("zzz").length, 0, "the failed channel wrote no partial stats");
  assert.equal((await store.getState("broken-api")).lastError?.includes(":500"), true);
  assert.equal((await store.getState(CHANNEL)).lastError, null);
});

test("batch: stops starting new channels once the deadline has passed", async () => {
  let clock = 0;
  const batch = await runSyncBatch(
    {
      listChannelIds: async () => ["a", "b", "c"],
      contextFor: async (channelId) => {
        clock += 10;
        return context(new FakeStore(), seedChannel(), { channelId });
      },
      now: () => clock,
    },
    15,
  );
  assert.equal(batch.results.length, 2);
  assert.equal(batch.skipped, 1);
});

// ============================================================
// Parsing
// ============================================================

test("parsing reads columns by name and treats absent revenue columns as unknown", () => {
  const rows = parseStatsRows({
    columnHeaders: [
      { name: "video" },
      { name: "day" },
      { name: "estimatedMinutesWatched" },
      { name: "views" },
    ],
    rows: [["abc", "2026-10-01", 9, 4]],
  });
  assert.equal(rows[0].youtubeVideoId, "abc");
  assert.equal(rows[0].day, "2026-10-01");
  assert.equal(rows[0].stats.views, 4);
  assert.equal(rows[0].stats.watchMinutes, 9);
  assert.equal(rows[0].stats.estimatedRevenueUsd, null);
  assert.equal(isEmptyStats(rows[0].stats), false);
});

test("date ranges are split without gaps or overlaps", () => {
  const ranges = splitDateRange("2026-01-01", "2026-01-10", 4);
  assert.deepEqual(ranges, [
    { startDate: "2026-01-01", endDate: "2026-01-04" },
    { startDate: "2026-01-05", endDate: "2026-01-08" },
    { startDate: "2026-01-09", endDate: "2026-01-10" },
  ]);
  assert.equal(TODAY, "2026-10-10");
});
