import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import { fetchPublicYoutubeVideoById } from "@/lib/server/google-oauth";

const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const channelIdSchema = z.string().uuid();

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

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return error.message.match(/:(\d{3})(?::|$)/)?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

export const Route = createFileRoute("/api/youtube/analyze-video")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const url = new URL(request.url);
          const videoId = videoIdSchema.parse(url.searchParams.get("videoId"));
          const rawChannelId = url.searchParams.get("channelId");
          const requestedChannelId = rawChannelId ? channelIdSchema.parse(rawChannelId) : null;

          let channelQuery = client
            .from("youtube_channels")
            .select("id, youtube_channel_id, channel_name, channel_handle")
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channel.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const accessToken = await getValidAccessToken(service, secretRow);
          const video = await fetchPublicYoutubeVideoById(accessToken, videoId);
          if (video.privacyStatus !== "public") {
            return json({ error: "YOUTUBE_VIDEO_NOT_PUBLIC" }, { status: 422 });
          }

          const isConnectedChannelVideo = video.channelId === channel.youtube_channel_id;
          const { data: savedVideo, error: savedVideoError } = isConnectedChannelVideo
            ? await client
                .from("videos")
                .select(
                  "id, channel_id, youtube_video_id, title, description, thumbnail, published_at, duration_seconds, status",
                )
                .eq("channel_id", channel.id)
                .eq("youtube_video_id", videoId)
                .maybeSingle()
            : { data: null, error: null };
          if (savedVideoError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const { data: transcript, error: transcriptError } = savedVideo
            ? await client
                .from("transcripts")
                .select("id, transcript, source, language")
                .eq("video_id", savedVideo.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : { data: null, error: null };
          if (transcriptError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          return json({
            data: {
              video,
              channel: {
                id: channel.id,
                youtubeChannelId: channel.youtube_channel_id,
                title: channel.channel_name,
                handle: channel.channel_handle,
              },
              ownership: isConnectedChannelVideo ? "connected" : "external",
              analyticsAccess: isConnectedChannelVideo ? "private" : "public_only",
              savedVideo,
              transcript,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND") {
            return json({ error: "YOUTUBE_VIDEO_NOT_FOUND" }, { status: 404 });
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_CHANNEL_MISMATCH") {
            return json({ error: "YOUTUBE_VIDEO_CHANNEL_MISMATCH" }, { status: 422 });
          }
          console.error("YouTube public video analysis request failed", {
            reason: safeReason(error),
          });
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
