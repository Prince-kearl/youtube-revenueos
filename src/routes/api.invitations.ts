import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { lookupAuthIdentity } from "@/lib/server/auth-identity";
import { resolveTeamManagementEntitlement } from "@/lib/server/workspace-entitlements";
import { checkAbuseLimit, RATE_LIMIT_POLICY, rateLimitedResponse } from "@/lib/server/rate-limit";
import { notifyWorkspace } from "@/lib/server/notify";
import {
  INVITATION_TOKEN,
  hashInvitationToken,
  invitationState,
  loadInvitationByToken,
  maskEmail,
  recordInvitationEvent,
} from "@/lib/server/workspace-invitations";

// The invitation link's page (/invite/$token) talks to this.
//
//   POST { action: "lookup", token }  what the page may show. Signed out: only whether the link
//                                     can be used and a masked address ("j***@gmail.com"), so the
//                                     person knows which account to use — no workspace, inviter
//                                     or role. Signed in: also the workspace and inviter names and
//                                     the role, and whether this account is the invited one.
//   POST { action: "accept", token }  joins the workspace.
//
// Accepting needs a session, and the account's email as Supabase Auth holds it — confirmed, and
// the invited address. Workspace, role and inviter come from the invitation row, never from the
// request. accept_workspace_invitation() then re-checks everything inside one transaction (single
// use, expiry, revocation, the inviter's current role, one workspace per account) and creates
// the membership, so a repeated or concurrent request cannot create a second one.
//
// Tokens travel in the request body, never in this API's URL, and are never logged. Each request
// counts towards a per-address limit (RATE_LIMIT_POLICY.workspaceInvite); a token is 256 random
// bits, so guessing one is not feasible either way.

const bodySchema = z
  .object({
    action: z.enum(["lookup", "accept"]),
    token: z.string().max(100),
  })
  .strict();

type AcceptOutcome =
  | "accepted"
  | "already_member"
  | "invalid"
  | "revoked"
  | "expired"
  | "used"
  | "wrong_account"
  | "inviter_not_allowed"
  | "has_own_workspace";

const OUTCOME_STATUS: Record<AcceptOutcome, number> = {
  accepted: 200,
  already_member: 200,
  invalid: 404,
  revoked: 410,
  expired: 410,
  used: 410,
  wrong_account: 403,
  inviter_not_allowed: 409,
  has_own_workspace: 409,
};

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

async function optionalSession(request: Request) {
  try {
    return await requireSessionUser(request);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/invitations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const input = bodySchema.parse(await request.json().catch(() => ({})));
          const service = createServiceSupabaseClient();
          const limited = await checkAbuseLimit(
            service,
            request,
            "workspace_invite",
            RATE_LIMIT_POLICY.workspaceInvite,
          );
          if (limited.refuse) return rateLimitedResponse(limited.retryAfterSeconds);

          if (!INVITATION_TOKEN.test(input.token))
            return json(
              { data: { state: "invalid" } },
              { status: input.action === "accept" ? 404 : 200 },
            );

          const session = await optionalSession(request);
          if (input.action === "accept" && !session)
            return json({ error: "AUTH_REQUIRED" }, { status: 401 });

          const invitation = await loadInvitationByToken(service, input.token);
          if (!invitation)
            return json(
              input.action === "accept" ? { error: "invalid" } : { data: { state: "invalid" } },
              { status: input.action === "accept" ? 404 : 200 },
            );
          const state = invitationState(invitation);

          // ---------- lookup ----------
          if (input.action === "lookup") {
            if (state !== "pending") {
              // An accepted link tells the person who accepted it where it led; nobody else.
              const mine =
                state === "accepted" && session && invitation.accepted_by === session.user.id;
              return json({ data: { state, alreadyJoined: Boolean(mine) } });
            }
            if (!session) return json({ data: { state, emailHint: maskEmail(invitation.email) } });
            const identity = await lookupAuthIdentity(service, session.user.id);
            if (identity.status === "unavailable")
              return json({ error: "AUTH_UNAVAILABLE" }, { status: 503 });
            const signedInEmail = identity.status === "found" ? identity.email : null;
            const matches =
              identity.status === "found" &&
              identity.emailConfirmed &&
              (identity.email ?? "").trim().toLowerCase() === invitation.email;
            if (!matches)
              return json({
                data: {
                  state,
                  emailHint: maskEmail(invitation.email),
                  signedInEmail,
                  emailMatches: false,
                  emailConfirmed: identity.status === "found" && identity.emailConfirmed,
                },
              });
            const [{ data: workspace }, { data: inviter }] = await Promise.all([
              service
                .from("workspaces")
                .select("name")
                .eq("id", invitation.workspace_id)
                .maybeSingle(),
              invitation.invited_by
                ? service
                    .from("profiles")
                    .select("name, email")
                    .eq("id", invitation.invited_by)
                    .maybeSingle()
                : Promise.resolve({ data: null }),
            ]);
            return json({
              data: {
                state,
                emailMatches: true,
                signedInEmail,
                workspaceName:
                  (workspace as { name?: string } | null)?.name ?? "a Tubify workspace",
                inviterName:
                  (inviter as { name?: string | null; email?: string | null } | null)?.name ||
                  (inviter as { email?: string | null } | null)?.email ||
                  null,
                role: invitation.role,
                expiresAt: invitation.expires_at,
              },
            });
          }

          // ---------- accept ----------
          const user = session!.user;
          const identity = await lookupAuthIdentity(service, user.id);
          if (identity.status === "unavailable")
            return json({ error: "AUTH_UNAVAILABLE" }, { status: 503 });
          if (identity.status !== "found" || !identity.email)
            return json({ error: "AUTH_REQUIRED" }, { status: 401 });
          if (!identity.emailConfirmed)
            return json({ error: "EMAIL_NOT_CONFIRMED" }, { status: 403 });

          // The workspace must still be allowed to grow its team (the inviter's plan is the
          // workspace owner's: Team Management). Checked before anything is written.
          if (state === "pending") {
            const entitlement = await resolveTeamManagementEntitlement(service, {
              workspaceId: invitation.workspace_id,
              userId: invitation.invited_by ?? user.id,
            });
            if (!entitlement.allowed)
              return json({ error: "WORKSPACE_NOT_ENTITLED" }, { status: 409 });
          }

          const { data, error } = await service.rpc("accept_workspace_invitation", {
            p_token_hash: await hashInvitationToken(input.token),
            p_user_id: user.id,
            p_email: identity.email,
          });
          if (error) {
            console.error("[invitations] accept failed", { code: error.code });
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          const result = (Array.isArray(data) ? data[0] : data) as
            | { outcome: AcceptOutcome; workspace_id: string | null; membership_id: string | null }
            | undefined;
          const outcome = result?.outcome;
          if (!outcome || !(outcome in OUTCOME_STATUS))
            return json({ error: "DATABASE_ERROR" }, { status: 500 });

          if (outcome === "accepted") {
            await recordInvitationEvent(service, {
              action: "workspace_invitation.accepted",
              userId: user.id,
              invitationId: invitation.id,
              workspaceId: invitation.workspace_id,
              role: invitation.role,
              outcome,
            });
            if (invitation.invited_by)
              void notifyWorkspace(service, {
                workspaceId: invitation.workspace_id,
                userId: invitation.invited_by,
                type: "message",
                title: "Invitation accepted",
                message: `${identity.email} joined as ${invitation.role}`,
              });
          }
          return outcome === "accepted" || outcome === "already_member"
            ? json({ data: { outcome } })
            : json({ error: outcome }, { status: OUTCOME_STATUS[outcome] });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          console.error("[invitations] request failed");
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
