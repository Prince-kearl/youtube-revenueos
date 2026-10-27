import { buildSetCookie } from "./cookies";
import { POST_LOGIN_COOKIE, postLoginPath } from "../safe-redirect";

/**
 * Sends a browser with no (or an expired) session to sign in, remembering where it was going:
 * in the address for an email/password sign-in, and in a short-lived cookie that survives the
 * Google sign-in round trip (read by /auth/callback). Only a safe app page is ever remembered —
 * never another site, an API or an auth route — so this can neither redirect off the app nor
 * loop back through sign-in.
 */
export function signInRedirect(returnTo: string): Response {
  const next = postLoginPath(returnTo);
  const response = new Response(null, {
    status: 302,
    headers: { Location: `/?next=${encodeURIComponent(next)}&reason=session_expired` },
  });
  response.headers.append("Set-Cookie", buildSetCookie(POST_LOGIN_COOKIE, next, { maxAge: 600 }));
  return response;
}
