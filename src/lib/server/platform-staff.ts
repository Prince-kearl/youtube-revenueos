import type { SupabaseClient } from "@supabase/supabase-js";

// Platform staff: profiles.role = "superadmin". A different axis from workspace roles (see
// workspace.ts) — it says who works for Tubify, not what someone may do inside a workspace.
//
// Kept in a module of its own, with no other imports, so the few places that grant staff a
// narrow exception (workspace-entitlements.ts, revenue-visibility.ts) can ask this one question
// without pulling anything else into their import graph.

/** Whether `userId` is platform staff, from the trusted profiles table. False on any doubt.
 * `service` must be the service-role client: the answer must not depend on what the caller's
 * own session can read. */
export async function isPlatformSuperadmin(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await service
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    return !error && data?.role === "superadmin";
  } catch {
    return false;
  }
}
