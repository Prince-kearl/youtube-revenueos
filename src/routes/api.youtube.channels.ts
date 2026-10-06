import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { softDisconnectChannel } from "@/lib/server/youtube-disconnect";

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
            .not("connection_id", "is", null)
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

          // Disconnecting removes ACCESS, not HISTORY (see youtube-disconnect.ts): the channel row
          // is detached from its Google connection and kept, so its videos, daily stats, sync
          // state and link/click/lead attribution all survive and are picked up again if the
          // same channel is reconnected. The stored credentials are deleted unless another
          // channel still uses the same connection. Every query runs on the caller's own
          // RLS-scoped client, exactly as the hard delete did before.
          const fail = (operation: string, error: { message: string } | null): never => {
            console.error("YouTube disconnect failed", { operation, message: error?.message });
            throw new Error("DISCONNECT_DATABASE_ERROR");
          };
          const result = await softDisconnectChannel(
            {
              async getChannel(channelId) {
                const { data, error } = await client
                  .from("youtube_channels")
                  .select("id, connection_id")
                  .eq("id", channelId)
                  .maybeSingle();
                if (error) fail("load", error);
                return data
                  ? { id: data.id as string, connectionId: (data.connection_id as string) ?? null }
                  : null;
              },
              async detachChannel(channelId) {
                const { error } = await client
                  .from("youtube_channels")
                  .update({ connection_id: null })
                  .eq("id", channelId);
                if (error) fail("detach", error);
              },
              async attachChannel(channelId, connectionId) {
                const { error } = await client
                  .from("youtube_channels")
                  .update({ connection_id: connectionId })
                  .eq("id", channelId);
                if (error) fail("reattach", error);
              },
              async countOtherChannelsUsingConnection(connectionId, exceptChannelId) {
                const { count, error } = await client
                  .from("youtube_channels")
                  .select("id", { count: "exact", head: true })
                  .eq("connection_id", connectionId)
                  .neq("id", exceptChannelId);
                if (error) fail("count", error);
                return count ?? 0;
              },
              async deleteConnection(connectionId) {
                // Ask for the deleted row back: a delete that matches nothing is not an error in
                // PostgREST, and the credentials must never be reported removed when they weren't.
                const { data, error } = await client
                  .from("youtube_connections")
                  .delete()
                  .eq("id", connectionId)
                  .select("id");
                if (error) fail("delete_connection", error);
                if (!data || data.length === 0)
                  fail("delete_connection", { message: "no connection row was deleted" });
              },
            },
            id,
          );

          return json({ success: true, status: result.status });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (error instanceof Error && error.message === "DISCONNECT_DATABASE_ERROR")
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
