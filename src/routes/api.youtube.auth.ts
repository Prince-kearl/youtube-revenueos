import { createFileRoute } from "@tanstack/react-router";
import { canManageWorkspaceMembers, getWorkspaceMembership } from "@/lib/server/workspace";
import {
  assertYoutubeOAuthConfigured,
  buildGoogleAuthorizationUrl,
} from "@/lib/server/google-oauth";
import { buildExpiredCookie, buildSetCookie } from "@/lib/server/cookies";
import { signInRedirect } from "@/lib/server/sign-in-redirect";
import { safeAppPath, withYoutubeStatus } from "@/lib/server/safe-redirect";

function redirectNoWorkspace() {
  return new Response(null, {
    status: 302,
    headers: { Location: "/settings?youtube=no_workspace" },
  });
}

export const Route = createFileRoute("/api/youtube/auth")({
  server: {
    handlers: {
      // Entry point for the "Connect YouTube Channel" button — requires an existing Supabase
      // session (cookie) and redirects the browser straight to Google's consent screen.
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const safeReturnTo = safeAppPath(requestUrl.searchParams.get("returnTo"), "/settings");
        try {
          const { client, workspaceId, workspaceRole, setCookieHeaders } =
            await getWorkspaceMembership(request);
          const back = (path: string) => {
            const response = new Response(null, { status: 302, headers: { Location: path } });
            for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
            return response;
          };

          // Connecting a channel attaches a Google account's YouTube access to the whole
          // workspace: only its owner or a manager may (the callback checks again).
          if (!canManageWorkspaceMembers(workspaceRole)) {
            return requestUrl.searchParams.get("ifNeeded") === "1"
              ? back(safeReturnTo)
              : back(withYoutubeStatus(safeReturnTo, "not_allowed"));
          }

          // `ifNeeded=1` is what the sign-in flows use: go connect YouTube only when this person's
          // workspace has no channel yet. Without it every login — including a returning creator
          // with a working connection — was forced through Google's full consent screen again
          // (and landed on "access denied" instead of their dashboard if they backed out).
          // Explicit "Connect"/"Reconnect" buttons omit the flag and always go to Google.
          if (requestUrl.searchParams.get("ifNeeded") === "1") {
            const { data: channels, error: channelsError } = await client
              .from("youtube_channels")
              .select("id")
              .eq("workspace_id", workspaceId)
              .not("connection_id", "is", null)
              .limit(1);
            if (channelsError || (channels?.length ?? 0) > 0) return back(safeReturnTo);
          }
          // GOOGLE_REDIRECT_URI is authoritative here — never computed from the request's host/origin.
          assertYoutubeOAuthConfigured();
          const state = crypto.randomUUID();
          const response = new Response(null, {
            status: 302,
            headers: { Location: buildGoogleAuthorizationUrl(state) },
          });
          // Short-lived CSRF nonce checked against the `state` param on the callback.
          response.headers.append(
            "Set-Cookie",
            buildSetCookie("yt_oauth_state", state, { maxAge: 600 }),
          );
          response.headers.append(
            "Set-Cookie",
            buildSetCookie("yt_oauth_return", safeReturnTo, { maxAge: 600 }),
          );
          // A client connect link opened in this browser earlier must not take over this one.
          response.headers.append("Set-Cookie", buildExpiredCookie("yt_invite"));
          for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
          return response;
        } catch (error) {
          // A top-level navigation, not a fetch: never a raw JSON error page.
          if (error instanceof Response) {
            // No session, or it expired: sign in, then come back here to try again.
            if (error.status === 401) return signInRedirect(safeReturnTo);
            // Signed in but no workspace yet: Settings explains.
            if (error.status === 403) return redirectNoWorkspace();
          }
          console.error("YouTube OAuth authorization request failed");
          return new Response(null, {
            status: 302,
            headers: { Location: withYoutubeStatus(safeReturnTo, "error") },
          });
        }
      },
    },
  },
});
