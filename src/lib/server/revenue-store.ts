// Reads the stored P0 revenue rows for revenue-metrics.ts.
//
//   UI / API  →  revenue-store (this file)  →  revenue-metrics  →  stored P0 data
//
// Everything here runs on the CALLER's Supabase client, so row-level security decides what is
// visible: channel_daily_stats and video_daily_stats are readable only through a channel whose
// workspace the caller is an active member of. The service-role client is never used, and
// nothing in this file calls YouTube.

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

/** What a caller needs to read revenue: its own client and workspace (from getWorkspaceContext
 * or requireWorkspaceFeature). */
export type RevenueReadContext = Pick<WorkspaceContext, "client" | "workspaceId">;

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
const STATS_COLUMNS =
  "channel_id, day, views, watch_minutes, estimated_revenue_usd, ad_revenue_usd, premium_revenue_usd";

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
  estimated_revenue_usd: unknown;
  ad_revenue_usd: unknown;
  premium_revenue_usd: unknown;
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
  for (let from = 0; ; from += PAGE_SIZE) {
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
    if (page.length < PAGE_SIZE) return rows;
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
  const [channelRows, videoRows] = await Promise.all([
    readStatsRows(
      ctx.client,
      "channel_daily_stats",
      STATS_COLUMNS,
      channelIds,
      range,
      "channel_id",
      toChannelRevenueDay,
    ),
    readStatsRows(
      ctx.client,
      "video_daily_stats",
      `video_id, ${STATS_COLUMNS}`,
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
