import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature, type WorkspaceContext } from "@/lib/server/workspace";
import { resolveTeamManagementEntitlement } from "@/lib/server/workspace-entitlements";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  authorizeInvite,
  canManageMembers,
  canManageRole,
  PLAN_REQUIRED_BODY,
} from "@/lib/team-policy";
import {
  INVITATION_COLUMNS,
  MAX_PENDING_INVITATIONS,
  hashInvitationToken,
  invitationExpiry,
  invitationRateLimited,
  invitationState,
  invitationUrl,
  newInvitationToken,
  recordInvitationEvent,
  type InvitationRow,
} from "@/lib/server/workspace-invitations";
import { publicInvitation } from "@/lib/server/workspace-invitation-view";

// Managing the workspace's shareable invitations (Team page).
//
//   GET                                   the invitations, newest first, with their state, and
//                                         older email invites still pending in workspace_members
//   POST { action: "revoke", id }         the link stops working
//   POST { action: "regenerate", id }     a new link (shown once); the previous one stops working
//   POST { action: "convert", memberId }  an older pending email invite becomes a link
//
// Who: owners and managers (a manager only for setter/editor invitations, as for members), with
// the "team" feature; regenerating or converting issues an invitation, so it also needs the
// Team Management entitlement, exactly like inviting. Always the caller's own workspace: an id
// from another workspace is the same 404 as one that does not exist. Never returns a token hash.

type Service = ReturnType<typeof createServiceSupabaseClient>;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("regenerate"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("convert"), memberId: z.string().uuid() }).strict(),
]);

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

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

/** Refused unless the caller may manage members at all. */
function requireManager(ctx: WorkspaceContext): Response | null {
  return canManageMembers(ctx.workspaceRole)
    ? null
    : json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
}

async function inviterNames(service: Service, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await service.from("profiles").select("id, name, email").in("id", unique);
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string | null; email: string | null }>).map((p) => [
      p.id,
      p.name || p.email || "A teammate",
    ]),
  );
}

async function workspaceInvitation(service: Service, ctx: WorkspaceContext, id: string) {
  const { data, error } = await service
    .from("workspace_invitations")
    .select(INVITATION_COLUMNS)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return (data as InvitationRow | null) ?? null;
}

/** Issuing a link (regenerate / convert) is inviting: the same role, hierarchy and plan rules. */
async function mayIssue(service: Service, ctx: WorkspaceContext, role: InvitationRow["role"]) {
  const decision = authorizeInvite({
    actorRole: ctx.workspaceRole,
    inviteRole: role,
    entitlement: await resolveTeamManagementEntitlement(service, {
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
    }),
  });
  if (decision.ok) return null;
  return decision.error === "PLAN_REQUIRED"
    ? json(PLAN_REQUIRED_BODY, { status: decision.status })
    : json({ error: decision.error }, { status: decision.status });
}

