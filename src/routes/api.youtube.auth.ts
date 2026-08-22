import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { assertYoutubeOAuthConfigured, buildGoogleAuthorizationUrl } from "@/lib/server/google-oauth";
import { buildSetCookie } from "@/lib/server/cookies";

export const Route = createFileRoute("/api/youtube/auth")({
  server: {
    handlers: {
      // Entry point for the "Connect YouTube Channel" button — requires an existing Supabase
      // session (cookie) and redirects the browser straight to Google's consent screen.
      GET: async ({ request }) => {
        try {
          const { client, setCookieHeaders } = await requireSessionUser(request);
          const requestUrl = new URL(request.url);
          const returnTo = requestUrl.searchParams.get("returnTo");
          const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/settings";
          const { data: existingChannel } = await client.from("youtube_channels").select("id").limit(1).maybeSingle();
          if (existingChannel) {
            const response = new Response(null, { status: 302, headers: { Location: safeReturnTo } });
            for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
            return response;
          }
          // GOOGLE_REDIRECT_URI is authoritative here — never computed from the request's host/origin.
          assertYoutubeOAuthConfigured();
          const state = crypto.randomUUID();
          const response = new Response(null, {
            status: 302,
            headers: { Location: buildGoogleAuthorizationUrl(state) },
          });
          // Short-lived CSRF nonce checked against the `state` param on the callback.
          response.headers.append("Set-Cookie", buildSetCookie("yt_oauth_state", state, { maxAge: 600 }));
          response.headers.append("Set-Cookie", buildSetCookie("yt_oauth_return", safeReturnTo, { maxAge: 600 }));
          for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
          return response;
        } catch (error) {
          if (error instanceof Response) return error;
          console.error("YouTube OAuth authorization request failed", error);
          return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
