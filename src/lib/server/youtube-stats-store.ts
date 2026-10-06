// Real implementations of the two interfaces youtube-stats-sync.ts is written against: the
// YouTube API (through the existing google-oauth helpers and token lifecycle) and the Supabase
// tables. Kept separate so the sync rules themselves stay testable without either.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAuthorizedYoutubeChannel,
  fetchYoutubeVideosPage,
  queryYoutubeAnalytics,
  type YoutubeAnalyticsPayload,
} from "./google-oauth";
import { getValidAccessToken, normalizeYoutubeConnectionRow } from "./youtube-tokens";
import { isSyncableChannel } from "./youtube-disconnect";
import {
  DEFAULT_STATS_SYNC_CONFIG,
  EMPTY_SYNC_STATE,
  RequestBudget,
  STATS_CURRENCY,
  type CatalogueVideo,
  type ChannelSyncContext,
  type DailyStats,
  type StatsSyncApi,
  type StatsSyncConfig,
  type StatsSyncStore,
  type StoredVideo,
  type SyncState,
  type VideoDailyStats,
} from "./youtube-stats-sync";

const WRITE_CHUNK = 500;
const READ_PAGE = 1000;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(operation: string, error: { message: string; code?: string } | null): never {
  throw new Error(`STATS_STORE_${operation}_FAILED${error?.code ? `:${error.code}` : ""}`);
}

// ---------- API ----------

export function createStatsSyncApi(
  accessToken: string,
  channel: { youtubeChannelId: string; uploadsPlaylistId: string | null },
): StatsSyncApi {
  return {
    async listUploadsPage(pageToken) {
      const page = await fetchYoutubeVideosPage(
        accessToken,
        channel.uploadsPlaylistId,
        pageToken ?? undefined,
        50,
        { includeNonPublic: true },
      );
      return {
        videos: page.videos.map((video): CatalogueVideo => ({
          youtubeVideoId: video.id,
          title: video.title,
          description: video.description,
          thumbnail: video.thumbnail,
          publishedAt: video.publishedAt,
          durationSeconds: video.durationSeconds,
          privacyStatus: video.privacyStatus,
        })),
        listedIds: page.listedIds,
        nextPageToken: page.nextPageToken,
      };
    },
    async queryAnalytics(request) {
      return (await queryYoutubeAnalytics(accessToken, {
        channelId: channel.youtubeChannelId,
        ...request,
        currency: STATS_CURRENCY,
      })) as YoutubeAnalyticsPayload;
    },
  };
}

// ---------- Store ----------

const STATE_COLUMNS: Record<keyof SyncState, string> = {
  catalogueSyncedAt: "catalogue_synced_at",
  catalogueFullSyncedAt: "catalogue_full_synced_at",
  cataloguePassStartedAt: "catalogue_pass_started_at",
  cataloguePageToken: "catalogue_page_token",
  statsPassKind: "stats_pass_kind",
  statsPassStartedAt: "stats_pass_started_at",
  statsPassWindowStart: "stats_pass_window_start",
  statsPassChannelDone: "stats_pass_channel_done",
  statsSyncedAt: "stats_synced_at",
  statsRevisedAt: "stats_revised_at",
  lastRunAt: "last_run_at",
  lastError: "last_error",
};

function statsColumns(row: DailyStats, fetchedAt: string) {
  return {
    day: row.day,
    views: Math.round(row.views),
    watch_minutes: Math.round(row.watchMinutes),
    average_view_duration_seconds:
      row.averageViewDurationSeconds === null ? null : Math.round(row.averageViewDurationSeconds),
    average_view_percentage: row.averageViewPercentage,
    likes: Math.round(row.likes),
    comments: Math.round(row.comments),
    shares: Math.round(row.shares),
    subscribers_gained: Math.round(row.subscribersGained),
    subscribers_lost: Math.round(row.subscribersLost),
    estimated_revenue_usd: row.estimatedRevenueUsd,
    ad_revenue_usd: row.adRevenueUsd,
    premium_revenue_usd: row.premiumRevenueUsd,
    fetched_at: fetchedAt,
  };
}

