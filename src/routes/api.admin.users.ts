import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission, canManageRole, toAppRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const patchSchema = z.object({
  role: z.enum(["user", "editor", "setter", "manager", "owner", "superadmin"]).optional(),
  // "none" unbans. Anything else is a Postgres interval string Supabase's admin API accepts
  // as-is (e.g. "24h" for a suspension, "876000h" — 100 years — standing in for "permanent").
  banDuration: z.string().optional(),
  emailConfirm: z.boolean().optional(),
  creatorVerified: z.boolean().optional(),
});
const createSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120).nullable().optional(),
  role: z.enum(["user", "editor", "setter", "manager", "owner", "superadmin"]).default("user"),
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

// auth.users only exposes banned_until/email_confirmed_at/last_sign_in_at/user_metadata through
// the Admin API, never through PostgREST — so the real Users table has to merge that with
// profiles (name/role/avatar) rather than reading either alone.
async function fetchAuthUsersById(service: ReturnType<typeof createServiceSupabaseClient>) {
  const byId = new Map<
    string,
    {
      banned_until?: string | null;
      email_confirmed_at?: string | null;
      last_sign_in_at?: string | null;
      user_metadata?: Record<string, unknown>;
    }
  >();
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data.users) byId.set(u.id, u);
    if (data.users.length < 200) break;
    page += 1;
    if (page > 10) break; // hard stop — this UI has no pagination yet, 2000 users is plenty for now
  }
  return byId;
}

