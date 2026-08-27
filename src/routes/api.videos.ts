import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import { fetchYoutubeVideoById } from "@/lib/server/google-oauth";

const idSchema = z.string().uuid();
const youtubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const saveVideoSchema = z.object({
  channelId: idSchema.optional(),
  youtubeVideoId: youtubeVideoIdSchema,
  description: z.string().trim().max(100_000).nullable().optional(),
  transcript: z.string().trim().max(500_000).nullable().optional(),
});
const updateVideoSchema = z.object({
  description: z.string().trim().max(100_000).nullable().optional(),
  transcript: z.string().trim().max(500_000).nullable().optional(),
});

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

function safeProviderReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const match = error.message.match(/:(\d{3})(?::|$)/);
  return match?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

async function findOwnedChannel(
  client: Awaited<ReturnType<typeof requireSessionUser>>["client"],
  id?: string,
) {
  let query = client
    .from("youtube_channels")
    .select("id, user_id, youtube_channel_id")
    .order("connected_at", { ascending: false });
  if (id) query = query.eq("id", id);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error("DATABASE_ERROR");
  return data;
}

async function loadTranscript(
  client: Awaited<ReturnType<typeof requireSessionUser>>["client"],
  videoId: string,
) {
  const { data, error } = await client
    .from("transcripts")
    .select("id, transcript, source, language, timestamps, created_at")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("DATABASE_ERROR");
  return data;
}

async function saveTranscript(
  client: Awaited<ReturnType<typeof requireSessionUser>>["client"],
  videoId: string,
  transcript: string | null | undefined,
) {
  if (transcript === undefined) return;
  const { error: deleteError } = await client.from("transcripts").delete().eq("video_id", videoId);
  if (deleteError) throw new Error("DATABASE_ERROR");
  if (!transcript) return;
  const { error: insertError } = await client.from("transcripts").insert({
    video_id: videoId,
    transcript,
    source: "manual",
    language: "en",
  });
  if (insertError) throw new Error("DATABASE_ERROR");
}

