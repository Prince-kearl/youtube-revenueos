import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { getYoutubeOAuthConfigStatus } from "@/lib/server/google-oauth";
import { getServerEnv } from "@/lib/server/env";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export const Route = createFileRoute("/api/youtube/diagnostics")({
  server: {
    handlers: {
      // Authenticated-only — reports which redirect URI/client ID are configured (both non-secret
      // by Google's own design) without ever returning the client secret or any token.
      GET: async ({ request }) => {
        try {
          await requireSessionUser(request);
          const status = getYoutubeOAuthConfigStatus();
          return json({
            appUrl: getServerEnv("APP_URL") ?? null,
            googleClientId: status.clientId ?? null,
            googleClientIdConfigured: status.clientIdConfigured,
            googleClientSecretConfigured: status.clientSecretConfigured,
            googleRedirectUri: status.redirectUri ?? null,
            googleRedirectUriConfigured: status.redirectUriConfigured,
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
