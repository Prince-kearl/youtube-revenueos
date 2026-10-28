import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { checkAbuseLimit, RATE_LIMIT_POLICY, rateLimitedResponse } from "@/lib/server/rate-limit";
import { fetchAuthorizedYoutubeChannels } from "@/lib/server/google-oauth";
import { getValidAccessToken, normalizeYoutubeConnectionRow } from "@/lib/server/youtube-tokens";
import { inviteState, loadInviteByToken, PENDING_PICK_MS } from "@/lib/server/connect-invites";

// GET ?token= — what a client connect link is for, for the client opening it (no session):
// the workspace and the person who sent it, so the client knows who they are granting access to,
// and the link's state. When the client's Google account has several channels and they still
// have to pick one, the choices (names and pictures only) — to the holder of the link only.
// Nothing about the workspace beyond its name is returned. Rate-limited per client address;
// unknown, malformed and revoked links get the same answer.

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      ...init?.headers,
    },
  });
}

export const Route = createFileRoute("/api/connect-invites/public")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const service = createServiceSupabaseClient();
          const limit = await checkAbuseLimit(
            service,
            request,
            "connect_invite",
            RATE_LIMIT_POLICY.connectInvite,
          );
          if (limit.refuse) return rateLimitedResponse(limit.retryAfterSeconds);

          const token = new URL(request.url).searchParams.get("token") ?? "";
          const invite = await loadInviteByToken(service, token);
          if (!invite || invite.revoked_at) return json({ data: { state: "invalid" } });
          const state = inviteState(invite);

          const [{ data: workspace }, { data: inviter }] = await Promise.all([
            service.from("workspaces").select("name").eq("id", invite.workspace_id).maybeSingle(),
            invite.created_by
              ? service.from("profiles").select("name").eq("id", invite.created_by).maybeSingle()
              : Promise.resolve({ data: null }),
          ]);

          let choices: Array<{
            channelId: string;
            title: string;
            thumbnail: string | null;
          }> | null = null;
          if (state === "valid" && invite.pending_connection_id) {
            const { data: pending } = await service
              .from("youtube_connections")
              .select(
                "id, created_at, access_token_ciphertext, refresh_token_ciphertext, token_expiry",
              )
              .eq("id", invite.pending_connection_id)
              .eq("workspace_id", invite.workspace_id)
              .eq("granted_via_invite_id", invite.id)
              .maybeSingle();
            const fresh =
              pending &&
              Date.now() - new Date(pending.created_at as string).getTime() < PENDING_PICK_MS;
            const connection = fresh ? normalizeYoutubeConnectionRow(pending) : null;
            if (connection) {
              try {
                const token = await getValidAccessToken(service, connection);
                choices = (await fetchAuthorizedYoutubeChannels(token)).map((c) => ({
                  channelId: c.channelId,
                  title: c.title,
                  thumbnail: c.thumbnail,
                }));
              } catch {
                choices = null;
              }
            }
          }

          return json({
            data: {
              state,
              workspaceName: (workspace?.name as string | undefined) ?? null,
              inviterName: (inviter?.name as string | undefined) ?? null,
              label: invite.label,
              expiresAt: invite.expires_at,
              choices,
            },
          });
        } catch {
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
