import { createFileRoute } from "@tanstack/react-router";
import { requireAdminUser } from "@/lib/server/supabase-ssr";

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

export const Route = createFileRoute("/api/admin/plans/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireAdminUser(request);
          const { data, error } = await client
            .from("plan_audit_log")
            .select(
              "id, action, plan_name, old_value, new_value, created_at, admin:profiles!plan_audit_log_admin_user_id_fkey(name, email)",
            )
            .order("created_at", { ascending: false })
            .limit(30);
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
