import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { assertYoutubeOAuthConfigured, exchangeGoogleAuthorizationCode, fetchAuthorizedYoutubeChannel } from "@/lib/server/google-oauth";
import { encryptSecretToBytea } from "@/lib/server/crypto";
import { getCookie, buildExpiredCookie } from "@/lib/server/cookies";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";

function redirectToApp(path: string, requestOrigin?: string): Response {
  const isLocalRequest = requestOrigin?.includes("localhost") || requestOrigin?.includes("127.0.0.1");
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
          if (url.searchParams.get("error")) return redirectToApp("/settings?youtube=denied", url.origin);

          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const expectedState = getCookie(request, "yt_oauth_state");
          const returnTo = getCookie(request, "yt_oauth_return") ?? "/settings";
          const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/settings";
          if (!code || !state || !expectedState || state !== expectedState) {
            return redirectToApp(`${safeReturnTo}?youtube=invalid_state`, url.origin);
          }

          const { client, user, setCookieHeaders } = await requireSessionUser(request);
          // Must match the redirect_uri used in the authorization request — GOOGLE_REDIRECT_URI is
          // the single authoritative source for both, never the callback request's own host/origin.
          assertYoutubeOAuthConfigured();
          const tokens = await exchangeGoogleAuthorizationCode(code);
          if (!tokens.refresh_token) {
            // Google omits refresh_token on repeat consent without access_type=offline&prompt=consent
            // having actually forced a new grant — ask the user to reauthorize rather than storing a
            // channel connection that will silently stop working once the access token expires.
            return redirectToApp(`${safeReturnTo}?youtube=reauthorize_required`, url.origin);
          }

          const channel = await fetchAuthorizedYoutubeChannel(tokens.access_token);
          const accessTokenCiphertext = await encryptSecretToBytea(tokens.access_token);
          const refreshTokenCiphertext = await encryptSecretToBytea(tokens.refresh_token);
          const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

          const { error: upsertError } = await client.from("youtube_channels").upsert(
            {
              user_id: user.id,
              youtube_channel_id: channel.channelId,
              channel_name: channel.title,
              channel_handle: channel.handle,
              thumbnail: channel.thumbnail,
              subscriber_count: channel.subscriberCount,
              view_count: channel.viewCount,
              video_count: channel.videoCount,
              uploads_playlist_id: channel.uploadsPlaylistId,
              access_token_ciphertext: accessTokenCiphertext,
              refresh_token_ciphertext: refreshTokenCiphertext,
              token_expiry: tokenExpiry,
              connected_at: new Date().toISOString(),
            },
            { onConflict: "user_id,youtube_channel_id" },
          );
          if (upsertError) return redirectToApp(`${safeReturnTo}?youtube=storage_failed`, url.origin);

          // A user may reconnect a different YouTube account. Keep one authoritative channel
          // per Tubify user so an older connection can never become the dashboard fallback.
          await client
            .from("youtube_channels")
            .delete()
            .eq("user_id", user.id)
            .neq("youtube_channel_id", channel.channelId);

          const service = createServiceSupabaseClient();
          await service.from("youtube_quota_events").insert({
            user_id: user.id,
            operation: "channels.list",
            quota_units: 1,
            succeeded: true,
          });

          const response = redirectToApp(`${safeReturnTo}?youtube=connected`, url.origin);
          response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_state"));
          response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_return"));
          for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
          return response;
        } catch (error) {
          if (error instanceof Response) return error;
          console.error("YouTube OAuth callback failed", error);
          return redirectToApp("/settings?youtube=error");
        }
      },
    },
  },
});
