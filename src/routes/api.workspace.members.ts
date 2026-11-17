import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature, type WorkspaceRole } from "@/lib/server/workspace";
import { resolveTeamManagementEntitlement } from "@/lib/server/workspace-entitlements";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { exactIlikePattern } from "@/lib/server/exact-match";
import {
  INVITATION_COLUMNS,
  MAX_PENDING_INVITATIONS,
  hashInvitationToken,
  invitationExpiry,
  invitationRateLimited,
  invitationUrl,
  newInvitationToken,
  recordInvitationEvent,
  type InvitationRow,
} from "@/lib/server/workspace-invitations";
import { publicInvitation } from "@/lib/server/workspace-invitation-view";
import {
  PLAN_REQUIRED_BODY,
  authorizeInvite,
  authorizeMemberRemoval,
  authorizeMemberUpdate,
  redactMember,
  type TeamDenial,
} from "@/lib/team-policy";

// Team Management API. Every handler requires, in this order:
//
//   1. a signed-in user with an active membership  (requireWorkspaceFeature → getWorkspaceContext)
//   2. an entitled workspace plan                   (getWorkspaceContext)
//   3. the "team" feature enabled for their role   (requireWorkspaceFeature)
//   4. a role that permits the specific action     (lib/team-policy.ts)
//   5. for inviting and for changing a role only:  the workspace's team-management entitlement,
//      resolved from the workspace OWNER's plan    (lib/server/workspace-entitlements.ts)
//
// Viewing and removing never need the team-management entitlement, so a paid workspace that
// downgrades keeps its members and can still shrink its team. The workspace is always the caller's
// own (taken from their membership, never from the request), and every write is filtered by it.
//
// All authorisation happens before the first write or outgoing request: a refused request
// creates no account, no membership and no email.

const workspaceRoleEnum = z.enum(["owner", "manager", "setter", "editor"]);

const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  role: workspaceRoleEnum,
  revenueVisible: z.boolean().default(false),
  leadShare: z.number().int().min(0).max(100).default(0),
  commission: z.number().int().min(0).max(100).default(0),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  costAmount: z.number().min(0).max(10_000_000).default(0),
});

// An explicit allowlist of what a PATCH may carry. Anything else in the body (a plan, a status,
// a workspace id, a user id…) is dropped by the parser and can never reach the database.
const updateSchema = z.object({
  role: workspaceRoleEnum.optional(),
  leadShare: z.number().int().min(0).max(100).optional(),
  commission: z.number().int().min(0).max(100).optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  costAmount: z.number().min(0).max(10_000_000).optional(),
});

const idSchema = z.string().uuid();

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

/** The response for a refused action. A plan restriction carries what to upgrade to; a role
 * restriction never does. */
