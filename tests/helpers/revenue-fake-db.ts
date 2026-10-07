// Shared by the revenue endpoint tests.
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// A small in-memory database with the same visibility rules the real row-level security
// applies: a caller sees a channel only if it belongs to their workspace, and sees stats, videos
// and sync state only through such a channel. A signed-out caller sees nothing.
// ============================================================

export type Row = Record<string, unknown>;

export class FakeDb {
  tables: Record<string, Row[]> = {
    youtube_channels: [],
    channel_daily_stats: [],
    video_daily_stats: [],
    videos: [],
    youtube_sync_state: [],
    deals: [],
  };
  /** Every table read through any client, in order. */
  reads: string[] = [];

  private visible(table: string, workspaceId: string | null): Row[] {
    if (!workspaceId) return [];
    const ownChannels = new Set(
      this.tables.youtube_channels.filter((c) => c.workspace_id === workspaceId).map((c) => c.id),
    );
    if (table === "youtube_channels" || table === "deals")
      return this.tables[table].filter((row) => row.workspace_id === workspaceId);
    return this.tables[table].filter((row) => ownChannels.has(row.channel_id));
  }

  /** A client acting as a member of `workspaceId` (null = signed out). */
  clientFor(workspaceId: string | null): SupabaseClient {
    return {
      from: (table: string) => {
        this.reads.push(table);
        let rows = [...this.visible(table, workspaceId)];
        const orders: Array<[string, boolean]> = [];
        let window: [number, number] | null = null;
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            rows = rows.filter((row) => row[column] === value);
            return builder;
          },
          in: (column: string, values: unknown[]) => {
            rows = rows.filter((row) => values.includes(row[column]));
            return builder;
          },
          gte: (column: string, value: string) => {
            rows = rows.filter((row) => String(row[column]) >= value);
            return builder;
          },
          lte: (column: string, value: string) => {
            rows = rows.filter((row) => String(row[column]) <= value);
            return builder;
          },
          not: (column: string, operator: string, value: unknown) => {
            assert.deepEqual([operator, value], ["is", null]);
            rows = rows.filter((row) => row[column] !== null && row[column] !== undefined);
            return builder;
          },
          order: (column: string, options?: { ascending?: boolean }) => {
            orders.push([column, options?.ascending !== false]);
            return builder;
          },
          range: (from: number, to: number) => {
            window = [from, to];
            return builder;
          },
          then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
            const sorted = [...rows].sort((a, b) => {
              for (const [column, ascending] of orders) {
                const cmp = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
                if (cmp !== 0) return ascending ? cmp : -cmp;
              }
              return 0;
            });
            const data = window ? sorted.slice(window[0], window[1] + 1) : sorted;
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;
  }
}

export const WS_A = "workspace-a";
export const WS_B = "workspace-b";
// Channel ids must be UUIDs because the endpoint validates the channelId parameter.
export const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
export const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
export const A_OFF = "aaaaaaaa-0000-4000-8000-000000000003";
export const B1 = "bbbbbbbb-0000-4000-8000-000000000001";
export const NOW = new Date("2026-10-10T08:00:00Z");
export const SEPT = "start=2026-09-01&end=2026-09-30";

export function channel(
  db: FakeDb,
  id: string,
  workspaceId: string,
  name: string,
  connected = true,
) {
  db.tables.youtube_channels.push({
    id,
    workspace_id: workspaceId,
    youtube_channel_id: `UC-${name}`,
    channel_name: name,
    connection_id: connected ? `conn-${id}` : null,
    connected_at: "2026-01-01T00:00:00Z",
  });
}

export function channelDay(db: FakeDb, channelId: string, day: string, values: Row = {}) {
  db.tables.channel_daily_stats.push({
    channel_id: channelId,
    day,
    views: 1000,
    watch_minutes: 2000,
    estimated_revenue_usd: 5,
    ad_revenue_usd: 4,
    premium_revenue_usd: 0.5,
    ...values,
  });
}

export function video(db: FakeDb, id: string, channelId: string, values: Row = {}) {
  db.tables.videos.push({
    id,
    channel_id: channelId,
    youtube_video_id: `yt-${id}`,
    title: `Title ${id}`,
    thumbnail: `https://img.test/${id}.jpg`,
    published_at: "2026-08-01T00:00:00Z",
    status: "active",
    analytics_updated_at: "2026-10-09T00:00:00Z",
    ...values,
  });
}

export function videoDay(
  db: FakeDb,
  videoId: string,
  channelId: string,
  day: string,
  values: Row = {},
) {
  db.tables.video_daily_stats.push({
    video_id: videoId,
    channel_id: channelId,
    day,
    views: 400,
    watch_minutes: 800,
    estimated_revenue_usd: 2,
    ad_revenue_usd: 1.6,
    premium_revenue_usd: 0.2,
    ...values,
  });
}

export function synced(db: FakeDb, channelId: string, values: Row = {}) {
  db.tables.youtube_sync_state.push({
    channel_id: channelId,
    catalogue_full_synced_at: "2026-10-08T00:00:00Z",
    catalogue_pass_started_at: null,
    stats_synced_at: "2026-10-09T00:00:00Z",
    stats_pass_kind: null,
    last_error: null,
    ...values,
  });
}

export function deal(
  db: FakeDb,
  workspaceId: string,
  stage: string,
  value: number,
  values: Row = {},
) {
  db.tables.deals.push({
    id: `deal-${db.tables.deals.length + 1}`.padEnd(12, "0"),
    workspace_id: workspaceId,
    stage,
    value,
    currency: "USD",
    closed_at: null,
    ...values,
  });
}
