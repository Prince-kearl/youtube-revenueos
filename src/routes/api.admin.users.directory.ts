import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";
import {
  isMissingFunctionError,
  toDirectoryStatus,
  type DirectoryStatusRow,
} from "@/lib/server/admin-users";

// The admin user directory's maintenance (see migration 202610180001_admin_user_directory.sql).
//
//   GET  → where the initial backfill stands, recent trigger failures, and whether the caller may
//          run maintenance. Anyone who may manage users.
//   POST → ONE bounded batch of: "backfill" (resumable initial population), "check" (read-only
//          drift detection over one window) or "repair" (fix one window). Superadmin only.
//
// A full pass is many requests: the console (or an operator) calls again with the returned
// `nextAfter` until `done`. No request ever processes more than MAX_BATCH accounts, so a full
// reconciliation never runs inside one HTTP request. Backfill and repair batches are written to
// admin_audit_log with counts only — never an email or any other personal detail.

const MAX_BATCH = 2000;

const postSchema = z
  .object({
    action: z.enum(["backfill", "check", "repair"]),
    after: z.string().uuid().nullable().optional(),
    limit: z.number().int().min(1).max(MAX_BATCH).optional(),
  })
  .strict();

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

export const Route = createFileRoute("/api/admin/users/directory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { role } = await requirePermission(request, "manage_users");
          const service = createServiceSupabaseClient();
          const { data, error } = await service.rpc("admin_user_directory_status").single();
          if (error) {
            if (isMissingFunctionError(error))
              return json({ error: "ADMIN_USERS_MIGRATION_REQUIRED" }, { status: 503 });
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          return json({
            data: {
              ...toDirectoryStatus(data as DirectoryStatusRow),
              canMaintain: role === "superadmin",
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const { user, role } = await requirePermission(request, "manage_users");
          // Repair operations are platform-level: Superadmin only, on top of manage_users.
          if (role !== "superadmin") return json({ error: "ROLE_REQUIRED" }, { status: 403 });
          let input: z.infer<typeof postSchema>;
          try {
            input = postSchema.parse(await request.json());
          } catch {
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          }
          const limit = input.limit ?? MAX_BATCH;
          const after = input.after ?? null;
          const service = createServiceSupabaseClient();

          if (input.action === "backfill") {
            const { data, error } = await service
              .rpc("admin_user_directory_backfill_step", { p_limit: limit })
              .single();
            if (error) {
              if (isMissingFunctionError(error))
                return json({ error: "ADMIN_USERS_MIGRATION_REQUIRED" }, { status: 503 });
              return json({ error: "DATABASE_ERROR" }, { status: 500 });
            }
            const row = data as {
              status: string;
              batch_processed: number;
              batch_inserted: number;
              total_processed: number | string;
              done: boolean;
            };
            await logAdminAudit(service, {
              adminUserId: user.id,
              action: "user_directory_backfill_batch",
              target: "admin_user_directory",
              newValue: {
                status: row.status,
                processed: row.batch_processed,
                inserted: row.batch_inserted,
              },
            });
            return json({
              data: {
                status: row.status,
                batchProcessed: row.batch_processed,
                batchInserted: row.batch_inserted,
                totalProcessed: Number(row.total_processed),
                done: row.done,
              },
            });
          }

          if (input.action === "check") {
            const { data, error } = await service
              .rpc("admin_user_directory_check", { p_after: after, p_limit: limit })
              .single();
            if (error) {
              if (isMissingFunctionError(error))
                return json({ error: "ADMIN_USERS_MIGRATION_REQUIRED" }, { status: 503 });
              return json({ error: "DATABASE_ERROR" }, { status: 500 });
            }
            const row = data as {
              checked: number;
              missing: number;
              stale_email: number;
              stale_profile: number;
              stale_status: number;
              next_after: string | null;
              done: boolean;
            };
            return json({
              data: {
                checked: row.checked,
                missing: row.missing,
                staleEmail: row.stale_email,
                staleProfile: row.stale_profile,
                staleStatus: row.stale_status,
                nextAfter: row.next_after,
                done: row.done,
              },
            });
          }

          const { data, error } = await service
            .rpc("admin_user_directory_repair", { p_after: after, p_limit: limit })
            .single();
          if (error) {
            if (isMissingFunctionError(error))
              return json({ error: "ADMIN_USERS_MIGRATION_REQUIRED" }, { status: 503 });
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          const row = data as {
            checked: number;
            inserted: number;
            updated: number;
            next_after: string | null;
            done: boolean;
          };
          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "user_directory_repair_batch",
            target: "admin_user_directory",
            newValue: { checked: row.checked, inserted: row.inserted, updated: row.updated },
          });
          return json({
            data: {
              checked: row.checked,
              inserted: row.inserted,
              updated: row.updated,
              nextAfter: row.next_after,
              done: row.done,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
