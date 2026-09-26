import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecretFromBytea, encryptSecretToBytea } from "./crypto";
import { refreshGoogleAccessToken } from "./google-oauth";

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

export function isYoutubeReauthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "YOUTUBE_REAUTH_REQUIRED" ||
    /GOOGLE_TOKEN_REQUEST_FAILED:(400|401)(?::|$)/.test(message) ||
    /YOUTUBE_[A-Z_]+_FAILED:401(?::|$)/.test(message)
  );
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
  const expiresAt = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;
  if (expiresAt - EXPIRY_SAFETY_MARGIN_MS > dependencies.now()) {
    return dependencies.decrypt(connection.access_token_ciphertext);
  }

  const refreshToken = await dependencies.decrypt(connection.refresh_token_ciphertext);
  let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
  try {
    refreshed = await dependencies.refresh(refreshToken);
  } catch (error) {
    if (!isYoutubeReauthError(error)) throw error;
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
