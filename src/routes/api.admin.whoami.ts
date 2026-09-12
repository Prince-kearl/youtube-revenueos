import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedRole, canAccessConsole } from "@/lib/server/roles";

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

// Lightweight real check the admin console's client-side guard calls on mount — defense-in-depth
// only; every actual admin-write route (api.admin.plans.ts etc.) checks this independently via
// requirePermission/requireAdminUser and does not trust that a request merely reached the console
// UI. Console entry itself is scoped to superadmin/owner (see canAccessConsole) — Manager/Setter/
// Editor are real operational/content roles for the product, not platform administration, so they
// don't get into the admin console shell at all, regardless of which individual permissions they
// might otherwise hold.
export const Route = createFileRoute("/api/admin/whoami")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { role } = await getAuthenticatedRole(request);
          if (!canAccessConsole(role)) {
            return json({ error: "ADMIN_REQUIRED" }, { status: 403 });
          }
          return json({ data: { isAdmin: true, role } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
