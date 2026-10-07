// GET /api/revenue/summary — the first consumer of the canonical revenue layer.
//
//   route  →  this file  →  revenue-store  →  revenue-metrics  →  stored P0 data
//
// Everything is read from stored rows through the caller's own (RLS-scoped) client. Nothing here
// calls YouTube and nothing here computes revenue: every earned figure comes from
// revenue-metrics. This file only validates the request, reads what the metrics need plus the
// context that explains them (video titles, sync state, deals), and shapes the response.
//
// Three money states are kept apart and never added together:
//   earned      YouTube-reported revenue (estimated, USD)
//   contracted  deals in stage 'contracted'
//   pipeline    deals in stage 'prospect', 'pitched' or 'negotiating'
// Completed deals are reported separately again. There is no combined total.

import { z } from "zod";
import {
  DEFAULT_REVENUE_METRICS_CONFIG,
  periodLengthDays,
  previousPeriod,
  reconcilePeriod,
  summarizeRevenue,
  type MetricChange,
  type RevenueAmount,
  type RevenueAvailability,
  type RevenueFreshness,
  type RevenuePeriod,
  type RevenueReconciliation,
  type RevenueTotals,
  type TrendGranularity,
} from "./revenue-metrics";
import {
  loadRevenueData,
  nullableNumber,
  type RevenueChannel,
  type RevenueDataset,
  type RevenueReadContext,
} from "./revenue-store";
import { addDays, isoDay } from "./youtube-stats-sync";

// ============================================================================================
// Request
// ============================================================================================

export const DEFAULT_PERIOD_DAYS = 28;
export const MAX_PERIOD_DAYS = 366;
export const DEFAULT_TOP_VIDEOS = 10;
export const MAX_TOP_VIDEOS = 50;
// Above this many days a daily trend is more points than a chart can use; default to months.
const DAILY_TREND_MAX_DAYS = 92;

export const revenueDayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  // Rejects dates that look right but do not exist (2026-02-30).
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && isoDay(date) === value;
  });

/** The parameters every revenue endpoint accepts, declared once. */
export const revenuePeriodParams = {
  start: revenueDayString.optional(),
  end: revenueDayString.optional(),
  days: z.coerce.number().int().min(1).max(MAX_PERIOD_DAYS).optional(),
  channelId: z.string().uuid().optional(),
};

const querySchema = z.object({
  ...revenuePeriodParams,
  granularity: z.enum(["day", "month"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TOP_VIDEOS).optional(),
});

export interface RevenueSummaryQuery {
  period: RevenuePeriod;
  /** True when the caller gave no dates and the default period was used. */
  defaulted: boolean;
  channelId: string | null;
  granularity: TrendGranularity;
  topVideos: number;
}

export class RevenueSummaryError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR" | "CHANNEL_NOT_FOUND",
    readonly status: number,
  ) {
    super(code);
  }
}

/** Query parameters as a plain object; an empty parameter is the same as an absent one. */
export function readQueryParams(url: URL): Record<string, string> {
  return Object.fromEntries([...url.searchParams].filter(([, value]) => value !== ""));
}

/**
 * The one definition of a requested period, shared by every revenue endpoint.
 *
 * Dates are YouTube reporting days (YYYY-MM-DD), exactly as stored: YouTube labels a day in
 * Pacific time and those labels are compared as-is, never shifted into another timezone. `today`
 * is the current UTC calendar date and is used only to bound the request and to pick the default
 * period — never to relabel a stored day.
 *
 *   ?start=&end=   an explicit inclusive range
 *   ?days=N        the N days ending on the newest day YouTube is expected to have reported
 *   (nothing)      the same, with N = 28
 */
export function resolveRevenuePeriod(
  input: { start?: string; end?: string; days?: number },
  today: string,
): { period: RevenuePeriod; defaulted: boolean } {
  const { start, end, days } = input;
  // A range needs both ends, and a range and a day count are two different requests.
  if (Boolean(start) !== Boolean(end) || (start && days !== undefined))
    throw new RevenueSummaryError("VALIDATION_ERROR", 422);

  let period: RevenuePeriod;
  if (start && end) {
    period = { startDate: start, endDate: end };
    if (start > end || end > today || periodLengthDays(period) > MAX_PERIOD_DAYS)
      throw new RevenueSummaryError("VALIDATION_ERROR", 422);
  } else {
    const endDate = addDays(today, -DEFAULT_REVENUE_METRICS_CONFIG.dataLagDays);
    period = { startDate: addDays(endDate, -((days ?? DEFAULT_PERIOD_DAYS) - 1)), endDate };
  }
  return { period, defaulted: !start && days === undefined };
}