export const Route = createFileRoute("/api/videos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const url = new URL(request.url);
          const rawChannelId = url.searchParams.get("channelId");
          const rawYoutubeVideoId = url.searchParams.get("youtubeVideoId");
          const channelId = rawChannelId ? idSchema.parse(rawChannelId) : null;
          const youtubeVideoId = rawYoutubeVideoId
            ? youtubeVideoIdSchema.parse(rawYoutubeVideoId)
            : null;

          let channelQuery = client
            .from("youtube_channels")
            .select("id, user_id, youtube_channel_id, channel_name, channel_handle")
            .order("connected_at", { ascending: false });
          if (channelId) channelQuery = channelQuery.eq("id", channelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) {
            return channelId
              ? json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 })
              : json({ status: "not_connected", data: null });
          }

          if (youtubeVideoId) {
            const service = createServiceSupabaseClient();
            const { data: secretRow, error: secretError } = await service
              .from("youtube_channels")
              .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
              .eq("id", channel.id)
              .single();
            if (secretError || !secretRow)
              return json({ error: "DATABASE_ERROR" }, { status: 500 });
            const accessToken = await getValidAccessToken(service, secretRow);
            const video = await fetchYoutubeVideoById(
              accessToken,
              youtubeVideoId,
              channel.youtube_channel_id,
            );
            if (video.privacyStatus !== "public") {
              return json({ error: "YOUTUBE_VIDEO_NOT_PUBLIC" }, { status: 422 });
            }
            const { data: savedVideo, error: videoError } = await client
              .from("videos")
              .select(
                "id, channel_id, youtube_video_id, title, description, thumbnail, published_at, duration_seconds, status, analytics_updated_at, created_at, updated_at",
              )
              .eq("channel_id", channel.id)
              .eq("youtube_video_id", youtubeVideoId)
              .maybeSingle();
            if (videoError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            const transcript = savedVideo ? await loadTranscript(client, savedVideo.id) : null;
            return json({
              status: "connected",
              data: { channel, video, savedVideo, transcript },
            });
          }

          const { data: videos, error: videosError } = await client
            .from("videos")
            .select(
              "id, channel_id, youtube_video_id, title, description, thumbnail, published_at, duration_seconds, status, analytics_updated_at, created_at, updated_at",
            )
            .eq("channel_id", channel.id)
            .order("published_at", { ascending: false });
          if (videosError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ status: "connected", data: { channel, videos: videos ?? [] } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeReauthError(error)) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND") {
            return json({ error: "YOUTUBE_VIDEO_NOT_FOUND" }, { status: 404 });
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_CHANNEL_MISMATCH") {
            return json({ error: "YOUTUBE_VIDEO_CHANNEL_MISMATCH" }, { status: 422 });
          }
          console.error("Video read failed", { reason: safeProviderReason(error) });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const input = saveVideoSchema.parse(await parseJson(request));
          const channel = await findOwnedChannel(client, input.channelId);
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channel.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const accessToken = await getValidAccessToken(service, secretRow);
          const video = await fetchYoutubeVideoById(
            accessToken,
            input.youtubeVideoId,
            channel.youtube_channel_id,
          );
          if (video.privacyStatus !== "public") {
            return json({ error: "YOUTUBE_VIDEO_NOT_PUBLIC" }, { status: 422 });
          }

          const { data: existingVideo, error: existingVideoError } = await client
            .from("videos")
            .select("description")
            .eq("channel_id", channel.id)
            .eq("youtube_video_id", video.id)
            .maybeSingle();
          if (existingVideoError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const { data: savedVideo, error: saveError } = await client
            .from("videos")
            .upsert(
              {
                channel_id: channel.id,
                youtube_video_id: video.id,
                title: video.title,
                description: input.description ?? existingVideo?.description ?? video.description,
                thumbnail: video.thumbnail,
                published_at: video.publishedAt,
                duration_seconds: video.durationSeconds,
                status: "active",
              },
              { onConflict: "channel_id,youtube_video_id" },
            )
            .select(
              "id, channel_id, youtube_video_id, title, description, thumbnail, published_at, duration_seconds, status, analytics_updated_at, created_at, updated_at",
            )
            .single();
          if (saveError || !savedVideo) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          await saveTranscript(client, savedVideo.id, input.transcript);
          return json(
            {
              status: "connected",
              data: { video, savedVideo, transcript: await loadTranscript(client, savedVideo.id) },
            },
            { status: 201 },
          );
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeReauthError(error)) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND") {
            return json({ error: "YOUTUBE_VIDEO_NOT_FOUND" }, { status: 404 });
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_CHANNEL_MISMATCH") {
            return json({ error: "YOUTUBE_VIDEO_CHANNEL_MISMATCH" }, { status: 422 });
          }
          console.error("Video create failed", { reason: safeProviderReason(error) });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = updateVideoSchema.parse(await parseJson(request));
          const { data: existing, error: existingError } = await client
            .from("videos")
            .select("id")
            .eq("id", id)
            .maybeSingle();
          if (existingError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!existing) return json({ error: "NOT_FOUND" }, { status: 404 });

          const update: Record<string, unknown> = {};
          if (input.description !== undefined) update.description = input.description;
          const videoColumns =
            "id, channel_id, youtube_video_id, title, description, thumbnail, published_at, duration_seconds, status, analytics_updated_at, created_at, updated_at";
          let savedVideo;
          if (Object.keys(update).length > 0) {
            const { data, error: updateError } = await client
              .from("videos")
              .update(update)
              .eq("id", id)
              .select(videoColumns)
              .single();
            if (updateError || !data) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            savedVideo = data;
          } else {
            const { data, error: loadError } = await client
              .from("videos")
              .select(videoColumns)
              .eq("id", id)
              .single();
            if (loadError || !data) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            savedVideo = data;
          }
          await saveTranscript(client, id, input.transcript);
          return json({
            status: "connected",
            data: { savedVideo, transcript: await loadTranscript(client, id) },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          console.error("Video update failed", { reason: safeProviderReason(error) });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { data: existing, error: existingError } = await client
            .from("videos")
            .select("id")
            .eq("id", id)
            .maybeSingle();
          if (existingError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!existing) return json({ error: "NOT_FOUND" }, { status: 404 });
          const { error } = await client.from("videos").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ success: true });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
