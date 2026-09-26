import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { fetchAuthorizedYoutubeChannels } from "@/lib/server/google-oauth";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";

const idSchema = z.string().uuid();

const addSchema = z.object({
  connectionId: z.string().uuid(),
  channelId: z.string().min(1),
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

function withCookies(response: Response, setCookieHeaders: string[]) {
  return applySetCookies(response, setCookieHeaders);
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

// Loads the connection's live token pair, scoped to the caller's own workspace via the
// RLS-filtered `client` — never the service-role client — so a caller can't discover or add
// channels under a connection belonging to a workspace they aren't a member of.
async function loadOwnedConnectionSecret(
  client: Awaited<ReturnType<typeof getWorkspaceContext>>["client"],
  connectionId: string,
) {
  return client
    .from("youtube_connections")
    .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
    .eq("id", connectionId)
    .maybeSingle();
}

export const Route = createFileRoute("/api/youtube/connections")({
  server: {
    handlers: {
      // Lists the channels a given OAuth connection has account-level access to, on Google's side,
      // that are NOT yet connected as a youtube_channels row in this workspace. Used both right
      // after the OAuth callback (when more than one new channel was discovered) and on demand from
      // Settings ("Find more channels on this connection") — the latter needs no new consent
      // screen at all, since the connection's existing token already covers it.
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const url = new URL(request.url);
          const connectionId = idSchema.parse(url.searchParams.get("discover"));

          const { data: connection, error: connectionError } = await loadOwnedConnectionSecret(
            client,
            connectionId,
          );
          if (connectionError)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (!connection)
            return withCookies(
              json({ error: "CONNECTION_NOT_FOUND" }, { status: 404 }),
              setCookieHeaders,
            );

          const service = createServiceSupabaseClient();
          const accessToken = await getValidAccessToken(service, connection);
          const discovered = await fetchAuthorizedYoutubeChannels(accessToken);

          const { data: alreadyConnected, error: connectedError } = await client
            .from("youtube_channels")
            .select("youtube_channel_id")
            .eq("workspace_id", workspaceId);
          if (connectedError)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          const alreadyConnectedIds = new Set(
            (alreadyConnected ?? []).map((row) => row.youtube_channel_id),
          );

          const available = discovered
            .filter((channel) => !alreadyConnectedIds.has(channel.channelId))
            .map((channel) => ({
              channelId: channel.channelId,
              title: channel.title,
              handle: channel.handle,
              thumbnail: channel.thumbnail,
              subscriberCount: channel.subscriberCount,
            }));

          return withCookies(json({ data: available }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      // Adds one of the connection's already-authorized channels as a youtube_channels row. The
      // candidate channel is re-verified against a fresh channels.list call rather than trusting
      // the id the client posts back — the same "never trust the client for anything the OAuth
      // token already answers" rule this codebase applies everywhere else (see
      // fetchYoutubeVideoById's expectedChannelId checks).
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } =
            await getWorkspaceContext(request);
          const input = addSchema.parse(await parseJson(request));

          const { data: connection, error: connectionError } = await loadOwnedConnectionSecret(
            client,
            input.connectionId,
          );
          if (connectionError)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (!connection)
            return withCookies(
              json({ error: "CONNECTION_NOT_FOUND" }, { status: 404 }),
              setCookieHeaders,
            );

          const service = createServiceSupabaseClient();
          const accessToken = await getValidAccessToken(service, connection);
          const discovered = await fetchAuthorizedYoutubeChannels(accessToken);
          const channel = discovered.find((item) => item.channelId === input.channelId);
          if (!channel)
            return withCookies(
              json({ error: "YOUTUBE_CONNECTED_CHANNEL_MISMATCH" }, { status: 409 }),
              setCookieHeaders,
            );

          const { data: upserted, error: upsertError } = await client
            .from("youtube_channels")
            .upsert(
              {
                user_id: user.id,
                workspace_id: workspaceId,
                connection_id: input.connectionId,
                youtube_channel_id: channel.channelId,
                channel_name: channel.title,
                channel_handle: channel.handle,
                thumbnail: channel.thumbnail,
                subscriber_count: channel.subscriberCount,
                view_count: channel.viewCount,
                video_count: channel.videoCount,
                uploads_playlist_id: channel.uploadsPlaylistId,
                connected_at: new Date().toISOString(),
                last_sync_status: "never_synced",
                last_sync_error: null,
              },
              { onConflict: "workspace_id,youtube_channel_id" },
            )
            .select("id, youtube_channel_id, channel_name")
            .single();
          if (upsertError || !upserted)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );

          return withCookies(json({ data: upserted }, { status: 201 }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
