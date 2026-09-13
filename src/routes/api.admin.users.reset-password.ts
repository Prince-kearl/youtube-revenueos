import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient, createAnonSupabaseClient } from "@/lib/server/supabase";
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

// Separate route (rather than another PATCH field) since this doesn't change any user record —
// it only triggers Supabase's own mailer, which needs the unauthenticated anon client, not the
// service-role one everything else here uses.
export const Route = createFileRoute("/api/admin/users/reset-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_users");
          const { id } = bodySchema.parse(await request.json().catch(() => ({})));

          const service = createServiceSupabaseClient();
          const { data: target } = await service
            .from("profiles")
            .select("email")
            .eq("id", id)
            .maybeSingle();
          if (!target?.email) return json({ error: "USER_NOT_FOUND" }, { status: 404 });

          const anon = createAnonSupabaseClient();
          const appUrl = getServerEnv("APP_URL") ?? new URL(request.url).origin;
          const { error } = await anon.auth.resetPasswordForEmail(target.email, {
            redirectTo: `${appUrl}/reset-password`,
          });
          if (error)
            return json({ error: "RESET_FAILED", message: error.message }, { status: 502 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_password_reset_sent",
            target: target.email,
          });
          return json({ data: { sent: true } });
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