function denied(denial: TeamDenial) {
  return json(denial.error === "PLAN_REQUIRED" ? PLAN_REQUIRED_BODY : { error: denial.error }, {
    status: denial.status,
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

const memberColumns =
  "id, workspace_id, user_id, invited_email, role, revenue_visible, status, lead_share, commission, job_title, cost_amount, invited_at, joined_at, created_at, updated_at";

async function countActiveOwners(
  service: ReturnType<typeof createServiceSupabaseClient>,
  workspaceId: string,
): Promise<number> {
  const { count } = await service
    .from("workspace_members")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .eq("status", "active");
  return count ?? 0;
}

export const Route = createFileRoute("/api/workspace/members")({
  server: {
    handlers: {
      // Lists the caller's own workspace. Each row is returned as that caller may see it: lead
      // share, commission and cost are blanked unless the caller's role permits (see
      // canViewCompensation) — the page is never trusted to hide them.
      GET: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          // Read with the service-role client, scoped to the caller's workspace. The roster's
          // compensation columns are not readable through the member-facing database role, so
          // this server-side read (followed by redaction) is the only way they are served.
          const service = createServiceSupabaseClient();
          const { data, error } = await service
            .from("workspace_members")
            .select(
              `${memberColumns}, member:profiles!workspace_members_user_id_fkey(name, email, avatar)`,
            )
            .eq("workspace_id", ctx.workspaceId)
            .neq("status", "removed")
            .order("created_at", { ascending: true });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          // Sending an invite creates the invitee's auth account straight away, and
          // handle_new_user() marks their membership 'active' at that same moment — before they
          // have accepted anything. Stored status stays as-is (workspace access is keyed on it),
          // but the list reports such a member as "invited" until they have signed in for the
          // first time, which is what accepting the invitation link does. Best-effort: if the
          // lookup fails the stored status is shown.
          const rows = await Promise.all(
            (data ?? []).map(async (row) => {
              if (row.status !== "active" || !row.user_id || row.user_id === ctx.user.id)
                return row;
              try {
                const { data: auth } = await service.auth.admin.getUserById(row.user_id);
                return auth?.user && !auth.user.last_sign_in_at
                  ? { ...row, status: "invited" }
                  : row;
              } catch {
                return row;
              }
            }),
          );
          const viewer = { userId: ctx.user.id, role: ctx.workspaceRole };
          const teamManagement = await resolveTeamManagementEntitlement(service, {
            workspaceId: ctx.workspaceId,
            userId: ctx.user.id,
          });
          return json({
            data: rows.map((row) => redactMember(row, viewer)),
            // Only what the page needs to choose its controls: the caller's role and membership,
            // and whether this workspace may expand its team. No plan or billing detail.
            meta: {
              role: ctx.workspaceRole,
              memberId: rows.find((row) => row.user_id === ctx.user.id)?.id ?? null,
              teamManagement,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Creates a shareable invitation (no email, no membership yet): the person invited opens the
      // link, signs in or signs up with the invited address, and accepts (api.invitations.ts).
      // The link is returned once. Authorisation is unchanged: role, hierarchy and the Team
      // Management entitlement, all before anything is written.
      POST: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          const input = inviteSchema.parse(await parseJson(request));

          const service = createServiceSupabaseClient();
          const decision = authorizeInvite({
            actorRole: ctx.workspaceRole,
            inviteRole: input.role,
            entitlement: await resolveTeamManagementEntitlement(service, {
              workspaceId: ctx.workspaceId,
              userId: ctx.user.id,
            }),
          });
          // Nothing below this line runs for a refused request.
          if (!decision.ok) return denied(decision);

          const email = input.email.toLowerCase();

          // Already on the team: nothing to invite.
          const { data: activeMembers, error: activeError } = await service
            .from("workspace_members")
            .select("id")
            .eq("workspace_id", ctx.workspaceId)
            .eq("status", "active")
            .ilike("invited_email", exactIlikePattern(email))
            .limit(1);
          if (activeError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (activeMembers?.length) return json({ error: "ALREADY_A_MEMBER" }, { status: 409 });

          // One open invitation per address: a second one is a regenerate (the Team page offers it).
          const { data: open, error: openError } = await service
            .from("workspace_invitations")
            .select("id, email")
            .eq("workspace_id", ctx.workspaceId)
            .eq("status", "pending");
          if (openError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const openRows = (open ?? []) as Array<{ id: string; email: string }>;
          const sameAddress = openRows.find((row) => row.email === email);
          if (sameAddress)
            return json(
              { error: "ALREADY_INVITED", invitationId: sameAddress.id },
              { status: 409 },
            );
          if (openRows.length >= MAX_PENDING_INVITATIONS)
            return json({ error: "TOO_MANY_PENDING_INVITATIONS" }, { status: 429 });
          if (await invitationRateLimited(service, ctx.workspaceId))
            return json({ error: "INVITATION_RATE_LIMITED" }, { status: 429 });

          const token = newInvitationToken();
          const { data: invitation, error: insertError } = await service
            .from("workspace_invitations")
            .insert({
              workspace_id: ctx.workspaceId,
              email,
              role: input.role,
              revenue_visible:
                ctx.workspaceRole === "owner" &&
                (input.role === "editor" || input.role === "setter") &&
                input.revenueVisible,
              lead_share: input.leadShare,
              commission: input.commission,
              job_title: input.jobTitle ?? null,
              cost_amount: input.costAmount,
              token_hash: await hashInvitationToken(token),
              status: "pending",
              invited_by: ctx.user.id,
              expires_at: invitationExpiry(),
            })
            .select(INVITATION_COLUMNS)
            .single();
          if (insertError || !invitation) {
            return json(
              { error: insertError?.code === "23505" ? "ALREADY_INVITED" : "DATABASE_ERROR" },
              { status: insertError?.code === "23505" ? 409 : 500 },
            );
          }
          const row = invitation as InvitationRow;
          // The audit row is also what the rate limit counts: without it, nothing is issued.
          const recorded = await recordInvitationEvent(service, {
            action: "workspace_invitation.created",
            userId: ctx.user.id,
            invitationId: row.id,
            workspaceId: ctx.workspaceId,
            role: row.role,
          });
          if (!recorded) {
            await service.from("workspace_invitations").delete().eq("id", row.id);
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          // The link is returned once, here. Nothing was emailed: the inviter shares it.
          return json(
            {
              data: {
                invitation: publicInvitation(row),
                inviteUrl: invitationUrl(request, token),
              },
            },
            { status: 201 },
          );
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Updates a member. Which fields the request carries decides what is required of the
      // caller (see authorizeMemberUpdate): a role change needs the hierarchy AND the plan;
      // compensation needs the hierarchy; a job title may be one's own.
      PATCH: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = updateSchema.parse(await parseJson(request));

          const service = createServiceSupabaseClient();
          const { data: existing } = await service
            .from("workspace_members")
            .select("id, user_id, role, status")
            .eq("id", id)
            .eq("workspace_id", ctx.workspaceId)
            .maybeSingle();
          if (!existing) return json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });

          const decision = authorizeMemberUpdate({
            actorRole: ctx.workspaceRole,
            isSelf: existing.user_id === ctx.user.id,
            targetRole: existing.role as WorkspaceRole,
            changes: {
              role: input.role,
              compensation:
                input.leadShare !== undefined ||
                input.commission !== undefined ||
                input.costAmount !== undefined,
              jobTitle: input.jobTitle !== undefined,
            },
            // Only a role change consults the plan, so only then is it looked up.
            entitlement:
              input.role !== undefined
                ? await resolveTeamManagementEntitlement(service, {
                    workspaceId: ctx.workspaceId,
                    userId: ctx.user.id,
                  })
                : { allowed: false, reason: "unavailable", requiredPlan: "scale" },
          });
          // Every requested field has been authorised by now; nothing is written otherwise.
          if (!decision.ok) return denied(decision);

          if (input.role !== undefined && existing.role === "owner" && input.role !== "owner") {
            const owners = await countActiveOwners(service, ctx.workspaceId);
            if (owners <= 1) return json({ error: "LAST_OWNER" }, { status: 409 });
          }

          const update: Record<string, unknown> = {};
          if (input.role !== undefined) update.role = input.role;
          if (input.leadShare !== undefined) update.lead_share = input.leadShare;
          if (input.commission !== undefined) update.commission = input.commission;
          if (input.jobTitle !== undefined) update.job_title = input.jobTitle;
          if (input.costAmount !== undefined) update.cost_amount = input.costAmount;

          const { data, error } = await service
            .from("workspace_members")
            .update(update)
            .eq("id", id)
            .eq("workspace_id", ctx.workspaceId)
            .select(memberColumns)
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({
            data: redactMember(data, { userId: ctx.user.id, role: ctx.workspaceRole }),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Removes a member, or cancels a pending invite. Available on every plan. A manager may
      // remove only setters and editors; anyone may leave; the last owner can never go.
      DELETE: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));

          const service = createServiceSupabaseClient();
          const { data: existing } = await service
            .from("workspace_members")
            .select("id, user_id, role")
            .eq("id", id)
            .eq("workspace_id", ctx.workspaceId)
            .maybeSingle();
          if (!existing) return json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });

          const decision = authorizeMemberRemoval({
            actorRole: ctx.workspaceRole,
            isSelf: existing.user_id === ctx.user.id,
            targetRole: existing.role as WorkspaceRole,
          });
          if (!decision.ok) return denied(decision);

          if (existing.role === "owner") {
            const owners = await countActiveOwners(service, ctx.workspaceId);
            if (owners <= 1) return json({ error: "LAST_OWNER" }, { status: 409 });
          }

          const { error } = await service
            .from("workspace_members")
            .update({ status: "removed" })
            .eq("id", id)
            .eq("workspace_id", ctx.workspaceId);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ success: true });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
