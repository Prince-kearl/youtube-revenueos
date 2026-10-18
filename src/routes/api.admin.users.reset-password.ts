import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { canActOnUser, requirePermission, toAppRole } from "@/lib/server/roles";
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
//
// The reset goes to the account's Auth email, fetched by the account's immutable id — never to
// profiles.email, which its owner can rewrite. The caller must outrank the target (canActOnUser),
// decided on the role in profiles, which users cannot change. Audited by account id.
export const Route = createFileRoute("/api/admin/users/reset-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user, role: actingRole } = await requirePermission(request, "manage_users");
          const { id } = bodySchema.parse(await request.json().catch(() => ({})));

          const service = createServiceSupabaseClient();
          const [{ data: profile }, { data: auth }] = await Promise.all([
            service.from("profiles").select("role").eq("id", id).maybeSingle(),
            service.auth.admin.getUserById(id),
          ]);
          const authUser = auth?.user ?? null;
          if (!profile || !authUser?.email || authUser.id !== id)
            return json({ error: "USER_NOT_FOUND" }, { status: 404 });
          const target = { email: authUser.email, role: profile.role as string | null };
          // Refused before any email is sent unless the caller outranks the target.
          if (!canActOnUser(actingRole, toAppRole(target.role as string | null)))
            return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });

          const anon = createAnonSupabaseClient();
          const appUrl = getServerEnv("APP_URL") ?? new URL(request.url).origin;
          const { error } = await anon.auth.resetPasswordForEmail(target.email, {
            redirectTo: `${appUrl}/reset-password`,
          });
          if (error) return json({ error: "RESET_FAILED" }, { status: 502 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_password_reset_sent",
            target: id,
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
