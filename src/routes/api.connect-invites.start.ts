import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { checkAbuseLimit, RATE_LIMIT_POLICY, rateLimitedResponse } from "@/lib/server/rate-limit";
import {
  assertYoutubeOAuthConfigured,
  buildGoogleAuthorizationUrl,
} from "@/lib/server/google-oauth";
import { buildExpiredCookie, buildSetCookie } from "@/lib/server/cookies";
import { inviteState, INVITE_TOKEN, loadInviteByToken } from "@/lib/server/connect-invites";
import { INVITE_COOKIE } from "@/lib/server/connect-invite-callback";

// GET ?token= — the client clicked "Continue with Google" on a connect link. The link must be
// valid (unused, unexpired, not revoked); then the browser goes to Google's consent screen with a
// fresh anti-forgery state, and the link travels in a short-lived HttpOnly cookie so the callback
// (/api/youtube/callback → connect-invite-callback.ts) knows which link this is. No session is
// needed: the client is not a Tubify user. Rate-limited per client address.

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { Location: location } });

export const Route = createFileRoute("/api/connect-invites/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const page = `/connect/${INVITE_TOKEN.test(token) ? token : "invalid"}`;
        try {
          const service = createServiceSupabaseClient();
          const limit = await checkAbuseLimit(
            service,
            request,
            "connect_invite",
            RATE_LIMIT_POLICY.connectInvite,
          );
          if (limit.refuse) return rateLimitedResponse(limit.retryAfterSeconds);
          const invite = await loadInviteByToken(service, token);
          if (!invite) return redirect(`${page}?result=invalid`);
          const state = inviteState(invite);
          if (state !== "valid") return redirect(`${page}?result=${state}`);

          assertYoutubeOAuthConfigured();
          const oauthState = crypto.randomUUID();
          const response = redirect(buildGoogleAuthorizationUrl(oauthState));
          response.headers.append(
            "Set-Cookie",
            buildSetCookie("yt_oauth_state", oauthState, { maxAge: 600 }),
          );
          response.headers.append(
            "Set-Cookie",
            buildSetCookie(INVITE_COOKIE, token, { maxAge: 600 }),
          );
          // Not the agency's own flow: nothing to return to inside the app.
          response.headers.append("Set-Cookie", buildExpiredCookie("yt_oauth_return"));
          return response;
        } catch {
          return redirect(`${page}?result=error`);
        }
      },
    },
  },
});
