import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { applySetCookies, createSessionSupabaseClient } from "@/lib/server/supabase-ssr";
import { getServerEnv } from "@/lib/server/env";

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const isLocalRequest = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        const appUrl = isLocalRequest ? url.origin : (getServerEnv("APP_URL") ?? url.origin);

        if (!code) {
          return redirectResponse(`${appUrl}/?auth_error=missing_code`);
        }

        try {
          const { client, setCookieHeaders } = createSessionSupabaseClient(request);
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) {
            return redirectResponse(`${appUrl}/?auth_error=code_exchange_failed`);
          }

          return applySetCookies(redirectResponse(`${appUrl}/dashboard`), setCookieHeaders);
        } catch (error) {
          console.error("Supabase auth callback failed", error);
          return redirectResponse(`${appUrl}/?auth_error=callback_failed`);
        }
      },
    },
  },
});

// Shared landing point for both Supabase-login purposes: Google sign-in redirects here, and so
// does the emailed sign-up confirmation link. Both deliver a PKCE `code` that must be exchanged
// for a session before routing onward. This is separate from /api/youtube/callback, which is the
// distinct YouTube data-access authorization flow, not a Revenue OS login mechanism.
function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The server handler normally redirects before this page renders. This fallback keeps a
    // client-side navigation or a development-server error understandable to the user.
    const timer = setTimeout(() => navigate({ to: "/dashboard" }), 1500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      {error ? (
        <>
          <p className="text-sm text-destructive">{error}</p>
          <a href="/" className="text-sm font-medium text-primary hover:underline">
            Back to sign in
          </a>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
        </>
      )}
    </div>
  );
}
