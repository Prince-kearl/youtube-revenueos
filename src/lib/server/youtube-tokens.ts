import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecretFromBytea, encryptSecretToBytea } from "./crypto";
import { refreshGoogleAccessToken } from "./google-oauth";

interface YoutubeChannelRow {
  id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expiry: string | null;
}

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

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
export async function getValidAccessToken(
  client: SupabaseClient,
  channel: YoutubeChannelRow,
): Promise<string> {
  const expiresAt = channel.token_expiry ? new Date(channel.token_expiry).getTime() : 0;
  if (expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return decryptSecretFromBytea(channel.access_token_ciphertext);
  }

  const refreshToken = await decryptSecretFromBytea(channel.refresh_token_ciphertext);
  let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
  try {
    refreshed = await refreshGoogleAccessToken(refreshToken);
  } catch (error) {
    if (!isYoutubeReauthError(error)) throw error;
    await client
      .from("youtube_channels")
      .update({ last_sync_status: "reauth_required", last_sync_error: null })
      .eq("id", channel.id);
    throw new YoutubeReauthRequiredError();
  }
  const accessTokenCiphertext = await encryptSecretToBytea(refreshed.access_token);
  const tokenExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  await client
    .from("youtube_channels")
    .update({ access_token_ciphertext: accessTokenCiphertext, token_expiry: tokenExpiry })
    .eq("id", channel.id);

  return refreshed.access_token;
}