/**
 * Any query parameter not listed in the schema (including a workspace id) is ignored: the
 * workspace always comes from the session.
 */
export function parseRevenueSummaryQuery(url: URL, today: string): RevenueSummaryQuery {
  const parsed = querySchema.safeParse(readQueryParams(url));
  if (!parsed.success) throw new RevenueSummaryError("VALIDATION_ERROR", 422);
  const { channelId, granularity, limit } = parsed.data;
  const { period, defaulted } = resolveRevenuePeriod(parsed.data, today);
  return {
    period,
    defaulted,
    channelId: channelId ?? null,
    granularity: granularity ?? (periodLengthDays(period) > DAILY_TREND_MAX_DAYS ? "month" : "day"),
    topVideos: limit ?? DEFAULT_TOP_VIDEOS,
  };
}

// ============================================================================================
// Response
// ============================================================================================

export interface RevenueAmountView {
  /** Sum of the known values; null when nothing is known. A null is never a zero. */
  usd: number | null;
  availability: RevenueAvailability;
  /** Channel-days whose revenue was reported / not reported. With one channel these are days. */
  knownDays: number;
  unknownDays: number;
}

export function amountView(amount: RevenueAmount): RevenueAmountView {
  return {
    usd: amount.usd,
    availability: amount.availability,
    knownDays: amount.knownRows,
    unknownDays: amount.unknownRows,
  };
}

function totalsView(totals: RevenueTotals) {
  return {
    revenue: amountView(totals.earned),
    views: totals.views,
    watchMinutes: totals.watchMinutes,
    rpm: totals.rpm,
    split: {
      ad: amountView(totals.split.ad),
      premium: amountView(totals.split.premium),
      other: amountView(totals.split.other),
    },
  };
}

/**
 * Why channel activity is not explained by video rows. Neutral on purpose: none of these says a
 * video was deleted, by whom, or why.
 *
 *   fully_attributed         nothing is unexplained
 *   catalogue_pending        the channel's video list has not been fully read yet (or a full
 *                            read is in progress), so videos may simply not be known yet
 *   video_history_pending    the video list is complete but per-video history is still loading
 *   videos_no_longer_listed  the list and history are complete, and some videos this channel
 *                            used to have are no longer returned by YouTube
 *   unexplained              none of the above accounts for it
 */
export type AttributionState =
  | "fully_attributed"
  | "catalogue_pending"
  | "video_history_pending"
  | "videos_no_longer_listed"
  | "unexplained";

// Most uncertain first: with several channels, the summary reports the least settled state.
const ATTRIBUTION_PRIORITY: AttributionState[] = [
  "catalogue_pending",
  "video_history_pending",
  "videos_no_longer_listed",
  "unexplained",
  "fully_attributed",
];

export interface ChannelSyncFacts {
  channelId: string;
  /** False when the channel has no sync-state row at all (never synced). */
  hasState: boolean;
  catalogueFullSyncedAt: string | null;
  cataloguePassInProgress: boolean;
  statsSyncedAt: string | null;
  statsBackfillInProgress: boolean;
  hasSyncError: boolean;
  /** Known videos that are still listed but have never had their history loaded. */
  videosAwaitingHistory: number;
  /** Known videos YouTube no longer returns (internal status 'deleted'). */
  videosNoLongerListed: number;
}

/** Pure: the state for one channel, from its reconciliation and what the sync has done so far. */
export function attributionStateFor(
  reconciliation: Pick<
    RevenueReconciliation,
    "unattributedViews" | "unattributedRevenue" | "fullyAttributed"
  >,
  facts: ChannelSyncFacts,
): AttributionState {
  const hasGap =
    reconciliation.unattributedViews > 0 || (reconciliation.unattributedRevenue.usd ?? 0) > 1e-6;
  if (!hasGap) return "fully_attributed";
  if (!facts.hasState || !facts.catalogueFullSyncedAt || facts.cataloguePassInProgress)
    return "catalogue_pending";
  if (!facts.statsSyncedAt || facts.statsBackfillInProgress || facts.videosAwaitingHistory > 0)
    return "video_history_pending";
  if (facts.videosNoLongerListed > 0) return "videos_no_longer_listed";
  return "unexplained";
}

