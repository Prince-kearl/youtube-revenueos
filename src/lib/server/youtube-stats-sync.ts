// Canonical YouTube revenue/analytics ingestion: full video catalogue → channel daily totals →
// per-video daily rows, stored in channel_daily_stats / video_daily_stats (see
// supabase/migrations/202610060001_revenue_data_foundation.sql).
//
// Everything here is written against two small interfaces (StatsSyncApi, StatsSyncStore) rather
// than Google/Supabase directly, so the rules below can be unit-tested with in-memory fakes. The
// real implementations live in youtube-stats-store.ts.
//
// Rules this module enforces — each one comes from behavior verified against the live YouTube
// Analytics API on 2026-10-06, not from assumption:
//
//  1. Channel totals are fetched on their own (dimension `day`) and are the authoritative layer.
//     Per-video rows are the attribution layer. They are never derived from each other, because
//     channel totals include videos that no longer exist and the per-video report omits those.
//  2. Per-video data is fetched ONLY for known video ids (filters=video==a,b,c). The unfiltered
//     "top videos" report is capped at 200 rows, cannot be paged, and deleted videos consume its
//     slots — it is never used for ingestion.
//  3. The fast path (dimensions=day,video + id filter) works but is not in Google's published
//     report list, so every batch is verified against per-video totals and falls back to the
//     documented one-video-per-request query (dimensions=day, filters=video==ID) whenever the
//     fast path errors or does not add up.
//  4. Revenue is an estimate Google revises. Rows are replaced on every refresh; nothing is ever
//     treated as final. All revenue is requested and stored in USD.
//  5. Work is bounded by a request budget and progress is persisted, so an invocation can stop
//     anywhere and the next one continues. Every write is an idempotent upsert/replace.

import type { YoutubeAnalyticsPayload } from "./google-oauth";

// ============================================================================================
// Configuration
// ============================================================================================

export interface StatsSyncConfig {
  /** Video ids per Analytics request. The API accepts up to 500 ids in a filter (501 is
   * rejected), but how many ROWS one response can carry was not provable on a small channel, so
   * this stays conservative and every batch is verified. */
  videoBatchSize: number;
  /** Days re-fetched on an ordinary run. YouTube's data lags about 3 days, so 7 calendar days
   * always covers the 3 most recent available days with margin. */
  recentWindowDays: number;
  /** Days re-fetched on a revision run, to pick up Google's month-end revenue adjustment. 62
   * always reaches back past the start of the previous calendar month. This is a conservative
   * choice, NOT a period Google guarantees revenue is final after — Google publishes none. */
  revisionWindowDays: number;
  /** How often a revision run replaces an ordinary one. */
  revisionIntervalDays: number;
  /** How far back the first sync of a channel/video reaches. */
  maxHistoryDays: number;
  /** Longest date range sent in one day-dimension request. */
  maxRangeDays: number;
  /** A full catalogue pass (which also detects removed videos) runs at most this often. */
  fullCatalogueIntervalDays: number;
  /** Google API requests one channel may use in one invocation. */
  requestBudget: number;
}

export const DEFAULT_STATS_SYNC_CONFIG: StatsSyncConfig = {
  videoBatchSize: 50,
  recentWindowDays: 7,
  revisionWindowDays: 62,
  revisionIntervalDays: 7,
  maxHistoryDays: 1095,
  maxRangeDays: 365,
  fullCatalogueIntervalDays: 7,
  requestBudget: 60,
};

export const STATS_CURRENCY = "USD";

export const ACTIVITY_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
] as const;

export const REVENUE_METRICS = [
  "estimatedRevenue",
  "estimatedAdRevenue",
  "estimatedRedPartnerRevenue",
] as const;

// ============================================================================================
// Types
// ============================================================================================

export interface DailyStats {
  day: string;
  views: number;
  watchMinutes: number;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
  /** null = revenue was not available for this row; 0 = YouTube reported zero. */
  estimatedRevenueUsd: number | null;
  adRevenueUsd: number | null;
  premiumRevenueUsd: number | null;
}

