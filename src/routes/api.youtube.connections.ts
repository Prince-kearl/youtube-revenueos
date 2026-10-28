import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { canManageWorkspaceMembers, getWorkspaceContext } from "@/lib/server/workspace";
import { channelCapacity, overChannelLimit, subscriptionRequired } from "@/lib/server/plan-access";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { fetchAuthorizedYoutubeChannels } from "@/lib/server/google-oauth";
import { getValidAccessToken, isYoutubeTokenRefreshReauthError } from "@/lib/server/youtube-tokens";

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

// Loads the connection's live token pair — only a connection of the caller's CURRENT workspace.
// Workspace membership alone is not enough: someone who belongs to two workspaces must never
// list or attach the other workspace's Google connection (its owner's YouTube access) here. Read
// server-side; the tokens never reach the caller.
async function loadOwnedConnectionSecret(workspaceId: string, connectionId: string) {
  return (
    createServiceSupabaseClient()
      .from("youtube_connections")
      .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
      .eq("id", connectionId)
      .eq("workspace_id", workspaceId)
      // A client's authorization granted through a connect link is never browsed or used to attach
      // more channels: the client shared ONE channel, not their Google account.
      .is("granted_via_invite_id", null)
      .maybeSingle()
  );
}

const notAllowed = () =>
  json(
    {
      error: "FORBIDDEN",
      message: "Only the workspace owner or a manager can connect YouTube channels.",
    },
    { status: 403 },
  );

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
          const { client, workspaceId, workspaceRole, setCookieHeaders } =
            await getWorkspaceContext(request, { requirePlan: false });
          if (!canManageWorkspaceMembers(workspaceRole))
            return withCookies(notAllowed(), setCookieHeaders);
          const url = new URL(request.url);
          const connectionId = idSchema.parse(url.searchParams.get("discover"));

          const { data: connection, error: connectionError } = await loadOwnedConnectionSecret(
            workspaceId,
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
            .eq("workspace_id", workspaceId)
            // Connected channels only: a previously disconnected channel keeps its row, and
            // must be offered here so it can be reattached (the POST below upserts onto it).
            .not("connection_id", "is", null);
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
          if (isYoutubeTokenRefreshReauthError(error))
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
          const { client, user, workspaceId, workspaceRole, setCookieHeaders, plan } =
            await getWorkspaceContext(request, { requirePlan: false });
          if (!canManageWorkspaceMembers(workspaceRole))
            return withCookies(notAllowed(), setCookieHeaders);
          const input = addSchema.parse(await parseJson(request));

          // The plan's channel limit, before anything is read from Google or written.
          let capacity: Awaited<ReturnType<typeof channelCapacity>>;
          try {
            capacity = await channelCapacity(client, {
              workspaceId,
              plan,
              youtubeChannelId: input.channelId,
            });
          } catch {
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
          if (!capacity.ok)
            return capacity.reason === "subscription_required"
              ? withCookies(subscriptionRequired(plan), setCookieHeaders)
              : withCookies(
                  json(
                    {
                      error: "CHANNEL_LIMIT_REACHED",
                      limit: capacity.limit,
                      message: `Your plan includes ${capacity.limit} ${capacity.limit === 1 ? "channel" : "channels"}. Disconnect one or upgrade in Billing to add another.`,
                    },
                    { status: 409 },
                  ),
                  setCookieHeaders,
                );

          const { data: connection, error: connectionError } = await loadOwnedConnectionSecret(
            workspaceId,
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

          const { data: upserted, error: upsertError } = await service
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

          // A connection made at the same moment may have taken the last place: then this one is
          // detached again (its row kept, like any disconnected channel) and the limit reported.
          if (!capacity.reconnect) {
            let over: boolean;
            try {
              over = await overChannelLimit(client, { workspaceId, plan });
            } catch {
              over = true;
            }
            if (over) {
              await service
                .from("youtube_channels")
                .update({ connection_id: null })
                .eq("workspace_id", workspaceId)
                .eq("youtube_channel_id", channel.channelId);
              return withCookies(
                json(
                  {
                    error: "CHANNEL_LIMIT_REACHED",
                    limit: plan.limits?.channels ?? 0,
                    message:
                      "Your plan's channel limit was reached. Disconnect one or upgrade in Billing to add another.",
                  },
                  { status: 409 },
                ),
                setCookieHeaders,
              );
            }
          }

          return withCookies(json({ data: upserted }, { status: 201 }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (isYoutubeTokenRefreshReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
