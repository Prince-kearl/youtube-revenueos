import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecretFromBytea, encryptSecretToBytea } from "./crypto";
import { refreshGoogleAccessToken } from "./google-oauth";
import { registerYoutubeAccessToken } from "./youtube-token-registry";

// A connection's token pair is shared by every youtube_channels row with a matching
// connection_id — refreshing it here benefits all of them at once, and a failure here means every
// one of those channels needs reauthorization, not just one. Callers fetch this shape by joining
// through youtube_channels.connection_id (see any route that calls getValidAccessToken).
export interface YoutubeConnectionRow {
  id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expiry: string | null;
}

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Every caller loads a channel's connection via a `connection:youtube_connections!connection_id(...)`
// embedded select (see any route that calls getValidAccessToken). Without generated Supabase
// Database types, the client can't tell that relationship is many-to-one, so its inferred type is
// an array even though PostgREST actually returns a single object for it at runtime. This
// normalizes either shape so callers get a single row (or null) regardless.
export function normalizeYoutubeConnectionRow(
  value: YoutubeConnectionRow | YoutubeConnectionRow[] | null | undefined,
): YoutubeConnectionRow | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export class YoutubeReauthRequiredError extends Error {
  constructor() {
    super("YOUTUBE_REAUTH_REQUIRED");
    this.name = "YoutubeReauthRequiredError";
  }
}

// Two different things can look like "unauthorized", and only one of them means the creator has
// to reconnect:
//
//   isYoutubeTokenRefreshReauthError  Google refused to issue an access token for the stored
//                                     refresh token. The grant is gone: reauthorization required.
//   isYoutubeApiUnauthorizedError     A YouTube API endpoint answered 401. On its own this proves
//                                     nothing about the grant — it has been seen on tokens Google
//                                     issued seconds earlier. The request layer answers it by
//                                     forcing a refresh and retrying once (google-oauth.ts); if
//                                     the refresh succeeds and the retry still fails, it is an
//                                     ordinary, retryable API failure.
//
// Nothing may treat the second as the first.

/** True only when Google rejected the OAuth credential itself while obtaining or refreshing an
 * access token — the one genuine "reauthorization required" condition. */
export function isYoutubeTokenRefreshReauthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // invalid_client / unauthorized_client mean this app's own GOOGLE_CLIENT_ID/SECRET are wrong, so
  // reconnecting cannot help and no creator's connection should be flagged for it.
  if (/GOOGLE_TOKEN_REQUEST_FAILED:\d{3}:(invalid_client|unauthorized_client)$/.test(message))
    return false;
  return (
    message === "YOUTUBE_REAUTH_REQUIRED" ||
    /GOOGLE_TOKEN_REQUEST_FAILED:(400|401)(?::|$)/.test(message)
  );
}

/** True when a YouTube API request (not the token endpoint) was answered with HTTP 401 even
 * after the forced refresh and single retry. A retryable upstream failure — never grounds for
 * marking a channel "reauth_required" or telling a creator to reconnect. */
export function isYoutubeApiUnauthorizedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /YOUTUBE_[A-Z_]+_FAILED:401(?::|$)/.test(message);
}

// Returns a usable access token, transparently refreshing (and persisting the refreshed
// ciphertext) when the stored one is expired or about to expire — this is what lets a creator
// stay connected indefinitely instead of reauthorizing every time the short-lived token expires.
type TokenLifecycleDependencies = {
  decrypt: typeof decryptSecretFromBytea;
  encrypt: typeof encryptSecretToBytea;
  refresh: typeof refreshGoogleAccessToken;
  now: () => number;
};

const productionTokenLifecycleDependencies: TokenLifecycleDependencies = {
  decrypt: decryptSecretFromBytea,
  encrypt: encryptSecretToBytea,
  refresh: refreshGoogleAccessToken,
  now: () => Date.now(),
};

export async function getValidAccessTokenWithDependencies(
  client: SupabaseClient,
  connection: YoutubeConnectionRow,
  dependencies: TokenLifecycleDependencies,
): Promise<string> {
  // Whatever token is handed out is registered with a way to force a refresh for this
  // connection, so the API request layer can answer a 401 by actually testing the grant
  // (see youtube-token-registry.ts) instead of assuming it has been revoked.
  const forceRefresh = async () => {
    const token = await refreshAndPersistAccessToken(client, connection, dependencies);
    registerYoutubeAccessToken(token, connection.id, forceRefresh, {
      forced: true,
      now: dependencies.now(),
    });
    return token;
  };
  const expiresAt = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;
  const token =
    expiresAt - EXPIRY_SAFETY_MARGIN_MS > dependencies.now()
      ? await dependencies.decrypt(connection.access_token_ciphertext)
      : await refreshAndPersistAccessToken(client, connection, dependencies);
  registerYoutubeAccessToken(token, connection.id, forceRefresh, { now: dependencies.now() });
  return token;
}

/**
 * Asks Google for a new access token with the stored refresh token and persists it.
 *
 * This is the only place a connection is ever marked "reauth_required": if Google rejects the
 * refresh, the grant is genuinely gone, the connection and every channel sharing it are flagged,
 * and YoutubeReauthRequiredError is thrown. Any other failure (network, Google 5xx) is rethrown
 * unchanged and flags nothing.
 */
async function refreshAndPersistAccessToken(
  client: SupabaseClient,
  connection: YoutubeConnectionRow,
  dependencies: TokenLifecycleDependencies,
): Promise<string> {
  const refreshToken = await dependencies.decrypt(connection.refresh_token_ciphertext);
  let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
  try {
    refreshed = await dependencies.refresh(refreshToken);
  } catch (error) {
    if (!isYoutubeTokenRefreshReauthError(error)) throw error;
    console.error("YouTube token refresh rejected by Google", {
      connectionId: connection.id,
      reason: error instanceof Error ? error.message : "unknown",
      timestamp: new Date(dependencies.now()).toISOString(),
    });
    await client
      .from("youtube_connections")
      .update({ status: "reauth_required" })
      .eq("id", connection.id);
    // Every channel sharing this connection loses access at once — surface that on each of them
    // so the existing per-channel "Reconnect required" UI (settings.tsx) reflects reality instead
    // of only flagging whichever channel happened to trigger the failed refresh first.
    await client
      .from("youtube_channels")
      .update({ last_sync_status: "reauth_required", last_sync_error: null })
      .eq("connection_id", connection.id);
    throw new YoutubeReauthRequiredError();
  }
  const accessTokenCiphertext = await dependencies.encrypt(refreshed.access_token);
  const tokenExpiry = new Date(dependencies.now() + refreshed.expires_in * 1000).toISOString();

  await client
    .from("youtube_connections")
    .update({ access_token_ciphertext: accessTokenCiphertext, token_expiry: tokenExpiry })
    .eq("id", connection.id);

  return refreshed.access_token;
}

export function getValidAccessToken(
  client: SupabaseClient,
  connection: YoutubeConnectionRow,
): Promise<string> {
  return getValidAccessTokenWithDependencies(
    client,
    connection,
    productionTokenLifecycleDependencies,
  );
}