export interface VideoDailyStats extends DailyStats {
  /** videos.id (our row), not the YouTube id. */
  videoId: string;
}

export interface CatalogueVideo {
  youtubeVideoId: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  privacyStatus: string | null;
}

export type StoredVideoStatus = "active" | "archived" | "deleted";

export interface StoredVideo {
  id: string;
  youtubeVideoId: string;
  publishedAt: string | null;
  status: StoredVideoStatus;
  analyticsUpdatedAt: string | null;
}

export type StatsPassKind = "backfill" | "recent" | "revision";

export interface SyncState {
  catalogueSyncedAt: string | null;
  catalogueFullSyncedAt: string | null;
  cataloguePassStartedAt: string | null;
  cataloguePageToken: string | null;
  statsPassKind: StatsPassKind | null;
  statsPassStartedAt: string | null;
  statsPassWindowStart: string | null;
  statsPassChannelDone: boolean;
  statsSyncedAt: string | null;
  statsRevisedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export const EMPTY_SYNC_STATE: SyncState = {
  catalogueSyncedAt: null,
  catalogueFullSyncedAt: null,
  cataloguePassStartedAt: null,
  cataloguePageToken: null,
  statsPassKind: null,
  statsPassStartedAt: null,
  statsPassWindowStart: null,
  statsPassChannelDone: false,
  statsSyncedAt: null,
  statsRevisedAt: null,
  lastRunAt: null,
  lastError: null,
};

export interface AnalyticsRequest {
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  filters?: string;
  sort?: string;
}

export interface StatsSyncApi {
  /** One page of the uploads playlist with full details. Costs 2 Google requests. */
  listUploadsPage(pageToken: string | null): Promise<{
    videos: CatalogueVideo[];
    listedIds: string[];
    nextPageToken: string | null;
  }>;
  /** One YouTube Analytics query for this channel, always in USD. Costs 1 request. Throws an
   * Error whose message ends in `:<http status>` on failure. */
  queryAnalytics(request: AnalyticsRequest): Promise<YoutubeAnalyticsPayload>;
}

export interface StatsSyncStore {
  getState(channelId: string): Promise<SyncState>;
  saveState(channelId: string, patch: Partial<SyncState>): Promise<void>;
  listVideos(channelId: string): Promise<StoredVideo[]>;
  /** Insert new videos / update existing ones (never deleting), stamping catalogue_seen_at. */
  upsertCatalogueVideos(channelId: string, videos: CatalogueVideo[], seenAt: string): Promise<void>;
  /** Mark videos not seen since `passStartedAt` as deleted. Returns how many. Rows are kept. */
  markVideosNotSeenAsDeleted(channelId: string, passStartedAt: string): Promise<number>;
  upsertChannelDays(channelId: string, rows: DailyStats[], fetchedAt: string): Promise<void>;
  /** Make the stored rows for these videos in [startDate, endDate] exactly equal `rows`:
   * upsert them, then remove any older row in that range that is not among them. */
  replaceVideoDays(
    channelId: string,
    videoIds: string[],
    startDate: string,
    endDate: string,
    rows: VideoDailyStats[],
    fetchedAt: string,
  ): Promise<void>;
  markVideosSynced(videoIds: string[], at: string): Promise<void>;
}

export class RequestBudget {
  private used = 0;
  constructor(private readonly limit: number) {}
  get remaining(): number {
    return this.limit - this.used;
  }
  /** Reserve `n` requests. Returns false (reserving nothing) if they don't fit. */
  take(n = 1): boolean {
    if (this.used + n > this.limit) return false;
    this.used += n;
    return true;
  }
  get spent(): number {
    return this.used;
  }
}

export interface ChannelSyncContext {
  channelId: string;
  api: StatsSyncApi;
  store: StatsSyncStore;
  config: StatsSyncConfig;
  budget: RequestBudget;
  now: Date;
}

// ============================================================================================
// Date helpers (all days are YYYY-MM-DD strings; YouTube labels days in Pacific time and we store
// its labels unchanged)
// ============================================================================================

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDay(date);
}

