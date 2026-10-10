import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePlanTier } from "./ai-usage";
import { TEAM_MANAGEMENT_PLAN, TEAM_NOT_ENTITLED, type TeamEntitlement } from "@/lib/team-policy";

// What a WORKSPACE's subscription entitles it to.
//
// Subscriptions are held by users, but an entitlement belongs to the workspace, so it is always
// resolved through the workspace's owner — never through whoever happens to be calling:
//
//   workspace  →  workspaces.owner_id  →  that owner's subscription  →  plan
//
// A manager with no subscription of their own can therefore manage the team of a Scale
// workspace, and a member who personally pays for Scale gains nothing inside someone else's Pro
// workspace.
//
// Only the local subscription record is read (the existing resolvePlanTier): no Stripe request
// is made while authorising a request. That helper counts a subscription only while it is
// "active" or "trialing", so past-due, canceled, expired and missing subscriptions — and any
// plan it does not recognise — resolve to "free" and are not entitled. A database error does the
// same. Everything here fails closed.
//
// An entitlement is not a permission. Callers still apply the workspace role rules
// (lib/team-policy.ts); this module only answers the plan half of the question.

/**
 * A narrowly scoped exception: platform staff (profiles.role = "superadmin") are treated as
 * entitled to team management in workspaces THEY ARE A MEMBER OF, whatever the owner's plan.
 *
 * It exists because Tubify's own workspaces have no subscription. It waives the plan requirement
 * and nothing else: the caller must already be an authenticated, active member of the workspace
 * (established by getWorkspaceContext before this is called), and every workspace role rule
 * still applies to them. It gives no access to any other workspace.
 *
 * To retire it, set this to false.
 */
export const SUPERADMIN_TEAM_EXCEPTION_ENABLED = true;

const ENTITLED_BY_PLAN: TeamEntitlement = {
  allowed: true,
  reason: "plan",
  requiredPlan: TEAM_MANAGEMENT_PLAN,
};
const ENTITLED_BY_EXCEPTION: TeamEntitlement = {
  allowed: true,
  reason: "superadmin_exception",
  requiredPlan: TEAM_MANAGEMENT_PLAN,
};
const UNAVAILABLE: TeamEntitlement = {
  allowed: false,
  reason: "unavailable",
  requiredPlan: TEAM_MANAGEMENT_PLAN,
};

/** Whether `userId` is platform staff, from the trusted profiles table. False on any doubt. */
async function isPlatformSuperadmin(service: SupabaseClient, userId: string): Promise<boolean> {
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

/**
 * The team-management entitlement of `workspaceId`, as it applies to the member `userId`.
 *
 * `workspaceId` and `userId` must come from the server's own authentication (the caller's
 * verified session and their active membership) — never from the request body or query string.
 * `service` is the service-role client: a member cannot read the owner's subscription through
 * row-level security, and must not be able to.
 *
 * `options` exists so tests can exercise the path with the staff exception switched off.
 */
export async function resolveTeamManagementEntitlement(
  service: SupabaseClient,
  input: { workspaceId: string; userId: string },
  options: { superadminException: boolean } = {
    superadminException: SUPERADMIN_TEAM_EXCEPTION_ENABLED,
  },
): Promise<TeamEntitlement> {
  let ownerId: string | null = null;
  try {
    const { data, error } = await service
      .from("workspaces")
      .select("owner_id")
      .eq("id", input.workspaceId)
      .maybeSingle();
    // The workspace or its owner could not be read: nothing is known, so nothing is granted —
    // not even the staff exception, which presupposes a workspace we can identify.
    if (error || !data?.owner_id) return UNAVAILABLE;
    ownerId = data.owner_id as string;
  } catch {
    return UNAVAILABLE;
  }

  const ownerPlan = await resolvePlanTier(service, ownerId);
  if (ownerPlan === TEAM_MANAGEMENT_PLAN) return ENTITLED_BY_PLAN;

  if (options.superadminException && (await isPlatformSuperadmin(service, input.userId)))
    return ENTITLED_BY_EXCEPTION;

  return TEAM_NOT_ENTITLED;
}
