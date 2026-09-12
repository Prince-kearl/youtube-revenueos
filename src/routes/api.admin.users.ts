import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission, canManageRole, toAppRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const patchSchema = z.object({
  role: z.enum(["user", "editor", "setter", "manager", "owner", "superadmin"]),
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

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      // Every real user + their current role, for the "Roles & Permissions" User Roles table.
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "manage_roles");
          const { data, error } = await client
            .from("profiles")
            .select("id, name, email, role, created_at")
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({
            data: (data ?? []).map((row) => ({ ...row, role: toAppRole(row.role as string) })),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Changes one user's role. The requested target role comes from the request body, but
      // whether the change is ALLOWED is decided entirely from the caller's own real server-side
      // role (requirePermission + canManageRole) — the body is never trusted for authorization,
      // only for the target's id/desired role.
      PATCH: async ({ request }) => {
        try {
          const {
            client,
            user,
            role: actingRole,
          } = await requirePermission(request, "manage_roles");
          const targetId = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = patchSchema.parse(await parseJson(request));

          if (targetId === user.id) {
            return json({ error: "CANNOT_CHANGE_OWN_ROLE" }, { status: 409 });
          }

          const service = createServiceSupabaseClient();
          const { data: target } = await service
            .from("profiles")
            .select("id, name, email, role")
            .eq("id", targetId)
            .maybeSingle();
          if (!target) return json({ error: "USER_NOT_FOUND" }, { status: 404 });
          const targetCurrentRole = toAppRole(target.role as string);

          if (!canManageRole(actingRole, targetCurrentRole, input.role)) {
            return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });
          }

          // Never allow the platform to end up with zero superadmins.
          if (targetCurrentRole === "superadmin" && input.role !== "superadmin") {
            const { count } = await service
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "superadmin");
            if ((count ?? 0) <= 1) {
              return json({ error: "CANNOT_REMOVE_LAST_SUPERADMIN" }, { status: 409 });
            }
          }

          const { data: updated, error } = await service
            .from("profiles")
            .update({ role: input.role })
            .eq("id", targetId)
            .select("id, name, email, role")
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "role_assigned",
            target: target.email ?? target.id,
            oldValue: { role: targetCurrentRole },
            newValue: { role: input.role },
          });

          return json({ data: { ...updated, role: toAppRole(updated.role as string) } });
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