export function daysBetween(earlier: string, later: Date): number {
  return (later.getTime() - new Date(earlier).getTime()) / 86_400_000;
}

/** Split [start, end] into consecutive ranges of at most `maxDays` days, oldest first. */
export function splitDateRange(
  start: string,
  end: string,
  maxDays: number,
): Array<{ startDate: string; endDate: string }> {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, maxDays - 1);
    ranges.push({ startDate: cursor, endDate: chunkEnd < end ? chunkEnd : end });
    cursor = addDays(chunkEnd, 1);
  }
  return ranges;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ============================================================================================
// Parsing and reconciliation (pure)
// ============================================================================================

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedStatsRow {
  day: string | null;
  youtubeVideoId: string | null;
  stats: Omit<DailyStats, "day">;
}

/** Turn an Analytics response into rows keyed by column NAME (never by position). A revenue
 * column that is absent from the response becomes null, not 0. */
export function parseStatsRows(payload: YoutubeAnalyticsPayload): ParsedStatsRow[] {
  const names = (payload.columnHeaders ?? []).map((header) => header.name);
  const index = (name: string) => names.indexOf(name);
  const cell = (row: Array<string | number>, name: string) => {
    const i = index(name);
    return i < 0 ? null : numberOrNull(row[i]);
  };
  return (payload.rows ?? []).map((row) => ({
    day: index("day") < 0 ? null : String(row[index("day")]),
    youtubeVideoId: index("video") < 0 ? null : String(row[index("video")]),
    stats: {
      views: cell(row, "views") ?? 0,
      watchMinutes: cell(row, "estimatedMinutesWatched") ?? 0,
      averageViewDurationSeconds: cell(row, "averageViewDuration"),
      averageViewPercentage: cell(row, "averageViewPercentage"),
      likes: cell(row, "likes") ?? 0,
      comments: cell(row, "comments") ?? 0,
      shares: cell(row, "shares") ?? 0,
      subscribersGained: cell(row, "subscribersGained") ?? 0,
      subscribersLost: cell(row, "subscribersLost") ?? 0,
      estimatedRevenueUsd: cell(row, "estimatedRevenue"),
      adRevenueUsd: cell(row, "estimatedAdRevenue"),
      premiumRevenueUsd: cell(row, "estimatedRedPartnerRevenue"),
    },
  }));
}

/** True when a row carries no activity and no money at all (revenue null or 0). */
export function isEmptyStats(stats: Omit<DailyStats, "day">): boolean {
  return (
    stats.views === 0 &&
    stats.watchMinutes === 0 &&
    stats.likes === 0 &&
    stats.comments === 0 &&
    stats.shares === 0 &&
    stats.subscribersGained === 0 &&
    stats.subscribersLost === 0 &&
    !stats.estimatedRevenueUsd &&
    !stats.adRevenueUsd &&
    !stats.premiumRevenueUsd
  );
}

export interface DayReconciliation {
  channelViews: number;
  attributedViews: number;
  /** Channel activity that belongs to no video in the catalogue ("videos no longer available").
   * Never redistributed across the remaining videos. */
  unattributedViews: number;
  channelRevenueUsd: number | null;
  attributedRevenueUsd: number | null;
  unattributedRevenueUsd: number | null;
  /** False whenever some channel activity or revenue is not explained by video rows. */
  fullyAttributed: boolean;
  /** Video rows add up to MORE than the channel total — the two were fetched at different times
   * or one is stale. Reported so it is investigated, never "corrected" by changing either. */
  videosExceedChannel: boolean;
}