export function createStatsSyncStore(service: SupabaseClient): StatsSyncStore {
  return {
    async getState(channelId) {
      const { data, error } = await service
        .from("youtube_sync_state")
        .select("*")
        .eq("channel_id", channelId)
        .maybeSingle();
      if (error) fail("GET_STATE", error);
      if (!data) return { ...EMPTY_SYNC_STATE };
      const row = data as Record<string, unknown>;
      const state = { ...EMPTY_SYNC_STATE } as Record<string, unknown>;
      for (const [key, column] of Object.entries(STATE_COLUMNS)) {
        if (row[column] !== undefined) state[key] = row[column];
      }
      return state as unknown as SyncState;
    },

    async saveState(channelId, patch) {
      const row: Record<string, unknown> = { channel_id: channelId };
      for (const [key, value] of Object.entries(patch)) {
        row[STATE_COLUMNS[key as keyof SyncState]] = value;
      }
      const { error } = await service
        .from("youtube_sync_state")
        .upsert(row, { onConflict: "channel_id" });
      if (error) fail("SAVE_STATE", error);
    },

    async listVideos(channelId) {
      const videos: StoredVideo[] = [];
      for (let from = 0; ; from += READ_PAGE) {
        const { data, error } = await service
          .from("videos")
          .select("id, youtube_video_id, published_at, status, analytics_updated_at")
          .eq("channel_id", channelId)
          .order("id")
          .range(from, from + READ_PAGE - 1);
        if (error) fail("LIST_VIDEOS", error);
        for (const row of data ?? []) {
          videos.push({
            id: row.id as string,
            youtubeVideoId: row.youtube_video_id as string,
            publishedAt: (row.published_at as string | null) ?? null,
            status: row.status as StoredVideo["status"],
            analyticsUpdatedAt: (row.analytics_updated_at as string | null) ?? null,
          });
        }
        if ((data ?? []).length < READ_PAGE) return videos;
      }
    },

    async upsertCatalogueVideos(channelId, videos, seenAt) {
      if (!videos.length) return;
      const { data: existing, error: existingError } = await service
        .from("videos")
        .select("youtube_video_id")
        .eq("channel_id", channelId)
        .in(
          "youtube_video_id",
          videos.map((v) => v.youtubeVideoId),
        );
      if (existingError) fail("UPSERT_VIDEOS", existingError);
      const known = new Set((existing ?? []).map((row) => row.youtube_video_id as string));

      const base = (video: CatalogueVideo) => ({
        channel_id: channelId,
        youtube_video_id: video.youtubeVideoId,
        title: video.title,
        thumbnail: video.thumbnail,
        published_at: video.publishedAt,
        duration_seconds: video.durationSeconds,
        // Same mapping the sync has always used; a video that reappears after being marked
        // 'deleted' is restored by this write.
        status: video.privacyStatus === "private" ? "archived" : "active",
        catalogue_seen_at: seenAt,
      });
      // Existing rows keep their description: creators edit it inside Tubify (AI Lab), and the
      // sync has never overwritten that with YouTube's copy.
      const updates = videos.filter((v) => known.has(v.youtubeVideoId)).map(base);
      const inserts = videos
        .filter((v) => !known.has(v.youtubeVideoId))
        .map((v) => ({ ...base(v), description: v.description }));
      for (const rows of [updates, inserts]) {
        if (!rows.length) continue;
        const { error } = await service
          .from("videos")
          .upsert(rows, { onConflict: "channel_id,youtube_video_id" });
        if (error) fail("UPSERT_VIDEOS", error);
      }
    },

    async markVideosNotSeenAsDeleted(channelId, passStartedAt) {
      const { data, error } = await service
        .from("videos")
        .update({ status: "deleted" })
        .eq("channel_id", channelId)
        .neq("status", "deleted")
        .or(`catalogue_seen_at.is.null,catalogue_seen_at.lt."${passStartedAt}"`)
        .select("id");
      if (error) fail("MARK_DELETED", error);
      return (data ?? []).length;
    },

    async upsertChannelDays(channelId, rows, fetchedAt) {
      for (const part of chunked(rows, WRITE_CHUNK)) {
        const { error } = await service.from("channel_daily_stats").upsert(
          part.map((row) => ({ channel_id: channelId, ...statsColumns(row, fetchedAt) })),
          { onConflict: "channel_id,day" },
        );
        if (error) fail("UPSERT_CHANNEL_DAYS", error);
      }
    },

    async replaceVideoDays(channelId, videoIds, startDate, endDate, rows, fetchedAt) {
      if (!videoIds.length) return;
      for (const part of chunked<VideoDailyStats>(rows, WRITE_CHUNK)) {
        const { error } = await service.from("video_daily_stats").upsert(
          part.map((row) => ({
            video_id: row.videoId,
            channel_id: channelId,
            ...statsColumns(row, fetchedAt),
          })),
          { onConflict: "video_id,day" },
        );
        if (error) fail("UPSERT_VIDEO_DAYS", error);
      }
      // Rows in the range that this refresh did not rewrite no longer exist on YouTube's side
      // (e.g. views later removed as invalid). Upsert-then-delete, in that order, so an
      // interruption can leave a stale row but never a gap.
      const { error } = await service
        .from("video_daily_stats")
        .delete()
        .in("video_id", videoIds)
        .gte("day", startDate)
        .lte("day", endDate)
        .lt("fetched_at", fetchedAt);
      if (error) fail("PRUNE_VIDEO_DAYS", error);
    },

    async markVideosSynced(videoIds, at) {
      if (!videoIds.length) return;
      const { error } = await service
        .from("videos")
        .update({ analytics_updated_at: at })
        .in("id", videoIds);
      if (error) fail("MARK_SYNCED", error);
    },
  };
}

