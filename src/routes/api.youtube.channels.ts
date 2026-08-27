import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import { fetchAuthorizedYoutubeChannel } from "@/lib/server/google-oauth";

const idSchema = z.string().uuid();

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export const Route = createFileRoute("/api/youtube/channels")({
  server: {
    handlers: {
      // Never selects/returns access_token_ciphertext or refresh_token_ciphertext — those stay
      // server-side for every caller, including this route.
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const { data: channels, error } = await client
            .from("youtube_channels")
            .select(
              "id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, view_count, video_count, uploads_playlist_id, connected_at, last_synced_at, last_sync_status, last_sync_error, token_expiry",
            )
            .order("connected_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channels?.length) return json({ data: [] });

          const channel = channels[0];
          const serviceClient = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await serviceClient
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channel.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const accessToken = await getValidAccessToken(serviceClient, secretRow);
          const liveChannel = await fetchAuthorizedYoutubeChannel(
            accessToken,
            channel.youtube_channel_id,
          );
          const { data: syncedChannel, error: syncError } = await client
            .from("youtube_channels")
            .update({
              channel_name: liveChannel.title,
              channel_handle: liveChannel.handle,
              thumbnail: liveChannel.thumbnail,
              subscriber_count: liveChannel.subscriberCount,
              view_count: liveChannel.viewCount,
              video_count: liveChannel.videoCount,
              uploads_playlist_id: liveChannel.uploadsPlaylistId,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", channel.id)
            .select(
              "id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, view_count, video_count, uploads_playlist_id, connected_at, last_synced_at, last_sync_status, last_sync_error, token_expiry",
            )
            .single();
          if (syncError || !syncedChannel)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: [syncedChannel] });
        } catch (error) {
          if (error instanceof Response) return error;
          const message = error instanceof Error ? error.message : "";
          if (message.includes("YOUTUBE_") && message.includes(":401")) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const { error } = await client.from("youtube_channels").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ success: true });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
