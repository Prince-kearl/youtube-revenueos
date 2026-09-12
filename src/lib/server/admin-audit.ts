import type { SupabaseClient } from "@supabase/supabase-js";

// Generic audit log for admin actions outside the plans/pricing domain (which already has its
// own plan_audit_log) — currently used by feature-management and release-management routes.
export async function logAdminAudit(
  client: SupabaseClient,
  entry: {
    adminUserId: string;
    action: string;
    target?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  try {
    await client.from("admin_audit_log").insert({
      admin_user_id: entry.adminUserId,
      action: entry.action,
      target: entry.target ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
    });
  } catch {
    // Audit logging is best-effort — never block a real admin action over it.
  }
}
