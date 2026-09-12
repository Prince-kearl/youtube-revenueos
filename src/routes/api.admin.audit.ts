import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/server/roles";

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

// Shared read endpoint for admin_audit_log, used by both Feature Management and Version Control
// (filtered client-side by action-name prefix: "feature_" vs "release_") rather than building two
// near-identical read routes for one generic table.
export const Route = createFileRoute("/api/admin/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "view_audit_logs");
          const { data, error } = await client
            .from("admin_audit_log")
            .select(
              "id, action, target, old_value, new_value, created_at, admin:profiles!admin_audit_log_admin_user_id_fkey(name, email)",
            )
            .order("created_at", { ascending: false })
            .limit(50);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
