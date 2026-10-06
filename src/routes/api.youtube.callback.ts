import { createFileRoute } from "@tanstack/react-router";
import { getWorkspaceContext } from "@/lib/server/workspace";
import {
  assertYoutubeOAuthConfigured,
  exchangeGoogleAuthorizationCode,
  fetchAuthorizedYoutubeChannels,
  decodeGoogleIdentityFromIdToken,
} from "@/lib/server/google-oauth";
import { encryptSecretToBytea } from "@/lib/server/crypto";
import { getCookie, buildExpiredCookie } from "@/lib/server/cookies";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";
import {
  planYoutubeConnectionResolution,
  type LegacyConnectionCandidate,
} from "@/lib/server/youtube-connection-resolution";
import { planReconnect } from "@/lib/server/youtube-disconnect";

// Postgres SQLSTATE for a unique-constraint violation — used to detect the race where two
// concurrent callbacks for the same identity both concluded no connection existed yet.
const UNIQUE_VIOLATION = "23505";

function redirectToApp(path: string, requestOrigin?: string): Response {
  const isLocalRequest =
    requestOrigin?.includes("localhost") || requestOrigin?.includes("127.0.0.1");
  const appUrl = isLocalRequest ? requestOrigin : (getServerEnv("APP_URL") ?? requestOrigin ?? "");
  return new Response(null, { status: 302, headers: { Location: `${appUrl}${path}` } });
}