export function reconcileDay(
  channel: Pick<DailyStats, "views" | "estimatedRevenueUsd">,
  videos: Array<Pick<DailyStats, "views" | "estimatedRevenueUsd">>,
): DayReconciliation {
  const attributedViews = videos.reduce((sum, v) => sum + v.views, 0);
  const revenueKnown = videos.length > 0 && videos.every((v) => v.estimatedRevenueUsd !== null);
  const attributedRevenueUsd = revenueKnown
    ? videos.reduce((sum, v) => sum + (v.estimatedRevenueUsd ?? 0), 0)
    : videos.length === 0
      ? 0
      : null;
  const channelRevenueUsd = channel.estimatedRevenueUsd;
  const unattributedRevenueUsd =
    channelRevenueUsd === null || attributedRevenueUsd === null
      ? null
      : Math.max(0, channelRevenueUsd - attributedRevenueUsd);
  const unattributedViews = Math.max(0, channel.views - attributedViews);
  const revenueOver =
    channelRevenueUsd !== null &&
    attributedRevenueUsd !== null &&
    attributedRevenueUsd > channelRevenueUsd + 1e-6;
  return {
    channelViews: channel.views,
    attributedViews,
    unattributedViews,
    channelRevenueUsd,
    attributedRevenueUsd,
    unattributedRevenueUsd,
    fullyAttributed:
      unattributedViews === 0 && (unattributedRevenueUsd === null || unattributedRevenueUsd < 1e-6),
    videosExceedChannel: attributedViews > channel.views || revenueOver,
  };
}

// ============================================================================================
// Errors
// ============================================================================================

function httpStatusOf(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/:(\d{3})(?::|$)/);
  return match ? Number(match[1]) : null;
}

/** Safe, bounded description for logs and last_error — never a token or a response body. */
export function describeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 200);
}

// ============================================================================================
// Catalogue
// ============================================================================================

export interface CatalogueResult {
  status: "complete" | "paused";
  mode: "full" | "incremental";
  pages: number;
  videosSeen: number;
  newVideos: number;
  markedDeleted: number;
}

/**
 * Full pass: walk every page of the uploads playlist (resumable through the stored page token),
 * then mark anything not seen during the pass as deleted — keeping the row and its history.
 * Incremental pass: read from the newest page and stop at the first page that contains no video
 * we don't already know (the playlist is newest-first), so a channel with thousands of videos
 * normally costs one page.
 */
export async function syncCatalogue(ctx: ChannelSyncContext): Promise<CatalogueResult> {
  const { api, store, channelId, config, budget, now } = ctx;
  const nowIso = now.toISOString();
  const state = await store.getState(channelId);
  const known = new Set((await store.listVideos(channelId)).map((v) => v.youtubeVideoId));

  const resuming = Boolean(state.cataloguePassStartedAt);
  const fullDue =
    !state.catalogueFullSyncedAt ||
    daysBetween(state.catalogueFullSyncedAt, now) >= config.fullCatalogueIntervalDays;
  const mode: CatalogueResult["mode"] = resuming || fullDue ? "full" : "incremental";
  const passStartedAt = state.cataloguePassStartedAt ?? nowIso;
  let pageToken = resuming ? state.cataloguePageToken : null;

  const result: CatalogueResult = {
    status: "complete",
    mode,
    pages: 0,
    videosSeen: 0,
    newVideos: 0,
    markedDeleted: 0,
  };

  if (mode === "full" && !resuming) {
    await store.saveState(channelId, {
      cataloguePassStartedAt: passStartedAt,
      cataloguePageToken: null,
    });
  }

  for (;;) {
    if (!budget.take(2)) return { ...result, status: "paused" };

    let page: Awaited<ReturnType<StatsSyncApi["listUploadsPage"]>>;
    try {
      page = await api.listUploadsPage(pageToken);
    } catch (error) {
      // A stored page token can go stale. Abandon this pass so the next run starts a clean one,
      // rather than retrying a token that will never work again. Nothing is marked deleted.
      if (mode === "full" && pageToken) {
        await store.saveState(channelId, {
          cataloguePassStartedAt: null,
          cataloguePageToken: null,
        });
      }
      throw error;
    }

    await store.upsertCatalogueVideos(channelId, page.videos, nowIso);
    const unknown = page.listedIds.filter((id) => !known.has(id));
    for (const id of page.listedIds) known.add(id);
    result.pages += 1;
    result.videosSeen += page.videos.length;
    result.newVideos += unknown.length;

    if (mode === "full") {
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        await store.saveState(channelId, { cataloguePageToken: pageToken });
        continue;
      }
      // Only a pass that reached the genuine end of the playlist may conclude anything is gone.
      result.markedDeleted = await store.markVideosNotSeenAsDeleted(channelId, passStartedAt);
      await store.saveState(channelId, {
        cataloguePassStartedAt: null,
        cataloguePageToken: null,
        catalogueFullSyncedAt: nowIso,
        catalogueSyncedAt: nowIso,
      });
      return result;
    }

    if (!page.nextPageToken || unknown.length === 0) {
      await store.saveState(channelId, { catalogueSyncedAt: nowIso });
      return result;
    }
    pageToken = page.nextPageToken;
  }
}

