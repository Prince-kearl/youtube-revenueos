import type { SupabaseClient } from "@supabase/supabase-js";

export async function logPlanAudit(
  client: SupabaseClient,
  entry: {
    adminUserId: string;
    action: string;
    planId?: string | null;
    planName?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  try {
    await client.from("plan_audit_log").insert({
      admin_user_id: entry.adminUserId,
      action: entry.action,
      plan_id: entry.planId ?? null,
      plan_name: entry.planName ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
    });
  } catch {
    // Audit logging is best-effort — never block a real plan/pricing change over it.
  }
}
