import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { checkAbuseLimit, RATE_LIMIT_POLICY, rateLimitedResponse } from "@/lib/server/rate-limit";
import { fetchAuthorizedYoutubeChannels } from "@/lib/server/google-oauth";
import { getValidAccessToken, normalizeYoutubeConnectionRow } from "@/lib/server/youtube-tokens";
import {
  attachInviteChannel,
  inviteState,
  INVITE_TOKEN,
  loadInviteByToken,
  PENDING_PICK_MS,
} from "@/lib/server/connect-invites";

// POST { token, channelId } — a client whose Google account has several channels picks the ONE
// to share. The choice is re-checked against Google with the client's own authorization (never
// trusted from the request), and only that channel is attached. No session (the client is not a
// Tubify user); the link's secret is the credential. Rate-limited per client address.

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

const pickSchema = z
  .object({
    token: z.string().regex(INVITE_TOKEN),
    channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  })
  .strict();

export const Route = createFileRoute("/api/connect-invites/pick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const service = createServiceSupabaseClient();
          const limit = await checkAbuseLimit(
            service,
            request,
            "connect_invite",
            RATE_LIMIT_POLICY.connectInvite,
          );
          if (limit.refuse) return rateLimitedResponse(limit.retryAfterSeconds);
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ error: "INVALID_JSON" }, { status: 400 });
          }
          const parsed = pickSchema.safeParse(body);
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });

          const invite = await loadInviteByToken(service, parsed.data.token);
          if (!invite || invite.revoked_at) return json({ error: "INVALID_LINK" }, { status: 404 });
          const state = inviteState(invite);
          if (state !== "valid") return json({ error: state.toUpperCase() }, { status: 409 });
          if (!invite.pending_connection_id)
            return json({ error: "NOTHING_TO_PICK" }, { status: 409 });

          const { data: pending } = await service
            .from("youtube_connections")
            .select(
              "id, created_at, access_token_ciphertext, refresh_token_ciphertext, token_expiry",
            )
            .eq("id", invite.pending_connection_id)
            .eq("workspace_id", invite.workspace_id)
            .eq("granted_via_invite_id", invite.id)
            .maybeSingle();
          const connection =
            pending &&
            Date.now() - new Date(pending.created_at as string).getTime() < PENDING_PICK_MS
              ? normalizeYoutubeConnectionRow(pending)
              : null;
          if (!connection) return json({ error: "EXPIRED" }, { status: 409 });

          const accessToken = await getValidAccessToken(service, connection);
          const channel = (await fetchAuthorizedYoutubeChannels(accessToken)).find(
            (c) => c.channelId === parsed.data.channelId,
          );
          if (!channel) return json({ error: "CHANNEL_NOT_AVAILABLE" }, { status: 404 });

          const outcome = await attachInviteChannel(service, {
            invite,
            connectionId: connection.id,
            channel,
          });
          if (outcome.status !== "connected")
            return json({ error: outcome.status.toUpperCase() }, { status: 409 });
          return json({ data: { channelTitle: outcome.channelTitle } });
        } catch {
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
