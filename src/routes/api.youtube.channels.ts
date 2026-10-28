import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { canManageWorkspaceMembers, getWorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
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
          // The CURRENT workspace's channels only — not every workspace the caller belongs to.
          const { client, workspaceId, workspaceRole } = await getWorkspaceContext(request, {
            requirePlan: false,
          });
          const { data: channels, error } = await client
            .from("youtube_channels")
            .select(
              "id, connection_id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, view_count, video_count, uploads_playlist_id, connected_at, last_synced_at, last_sync_status, last_sync_error",
            )
            .eq("workspace_id", workspaceId)
            .not("connection_id", "is", null)
            .order("connected_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          // Channels this workspace disconnected: their rows (and all their history) are kept,
          // so Settings can list them with a "Reconnect" — instead of them silently vanishing.
          // Same workspace, display fields only.
          const { data: disconnected, error: disconnectedError } = await client
            .from("youtube_channels")
            .select(
              "id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, last_synced_at",
            )
            .eq("workspace_id", workspaceId)
            .is("connection_id", null)
            .order("last_synced_at", { ascending: false, nullsFirst: false });
          if (disconnectedError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          // Channels a client shared through a connect link: marked with the client's Google email
          // (they are the client's grant, not the workspace's own Google account). Server-side
          // read, this workspace only; if it cannot be read, nothing is marked.
          const sharedBy = new Map<string, string | null>();
          {
            const { data: grants, error: grantsError } = await createServiceSupabaseClient()
              .from("youtube_connections")
              .select("id, google_email")
              .eq("workspace_id", workspaceId)
              .not("granted_via_invite_id", "is", null);
            if (!grantsError)
              for (const g of grants ?? [])
                sharedBy.set(g.id as string, (g.google_email as string | null) ?? null);
          }
          // Whether this caller may connect or disconnect channels (owner or manager), so the
          // page can show those controls only to them; the routes check it again.
          return json({
            data: (channels ?? []).map((channel) => ({
              ...channel,
              shared_by_client: sharedBy.has(channel.connection_id as string),
              client_email: sharedBy.get(channel.connection_id as string) ?? null,
            })),
            disconnected: disconnected ?? [],
            canManage: canManageWorkspaceMembers(workspaceRole),
          });
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
          const { workspaceId, workspaceRole } = await getWorkspaceContext(request, {
            requirePlan: false,
          });
          // Disconnecting removes the workspace's access to a channel: owner or manager only.
          if (!canManageWorkspaceMembers(workspaceRole))
            return json(
              {
                error: "FORBIDDEN",
                message: "Only the workspace owner or a manager can disconnect a channel.",
              },
              { status: 403 },
            );
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          // Every step names the caller's current workspace; a channel of any other workspace is
          // "not found". Server-side writes: channel and connection rows are not writable by
          // client roles.
          const client = createServiceSupabaseClient();

          // Disconnecting removes ACCESS, not HISTORY (see youtube-disconnect.ts): the channel row
          // is detached from its Google connection and kept, so its videos, daily stats, sync
          // state and link/click/lead attribution all survive and are picked up again if the
          // same channel is reconnected. The stored credentials are deleted unless another
          // channel still uses the same connection.
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
                  .eq("workspace_id", workspaceId)
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
                  .eq("id", channelId)
                  .eq("workspace_id", workspaceId);
                if (error) fail("detach", error);
              },
              async attachChannel(channelId, connectionId) {
                const { error } = await client
                  .from("youtube_channels")
                  .update({ connection_id: connectionId })
                  .eq("id", channelId)
                  .eq("workspace_id", workspaceId);
                if (error) fail("reattach", error);
              },
              async countOtherChannelsUsingConnection(connectionId, exceptChannelId) {
                const { count, error } = await client
                  .from("youtube_channels")
                  .select("id", { count: "exact", head: true })
                  .eq("connection_id", connectionId)
                  .neq("id", exceptChannelId);
                // (Counted across every workspace on purpose: the credentials must never be
                // deleted while ANY channel still uses them.)
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
                  .eq("workspace_id", workspaceId)
                  .select("id");
                if (error) fail("delete_connection", error);
                if (!data || data.length === 0)
                  fail("delete_connection", { message: "no connection row was deleted" });
              },
            },
            id,
          );

          if (result.status === "not_found")
            return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
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