// ============================================================================================
// Stats
// ============================================================================================

export interface StatsResult {
  status: "complete" | "paused";
  kind: StatsPassKind;
  channelDays: number;
  videosSynced: number;
  videoRows: number;
  videosRemaining: number;
  usedFallback: boolean;
  revenueAvailable: boolean;
}

interface StatsRun {
  ctx: ChannelSyncContext;
  /** Set to false the first time Google refuses the monetary metrics (HTTP 403); from then on
   * requests ask for activity only and revenue is stored as null. */
  revenueAvailable: boolean;
  /** Set to false the first time the fast query shape is rejected; remaining batches go
   * straight to the documented per-video query. */
  fastPathAvailable: boolean;
  usedFallback: boolean;
}

async function queryStats(run: StatsRun, request: Omit<AnalyticsRequest, "metrics">) {
  const metrics = (withRevenue: boolean) =>
    withRevenue ? [...ACTIVITY_METRICS, ...REVENUE_METRICS] : [...ACTIVITY_METRICS];
  if (run.revenueAvailable) {
    try {
      return await run.ctx.api.queryAnalytics({ ...request, metrics: metrics(true) });
    } catch (error) {
      if (httpStatusOf(error) !== 403) throw error;
      run.revenueAvailable = false;
      if (!run.ctx.budget.take(1)) throw new BudgetExhausted();
    }
  }
  return run.ctx.api.queryAnalytics({ ...request, metrics: metrics(false) });
}

class BudgetExhausted extends Error {
  constructor() {
    super("STATS_SYNC_BUDGET_EXHAUSTED");
  }
}

async function syncChannelTotals(run: StatsRun, start: string, end: string): Promise<number> {
  const { ctx } = run;
  let days = 0;
  for (const range of splitDateRange(start, end, ctx.config.maxRangeDays)) {
    const payload = await queryStats(run, { ...range, dimensions: ["day"], sort: "day" });
    const rows = parseStatsRows(payload)
      .filter((row) => row.day)
      .map((row) => ({ day: row.day as string, ...row.stats }));
    await ctx.store.upsertChannelDays(ctx.channelId, rows, ctx.now.toISOString());
    days += rows.length;
  }
  return days;
}

/** Documented query shape: one video, dimension `day`. Always available; one request per video
 * per range. */
async function fetchVideoDaysDocumented(
  run: StatsRun,
  video: StoredVideo,
  range: { startDate: string; endDate: string },
): Promise<VideoDailyStats[]> {
  const payload = await queryStats(run, {
    ...range,
    dimensions: ["day"],
    filters: `video==${video.youtubeVideoId}`,
    sort: "day",
  });
  return parseStatsRows(payload)
    .filter((row) => row.day && !isEmptyStats(row.stats))
    .map((row) => ({ videoId: video.id, day: row.day as string, ...row.stats }));
}

