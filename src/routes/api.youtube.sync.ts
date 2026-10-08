import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";
import {
  getValidAccessToken,
  isYoutubeTokenRefreshReauthError,
  normalizeYoutubeConnectionRow,
} from "@/lib/server/youtube-tokens";
import {
  fetchAuthorizedYoutubeChannel,
  fetchRecentYoutubeComments,
  fetchRecentYoutubeVideos,
  type YoutubeVideoSummary,
} from "@/lib/server/google-oauth";
import {
  runRevenueDataBatch,
  runRevenueDataSync,
  statsSyncTimeBudgetMs,
} from "@/lib/server/youtube-stats-runner";

const defaults = {
  auto_sync_videos: true,
  import_analytics: true,
  sync_comments: false,
  import_chapters: true,
};

type SyncSettings = typeof defaults;
type ChannelRow = {
  id: string;
  user_id: string;
  youtube_channel_id: string;
  last_sync_status: string;
  connection: {
    id: string;
    access_token_ciphertext: string;
    refresh_token_ciphertext: string;
    token_expiry: string | null;
  } | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function parseChapters(description: string | null, durationSeconds: number | null) {
  if (!description) return [];
  const chapters: Array<{
    title: string;
    startSeconds: number;
    endSeconds: number | null;
    position: number;
  }> = [];
  for (const line of description.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/);
    if (!match) continue;
    const startSeconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    const title = match[4].trim();
    if (!title || (durationSeconds !== null && startSeconds >= durationSeconds)) continue;
    const previous = chapters.at(-1);
    if (previous && startSeconds <= previous.startSeconds) continue;
    chapters.push({ title, startSeconds, endSeconds: null, position: chapters.length });
  }
  if (chapters.length < 3 || chapters[0].startSeconds !== 0) return [];
  return chapters.map((chapter, index) => ({
    ...chapter,
    endSeconds: chapters[index + 1]?.startSeconds ?? durationSeconds,
  }));
}

async function loadSettings(
  service: ReturnType<typeof createServiceSupabaseClient>,
  channelId: string,
): Promise<SyncSettings> {
  const { data } = await service
    .from("youtube_integration_settings")
    .select(Object.keys(defaults).join(", "))
    .eq("channel_id", channelId)
    .maybeSingle();
  const row = data && typeof data === "object" ? (data as Partial<SyncSettings>) : {};
  return { ...defaults, ...row };
}

async function syncChannel(
  service: ReturnType<typeof createServiceSupabaseClient>,
  channel: ChannelRow,
) {
  const claimed = await service
    .from("youtube_channels")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", channel.id)
    .neq("last_sync_status", "syncing")
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) return { status: "already_syncing" };

  const settings = await loadSettings(service, channel.id);
  const result = {
    videos: "skipped",
    comments: "skipped",
    chapters: "skipped",
  } as Record<string, string>;
  const failures: string[] = [];
  try {
    if (!channel.connection) throw new Error("YOUTUBE_CONNECTION_MISSING");
    const accessToken = await getValidAccessToken(service, channel.connection);
    // expectedChannelId is required here — a connection can back more than one channel, and
    // without it this would silently overwrite this channel's row with whichever channel Google
    // happens to return first for the shared identity (see fetchAuthorizedYoutubeChannel's doc
    // comment in google-oauth.ts).
    const liveChannel = await fetchAuthorizedYoutubeChannel(
      accessToken,
      channel.youtube_channel_id,
    );
    await service
      .from("youtube_channels")
      .update({
        youtube_channel_id: liveChannel.channelId,
        channel_name: liveChannel.title,
        channel_handle: liveChannel.handle,
        thumbnail: liveChannel.thumbnail,
        subscriber_count: liveChannel.subscriberCount,
        view_count: liveChannel.viewCount,
        video_count: liveChannel.videoCount,
        uploads_playlist_id: liveChannel.uploadsPlaylistId,
      })
      .eq("id", channel.id);

    // Channel statistics and revenue are not collected here: the stored revenue-data sync
    // (youtube-stats-sync.ts, run right after this) is the one source for them.
    let videos: YoutubeVideoSummary[] = [];
    if (settings.auto_sync_videos || settings.sync_comments || settings.import_chapters) {
      try {
        videos = await fetchRecentYoutubeVideos(accessToken, liveChannel.uploadsPlaylistId);
        if (settings.auto_sync_videos) {
          const { data: existingVideos, error: existingVideosError } = await service
            .from("videos")
            .select("youtube_video_id, description")
            .eq("channel_id", channel.id);
          if (existingVideosError) throw new Error("videos");
          const descriptions = new Map(
            (existingVideos ?? []).map((existing) => [
              existing.youtube_video_id,
              existing.description,
            ]),
          );
          const { error } = await service.from("videos").upsert(
            videos.map((video) => ({
              channel_id: channel.id,
              youtube_video_id: video.id,
              title: video.title,
              description: descriptions.get(video.id) ?? video.description,
              thumbnail: video.thumbnail,
              published_at: video.publishedAt,
              duration_seconds: video.durationSeconds,
              status: video.privacyStatus === "private" ? "archived" : "active",
            })),
            { onConflict: "channel_id,youtube_video_id" },
          );
          if (error) throw new Error("videos");
          result.videos = "success";
        }
      } catch {
        result.videos = "failed";
        failures.push("videos");
      }
    }

    if (settings.sync_comments) {
      try {
        const comments = await fetchRecentYoutubeComments(
          accessToken,
          videos.map((video) => video.id),
        );
        const { error } = await service.from("youtube_comments").upsert(
          comments.map((comment) => ({
            channel_id: channel.id,
            youtube_comment_id: comment.id,
            youtube_video_id: comment.videoId,
            parent_comment_id: comment.parentCommentId,
            author_name: comment.authorName,
            author_channel_id: comment.authorChannelId,
            text: comment.text,
            like_count: comment.likeCount,
            published_at: comment.publishedAt,
            updated_at: comment.updatedAt,
            can_reply: comment.canReply,
          })),
          { onConflict: "channel_id,youtube_comment_id" },
        );
        if (error) throw new Error("comments");
        result.comments = "success";
      } catch {
        result.comments = "failed";
        failures.push("comments");
      }
    }

    if (settings.import_chapters) {
      try {
        for (const video of videos) {
          const chapters = parseChapters(video.description, video.durationSeconds);
          await service
            .from("youtube_chapters")
            .delete()
            .eq("channel_id", channel.id)
            .eq("youtube_video_id", video.id);
          if (chapters.length) {
            const { error } = await service.from("youtube_chapters").insert(
              chapters.map((chapter) => ({
                channel_id: channel.id,
                youtube_video_id: video.id,
                ...chapter,
              })),
            );
            if (error) throw new Error("chapters");
          }
        }
        result.chapters = "success";
      } catch {
        result.chapters = "failed";
        failures.push("chapters");
      }
    }

    const status = failures.length ? "partial" : "success";
    await service
      .from("youtube_channels")
      .update({
        last_sync_status: status,
        last_sync_error: failures.length ? failures.join(",") : null,
        ...(status === "success" ? { last_synced_at: new Date().toISOString() } : {}),
      })
      .eq("id", channel.id);
    return { status, result };
  } catch (error) {
    // Only Google rejecting the token refresh means the creator must reconnect. A YouTube API
    // 401 that survived the forced refresh and single retry (see youtubeFetch in google-oauth.ts)
    // is an ordinary failure: it must never mark the channel "reauth_required".
    const status = isYoutubeTokenRefreshReauthError(error) ? "reauth_required" : "failed";
    await service
      .from("youtube_channels")
      .update({
        last_sync_status: status,
        last_sync_error: status === "reauth_required" ? null : "sync_unavailable",
      })
      .eq("id", channel.id);
    return { status };
  }
}

