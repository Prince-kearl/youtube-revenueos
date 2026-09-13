import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";
import { getServerEnv } from "@/lib/server/env";

const bodySchema = z.object({ id: z.string().uuid() });

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

// Returns a real, one-time Supabase magic-link URL for the target account rather than swapping
// the admin's own session — opening the link (in a new tab/private window) signs in as that user
// without ever touching the admin's cookies. Always audited: this is the single most sensitive
// action in the console, more so than a role change or a ban.
export const Route = createFileRoute("/api/admin/users/impersonate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_users");
          const { id } = bodySchema.parse(await request.json().catch(() => ({})));
          if (id === user.id) return json({ error: "CANNOT_IMPERSONATE_SELF" }, { status: 409 });

          const service = createServiceSupabaseClient();
          const { data: target } = await service
            .from("profiles")
            .select("email")
            .eq("id", id)
            .maybeSingle();
          if (!target?.email) return json({ error: "USER_NOT_FOUND" }, { status: 404 });

          const appUrl = getServerEnv("APP_URL") ?? new URL(request.url).origin;
          const { data, error } = await service.auth.admin.generateLink({
            type: "magiclink",
            email: target.email,
            options: { redirectTo: `${appUrl}/dashboard` },
          });
          if (error || !data?.properties?.action_link) {
            return json({ error: "LINK_FAILED", message: error?.message }, { status: 502 });
          }

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_impersonation_link_generated",
            target: target.email,
          });
          return json({ data: { url: data.properties.action_link } });
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
