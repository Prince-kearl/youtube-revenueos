import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission, canActOnUser, canManageRole, toAppRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";
import {
  AdminUsersQueryError,
  adminCountUsersArgs,
  adminListUsersArgs,
  isDirectoryIncompleteError,
  isMissingFunctionError,
  parseAdminUsersQuery,
  toDirectoryStatus,
  type DirectoryStatusRow,
  toAdminUsersPage,
  type AdminUserDirectoryRow,
  type AdminUsersQuery,
} from "@/lib/server/admin-users";

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

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      // One page of accounts — identity (profiles) with account status (verification, ban, last
      // sign-in) — searched, filtered, sorted, counted and paged inside Postgres by the
      // admin_list_users / admin_count_users / admin_user_stats functions (migration
      // 202610180001_admin_user_directory.sql). Nothing here loads more than one page of rows.
      //
      //   ?limit=1..100 (default 25)  ?sort=newest|oldest|email  ?q=<name, email or user id>
      //   ?role=<app role>  ?status=active|pending|banned  ?cursor=<from the previous page>
      //   ?stats=1 (first page only: the Total/Active/Pending/Banned figures)
      //
      // The total and the stats are only computed for the first page (no cursor); the console
      // keeps them while paging.
      GET: async ({ request }) => {
        try {
          await requirePermission(request, "manage_users");
          let query: AdminUsersQuery;
          try {
            query = parseAdminUsersQuery(new URL(request.url).searchParams);
          } catch (error) {
            if (error instanceof AdminUsersQueryError)
              return json({ error: error.code }, { status: 422 });
            throw error;
          }

          // Service client, not the caller's: the functions are granted to service_role only, and
          // the caller's platform permission was checked above.
          const service = createServiceSupabaseClient();
          const firstPage = query.cursor === null;
          const [list, count, stats] = await Promise.all([
            service.rpc("admin_list_users", adminListUsersArgs(query)),
            firstPage
              ? service.rpc("admin_count_users", adminCountUsersArgs(query))
              : Promise.resolve(null),
            firstPage && query.includeStats
              ? service.rpc("admin_user_stats").single()
              : Promise.resolve(null),
          ]);
          const failed = [list.error, count?.error, stats?.error].find(Boolean) ?? null;
          if (failed) {
            if (isMissingFunctionError(failed))
              return json({ error: "ADMIN_USERS_MIGRATION_REQUIRED" }, { status: 503 });
            // The initial backfill has not finished: the database refuses to present a partial
            // directory as the user list. Say how far it has got instead.
            if (isDirectoryIncompleteError(failed)) {
              const { data: state } = await service.rpc("admin_user_directory_status").single();
              return json(
                {
                  error: "ADMIN_USERS_DIRECTORY_INCOMPLETE",
                  directory: state ? toDirectoryStatus(state as DirectoryStatusRow) : null,
                },
                { status: 503 },
              );
            }
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          const page = toAdminUsersPage((list.data ?? []) as AdminUserDirectoryRow[], query);
          const statsRow = stats?.data as Record<string, number | string> | null | undefined;
          return json({
            data: page.items,
            page: {
              limit: query.limit,
              nextCursor: page.nextCursor,
              total: count ? Number(count.data) : null,
            },
            ...(statsRow
              ? {
                  stats: {
                    total: Number(statsRow.total),
                    active: Number(statsRow.active),
                    pending: Number(statsRow.pending),
                    banned: Number(statsRow.banned),
                  },
                }
              : {}),
          });
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
            target: data.user.id,
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
            .select("id, role")
            .eq("id", targetId)
            .maybeSingle();
          if (!target) return json({ error: "USER_NOT_FOUND" }, { status: 404 });
          const targetCurrentRole = toAppRole(target.role as string);

          // Banning or unbanning, marking the email verified and setting the creator badge all
          // change someone's account, so each needs the caller to outrank the target (see
          // canActOnUser). Decided on the target's CURRENT role, once, before anything in this
          // request is applied — so a request that also changes the role cannot first demote the
          // target and then act on it. (A caller's own email flag and badge are their own
          // account, as before; a ban or role change on oneself is refused above.)
          const changesAccount =
            input.banDuration !== undefined ||
            input.emailConfirm !== undefined ||
            input.creatorVerified !== undefined;
          if (
            changesAccount &&
            targetId !== user.id &&
            !canActOnUser(actingRole, targetCurrentRole)
          ) {
            return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });
          }

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
              target: target.id,
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
              target: target.id,
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
              target: target.id,
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
              target: target.id,
            });
          }

          const { data: updated } = await service
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
          const { user, role: actingRole } = await requirePermission(request, "manage_users");
          const targetId = idSchema.parse(new URL(request.url).searchParams.get("id"));
          if (targetId === user.id) return json({ error: "CANNOT_DELETE_SELF" }, { status: 409 });

          const service = createServiceSupabaseClient();
          const { data: target } = await service
            .from("profiles")
            .select("id, role")
            .eq("id", targetId)
            .maybeSingle();
          if (!target) return json({ error: "USER_NOT_FOUND" }, { status: 404 });
          // Deleting an account needs the caller to outrank it: an Owner can never delete a
          // Superadmin or another Owner.
          if (!canActOnUser(actingRole, toAppRole(target.role as string))) {
            return json({ error: "PRIVILEGE_ESCALATION_BLOCKED" }, { status: 403 });
          }

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
            target: target.id,
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
