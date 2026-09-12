import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  requireWorkspaceFeature,
  canManageWorkspaceMembers,
  canManageWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { requireServerEnv, getServerEnv } from "@/lib/server/env";

const workspaceRoleEnum = z.enum(["owner", "manager", "setter", "editor"]);

const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  role: workspaceRoleEnum,
  leadShare: z.number().int().min(0).max(100).default(0),
  commission: z.number().int().min(0).max(100).default(0),
});

const updateSchema = z.object({
  role: workspaceRoleEnum.optional(),
  leadShare: z.number().int().min(0).max(100).optional(),
  commission: z.number().int().min(0).max(100).optional(),
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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

const memberColumns =
  "id, workspace_id, user_id, invited_email, role, status, lead_share, commission, invited_at, joined_at, created_at, updated_at";

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
      GET: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "team");
          const { data, error } = await ctx.client
            .from("workspace_members")
            .select(
              `${memberColumns}, member:profiles!workspace_members_user_id_fkey(name, email, avatar)`,
            )
            .eq("workspace_id", ctx.workspaceId)
            .neq("status", "removed")
            .order("created_at", { ascending: true });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data, meta: { role: ctx.workspaceRole } });
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
          if (!canManageWorkspaceMembers(ctx.workspaceRole)) {
            return json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
          }
          const input = inviteSchema.parse(await parseJson(request));
          if (!canManageWorkspaceRole(ctx.workspaceRole, input.role)) {
            return json({ error: "CANNOT_ASSIGN_ROLE" }, { status: 403 });
          }

          const service = createServiceSupabaseClient();
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
                  invited_by: ctx.user.id,
                  joined_at: new Date().toISOString(),
                },
                { onConflict: "id" },
              )
              .select(memberColumns)
              .single();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            return json({ data }, { status: 201 });
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

          return json({ data: pending }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
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

          const isSelf = existing.user_id === ctx.user.id;
          if (input.role !== undefined) {
            if (isSelf) return json({ error: "CANNOT_CHANGE_OWN_ROLE" }, { status: 403 });
            if (!canManageWorkspaceMembers(ctx.workspaceRole)) {
              return json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
            }
            if (
              !canManageWorkspaceRole(ctx.workspaceRole, existing.role as WorkspaceRole) ||
              !canManageWorkspaceRole(ctx.workspaceRole, input.role)
            ) {
              return json({ error: "CANNOT_ASSIGN_ROLE" }, { status: 403 });
            }
            if (existing.role === "owner" && input.role !== "owner") {
              const owners = await countActiveOwners(service, ctx.workspaceId);
              if (owners <= 1) return json({ error: "LAST_OWNER" }, { status: 409 });
            }
          } else if (!isSelf && !canManageWorkspaceMembers(ctx.workspaceRole)) {
            return json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
          }

          const update: Record<string, unknown> = {};
          if (input.role !== undefined) update.role = input.role;
          if (input.leadShare !== undefined) update.lead_share = input.leadShare;
          if (input.commission !== undefined) update.commission = input.commission;

          const { data, error } = await service
            .from("workspace_members")
            .update(update)
            .eq("id", id)
            .select(memberColumns)
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
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

          const isSelf = existing.user_id === ctx.user.id;
          if (!isSelf && !canManageWorkspaceMembers(ctx.workspaceRole)) {
            return json({ error: "CANNOT_MANAGE_MEMBERS" }, { status: 403 });
          }
          if (existing.role === "owner") {
            const owners = await countActiveOwners(service, ctx.workspaceId);
            if (owners <= 1) return json({ error: "LAST_OWNER" }, { status: 409 });
          }

          const { error } = await service
            .from("workspace_members")
            .update({ status: "removed" })
            .eq("id", id);
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
