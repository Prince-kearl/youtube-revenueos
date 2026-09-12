import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const bulkSchema = z.object({
  role: z.enum(["user", "editor", "setter", "manager", "owner", "superadmin"]),
  action: z.enum(["enable_all", "disable_all", "reset_defaults"]),
});

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

export const Route = createFileRoute("/api/admin/features/bulk")({
  server: {
    handlers: {
      // enable_all / reset_defaults both mean "everything on" today, since the seeded default is
      // enabled=true for every feature — kept as two labels because they read differently in the
      // UI, but functionally identical unless defaults ever diverge from "all enabled".
      // disable_all deliberately never touches is_system_feature rows (dashboard), so a Superadmin
      // can never accidentally lock a role out of the product entirely with one click.
      POST: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_features");
          const service = createServiceSupabaseClient();
          const input = bulkSchema.parse(await parseJson(request));

          const { data: features } = await service.from("features").select("id, is_system_feature");
          if (!features?.length) return json({ data: { updated: 0 } });

          const targetIds =
            input.action === "disable_all"
              ? features.filter((f) => !f.is_system_feature).map((f) => f.id)
              : features.map((f) => f.id);
          const enabled = input.action !== "disable_all";

          const { error } = await service
            .from("role_feature_access")
            .update({ enabled, updated_by: user.id })
            .eq("role", input.role)
            .in("feature_id", targetIds);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "feature_bulk_change",
            target: input.role,
            newValue: { action: input.action, affectedCount: targetIds.length },
          });

          return json({ data: { updated: targetIds.length } });
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