/**
 * Fast query shape: many videos, dimensions `day,video`. Returns rows only for videos whose
 * per-video sum matches an independent per-video total for the same range; any video that does
 * not match (or every video, if either request is refused) is returned in `unverified` and must
 * be fetched through the documented shape instead. This is what makes it safe to use a query
 * Google does not list: a truncated or changed response cannot be stored unnoticed.
 */
async function fetchVideoDaysFast(
  run: StatsRun,
  videos: StoredVideo[],
  range: { startDate: string; endDate: string },
): Promise<{ rows: VideoDailyStats[]; unverified: StoredVideo[] }> {
  const filters = `video==${videos.map((v) => v.youtubeVideoId).join(",")}`;
  const byYoutubeId = new Map(videos.map((v) => [v.youtubeVideoId, v]));
  let daily: ParsedStatsRow[];
  let totals: ParsedStatsRow[];
  try {
    daily = parseStatsRows(
      await queryStats(run, { ...range, dimensions: ["day", "video"], filters }),
    );
    totals = parseStatsRows(
      await run.ctx.api.queryAnalytics({
        ...range,
        metrics: ["views"],
        dimensions: ["video"],
        filters,
      }),
    );
  } catch (error) {
    if (error instanceof BudgetExhausted) throw error;
    const status = httpStatusOf(error);
    // 400 = Google no longer accepts this shape. Anything else (auth, quota, outage) is a real
    // failure the caller must see.
    if (status !== 400) throw error;
    run.fastPathAvailable = false;
    return { rows: [], unverified: videos };
  }

  // Verified on views only. Views are whole numbers, so the daily rows must add up exactly to
  // the period total. Watch minutes cannot be used: YouTube rounds them per day, so daily values
  // legitimately do not sum to the period figure (observed on live data — comparing them sent
  // every batch to the fallback).
  const dailyViews = new Map<string, number>();
  for (const row of daily) {
    if (!row.youtubeVideoId) continue;
    dailyViews.set(row.youtubeVideoId, (dailyViews.get(row.youtubeVideoId) ?? 0) + row.stats.views);
  }
  const totalViews = new Map<string, number>();
  for (const row of totals) {
    if (!row.youtubeVideoId) continue;
    totalViews.set(row.youtubeVideoId, row.stats.views);
  }

  const unverified = videos.filter((video) => {
    const id = video.youtubeVideoId;
    return (dailyViews.get(id) ?? 0) !== (totalViews.get(id) ?? 0);
  });
  const rejected = new Set(unverified.map((v) => v.youtubeVideoId));
  const rows = daily
    .filter(
      (row) =>
        row.day &&
        row.youtubeVideoId &&
        byYoutubeId.has(row.youtubeVideoId) &&
        !rejected.has(row.youtubeVideoId) &&
        !isEmptyStats(row.stats),
    )
    .map((row) => ({
      videoId: byYoutubeId.get(row.youtubeVideoId as string)!.id,
      day: row.day as string,
      ...row.stats,
    }));
  return { rows, unverified };
}

function historyStartFor(video: StoredVideo, today: string, config: StatsSyncConfig): string {
  const floor = addDays(today, -config.maxHistoryDays);
  if (!video.publishedAt) return floor;
  // One day before the publish date: YouTube's day is Pacific time, ours is UTC.
  const published = addDays(video.publishedAt.slice(0, 10), -1);
  return published > floor ? published : floor;
}

/**
 * Runs (or continues) one stats pass for a channel:
 *   backfill  — first ever sync: full history
 *   revision  — every revisionIntervalDays: the long window, to absorb Google's adjustments
 *   recent    — otherwise: the short window
 * A pass spans as many invocations as it needs. Videos are processed stalest-first and stamped
 * as they finish, so an interrupted pass resumes exactly where it stopped.
 */
