import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { buildGoogleAuthorizationUrl } from "@/lib/server/google-oauth";
import { buildSetCookie } from "@/lib/server/cookies";

export const Route = createFileRoute("/api/youtube/auth")({
  server: {
    handlers: {
      // Entry point for the "Connect YouTube Channel" button — requires an existing Supabase
      // session (cookie) and redirects the browser straight to Google's consent screen.
      GET: async ({ request }) => {
        try {
          const { setCookieHeaders } = await requireSessionUser(request);
          const state = crypto.randomUUID();
          const response = new Response(null, {
            status: 302,
            headers: { Location: buildGoogleAuthorizationUrl(state) },
          });
          // Short-lived CSRF nonce checked against the `state` param on the callback.
          response.headers.append("Set-Cookie", buildSetCookie("yt_oauth_state", state, { maxAge: 600 }));
          for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
          return response;
        } catch (error) {
          if (error instanceof Response) return error;
          return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
