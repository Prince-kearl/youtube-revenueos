import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { applySetCookies, createSessionSupabaseClient } from "@/lib/server/supabase-ssr";
import { getServerEnv } from "@/lib/server/env";
import { fetchAuthorizedYoutubeChannel } from "@/lib/server/google-oauth";
import { encryptSecretToBytea } from "@/lib/server/crypto";

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
          const { data, error } = await client.auth.exchangeCodeForSession(code);
          if (error || !data.session) {
            return redirectResponse(`${appUrl}/?auth_error=code_exchange_failed`);
          }

          // Google sign-in/up now requests the YouTube scopes directly (see signInWithGoogle), so
          // a provider token here means this session's Google consent already covers YouTube data
          // access — store the channel connection right away instead of sending the user through
          // a second, separate consent screen.
          const { provider_token: providerToken, provider_refresh_token: providerRefreshToken } =
            data.session;
          if (providerToken && providerRefreshToken) {
            try {
              const channel = await fetchAuthorizedYoutubeChannel(providerToken);
              const { data: membership } = await client
                .from("workspace_members")
                .select("workspace_id")
                .eq("user_id", data.session.user.id)
                .eq("status", "active")
                .limit(1)
                .maybeSingle();
              if (membership) {
                const accessTokenCiphertext = await encryptSecretToBytea(providerToken);
                const refreshTokenCiphertext = await encryptSecretToBytea(providerRefreshToken);
                await client.from("youtube_channels").upsert(
                  {
                    user_id: data.session.user.id,
                    workspace_id: membership.workspace_id,
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
                    // Supabase doesn't expose the provider token's actual expiry, only the token
                    // itself — an hour is Google's standard access-token lifetime, and the normal
                    // refresh-token flow (see youtube-tokens.ts) takes over well before then.
                    token_expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
                    connected_at: new Date().toISOString(),
                  },
                  { onConflict: "workspace_id,youtube_channel_id" },
                );
              }
            } catch (channelError) {
              // Not fatal — sign-in itself succeeded, and the user can still connect manually
              // from Settings if this best-effort auto-connect didn't go through.
              console.error("Auto-connecting YouTube after sign-in failed", channelError);
            }
            return applySetCookies(redirectResponse(`${appUrl}/dashboard`), setCookieHeaders);
          }

          // No provider token — an email/password signup confirmation link, or a Google session
          // that for some reason didn't come back with the YouTube scopes. Fall back to the
          // separate YouTube consent flow.
          const youtubeAuthUrl = `${url.origin}/api/youtube/auth?returnTo=${encodeURIComponent("/dashboard")}`;
          return applySetCookies(redirectResponse(youtubeAuthUrl), setCookieHeaders);
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
