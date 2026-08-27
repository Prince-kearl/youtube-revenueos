import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import {
  aggregateYoutubeAnalyticsByMonth,
  fetchAuthorizedYoutubeChannel,
  fetchRecentYoutubeComments,
  fetchRecentYoutubeVideos,
  queryYoutubeAnalytics,
  type YoutubeAnalyticsPayload,
  type YoutubeVideoSummary,
} from "@/lib/server/google-oauth";

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
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expiry: string | null;
  last_sync_status: string;
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
    analytics: "skipped",
    comments: "skipped",
    chapters: "skipped",
  } as Record<string, string>;
  const failures: string[] = [];
  try {
    const accessToken = await getValidAccessToken(service, channel);
    const liveChannel = await fetchAuthorizedYoutubeChannel(accessToken);
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

    let videos: YoutubeVideoSummary[] = [];
    if (settings.auto_sync_videos || settings.sync_comments || settings.import_chapters) {
      try {
        videos = await fetchRecentYoutubeVideos(accessToken, liveChannel.uploadsPlaylistId);
        if (settings.auto_sync_videos) {
          const { error } = await service.from("videos").upsert(
            videos.map((video) => ({
              channel_id: channel.id,
              youtube_video_id: video.id,
              title: video.title,
              description: video.description,
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

    if (settings.import_analytics) {
      try {
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setUTCMonth(startDate.getUTCMonth() - 12);
        const periodStart = isoDate(startDate);
        const periodEnd = isoDate(endDate);
        const dailyPayload = (await queryYoutubeAnalytics(accessToken, {
          channelId: liveChannel.channelId,
          startDate: periodStart,
          endDate: periodEnd,
          metrics: ["views", "estimatedRevenue", "subscribersGained", "estimatedMinutesWatched"],
          dimensions: ["day"],
        })) as YoutubeAnalyticsPayload;
        const payload = aggregateYoutubeAnalyticsByMonth(dailyPayload);
        const { error } = await service
          .from("youtube_analytics_snapshots")
          .upsert(
            { channel_id: channel.id, period_start: periodStart, period_end: periodEnd, payload },
            { onConflict: "channel_id,period_start,period_end" },
          );
        if (error) throw new Error("analytics");
        result.analytics = "success";
      } catch {
        result.analytics = "failed";
        failures.push("analytics");
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
    const message = error instanceof Error ? error.message : "";
    const status =
      message.includes("YOUTUBE_") && message.includes(":401") ? "reauth_required" : "failed";
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
      "id, user_id, youtube_channel_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry, last_sync_status",
    )
    .eq("id", id)
    .single();
  return data as ChannelRow | null;
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
            .order("connected_at", { ascending: false });
          if (requestedChannelId) ownedQuery = ownedQuery.eq("id", requestedChannelId);
          const { data: owned } = await ownedQuery.limit(1).maybeSingle();
          if (!owned) return json({ error: "YOUTUBE_NOT_CONNECTED" }, { status: 409 });
          const service = createServiceSupabaseClient();
          const channel = await getChannel(service, owned.id);
          if (!channel) return json({ error: "YOUTUBE_NOT_CONNECTED" }, { status: 409 });
          return json(await syncChannel(service, channel));
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
            "id, user_id, youtube_channel_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry, last_sync_status",
          );
        const results = [];
        for (const channel of (channels ?? []) as ChannelRow[])
          results.push({ channelId: channel.id, ...(await syncChannel(service, channel)) });
        return json({ results });
      },
    },
  },
});
