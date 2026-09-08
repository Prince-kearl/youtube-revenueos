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

// Lightweight real check the admin console's client-side guard calls on mount — defense-in-depth
// only; every actual admin-write route (api.admin.plans.ts etc.) checks this independently and
// does not trust that a request merely reached the console UI.
export const Route = createFileRoute("/api/admin/whoami")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminUser(request);
          return json({ data: { isAdmin: true } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
