import {
  decodeGoogleIdentityFromIdToken,
  exchangeGoogleAuthorizationCode,
  fetchAuthorizedYoutubeChannels,
} from "./google-oauth";
import { encryptSecretToBytea } from "./crypto";
import { buildExpiredCookie } from "./cookies";
import { createServiceSupabaseClient } from "./supabase";
import {
  attachInviteChannel,
  dropUnusedInviteConnection,
  inviteState,
  INVITE_TOKEN,
  loadInviteByToken,
} from "./connect-invites";

// Google's answer for a client connect link (the client is not a Tubify user and has no session).
// /api/youtube/callback hands over here when the yt_invite cookie (set by
// /api/connect-invites/start) is present. Everything is checked again here: the OAuth state, the
// link (unused, unexpired, not revoked), then Google's own answer. Only the channel the client
// chose is attached (attachInviteChannel); a client whose Google account has several channels
// picks one on the link's page, and until then their authorization is kept unusable by the
// workspace (api.youtube.connections.ts refuses invite connections).

const UNIQUE_VIOLATION = "23505";
export const INVITE_COOKIE = "yt_invite";

function back(appUrl: string, token: string, result: string, extra = ""): Response {
  const safeToken = INVITE_TOKEN.test(token) ? token : "invalid";
  const response = new Response(null, {
    status: 302,
    headers: { Location: `${appUrl}/connect/${safeToken}?result=${result}${extra}` },
  });
  response.headers.append("Set-Cookie", buildExpiredCookie(INVITE_COOKIE));
  response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_state"));
  return response;
}

export async function handleInviteCallback(input: {
  appUrl: string;
  token: string;
  code: string | null;
  state: string | null;
  expectedState: string | undefined;
  denied: boolean;
}): Promise<Response> {
  const { appUrl, token } = input;
  if (input.denied) return back(appUrl, token, "denied");
  if (!input.code || !input.state || !input.expectedState || input.state !== input.expectedState)
    return back(appUrl, token, "invalid_state");

  const service = createServiceSupabaseClient();
  const invite = await loadInviteByToken(service, token);
  if (!invite) return back(appUrl, token, "invalid");
  const state = inviteState(invite);
  if (state !== "valid") return back(appUrl, token, state);

  let tokens: Awaited<ReturnType<typeof exchangeGoogleAuthorizationCode>>;
  try {
    tokens = await exchangeGoogleAuthorizationCode(input.code);
  } catch {
    return back(appUrl, token, "error");
  }
  if (!tokens.refresh_token) return back(appUrl, token, "reauthorize_required");
  const identity = tokens.id_token ? decodeGoogleIdentityFromIdToken(tokens.id_token) : null;

  let discovered: Awaited<ReturnType<typeof fetchAuthorizedYoutubeChannels>>;
  try {
    discovered = await fetchAuthorizedYoutubeChannels(tokens.access_token);
  } catch {
    return back(appUrl, token, "error");
  }
  await service.from("youtube_quota_events").insert({
    user_id: invite.created_by,
    operation: "channels.list",
    quota_units: 1,
    succeeded: true,
  });
  if (discovered.length === 0) return back(appUrl, token, "no_channels");

  const secrets = {
    access_token_ciphertext: await encryptSecretToBytea(tokens.access_token),
    refresh_token_ciphertext: await encryptSecretToBytea(tokens.refresh_token),
    token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    granted_scopes: tokens.scope.split(" ").filter(Boolean),
    status: "active",
  };

  // The client's authorization, in the agency's workspace. The same Google identity already
  // connected there (a reconnect through a new link) is refreshed rather than duplicated.
  let connectionId: string | null = null;
  if (identity) {
    const { data: existing } = await service
      .from("youtube_connections")
      .select("id")
      .eq("workspace_id", invite.workspace_id)
      .eq("google_subject_id", identity.sub)
      .maybeSingle();
    if (existing) {
      const { error } = await service
        .from("youtube_connections")
        .update({ ...secrets, google_email: identity.email ?? null })
        .eq("id", existing.id as string)
        .eq("workspace_id", invite.workspace_id);
      if (error) return back(appUrl, token, "storage_failed");
      connectionId = existing.id as string;
    }
  }
  if (!connectionId) {
    const { data: inserted, error } = await service
      .from("youtube_connections")
      .insert({
        workspace_id: invite.workspace_id,
        // The member who sent the link (NOT NULL, display/audit only); the grant is the client's.
        user_id: invite.created_by,
        google_subject_id: identity?.sub ?? null,
        google_email: identity?.email ?? null,
        granted_via_invite_id: invite.id,
        ...secrets,
      })
      .select("id")
      .single();
    if (error?.code === UNIQUE_VIOLATION && identity) {
      const { data: raced } = await service
        .from("youtube_connections")
        .select("id")
        .eq("workspace_id", invite.workspace_id)
        .eq("google_subject_id", identity.sub)
        .maybeSingle();
      connectionId = (raced?.id as string | undefined) ?? null;
    } else if (!error && inserted) {
      connectionId = inserted.id as string;
    }
    if (!connectionId) return back(appUrl, token, "storage_failed");
  }

  if (discovered.length > 1) {
    // Several channels on the client's Google account: the client picks one on the link's page.
    await service
      .from("channel_connect_invites")
      .update({ pending_connection_id: connectionId })
      .eq("id", invite.id)
      .is("used_at", null);
    return back(appUrl, token, "pick");
  }

  const outcome = await attachInviteChannel(service, {
    invite,
    connectionId,
    channel: discovered[0],
  });
  if (outcome.status !== "connected") {
    await dropUnusedInviteConnection(service, invite.workspace_id, connectionId);
    return back(appUrl, token, outcome.status);
  }
  return back(
    appUrl,
    token,
    "connected",
    `&channel=${encodeURIComponent(outcome.channelTitle.slice(0, 120))}`,
  );
}