export async function syncChannelStats(ctx: ChannelSyncContext): Promise<StatsResult> {
  const { store, channelId, config, budget, now } = ctx;
  const nowIso = now.toISOString();
  const today = isoDay(now);
  let state = await store.getState(channelId);

  if (!state.statsPassStartedAt || !state.statsPassKind || !state.statsPassWindowStart) {
    const kind: StatsPassKind = !state.statsSyncedAt
      ? "backfill"
      : !state.statsRevisedAt ||
          daysBetween(state.statsRevisedAt, now) >= config.revisionIntervalDays
        ? "revision"
        : "recent";
    const windowDays =
      kind === "backfill"
        ? config.maxHistoryDays
        : kind === "revision"
          ? config.revisionWindowDays
          : config.recentWindowDays;
    const patch = {
      statsPassKind: kind,
      statsPassStartedAt: nowIso,
      statsPassWindowStart: addDays(today, -windowDays),
      statsPassChannelDone: false,
    };
    await store.saveState(channelId, patch);
    state = { ...state, ...patch };
  }

  const kind = state.statsPassKind as StatsPassKind;
  const passStartedAt = state.statsPassStartedAt as string;
  const windowStart = state.statsPassWindowStart as string;
  const run: StatsRun = {
    ctx,
    revenueAvailable: true,
    fastPathAvailable: true,
    usedFallback: false,
  };
  const result: StatsResult = {
    status: "complete",
    kind,
    channelDays: 0,
    videosSynced: 0,
    videoRows: 0,
    videosRemaining: 0,
    usedFallback: false,
    revenueAvailable: true,
  };
  const finish = (status: StatsResult["status"], remaining: number): StatsResult => ({
    ...result,
    status,
    videosRemaining: remaining,
    usedFallback: run.usedFallback,
    revenueAvailable: run.revenueAvailable,
  });

  const allVideos = (await store.listVideos(channelId)).filter((v) => v.status !== "deleted");
  const pending = () =>
    allVideos.filter((v) => !v.analyticsUpdatedAt || v.analyticsUpdatedAt < passStartedAt);

  try {
    // 1. Authoritative channel totals for the whole window.
    if (!state.statsPassChannelDone) {
      const ranges = splitDateRange(windowStart, today, config.maxRangeDays);
      if (!budget.take(ranges.length)) return finish("paused", pending().length);
      result.channelDays = await syncChannelTotals(run, windowStart, today);
      await store.saveState(channelId, { statsPassChannelDone: true });
    }

    // 2. Per-video rows, stalest first. Videos never synced before get their full history;
    //    the rest get this pass's window.
    const queue = pending().sort((a, b) =>
      (a.analyticsUpdatedAt ?? "").localeCompare(b.analyticsUpdatedAt ?? ""),
    );
    const neverSynced = queue.filter((v) => !v.analyticsUpdatedAt);
    const synced = queue.filter((v) => v.analyticsUpdatedAt);
    const batches: Array<{ videos: StoredVideo[]; start: string }> = [
      ...chunk(neverSynced, config.videoBatchSize).map((videos) => ({
        videos,
        start: videos.map((v) => historyStartFor(v, today, config)).sort()[0],
      })),
      ...chunk(synced, config.videoBatchSize).map((videos) => ({ videos, start: windowStart })),
    ];

    for (const batch of batches) {
      const ranges = splitDateRange(batch.start, today, config.maxRangeDays);
      const rowsByVideo = new Map<string, VideoDailyStats[]>(batch.videos.map((v) => [v.id, []]));
      let needsDocumented: StoredVideo[] = batch.videos;

      if (run.fastPathAvailable) {
        // 2 requests per range: the day,video query and the totals it is verified against.
        if (!budget.take(ranges.length * 2)) return finish("paused", pending().length);
        const unverified = new Set<string>();
        for (const range of ranges) {
          const fast = await fetchVideoDaysFast(run, batch.videos, range);
          for (const row of fast.rows) rowsByVideo.get(row.videoId)?.push(row);
          for (const video of fast.unverified) unverified.add(video.id);
        }
        needsDocumented = batch.videos.filter((v) => unverified.has(v.id));
      }

      const done: StoredVideo[] = batch.videos.filter((v) => !needsDocumented.includes(v));
      for (const video of needsDocumented) {
        run.usedFallback = true;
        if (!budget.take(ranges.length)) break;
        const rows: VideoDailyStats[] = [];
        for (const range of ranges)
          rows.push(...(await fetchVideoDaysDocumented(run, video, range)));
        rowsByVideo.set(video.id, rows);
        done.push(video);
      }

      if (done.length) {
        const rows = done.flatMap((v) => rowsByVideo.get(v.id) ?? []);
        await store.replaceVideoDays(
          channelId,
          done.map((v) => v.id),
          batch.start,
          today,
          rows,
          nowIso,
        );
        await store.markVideosSynced(
          done.map((v) => v.id),
          nowIso,
        );
        for (const video of done) video.analyticsUpdatedAt = nowIso;
        result.videosSynced += done.length;
        result.videoRows += rows.length;
      }
      if (done.length < batch.videos.length) return finish("paused", pending().length);
    }
  } catch (error) {
    if (error instanceof BudgetExhausted) return finish("paused", pending().length);
    throw error;
  }

  await store.saveState(channelId, {
    statsPassKind: null,
    statsPassStartedAt: null,
    statsPassWindowStart: null,
    statsPassChannelDone: false,
    statsSyncedAt: nowIso,
    statsRevisedAt: kind === "recent" ? state.statsRevisedAt : nowIso,
  });
  return finish("complete", 0);
}

