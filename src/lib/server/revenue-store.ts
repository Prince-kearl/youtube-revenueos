// Reads the stored P0 revenue rows for revenue-metrics.ts.
//
//   UI / API  →  revenue-store (this file)  →  revenue-metrics  →  stored P0 data
//
// Which channels a caller may read is always decided by row-level security: the channel list is
// read on the CALLER's client, so it holds only channels of a workspace they are an active member
// of. Stats rows are then read for exactly those channel ids and no others.
//
// The stats tables hold two kinds of column:
//
//   activity  (views, watch_minutes)                       readable by any member
//   money     (estimated / ad / premium revenue, in USD)   NOT readable through the member-facing
//                                                          database role (see the
//                                                          revenue-column-privacy migration)
//
// So how the rows are read depends on `ctx.revenue` (see lib/server/revenue-visibility.ts):
//
//   { visible: true, money }        the caller may see revenue: all columns are read through
//                                   the MoneyReader, which is bound to the caller's workspace
//                                   and re-checks every channel id against it
//   { visible: false }              the caller may not: only the activity columns are requested,
//                                   on the caller's own client. No amount ever enters this
//                                   process, so nothing downstream can leak one — every revenue
//                                   figure simply comes out as "not available"
//   (absent)                        all columns on the caller's client. Unit tests and scripts
//                                   only; a route always states which of the two above applies
//
// Nothing in this file calls YouTube.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  previousPeriod,
  summarizeRevenue,
  type ChannelRevenueDay,
  type RevenueMetricsConfig,
  type RevenuePeriod,
  type RevenueSummary,
  type TrendGranularity,
  type VideoRevenueDay,
} from "./revenue-metrics";
import { isoDay } from "./youtube-stats-sync";
import type { WorkspaceContext } from "./workspace";

/** One stored stats row including its money columns, as the MoneyReader returns it. */
export interface MoneyStatsRow {
  channel_id: string;
  video_id?: string;
  day: string;
  views: unknown;
  watch_minutes: unknown;
  estimated_revenue_usd: unknown;
  ad_revenue_usd: unknown;
  premium_revenue_usd: unknown;
}

/**
 * The only way this module — or any other — reads amounts. A MoneyReader is created by
 * lib/server/revenue-visibility.ts for a caller it has authorised, and is bound to that caller's
 * workspace: it exposes these fixed queries and nothing else (no table, column or workspace can
 * be chosen by whoever holds it).
 */
export interface MoneyReader {
  /** Stats rows with revenue, for those of `channelIds` that belong to the reader's workspace. */
  readStats(
    table: "channel_daily_stats" | "video_daily_stats",
    channelIds: string[],
    range: RevenuePeriod,
  ): Promise<MoneyStatsRow[]>;
  /** Deal values of the reader's workspace, by deal id (all deals, or only those listed). */
  dealValues(dealIds?: string[]): Promise<Map<string, number | null>>;
  /** What the revenue summary needs of the reader's workspace's deals. */
  dealSummaryRows(): Promise<
    Array<{
      id: string;
      value: unknown;
      currency: string | null;
      stage: string;
      closed_at: string | null;
    }>
  >;
}

/** How the caller may read the money columns — decided by resolveRevenueAccess, never here. */
export type RevenueReadMode = { visible: true; money: MoneyReader } | { visible: false };

/** What a caller needs to read revenue: its own client and workspace (from getWorkspaceContext
 * or requireWorkspaceFeature), and whether it may see amounts. */
export type RevenueReadContext = Pick<WorkspaceContext, "client" | "workspaceId"> & {
  revenue?: RevenueReadMode;
};

/** True when the caller's amounts were withheld (the rows carry activity only). */
export function revenueWithheld(ctx: RevenueReadContext): boolean {
  return ctx.revenue?.visible === false;
}

/** The reader of amounts for this caller, or null when they may not see them (or when no mode
 * was stated: see the file header). */
export function moneyReader(ctx: RevenueReadContext): MoneyReader | null {
  return ctx.revenue?.visible ? ctx.revenue.money : null;
}

export interface RevenueChannel {
  id: string;
  youtubeChannelId: string;
  name: string | null;
  /** False for a channel that was disconnected: its history is kept and still readable. */
  connected: boolean;
}

export interface RevenueChannelFilter {
  /** Restrict to one channel (youtube_channels.id). */
  channelId?: string;
  /** Also include disconnected channels, whose stored history remains. Default: connected only. */
  includeDisconnected?: boolean;
}

export interface RevenueDataset {
  channels: RevenueChannel[];
  range: RevenuePeriod;
  channelRows: ChannelRevenueDay[];
  videoRows: VideoRevenueDay[];
}

const PAGE_SIZE = 1000;
const ACTIVITY_COLUMNS = "channel_id, day, views, watch_minutes";
const STATS_COLUMNS = `${ACTIVITY_COLUMNS}, estimated_revenue_usd, ad_revenue_usd, premium_revenue_usd`;

function fail(operation: string, error: { message?: string; code?: string } | null): never {
  // Logged without row contents; the caller gets a stable code, not a database message.
  console.error("Revenue store read failed", { operation, code: error?.code });
  throw new Error(`REVENUE_STORE:${operation}`);
}

/** A numeric column as a number, keeping NULL as null (PostgREST may send numerics as strings). */
export function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface StoredStatsRow {
  channel_id: string;
  video_id?: string;
  day: string;
  views: unknown;
  watch_minutes: unknown;
  // Absent when the caller may not see revenue: the columns were never requested.
  estimated_revenue_usd?: unknown;
  ad_revenue_usd?: unknown;
  premium_revenue_usd?: unknown;
}