export const Route = createFileRoute("/api/youtube/callback")({
  server: {
    handlers: {
      // Google redirects here after consent. This is intentionally a *different* callback from
      // Supabase's own `/auth/v1/callback` login flow — this one exchanges the authorization code
      // for YouTube API tokens and never returns them to the browser.
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          if (url.searchParams.get("error"))
            return redirectToApp("/settings?youtube=denied", url.origin);

          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const expectedState = getCookie(request, "yt_oauth_state");
          const returnTo = getCookie(request, "yt_oauth_return") ?? "/settings";
          const safeReturnTo =
            returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/settings";
          if (!code || !state || !expectedState || state !== expectedState) {
            return redirectToApp(`${safeReturnTo}?youtube=invalid_state`, url.origin);
          }

          const { client, user, workspaceId, setCookieHeaders } =
            await getWorkspaceContext(request);
          // Must match the redirect_uri used in the authorization request — GOOGLE_REDIRECT_URI is
          // the single authoritative source for both, never the callback request's own host/origin.
          assertYoutubeOAuthConfigured();
          const tokens = await exchangeGoogleAuthorizationCode(code);
          if (!tokens.refresh_token) {
            // Google omits refresh_token on repeat consent without access_type=offline&prompt=consent
            // having actually forced a new grant — ask the user to reauthorize rather than storing a
            // connection that will silently stop working once the access token expires.
            return redirectToApp(`${safeReturnTo}?youtube=reauthorize_required`, url.origin);
          }

          const identity = tokens.id_token
            ? decodeGoogleIdentityFromIdToken(tokens.id_token)
            : null;

          // channels.list(mine=true) returns every channel this Google identity has account-level
          // rights to — for most creators that's one, but for a legacy Brand Account manager it can
          // be several. Every one of them is discovered here; none are silently dropped.
          const discovered = await fetchAuthorizedYoutubeChannels(tokens.access_token);
          const service = createServiceSupabaseClient();
          await service.from("youtube_quota_events").insert({
            user_id: user.id,
            operation: "channels.list",
            quota_units: 1,
            succeeded: true,
          });

          if (discovered.length === 0) {
            // This is the one scenario this app cannot fix: a modern YouTube Studio "Channel
            // Permissions" invite (as opposed to a legacy Brand Account manager role) is not
            // exposed via any YouTube API to the invited user's own OAuth token, by Google's own
            // design — see YoutubeReauthNotice / the settings help copy for the workaround
            // (have the channel owner connect it directly, then invite this user as a Tubify
            // workspace member).
            return redirectToApp(`${safeReturnTo}?youtube=no_channels_found`, url.origin);
          }

          const accessTokenCiphertext = await encryptSecretToBytea(tokens.access_token);
          const refreshTokenCiphertext = await encryptSecretToBytea(tokens.refresh_token);
          const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          const grantedScopes = tokens.scope.split(" ").filter(Boolean);

          // Step 1: exact match on this workspace's existing connection for this exact Google
          // identity — the common case once an identity has connected at least once since the
          // openid scope was added.
          let exactMatchConnectionId: string | null = null;
          if (identity) {
            const { data: existing } = await client
              .from("youtube_connections")
              .select("id")
              .eq("workspace_id", workspaceId)
              .eq("google_subject_id", identity.sub)
              .maybeSingle();
            exactMatchConnectionId = existing?.id ?? null;
          }

          // Step 2: if no exact match, look for a legacy (google_subject_id IS NULL) connection
          // that this reconnect can safely adopt — one backfilled by the pre-connections migration,
          // referenced by a channel this same OAuth token can also see. See
          // youtube-connection-resolution.ts for exactly why and how this is scoped conservatively.
          let eligibleLegacyConnections: LegacyConnectionCandidate[] = [];
          if (identity && !exactMatchConnectionId && discovered.length > 0) {
            const { data: matchingChannels } = await client
              .from("youtube_channels")
              .select("connection_id")
              .eq("workspace_id", workspaceId)
              .in(
                "youtube_channel_id",
                discovered.map((channel) => channel.channelId),
              );
            const candidateConnectionIds = [
              ...new Set(
                (matchingChannels ?? [])
                  .map((row) => row.connection_id)
                  .filter((id): id is string => Boolean(id)),
              ),
            ];
            if (candidateConnectionIds.length > 0) {
              const { data: legacyConnections } = await client
                .from("youtube_connections")
                .select("id, access_token_ciphertext, refresh_token_ciphertext")
                .in("id", candidateConnectionIds)
                .is("google_subject_id", null);
              eligibleLegacyConnections = (legacyConnections ?? []).map((row) => ({
                id: row.id,
                hasTokenPair:
                  Boolean(row.access_token_ciphertext) && Boolean(row.refresh_token_ciphertext),
              }));
            }
          }

          const plan = planYoutubeConnectionResolution({
            exactMatchConnectionId,
            eligibleLegacyConnections,
          });

          if (plan.action === "ambiguous") {
            // More than one legacy connection in this workspace could plausibly belong to this
            // identity, and there is no reliable way to tell which — never guess, never merge.
            // Nothing has been written; the operator can resolve this deliberately (e.g. by
            // disconnecting the stale legacy channel first, or reconnecting each channel
            // individually) rather than risking two unrelated Google accounts sharing credentials.
            console.error("YouTube connection reconciliation ambiguous", {
              workspaceId,
              candidateConnectionIds: plan.candidateConnectionIds,
            });
            return redirectToApp(`${safeReturnTo}?youtube=connection_ambiguous`, url.origin);
          }

          let connectionId: string;
          if (plan.action === "reuse" || plan.action === "reconcile") {
            connectionId = plan.connectionId;
            const { error: updateError } = await client
              .from("youtube_connections")
              .update({
                access_token_ciphertext: accessTokenCiphertext,
                refresh_token_ciphertext: refreshTokenCiphertext,
                token_expiry: tokenExpiry,
                granted_scopes: grantedScopes,
                status: "active",
                // Only meaningfully changes anything on "reconcile" (adopting a legacy NULL-subject
                // row) — on "reuse" these already match what's stored, so resending is a harmless
                // no-op write.
                google_subject_id: identity?.sub ?? null,
                google_email: identity?.email ?? null,
              })
              .eq("id", connectionId);
            if (updateError) {
              if (updateError.code === UNIQUE_VIOLATION && identity) {
                // Extremely narrow race: something else attached this exact sub to a different
                // connection in the moment between our plan and this write. Recover by adopting
                // whatever now holds that sub rather than failing the whole connect.
                const { data: raced } = await client
                  .from("youtube_connections")
                  .select("id")
                  .eq("workspace_id", workspaceId)
                  .eq("google_subject_id", identity.sub)
                  .maybeSingle();
                if (!raced) {
                  console.error("YouTube connection update failed", updateError.message);
                  return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);
                }
                connectionId = raced.id;
              } else {
                console.error("YouTube connection update failed", updateError.message);
                return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);
              }
            }
          } else {
            // plan.action === "create" — no exact match and no safely-adoptable legacy connection.
            const { data: inserted, error: insertError } = await client
              .from("youtube_connections")
              .insert({
                workspace_id: workspaceId,
                user_id: user.id,
                google_subject_id: identity?.sub ?? null,
                google_email: identity?.email ?? null,
                access_token_ciphertext: accessTokenCiphertext,
                refresh_token_ciphertext: refreshTokenCiphertext,
                token_expiry: tokenExpiry,
                granted_scopes: grantedScopes,
                status: "active",
              })
              .select("id")
              .single();
            if (insertError || !inserted) {
              if (insertError?.code === UNIQUE_VIOLATION && identity) {
                // Two concurrent callbacks for the same brand-new identity both concluded no
                // connection existed and both tried to insert — the (workspace_id,
                // google_subject_id) unique index let exactly one win. Adopt that one instead of
                // failing this request; its tokens are just as valid as the ones we would have
                // written.
                const { data: raced } = await client
                  .from("youtube_connections")
                  .select("id")
                  .eq("workspace_id", workspaceId)
                  .eq("google_subject_id", identity.sub)
                  .maybeSingle();
                if (!raced) {
                  console.error("YouTube connection insert failed", insertError?.message);
                  return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);
                }
                connectionId = raced.id;
              } else {
                console.error("YouTube connection insert failed", insertError?.message);
                return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);
              }
            } else {
              connectionId = inserted.id;
            }
          }

          const { data: existingRows } = await client
            .from("youtube_channels")
            .select("youtube_channel_id, connection_id")
            .eq("workspace_id", workspaceId);
          // Sorts the channels this grant can see into "currently connected here" (refresh their
          // connection) and "not connected here" — brand new OR previously disconnected. A
          // disconnected channel keeps its row (see youtube-disconnect.ts), and goes through the
          // ordinary connect step below, whose upsert on (workspace_id, youtube_channel_id)
          // reattaches that same row — same id, history intact — rather than creating a second
          // one. Identity is the YouTube channel id only.
          const reconnect = planReconnect(
            (existingRows ?? []) as Array<{
              youtube_channel_id: string;
              connection_id: string | null;
            }>,
            discovered.map((channel) => channel.channelId),
            connectionId,
          );

          // Reconnecting an already-connected channel must leave it using THIS grant. The plan
          // above can resolve to a different connection than the one the channel row points at
          // (a "create" when no identity/legacy match was found, or a "reuse" of another row for
          // the same identity) — without this, the fresh tokens are stored but the channel keeps
          // reading its old, rejected ones and stays stuck on "authorization needs to be renewed".
          // Safe to attach: channels.list(mine=true) just proved this token can access them.
          if (reconnect.refreshIds.length > 0) {
            const rediscoveredIds = reconnect.refreshIds;
            const { error: repointError } = await client
              .from("youtube_channels")
              .update({ connection_id: connectionId })
              .eq("workspace_id", workspaceId)
              .in("youtube_channel_id", rediscoveredIds);
            if (repointError) {
              console.error("YouTube channel reconnect failed", repointError.message);
              return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);
            }
            // Clear the stale flag now instead of leaving "Reconnect required" until the next sync.
            await client
              .from("youtube_channels")
              .update({ last_sync_status: "never_synced", last_sync_error: null })
              .eq("workspace_id", workspaceId)
              .in("youtube_channel_id", rediscoveredIds)
              .eq("last_sync_status", "reauth_required");
            // Drop connections this just superseded. The FK is ON DELETE RESTRICT, so one that
            // still backs another channel is refused by the database and left untouched.
            for (const supersededId of reconnect.supersededConnectionIds) {
              await client.from("youtube_connections").delete().eq("id", supersededId);
            }
          }
          const connectIds = new Set(reconnect.connectIds);
          const newChannels = discovered.filter((channel) => connectIds.has(channel.channelId));

          if (newChannels.length === 0) {
            // Every discovered channel is already connected to this workspace — nothing new to
            // add, but the connection's tokens were still refreshed above.
            return redirectToApp(`${safeReturnTo}?youtube=already_connected`, url.origin);
          }

          if (newChannels.length > 1) {
            // More than one new channel is available under this identity — let the person choose
            // which to add rather than guessing, same principle as never taking items[0]. The
            // settings page picks this up via pendingConnectionId and calls
            // /api/youtube/connections?discover= to list them.
            const response = redirectToApp(
              `/settings?youtube=pick_channels&pendingConnectionId=${connectionId}`,
              url.origin,
            );
            response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_state"));
            response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_return"));
            for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
            return response;
          }

          // Exactly one new channel — connect it immediately, no picker needed.
          const channel = newChannels[0];
          const { error: upsertError } = await client.from("youtube_channels").upsert(
            {
              user_id: user.id,
              workspace_id: workspaceId,
              connection_id: connectionId,
              youtube_channel_id: channel.channelId,
              channel_name: channel.title,
              channel_handle: channel.handle,
              thumbnail: channel.thumbnail,
              subscriber_count: channel.subscriberCount,
              view_count: channel.viewCount,
              video_count: channel.videoCount,
              uploads_playlist_id: channel.uploadsPlaylistId,
              connected_at: new Date().toISOString(),
              // A successful reconnect means the new token is valid — clear a stale
              // reauth_required (or failed) flag from a previous connection immediately, rather
              // than leaving the UI stuck on "Reconnect required" until the next sync job runs.
              last_sync_status: "never_synced",
              last_sync_error: null,
            },
            { onConflict: "workspace_id,youtube_channel_id" },
          );
          if (upsertError) {
            console.error("YouTube channel upsert failed", {
              code: upsertError.code,
              message: upsertError.message,
              details: upsertError.details,
              hint: upsertError.hint,
            });
            return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);
          }

          const response = redirectToApp(`${safeReturnTo}?youtube=connected`, url.origin);
          response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_state"));
          response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_return"));
          for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
          return response;
        } catch (error) {
          // getWorkspaceContext throws a bare 403 Response for NO_WORKSPACE — surface that as a
          // friendly redirect like every other failure mode here, instead of dumping raw JSON in
          // the browser (this is a top-level OAuth redirect, not a fetch the app can read).
          if (error instanceof Response) {
            if (error.status === 403) {
              try {
                const body = (await error.clone().json()) as { error?: string };
                if (body.error === "NO_WORKSPACE") {
                  return redirectToApp("/settings?youtube=no_workspace");
                }
              } catch {
                // fall through to returning the raw response below
              }
            }
            return error;
          }
          console.error("YouTube OAuth callback failed", error);
          return redirectToApp("/settings?youtube=error");
        }
      },
    },
  },
});