// ---------- Context / scheduling ----------

/** Channels that can be synced right now (an active connection), least recently run first, so
 * repeated bounded invocations rotate through every channel instead of starving the later ones. */
export async function listSyncableChannelIds(service: SupabaseClient): Promise<string[]> {
  const { data: channels, error } = await service
    .from("youtube_channels")
    .select("id, connection:youtube_connections!connection_id(status)");
  if (error) fail("LIST_CHANNELS", error);
  const { data: states, error: stateError } = await service
    .from("youtube_sync_state")
    .select("channel_id, last_run_at");
  if (stateError) fail("LIST_STATES", stateError);
  const lastRun = new Map(
    (states ?? []).map((row) => [row.channel_id as string, (row.last_run_at as string) ?? ""]),
  );
  return (
    (channels ?? [])
      // Excludes disconnected channels (no connection) as well as ones needing reauthorisation.
      .filter((row) => isSyncableChannel(row as Parameters<typeof isSyncableChannel>[0]))
      .map((row) => row.id as string)
      .sort((a, b) => (lastRun.get(a) ?? "").localeCompare(lastRun.get(b) ?? ""))
  );
}

export async function buildChannelSyncContext(
  service: SupabaseClient,
  channelRowId: string,
  options: { config?: Partial<StatsSyncConfig>; now?: Date } = {},
): Promise<ChannelSyncContext> {
  const { data, error } = await service
    .from("youtube_channels")
    .select(
      "id, youtube_channel_id, uploads_playlist_id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
    )
    .eq("id", channelRowId)
    .maybeSingle();
  if (error) fail("LOAD_CHANNEL", error);
  const connection = normalizeYoutubeConnectionRow(data?.connection);
  if (!data || !connection) throw new Error("YOUTUBE_CONNECTION_MISSING");

  const accessToken = await getValidAccessToken(service, connection);
  let uploadsPlaylistId = (data.uploads_playlist_id as string | null) ?? null;
  if (!uploadsPlaylistId) {
    const live = await fetchAuthorizedYoutubeChannel(accessToken, data.youtube_channel_id);
    uploadsPlaylistId = live.uploadsPlaylistId;
  }

  const config = { ...DEFAULT_STATS_SYNC_CONFIG, ...options.config };
  return {
    channelId: channelRowId,
    api: createStatsSyncApi(accessToken, {
      youtubeChannelId: data.youtube_channel_id as string,
      uploadsPlaylistId,
    }),
    store: createStatsSyncStore(service),
    config,
    budget: new RequestBudget(config.requestBudget),
    now: options.now ?? new Date(),
  };
}