export function toChannelRevenueDay(row: StoredStatsRow): ChannelRevenueDay {
  return {
    channelId: row.channel_id,
    day: row.day,
    // views and watch_minutes are NOT NULL in the schema; revenue columns are nullable and a
    // NULL must reach the metrics layer as null.
    views: nullableNumber(row.views) ?? 0,
    watchMinutes: nullableNumber(row.watch_minutes) ?? 0,
    estimatedRevenueUsd: nullableNumber(row.estimated_revenue_usd),
    adRevenueUsd: nullableNumber(row.ad_revenue_usd),
    premiumRevenueUsd: nullableNumber(row.premium_revenue_usd),
  };
}

export function toVideoRevenueDay(row: StoredStatsRow & { video_id: string }): VideoRevenueDay {
  return { ...toChannelRevenueDay(row), videoId: row.video_id };
}

/** The workspace's YouTube channels the caller may read. An unknown or foreign channel id simply
 * yields an empty list: row-level security hides it, and the workspace filter is applied on top
 * as every other workspace-scoped route does. */
export async function listRevenueChannels(
  ctx: RevenueReadContext,
  filter: RevenueChannelFilter = {},
): Promise<RevenueChannel[]> {
  let query = ctx.client
    .from("youtube_channels")
    .select("id, youtube_channel_id, channel_name, connection_id")
    .eq("workspace_id", ctx.workspaceId)
    .order("connected_at", { ascending: false });
  if (!filter.includeDisconnected) query = query.not("connection_id", "is", null);
  if (filter.channelId) query = query.eq("id", filter.channelId);
  const { data, error } = await query;
  if (error) fail("LIST_CHANNELS", error);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    youtubeChannelId: row.youtube_channel_id as string,
    name: (row.channel_name as string | null) ?? null,
    connected: row.connection_id !== null,
  }));
}

async function readStatsRows<T>(
  client: SupabaseClient,
  table: "channel_daily_stats" | "video_daily_stats",
  columns: string,
  channelIds: string[],
  range: RevenuePeriod,
  tieBreaker: "channel_id" | "video_id",
  map: (row: never) => T,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ;) {
    // Ordered by the primary key so pages never overlap or skip.
    const { data, error } = await client
      .from(table)
      .select(columns)
      .in("channel_id", channelIds)
      .gte("day", range.startDate)
      .lte("day", range.endDate)
      .order("day", { ascending: true })
      .order(tieBreaker, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail(`READ_${table.toUpperCase()}`, error);
    const page = (data ?? []) as unknown as never[];
    for (const row of page) rows.push(map(row));
    // A short page is not the end of the data — the API can cap a response below the size
    // asked for — so reading goes on from the rows actually received until a page is empty.
    if (page.length === 0) return rows;
    from += page.length;
  }
}

/** Stored channel and video rows for the caller's channels over an inclusive day range. */
export async function loadRevenueData(
  ctx: RevenueReadContext,
  range: RevenuePeriod,
  filter: RevenueChannelFilter = {},
): Promise<RevenueDataset> {
  const channels = await listRevenueChannels(ctx, filter);
  if (!channels.length) return { channels, range, channelRows: [], videoRows: [] };
  const channelIds = channels.map((channel) => channel.id);
  // A caller who may see revenue: every column, through the reader bound to their workspace.
  const money = moneyReader(ctx);
  if (money) {
    const [channelRows, videoRows] = await Promise.all([
      money.readStats("channel_daily_stats", channelIds, range),
      money.readStats("video_daily_stats", channelIds, range),
    ]);
    return {
      channels,
      range,
      channelRows: channelRows.map(toChannelRevenueDay),
      videoRows: videoRows.flatMap((row) =>
        typeof row.video_id === "string"
          ? [toVideoRevenueDay({ ...row, video_id: row.video_id })]
          : [],
      ),
    };
  }
  // A caller who may not: activity columns only, on their own client — no amount is requested.
  // (With no mode stated at all — unit tests and scripts — every column on the caller's client.)
  const columns = ctx.revenue ? ACTIVITY_COLUMNS : STATS_COLUMNS;
  const [channelRows, videoRows] = await Promise.all([
    readStatsRows(
      ctx.client,
      "channel_daily_stats",
      columns,
      channelIds,
      range,
      "channel_id",
      toChannelRevenueDay,
    ),
    readStatsRows(
      ctx.client,
      "video_daily_stats",
      `video_id, ${columns}`,
      channelIds,
      range,
      "video_id",
      toVideoRevenueDay,
    ),
  ]);
  return { channels, range, channelRows, videoRows };
}

export interface RevenueSummaryOptions extends RevenueChannelFilter {
  period: RevenuePeriod;
  granularity?: TrendGranularity;
  /** Today as YYYY-MM-DD; defaults to the current UTC day. */
  asOf?: string;
  config?: RevenueMetricsConfig;
}

export interface WorkspaceRevenueSummary extends RevenueSummary {
  channels: RevenueChannel[];
}

/** The canonical summary for a period: loads the period and the one before it (for the
 * comparison) and hands the rows to revenue-metrics. */
export async function loadRevenueSummary(
  ctx: RevenueReadContext,
  options: RevenueSummaryOptions,
): Promise<WorkspaceRevenueSummary> {
  const { period } = options;
  const dataset = await loadRevenueData(
    ctx,
    { startDate: previousPeriod(period).startDate, endDate: period.endDate },
    options,
  );
  return {
    channels: dataset.channels,
    ...summarizeRevenue({
      channelRows: dataset.channelRows,
      videoRows: dataset.videoRows,
      channelIds: dataset.channels.map((channel) => channel.id),
      period,
      asOf: options.asOf ?? isoDay(new Date()),
      granularity: options.granularity,
      config: options.config,
    }),
  };
}