export const Route = createFileRoute("/api/workspace/invitations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          const refused = requireManager(ctx);
          if (refused) return refused;
          const service = createServiceSupabaseClient();
          const { data, error } = await service
            .from("workspace_invitations")
            .select(INVITATION_COLUMNS)
            .eq("workspace_id", ctx.workspaceId)
            .order("created_at", { ascending: false })
            .limit(100);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const rows = (data ?? []) as InvitationRow[];

          // Email invites from before links existed, still waiting (no link can be shown for them).
          const { data: legacy, error: legacyError } = await service
            .from("workspace_members")
            .select("id, invited_email, role, invited_by, invited_at")
            .eq("workspace_id", ctx.workspaceId)
            .eq("status", "invited")
            .is("user_id", null);
          if (legacyError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const legacyRows = (legacy ?? []) as Array<{
            id: string;
            invited_email: string;
            role: InvitationRow["role"];
            invited_by: string | null;
            invited_at: string;
          }>;

          const names = await inviterNames(service, [
            ...rows.map((r) => r.invited_by ?? ""),
            ...legacyRows.map((r) => r.invited_by ?? ""),
          ]);
          return json({
            data: rows.map((row) => publicInvitation(row, names.get(row.invited_by ?? "") ?? null)),
            legacy: legacyRows.map((row) => ({
              memberId: row.id,
              email: row.invited_email,
              role: row.role,
              invitedBy: names.get(row.invited_by ?? "") ?? null,
              createdAt: row.invited_at,
            })),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          const refused = requireManager(ctx);
          if (refused) return refused;
          const input = bodySchema.parse(await parseJson(request));
          const service = createServiceSupabaseClient();

          if (input.action === "convert") {
            const { data: member, error } = await service
              .from("workspace_members")
              .select(
                "id, invited_email, role, revenue_visible, lead_share, commission, job_title, cost_amount",
              )
              .eq("id", input.memberId)
              .eq("workspace_id", ctx.workspaceId)
              .eq("status", "invited")
              .is("user_id", null)
              .maybeSingle();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            if (!member) return json({ error: "INVITATION_NOT_FOUND" }, { status: 404 });
            const legacy = member as {
              id: string;
              invited_email: string;
              role: InvitationRow["role"];
              revenue_visible: boolean | null;
              lead_share: number | null;
              commission: number | null;
              job_title: string | null;
              cost_amount: number | null;
            };
            if (!canManageRole(ctx.workspaceRole, legacy.role))
              return json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
            const issueRefused = await mayIssue(service, ctx, legacy.role);
            if (issueRefused) return issueRefused;
            if (await invitationRateLimited(service, ctx.workspaceId))
              return json({ error: "INVITATION_RATE_LIMITED" }, { status: 429 });
            const { data: openRows, error: openError } = await service
              .from("workspace_invitations")
              .select("id")
              .eq("workspace_id", ctx.workspaceId)
              .eq("status", "pending");
            if (openError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            if ((openRows ?? []).length >= MAX_PENDING_INVITATIONS)
              return json({ error: "TOO_MANY_PENDING_INVITATIONS" }, { status: 429 });

            const token = newInvitationToken();
            const { data: created, error: insertError } = await service
              .from("workspace_invitations")
              .insert({
                workspace_id: ctx.workspaceId,
                email: legacy.invited_email.trim().toLowerCase(),
                role: legacy.role,
                revenue_visible: Boolean(legacy.revenue_visible),
                lead_share: legacy.lead_share ?? 0,
                commission: legacy.commission ?? 0,
                job_title: legacy.job_title,
                cost_amount: legacy.cost_amount ?? 0,
                token_hash: await hashInvitationToken(token),
                status: "pending",
                invited_by: ctx.user.id,
                expires_at: invitationExpiry(),
              })
              .select(INVITATION_COLUMNS)
              .single();
            if (insertError || !created)
              return json(
                { error: insertError?.code === "23505" ? "ALREADY_INVITED" : "DATABASE_ERROR" },
                { status: insertError?.code === "23505" ? 409 : 500 },
              );
            const row = created as InvitationRow;
            if (
              !(await recordInvitationEvent(service, {
                action: "workspace_invitation.created",
                userId: ctx.user.id,
                invitationId: row.id,
                workspaceId: ctx.workspaceId,
                role: row.role,
              }))
            ) {
              await service.from("workspace_invitations").delete().eq("id", row.id);
              return json({ error: "DATABASE_ERROR" }, { status: 500 });
            }
            // The old pending row is replaced by the link invitation.
            await service
              .from("workspace_members")
              .delete()
              .eq("id", legacy.id)
              .eq("workspace_id", ctx.workspaceId)
              .eq("status", "invited");
            return json(
              {
                data: {
                  invitation: publicInvitation(row),
                  inviteUrl: invitationUrl(request, token),
                },
              },
              { status: 201 },
            );
          }

          const invitation = await workspaceInvitation(service, ctx, input.id);
          if (!invitation) return json({ error: "INVITATION_NOT_FOUND" }, { status: 404 });
          // A manager acts only on setter and editor invitations.
          if (!canManageRole(ctx.workspaceRole, invitation.role))
            return json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
          const state = invitationState(invitation);

          if (input.action === "revoke") {
            if (state !== "pending" && state !== "expired")
              return json({ error: "INVITATION_NOT_OPEN" }, { status: 409 });
            const { data: revoked, error } = await service
              .from("workspace_invitations")
              .update({
                status: "revoked",
                revoked_at: new Date().toISOString(),
                revoked_by: ctx.user.id,
              })
              .eq("id", invitation.id)
              .eq("workspace_id", ctx.workspaceId)
              .eq("status", "pending")
              .select(INVITATION_COLUMNS)
              .maybeSingle();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            if (!revoked) return json({ error: "INVITATION_NOT_OPEN" }, { status: 409 });
            await recordInvitationEvent(service, {
              action: "workspace_invitation.revoked",
              userId: ctx.user.id,
              invitationId: invitation.id,
              workspaceId: ctx.workspaceId,
            });
            return json({ data: { invitation: publicInvitation(revoked as InvitationRow) } });
          }

          // regenerate: a pending or expired invitation gets a new secret and a fresh expiry.
          if (state !== "pending" && state !== "expired")
            return json({ error: "INVITATION_NOT_OPEN" }, { status: 409 });
          const issueRefused = await mayIssue(service, ctx, invitation.role);
          if (issueRefused) return issueRefused;
          if (await invitationRateLimited(service, ctx.workspaceId))
            return json({ error: "INVITATION_RATE_LIMITED" }, { status: 429 });
          const token = newInvitationToken();
          const { data: renewed, error } = await service
            .from("workspace_invitations")
            .update({
              token_hash: await hashInvitationToken(token),
              expires_at: invitationExpiry(),
              invited_by: ctx.user.id,
            })
            .eq("id", invitation.id)
            .eq("workspace_id", ctx.workspaceId)
            .eq("status", "pending")
            .select(INVITATION_COLUMNS)
            .maybeSingle();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!renewed) return json({ error: "INVITATION_NOT_OPEN" }, { status: 409 });
          await recordInvitationEvent(service, {
            action: "workspace_invitation.regenerated",
            userId: ctx.user.id,
            invitationId: invitation.id,
            workspaceId: ctx.workspaceId,
            role: invitation.role,
          });
          return json({
            data: {
              invitation: publicInvitation(renewed as InvitationRow),
              inviteUrl: invitationUrl(request, token),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
