import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  getValidAccessToken,
  isYoutubeTokenRefreshReauthError,
  normalizeYoutubeConnectionRow,
} from "@/lib/server/youtube-tokens";
import {
  fetchChannelCommentsPage,
  fetchRecentYoutubeComments,
  fetchYoutubeVideoById,
  fetchYoutubeVideosByIds,
} from "@/lib/server/google-oauth";

// A YouTube video id: 11 characters of [A-Za-z0-9_-].
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// A YouTube page token, as returned in nextPageToken: URL-safe characters only, bounded.
const YOUTUBE_PAGE_TOKEN = /^[A-Za-z0-9_=-]{1,512}$/;

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

export const Route = createFileRoute("/api/youtube/comments")({
  server: {
    handlers: {
      // Always fetches live from YouTube (not the separate background-synced youtube_comments
      // table, which depends on the "Sync comment data" setting being on) — Comment Automation
      // needs current comments to match rules against, not whatever was last synced.
      //
      // Without videoId: the comments on every video of the channel, newest first, a page of up
      // to 100 at a time (pageToken continues from the previous page's nextPageToken). With
      // videoId (from a
      // video's comment count on the Videos page): that one video's comments, whatever its age —
      // only when YouTube confirms the video belongs to the caller's channel. A video that does
      // not exist and one on another channel get the same 404, and nothing is fetched for it.
      GET: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const searchParams = new URL(request.url).searchParams;
          const requestedChannelId = searchParams.get("channelId");
          const requestedVideoId = searchParams.get("videoId");
          if (requestedVideoId !== null && !YOUTUBE_VIDEO_ID.test(requestedVideoId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const pageToken = searchParams.get("pageToken");
          if (pageToken !== null && !YOUTUBE_PAGE_TOKEN.test(pageToken))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          let channelQuery = client
            .from("youtube_channels")
            .select("id, youtube_channel_id")
            .eq("workspace_id", workspaceId)
            .not("connection_id", "is", null)
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ status: "not_connected", data: null });

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select(
              "id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
            )
            .eq("id", channel.id)
            .single();
          const connection = normalizeYoutubeConnectionRow(secretRow?.connection);
          if (secretError || !connection) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const accessToken = await getValidAccessToken(service, connection);

          if (requestedVideoId) {
            let video;
            try {
              video = await fetchYoutubeVideoById(
                accessToken,
                requestedVideoId,
                channel.youtube_channel_id,
              );
            } catch (error) {
              if (
                error instanceof Error &&
                (error.message === "YOUTUBE_VIDEO_NOT_FOUND" ||
                  error.message === "YOUTUBE_VIDEO_CHANNEL_MISMATCH")
              )
                return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
              throw error;
            }
            const comments = await fetchRecentYoutubeComments(accessToken, [video.id], 100);
            void service.from("youtube_quota_events").insert({
              user_id: user.id,
              channel_id: channel.id,
              operation: "commentThreads.list",
              quota_units: 2, // videos.list + commentThreads.list
              succeeded: true,
            });
            return json({
              status: "connected",
              data: {
                comments,
                videos: [{ id: video.id, title: video.title }],
                // For the preview at the top of the comments dialog.
                video: {
                  id: video.id,
                  title: video.title,
                  thumbnail: video.thumbnail,
                  publishedAt: video.publishedAt,
                  duration: video.duration,
                  views: video.views,
                  comments: video.comments,
                },
              },
            });
          }

          // Every video of the caller's own connected channel, one page at a time.
          const page = await fetchChannelCommentsPage(
            accessToken,
            channel.youtube_channel_id,
            pageToken,
          );
          // Titles for the videos this page's comments are on (videos.list takes 50 ids a call).
          const videoIds = [...new Set(page.comments.map((comment) => comment.videoId))];
          const videos = [];
          for (let i = 0; i < videoIds.length; i += 50)
            videos.push(...(await fetchYoutubeVideosByIds(accessToken, videoIds.slice(i, i + 50))));

          void service.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "commentThreads.list",
            quota_units: 1 + Math.ceil(videoIds.length / 50),
            succeeded: true,
          });

          return json({
            status: "connected",
            data: {
              comments: page.comments,
              videos: videos.map((v) => ({ id: v.id, title: v.title })),
              nextPageToken: page.nextPageToken,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (isYoutubeTokenRefreshReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          console.error("Comment fetch failed");
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