function deriveStatus(
  authUser: { banned_until?: string | null; email_confirmed_at?: string | null } | undefined,
) {
  if (authUser?.banned_until && new Date(authUser.banned_until).getTime() > Date.now())
    return "Banned";
  if (!authUser?.email_confirmed_at) return "Pending";
  return "Active";
}

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      // Every real user, merging profiles (name/role/avatar) with auth.users (verification/ban/
      // last-login) — the only place both halves of "who this person is" and "can they sign in"
      // exist together.
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "manage_users");
          const { data, error } = await client
            .from("profiles")
            .select("id, name, email, avatar, role, created_at")
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const service = createServiceSupabaseClient();
          const authUsers = await fetchAuthUsersById(service);

          const rows = (data ?? []).map((row) => {
            const authUser = authUsers.get(row.id);
            return {
              ...row,
              role: toAppRole(row.role as string),
              status: deriveStatus(authUser),
              emailVerified: Boolean(authUser?.email_confirmed_at),
              creatorVerified: authUser?.user_metadata?.creator_verified === true,
              bannedUntil: authUser?.banned_until ?? null,
              lastSignInAt: authUser?.last_sign_in_at ?? null,
            };
          });
          return json({ data: rows });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      // Real invite — creates the auth.users row (which the existing handle_new_user trigger
      // turns into a profiles row) and emails them a real Supabase invite link. Requires the
      // project's email provider to be configured; surfaces that plainly if it isn't.
      POST: async ({ request }) => {
        try {
          const { user, role: actingRole } = await requirePermission(request, "manage_users");
          const input = createSchema.parse(await parseJson(request));
          if (!canManageRole(actingRole, "user", input.role)) {
            return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });
          }

          const service = createServiceSupabaseClient();
          const { data, error } = await service.auth.admin.inviteUserByEmail(input.email, {
            data: { name: input.name ?? null },
          });
          if (error || !data.user) {
            return json({ error: "INVITE_FAILED", message: error?.message }, { status: 502 });
          }

          if (input.role !== "user") {
            await service.from("profiles").update({ role: input.role }).eq("id", data.user.id);
          }

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_invited",
            target: input.email,
            newValue: { role: input.role },
          });

          return json({ data: { id: data.user.id, email: input.email } }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      // Every real mutation on one user: role, ban/unban, email verification, creator badge.
      // Whichever fields are present in the body are applied; each is its own real, immediate
      // change, independently audited.
      PATCH: async ({ request }) => {
        try {
          const {
            client,
            user,
            role: actingRole,
          } = await requirePermission(request, "manage_users");
          const targetId = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = patchSchema.parse(await parseJson(request));

          if (targetId === user.id && (input.role || input.banDuration)) {
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

          if (input.role !== undefined) {
            if (!canManageRole(actingRole, targetCurrentRole, input.role)) {
              return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });
            }
            if (targetCurrentRole === "superadmin" && input.role !== "superadmin") {
              const { count } = await service
                .from("profiles")
                .select("id", { count: "exact", head: true })
                .eq("role", "superadmin");
              if ((count ?? 0) <= 1) {
                return json({ error: "CANNOT_REMOVE_LAST_SUPERADMIN" }, { status: 409 });
              }
            }
            const { error } = await service
              .from("profiles")
              .update({ role: input.role })
              .eq("id", targetId);
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            await logAdminAudit(service, {
              adminUserId: user.id,
              action: "role_assigned",
              target: target.email ?? target.id,
              oldValue: { role: targetCurrentRole },
              newValue: { role: input.role },
            });
          }

          if (input.banDuration !== undefined) {
            const { error } = await service.auth.admin.updateUserById(targetId, {
              ban_duration: input.banDuration,
            });
            if (error)
              return json({ error: "BAN_UPDATE_FAILED", message: error.message }, { status: 502 });
            await logAdminAudit(service, {
              adminUserId: user.id,
              action: input.banDuration === "none" ? "user_unbanned" : "user_banned",
              target: target.email ?? target.id,
              newValue: { banDuration: input.banDuration },
            });
          }

          if (input.emailConfirm !== undefined) {
            const { error } = await service.auth.admin.updateUserById(targetId, {
              email_confirm: input.emailConfirm,
            });
            if (error)
              return json({ error: "VERIFY_FAILED", message: error.message }, { status: 502 });
            await logAdminAudit(service, {
              adminUserId: user.id,
              action: "user_email_verified",
              target: target.email ?? target.id,
            });
          }

          if (input.creatorVerified !== undefined) {
            const { data: existing } = await service.auth.admin.getUserById(targetId);
            const { error } = await service.auth.admin.updateUserById(targetId, {
              user_metadata: {
                ...existing?.user?.user_metadata,
                creator_verified: input.creatorVerified,
              },
            });
            if (error)
              return json({ error: "VERIFY_FAILED", message: error.message }, { status: 502 });
            await logAdminAudit(service, {
              adminUserId: user.id,
              action: input.creatorVerified ? "user_creator_verified" : "user_creator_unverified",
              target: target.email ?? target.id,
            });
          }

          const { data: updated } = await client
            .from("profiles")
            .select("id, name, email, avatar, role, created_at")
            .eq("id", targetId)
            .single();
          return json({
            data: updated ? { ...updated, role: toAppRole(updated.role as string) } : null,
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      // Permanently deletes the real auth account; profiles cascades via its FK, so nothing else
      // to clean up here.
      DELETE: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_users");
          const targetId = idSchema.parse(new URL(request.url).searchParams.get("id"));
          if (targetId === user.id) return json({ error: "CANNOT_DELETE_SELF" }, { status: 409 });

          const service = createServiceSupabaseClient();
          const { data: target } = await service
            .from("profiles")
            .select("id, email, role")
            .eq("id", targetId)
            .maybeSingle();
          if (!target) return json({ error: "USER_NOT_FOUND" }, { status: 404 });

          if (toAppRole(target.role as string) === "superadmin") {
            const { count } = await service
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "superadmin");
            if ((count ?? 0) <= 1) {
              return json({ error: "CANNOT_REMOVE_LAST_SUPERADMIN" }, { status: 409 });
            }
          }

          const { error } = await service.auth.admin.deleteUser(targetId);
          if (error)
            return json({ error: "DELETE_FAILED", message: error.message }, { status: 502 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_deleted",
            target: target.email ?? target.id,
          });
          return json({ data: { id: targetId } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