export interface DealRow {
  value: unknown;
  currency: string | null;
  stage: string;
  closed_at: string | null;
}

export interface DealCurrencySummary {
  currency: string;
  contracted: { value: number; count: number };
  pipeline: { value: number; count: number };
  /** Deals in stage 'completed' whose close date falls in the period (UTC date of closed_at). */
  dealsCompletedValue: number;
  dealsCompletedCount: number;
}

const PIPELINE_STAGES = new Set(["prospect", "pitched", "negotiating"]);
const roundCents = (value: number) => Math.round(value * 100) / 100;

/**
 * Pure. Deal values are grouped by the deal's own currency and never added across currencies or
 * converted: there is no workspace currency and no exchange rate in this product, so a single
 * total across currencies would be a made-up number. Contracted and pipeline are the deals'
 * CURRENT stage (they are open positions, not events in the period); completed is counted in
 * the period by its close date.
 */
export function summarizeDeals(deals: DealRow[], period: RevenuePeriod): DealCurrencySummary[] {
  const byCurrency = new Map<string, DealCurrencySummary>();
  for (const deal of deals) {
    const value = nullableNumber(deal.value);
    if (value === null || value < 0) continue;
    const currency = (deal.currency ?? "").trim().toUpperCase() || "UNKNOWN";
    if (!byCurrency.has(currency))
      byCurrency.set(currency, {
        currency,
        contracted: { value: 0, count: 0 },
        pipeline: { value: 0, count: 0 },
        dealsCompletedValue: 0,
        dealsCompletedCount: 0,
      });
    const entry = byCurrency.get(currency)!;
    if (deal.stage === "contracted") {
      entry.contracted.value = roundCents(entry.contracted.value + value);
      entry.contracted.count += 1;
    } else if (PIPELINE_STAGES.has(deal.stage)) {
      entry.pipeline.value = roundCents(entry.pipeline.value + value);
      entry.pipeline.count += 1;
    } else if (deal.stage === "completed" && deal.closed_at) {
      const closedDay = deal.closed_at.slice(0, 10);
      if (closedDay >= period.startDate && closedDay <= period.endDate) {
        entry.dealsCompletedValue = roundCents(entry.dealsCompletedValue + value);
        entry.dealsCompletedCount += 1;
      }
    }
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface RevenueSummaryResponse {
  status: "connected" | "not_connected";
  /** Currency of every figure under `earned` and `videos`. Deals carry their own currency. */
  currency: "USD";
  /** How to read every date in this response. */
  dateBasis: "youtube_reporting_day";
  period: RevenuePeriod & { days: number; defaulted: boolean };
  previousPeriod: RevenuePeriod;
  granularity: TrendGranularity;
  channels: RevenueChannel[];
  earned: ReturnType<typeof totalsView> & {
    previous: ReturnType<typeof totalsView>;
    change: {
      revenue: MetricChange;
      views: MetricChange;
      watchMinutes: MetricChange;
      rpm: MetricChange;
      /** False when either period's revenue is partial or unavailable. */
      revenueComparable: boolean;
    };
    trend: Array<{
      bucket: string;
      startDate: string;
      endDate: string;
      revenue: RevenueAmountView;
      views: number;
      watchMinutes: number;
      rpm: number | null;
      hasData: boolean;
      incomplete: boolean;
    }>;
  };
  videos: {
    /** Highest-earning videos in the period, from stored per-video rows. */
    top: Array<{
      videoId: string;
      youtubeVideoId: string | null;
      channelId: string;
      title: string | null;
      thumbnail: string | null;
      publishedAt: string | null;
      /** False when YouTube no longer returns this video. Its stored history is still shown. */
      currentlyListed: boolean | null;
      revenue: RevenueAmountView;
      views: number;
      watchMinutes: number;
      rpm: number | null;
      /** Share of CHANNEL-level earned revenue (0–1); shares need not add up to 1. */
      revenueShare: number | null;
      viewShare: number | null;
    }>;
    /** Videos with any stored activity in the period. */
    count: number;
    attribution: {
      state: AttributionState;
      /** The authoritative channel figure the two below are parts of. */
      channelRevenue: RevenueAmountView;
      /** Explained by stored video rows. */
      attributedRevenue: RevenueAmountView;
      /** Not explained by any stored video row. Never redistributed across videos. */
      unattributedRevenue: RevenueAmountView;
      channelViews: number;
      attributedViews: number;
      unattributedViews: number;
      /** Days where video rows add up to more than the channel total (fetched at different
       * moments). Reported, not corrected. */
      daysVideosExceedChannel: number;
      byChannel: Array<{
        channelId: string;
        state: AttributionState;
        unattributedViews: number;
        unattributedRevenue: RevenueAmountView;
        videosNoLongerListed: number;
        videosAwaitingHistory: number;
      }>;
    };
  };
  dataQuality: {
    freshness: RevenueFreshness;
    /** Rows with impossible values that were ignored, and rows with negative revenue. */
    invalidRows: number;
    negativeRevenueRows: number;
    sync: Array<{
      channelId: string;
      lastStatsSyncAt: string | null;
      lastFullCatalogueAt: string | null;
      hasSyncError: boolean;
    }>;
  };
  /** Brand deals. Separate money states in each deal's own currency; never part of `earned`. */
  deals:
    | { available: true; byCurrency: DealCurrencySummary[] }
    | { available: false; reason: "FEATURE_UNAVAILABLE" };
}

// ============================================================================================
// Reads that give the metrics their context
// ============================================================================================

const PAGE_SIZE = 1000;

export interface VideoMeta {
  id: string;
  channel_id: string;
  youtube_video_id: string | null;
  title: string | null;
  thumbnail: string | null;
  published_at: string | null;
  status: string;
  analytics_updated_at: string | null;
}

function fail(operation: string, error: { code?: string } | null): never {
  console.error("Revenue summary read failed", { operation, code: error?.code });
  throw new Error(`REVENUE_SUMMARY:${operation}`);
}

export async function readVideos(
  ctx: RevenueReadContext,
  channelIds: string[],
): Promise<VideoMeta[]> {
  const rows: VideoMeta[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await ctx.client
      .from("videos")
      .select(
        "id, channel_id, youtube_video_id, title, thumbnail, published_at, status, analytics_updated_at",
      )
      .in("channel_id", channelIds)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail("READ_VIDEOS", error);
    rows.push(...((data ?? []) as VideoMeta[]));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

export async function readSyncFacts(
  ctx: RevenueReadContext,
  channelIds: string[],
  videos: VideoMeta[],
): Promise<Map<string, ChannelSyncFacts>> {
  const { data, error } = await ctx.client
    .from("youtube_sync_state")
    .select(
      "channel_id, catalogue_full_synced_at, catalogue_pass_started_at, stats_synced_at, stats_pass_kind, last_error",
    )
    .in("channel_id", channelIds);
  if (error) fail("READ_SYNC_STATE", error);
  const states = new Map((data ?? []).map((row) => [row.channel_id as string, row]));
  return new Map(
    channelIds.map((channelId) => {
      const state = states.get(channelId);
      const own = videos.filter((video) => video.channel_id === channelId);
      return [
        channelId,
        {
          channelId,
          hasState: Boolean(state),
          catalogueFullSyncedAt: (state?.catalogue_full_synced_at as string | null) ?? null,
          cataloguePassInProgress: Boolean(state?.catalogue_pass_started_at),
          statsSyncedAt: (state?.stats_synced_at as string | null) ?? null,
          statsBackfillInProgress: state?.stats_pass_kind === "backfill",
          hasSyncError: Boolean(state?.last_error),
          videosAwaitingHistory: own.filter(
            (video) => video.status !== "deleted" && !video.analytics_updated_at,
          ).length,
          videosNoLongerListed: own.filter((video) => video.status === "deleted").length,
        },
      ];
    }),
  );
}

async function readDeals(ctx: RevenueReadContext): Promise<DealRow[]> {
  const rows: DealRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await ctx.client
      .from("deals")
      .select("id, value, currency, stage, closed_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail("READ_DEALS", error);
    rows.push(...((data ?? []) as unknown as DealRow[]));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

// ============================================================================================
// Attribution
// ============================================================================================

export type AttributionView = RevenueSummaryResponse["videos"]["attribution"];

/**
 * How much of the channel total is explained by stored video rows, and — per channel — why any
 * remainder exists. Each channel is reconciled on its own with the same canonical function, only
 * so its remainder can be explained by that channel's own sync state.
 */
export function describeAttribution(
  dataset: Pick<RevenueDataset, "channels" | "channelRows" | "videoRows">,
  period: RevenuePeriod,
  facts: Map<string, ChannelSyncFacts>,
  reconciliation: RevenueReconciliation,
): AttributionView {
  const byChannel = dataset.channels.map(({ id: channelId }) => {
    const own = reconcilePeriod(
      dataset.channelRows.filter((row) => row.channelId === channelId),
      dataset.videoRows.filter((row) => row.channelId === channelId),
      period,
    );
    const channelFacts = facts.get(channelId)!;
    return {
      channelId,
      state: attributionStateFor(own, channelFacts),
      unattributedViews: own.unattributedViews,
      unattributedRevenue: amountView(own.unattributedRevenue),
      videosNoLongerListed: channelFacts.videosNoLongerListed,
      videosAwaitingHistory: channelFacts.videosAwaitingHistory,
    };
  });
  return {
    state:
      ATTRIBUTION_PRIORITY.find((candidate) => byChannel.some((c) => c.state === candidate)) ??
      "fully_attributed",
    channelRevenue: amountView(reconciliation.channelRevenue),
    attributedRevenue: amountView(reconciliation.attributedRevenue),
    unattributedRevenue: amountView(reconciliation.unattributedRevenue),
    channelViews: reconciliation.channelViews,
    attributedViews: reconciliation.attributedViews,
    unattributedViews: reconciliation.unattributedViews,
    daysVideosExceedChannel: reconciliation.daysVideosExceedChannel,
    byChannel,
  };
}

export type SyncView = RevenueSummaryResponse["dataQuality"]["sync"];

/** When each channel was last synced, without any raw error text. */
export function describeSync(channelIds: string[], facts: Map<string, ChannelSyncFacts>): SyncView {
  return channelIds.map((channelId) => ({
    channelId,
    lastStatsSyncAt: facts.get(channelId)!.statsSyncedAt,
    lastFullCatalogueAt: facts.get(channelId)!.catalogueFullSyncedAt,
    hasSyncError: facts.get(channelId)!.hasSyncError,
  }));
}

// ============================================================================================
// Build
// ============================================================================================

export interface BuildRevenueSummaryOptions {
  /** Current UTC calendar date (YYYY-MM-DD). */
  today: string;
  /** Whether this caller may see brand-deal values (the existing brand_deals feature gate). */
  includeDeals: boolean;
}

export async function buildRevenueSummary(
  ctx: RevenueReadContext,
  query: RevenueSummaryQuery,
  options: BuildRevenueSummaryOptions,
): Promise<RevenueSummaryResponse> {
  // One read covers the period and the one before it (for the comparison); the rows are kept
  // so each channel can also be reconciled on its own below.
  const dataset = await loadRevenueData(
    ctx,
    { startDate: previousPeriod(query.period).startDate, endDate: query.period.endDate },
    { channelId: query.channelId ?? undefined },
  );
  // A channel id that is unknown, belongs to another workspace, or is disconnected resolves to
  // no channel at all — indistinguishable on purpose, so the endpoint cannot be used to probe
  // which channel ids exist elsewhere.
  if (query.channelId && dataset.channels.length === 0)
    throw new RevenueSummaryError("CHANNEL_NOT_FOUND", 404);

  const channelIds = dataset.channels.map((channel) => channel.id);
  const summary = summarizeRevenue({
    channelRows: dataset.channelRows,
    videoRows: dataset.videoRows,
    channelIds,
    period: query.period,
    asOf: options.today,
    granularity: query.granularity,
  });
  const videos = channelIds.length ? await readVideos(ctx, channelIds) : [];
  const facts = channelIds.length
    ? await readSyncFacts(ctx, channelIds, videos)
    : new Map<string, ChannelSyncFacts>();
  const videoById = new Map(videos.map((video) => [video.id, video]));

  const deals: RevenueSummaryResponse["deals"] = options.includeDeals
    ? { available: true, byCurrency: summarizeDeals(await readDeals(ctx), query.period) }
    : { available: false, reason: "FEATURE_UNAVAILABLE" };

  return {
    status: channelIds.length ? "connected" : "not_connected",
    currency: summary.currency,
    dateBasis: "youtube_reporting_day",
    period: {
      ...query.period,
      days: periodLengthDays(query.period),
      defaulted: query.defaulted,
    },
    previousPeriod: summary.previousPeriod,
    granularity: query.granularity,
    channels: dataset.channels,
    earned: {
      ...totalsView(summary.current),
      previous: totalsView(summary.previous),
      change: {
        revenue: summary.change.earned,
        views: summary.change.views,
        watchMinutes: summary.change.watchMinutes,
        rpm: summary.change.rpm,
        revenueComparable: summary.change.revenueComparable,
      },
      trend: summary.trend.map((point) => ({
        bucket: point.bucket,
        startDate: point.startDate,
        endDate: point.endDate,
        revenue: amountView(point.earned),
        views: point.views,
        watchMinutes: point.watchMinutes,
        rpm: point.rpm,
        hasData: point.hasData,
        incomplete: point.incomplete,
      })),
    },
    videos: {
      top: summary.videos.slice(0, query.topVideos).map((video) => {
        const meta = videoById.get(video.videoId);
        return {
          videoId: video.videoId,
          youtubeVideoId: meta?.youtube_video_id ?? null,
          channelId: video.channelId,
          title: meta?.title ?? null,
          thumbnail: meta?.thumbnail ?? null,
          publishedAt: meta?.published_at ?? null,
          currentlyListed: meta ? meta.status !== "deleted" : null,
          revenue: amountView(video.earned),
          views: video.views,
          watchMinutes: video.watchMinutes,
          rpm: video.rpm,
          revenueShare: video.revenueShare,
          viewShare: video.viewShare,
        };
      }),
      count: summary.videos.length,
      attribution: describeAttribution(dataset, query.period, facts, summary.reconciliation),
    },
    dataQuality: {
      freshness: summary.freshness,
      invalidRows: summary.current.invalidRows,
      negativeRevenueRows: summary.current.negativeRevenueRows,
      sync: describeSync(channelIds, facts),
    },
    deals,
  };
}

// ============================================================================================
// HTTP
// ============================================================================================

export function revenueJson(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

/** The response for anything a revenue endpoint throws: an auth Response passes through, a
 * request error becomes its own status, and anything else is a 500 with a stable code and no
 * details. */
export function revenueErrorResponse(error: unknown, label: string): Response {
  if (error instanceof Response) return error;
  if (error instanceof RevenueSummaryError)
    return revenueJson({ error: error.code }, { status: error.status });
  console.error(label, { message: error instanceof Error ? error.message : "unknown" });
  return revenueJson({ error: "DATABASE_ERROR" }, { status: 500 });
}

export interface RevenueSummaryDeps {
  /** Resolves the signed-in caller and their workspace; throws a Response when there is none. */
  getContext(request: Request): Promise<RevenueReadContext>;
  /** Whether the caller's role may see brand deals. */
  canViewDeals(request: Request): Promise<boolean>;
  now(): Date;
}

/** The whole request, with its outside dependencies passed in so it can be tested as a unit. */
export async function handleRevenueSummaryRequest(
  request: Request,
  deps: RevenueSummaryDeps,
): Promise<Response> {
  try {
    const ctx = await deps.getContext(request);
    const today = isoDay(deps.now());
    const query = parseRevenueSummaryQuery(new URL(request.url), today);
    const data = await buildRevenueSummary(ctx, query, {
      today,
      includeDeals: await deps.canViewDeals(request),
    });
    return revenueJson({ data });
  } catch (error) {
    return revenueErrorResponse(error, "Revenue summary failed");
  }
}
