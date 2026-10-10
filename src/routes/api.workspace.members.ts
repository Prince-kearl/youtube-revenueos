import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature, type WorkspaceRole } from "@/lib/server/workspace";
import { resolveTeamManagementEntitlement } from "@/lib/server/workspace-entitlements";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { requireServerEnv, getServerEnv } from "@/lib/server/env";
import { notifyWorkspace } from "@/lib/server/notify";
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
//   2. the "team" feature enabled for their role   (requireWorkspaceFeature)
//   3. a role that permits the specific action     (lib/team-policy.ts)
//   4. for inviting and for changing a role only:  the workspace's team-management entitlement,
//      resolved from the workspace OWNER's plan    (lib/server/workspace-entitlements.ts)
//
// Viewing and removing never need the entitlement, so a workspace that downgrades keeps its
// members and can still shrink its team. The workspace is always the caller's own (taken from
// their membership, never from the request), and every write is filtered by it.
//
// All authorisation happens before the first write or outgoing request: a refused request
// creates no account, no membership and no email.

const workspaceRoleEnum = z.enum(["owner", "manager", "setter", "editor"]);

const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  role: workspaceRoleEnum,
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
  "id, workspace_id, user_id, invited_email, role, status, lead_share, commission, job_title, cost_amount, invited_at, joined_at, created_at, updated_at";

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
      // Lists the caller's own workspace. Available on every plan. Each row is returned as that
      // caller may see it: lead share, commission and cost are blanked unless the caller's role
      // permits (see canViewCompensation) — the page is never trusted to hide them.
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
      // Invites either activate immediately (email already belongs to an existing Tubify
      // account — v1 doesn't support one account holding more than one active workspace
      // membership, so this can't be a genuine pending invite for them) or create a real pending
      // row and send a real Supabase invite email for a brand-new email. The pending row is
      // written BEFORE calling inviteUserByEmail: that call creates the auth.users row
      // synchronously, which fires handle_new_user() immediately — the row has to already exist
      // for the trigger to find and activate it instead of creating a second default workspace.
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

          const viewer = { userId: ctx.user.id, role: ctx.workspaceRole };
          const { data: existingProfile } = await service
            .from("profiles")
            .select("id")
            .eq("email", input.email)
            .maybeSingle();

          if (existingProfile) {
            const { data: existingMembership } = await service
              .from("workspace_members")
              .select("id, status")
              .eq("workspace_id", ctx.workspaceId)
              .eq("user_id", existingProfile.id)
              .maybeSingle();
            if (existingMembership && existingMembership.status !== "removed") {
              return json({ error: "ALREADY_A_MEMBER" }, { status: 409 });
            }
            const { data: ownsElsewhere } = await service
              .from("workspace_members")
              .select("id")
              .eq("user_id", existingProfile.id)
              .eq("status", "active")
              .maybeSingle();
            if (ownsElsewhere) {
              return json({ error: "ALREADY_HAS_WORKSPACE" }, { status: 409 });
            }
            const { data, error } = await service
              .from("workspace_members")
              .upsert(
                {
                  id: existingMembership?.id,
                  workspace_id: ctx.workspaceId,
                  user_id: existingProfile.id,
                  invited_email: input.email,
                  role: input.role,
                  status: "active",
                  lead_share: input.leadShare,
                  commission: input.commission,
                  job_title: input.jobTitle ?? null,
                  cost_amount: input.costAmount,
                  invited_by: ctx.user.id,
                  joined_at: new Date().toISOString(),
                },
                { onConflict: "id" },
              )
              .select(memberColumns)
              .single();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            void notifyWorkspace(service, {
              workspaceId: ctx.workspaceId,
              userId: existingProfile.id,
              type: "message",
              title: "New teammate joined",
              message: `${input.email} joined as ${input.role}`,
            });
            return json({ data: redactMember(data, viewer) }, { status: 201 });
          }

          const { data: pending, error: insertError } = await service
            .from("workspace_members")
            .insert({
              workspace_id: ctx.workspaceId,
              invited_email: input.email,
              role: input.role,
              status: "invited",
              lead_share: input.leadShare,
              commission: input.commission,
              job_title: input.jobTitle ?? null,
              cost_amount: input.costAmount,
              invited_by: ctx.user.id,
            })
            .select(memberColumns)
            .single();
          if (insertError) {
            return json(
              { error: insertError.code === "23505" ? "ALREADY_INVITED" : "DATABASE_ERROR" },
              { status: insertError.code === "23505" ? 409 : 500 },
            );
          }

          if (!getServerEnv("SUPABASE_SERVICE_ROLE_KEY")) {
            return json({ error: "EMAIL_NOT_CONFIGURED" }, { status: 503 });
          }
          const inviteResponse = await fetch(`${requireServerEnv("SUPABASE_URL")}/auth/v1/invite`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
              Authorization: `Bearer ${requireServerEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              email: input.email,
              data: { invited_to_workspace: ctx.workspaceId },
            }),
          });
          if (!inviteResponse.ok) {
            await service.from("workspace_members").delete().eq("id", pending.id);
            const body = await inviteResponse.json().catch(() => null);
            return json(
              {
                error: "INVITE_EMAIL_FAILED",
                detail: body?.msg ?? body?.error_description ?? null,
              },
              { status: 502 },
            );
          }

          return json({ data: redactMember(pending, viewer) }, { status: 201 });
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
