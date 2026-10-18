import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { canImpersonate, requirePermission, toAppRole } from "@/lib/server/roles";
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
//
// Identity. WHO the link signs in as is decided by Supabase Auth, by the account's immutable id —
// never by profiles.email, which its owner can rewrite (profiles_self_update does not protect it).
// Before this, a link was generated for whatever address the profile held: an Owner could set an
// ordinary account's profile email to a Superadmin's address, impersonate that account, and
// receive a sign-in link for the Superadmin. Now the email comes from Auth, the role from
// profiles (which users cannot change), and the link Supabase returns must belong to the
// requested user or it is discarded. The link itself is never logged or audited.
export const Route = createFileRoute("/api/admin/users/impersonate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user, role: actingRole } = await requirePermission(request, "manage_users");
          const { id } = bodySchema.parse(await request.json().catch(() => ({})));
          if (id === user.id) return json({ error: "CANNOT_IMPERSONATE_SELF" }, { status: 409 });

          const service = createServiceSupabaseClient();
          const [{ data: profile }, { data: auth }] = await Promise.all([
            service.from("profiles").select("role").eq("id", id).maybeSingle(),
            service.auth.admin.getUserById(id),
          ]);
          const authUser = auth?.user ?? null;
          if (!profile || !authUser?.email || authUser.id !== id)
            return json({ error: "USER_NOT_FOUND" }, { status: 404 });
          // Signing in as someone is holding their account: refused before any link exists unless
          // the caller strictly outranks the target (see canImpersonate).
          if (!canImpersonate(actingRole, toAppRole(profile.role as string | null)))
            return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });

          const appUrl = getServerEnv("APP_URL") ?? new URL(request.url).origin;
          const { data, error } = await service.auth.admin.generateLink({
            type: "magiclink",
            email: authUser.email,
            options: { redirectTo: `${appUrl}/dashboard` },
          });
          if (error || !data?.properties?.action_link) {
            return json({ error: "LINK_FAILED" }, { status: 502 });
          }
          // The link must sign in as the account that was asked for — nothing else is returned.
          if (data.user?.id !== id) {
            await logAdminAudit(service, {
              adminUserId: user.id,
              action: "user_impersonation_link_rejected",
              target: id,
            });
            return json({ error: "LINK_MISMATCH" }, { status: 502 });
          }

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_impersonation_link_generated",
            target: id,
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
