import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

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
      // server-side for every caller, including this route. connection_id is returned (it's an
      // opaque id, not a secret) so the UI can tell when two channels share one OAuth connection —
      // see the DELETE handler below for why that distinction matters.
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const { data: channels, error } = await client
            .from("youtube_channels")
            .select(
              "id, connection_id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, view_count, video_count, uploads_playlist_id, connected_at, last_synced_at, last_sync_status, last_sync_error",
            )
            .order("connected_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: channels ?? [] });
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

          const { data: channelRow, error: channelError } = await client
            .from("youtube_channels")
            .select("id, connection_id")
            .eq("id", id)
            .maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channelRow) return json({ success: true });

          const { error } = await client.from("youtube_channels").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          // A connection can back several channels at once (e.g. a legacy Brand Account manager
          // with rights to more than one channel). Disconnecting one channel must never revoke or
          // delete the shared OAuth credentials while a sibling channel still depends on them —
          // only clean up the connection once nothing references it anymore.
          if (channelRow.connection_id) {
            const { count, error: countError } = await client
              .from("youtube_channels")
              .select("id", { count: "exact", head: true })
              .eq("connection_id", channelRow.connection_id);
            if (!countError && !count) {
              await client.from("youtube_connections").delete().eq("id", channelRow.connection_id);
            }
          }

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