async function getChannel(service: ReturnType<typeof createServiceSupabaseClient>, id: string) {
  const { data } = await service
    .from("youtube_channels")
    .select(
      "id, user_id, youtube_channel_id, last_sync_status, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
    )
    .eq("id", id)
    .single();
  if (!data) return null;
  return { ...data, connection: normalizeYoutubeConnectionRow(data.connection) } as ChannelRow;
}

export const Route = createFileRoute("/api/youtube/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const requestedChannelId = new URL(request.url).searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          let ownedQuery = client
            .from("youtube_channels")
            .select("id")
            .not("connection_id", "is", null)
            .order("connected_at", { ascending: false });
          if (requestedChannelId) ownedQuery = ownedQuery.eq("id", requestedChannelId);
          const { data: owned } = await ownedQuery.limit(1).maybeSingle();
          if (!owned) return json({ error: "YOUTUBE_NOT_CONNECTED" }, { status: 409 });
          const service = createServiceSupabaseClient();
          const channel = await getChannel(service, owned.id);
          if (!channel) return json({ error: "YOUTUBE_NOT_CONNECTED" }, { status: 409 });
          const legacy = await syncChannel(service, channel);
          // One bounded unit of the stored revenue-data sync for this channel. Reported
          // separately and never allowed to change the outcome above.
          const revenueData =
            legacy.status === "success" || legacy.status === "partial"
              ? await runRevenueDataSync(service, channel.id)
              : null;
          return json({ ...legacy, revenueData });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SYNC_UNAVAILABLE" }, { status: 502 });
        }
      },
      GET: async ({ request }) => {
        const cronSecret = getServerEnv("CRON_SECRET");
        if (!cronSecret || request.headers.get("Authorization") !== `Bearer ${cronSecret}`)
          return json({ error: "AUTH_REQUIRED" }, { status: 401 });
        const service = createServiceSupabaseClient();
        const { data: channels } = await service
          .from("youtube_channels")
          .select(
            "id, user_id, youtube_channel_id, last_sync_status, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
          )
          // Disconnected channels keep their row and history but have no connection; they are
          // not synced (and must not be marked "failed" every night for lacking credentials).
          .not("connection_id", "is", null);
        const normalizedChannels = (channels ?? []).map(
          (row) =>
            ({ ...row, connection: normalizeYoutubeConnectionRow(row.connection) }) as ChannelRow,
        );
        const startedAt = Date.now();
        const results = [];
        for (const channel of normalizedChannels)
          results.push({ channelId: channel.id, ...(await syncChannel(service, channel)) });
        // Then spend whatever time is left on the stored revenue-data sync: bounded work per
        // channel, least recently run first, resuming where the previous invocation stopped.
        const revenueData = await runRevenueDataBatch(service, startedAt + statsSyncTimeBudgetMs());
        return json({ results, revenueData });
      },
    },
  },
});