// ============================================================================================
// Orchestration
// ============================================================================================

export interface ChannelSyncResult {
  channelId: string;
  status: "complete" | "paused" | "failed";
  requestsUsed: number;
  catalogue: CatalogueResult | null;
  stats: StatsResult | null;
  error: string | null;
}

/** One bounded unit of work for one channel. Never throws: a failure is recorded on the
 * channel's sync state and returned, so one channel cannot stop the others. */
export async function runChannelSync(ctx: ChannelSyncContext): Promise<ChannelSyncResult> {
  const { store, channelId, budget, now } = ctx;
  const result: ChannelSyncResult = {
    channelId,
    status: "complete",
    requestsUsed: 0,
    catalogue: null,
    stats: null,
    error: null,
  };
  try {
    result.catalogue = await syncCatalogue(ctx);
    // Stats need the catalogue: a paused catalogue pass must finish first, otherwise a
    // half-listed channel would have part of its videos treated as the whole.
    if (result.catalogue.status === "complete") result.stats = await syncChannelStats(ctx);
    result.status =
      result.catalogue.status === "paused" || result.stats?.status === "paused"
        ? "paused"
        : "complete";
  } catch (error) {
    result.status = "failed";
    result.error = describeSyncError(error);
  }
  result.requestsUsed = budget.spent;
  try {
    await store.saveState(channelId, { lastRunAt: now.toISOString(), lastError: result.error });
  } catch {
    // Recording the outcome is best-effort; the work itself already succeeded or failed above.
  }
  return result;
}

export interface SyncBatchDeps {
  /** Channels due for work, least recently run first. */
  listChannelIds(): Promise<string[]>;
  /** Build the context for one channel, or throw if it cannot be synced right now. */
  contextFor(channelId: string): Promise<ChannelSyncContext>;
  now(): number;
}

/** Work through channels until `deadline` (epoch ms). Each channel is isolated: one failing —
 * while building its context or while syncing — is reported and the loop moves on. */
export async function runSyncBatch(
  deps: SyncBatchDeps,
  deadline: number,
): Promise<{ results: ChannelSyncResult[]; skipped: number }> {
  const ids = await deps.listChannelIds();
  const results: ChannelSyncResult[] = [];
  let processed = 0;
  for (const channelId of ids) {
    if (deps.now() >= deadline) break;
    processed += 1;
    try {
      results.push(await runChannelSync(await deps.contextFor(channelId)));
    } catch (error) {
      results.push({
        channelId,
        status: "failed",
        requestsUsed: 0,
        catalogue: null,
        stats: null,
        error: describeSyncError(error),
      });
    }
  }
  return { results, skipped: ids.length - processed };
}
