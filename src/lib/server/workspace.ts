import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireSessionUser } from "./supabase-ssr";
import { createServiceSupabaseClient } from "./supabase";
import { resolveWorkspacePlan, subscriptionRequired, type WorkspacePlan } from "./plan-access";
import { canManageMembers, canManageRole, type WorkspaceRole } from "@/lib/team-policy";

// Workspace membership role — a DIFFERENT axis from profiles.role / AppRole in roles.ts, even
// though the label strings overlap. profiles.role is the platform-staff role (Superadmin console,
// requirePermission/requireAdminUser); this is "what can this person do inside THIS creator's
// workspace." Never pass a WorkspaceRole into requirePermission/requireAdminUser/canAccessConsole
// or vice versa — every signed-up user is "owner" of their own workspace by default, and
// confusing the two would silently grant Superadmin-console permissions to every new signup.
export type { WorkspaceRole };

export interface WorkspaceContext {
  client: SupabaseClient;
  user: User;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  setCookieHeaders: string[];
  /** The workspace's plan (lib/server/plan-access.ts). With the default `requirePlan` it is
   * always a paid plan here; a route that opted out may receive "no plan". */
  plan: WorkspacePlan;
}

export interface WorkspaceContextOptions {
  /**
   * Whether the workspace needs an active or trialing subscription (default: yes). A workspace
   * without one is refused with 402 SUBSCRIPTION_REQUIRED — or 503 when its plan cannot be read —
   * before the route reads anything.
   *
   * Every workspace route requires a plan unless it says otherwise, so a new route is paid by
   * default. Only what a customer needs to subscribe, recover or manage their account opts out
   * (`requirePlan: false`): onboarding, notifications, workspace and team settings, YouTube
   * reconnection, support. Their data is never deleted either way.
   */
  requirePlan?: boolean;
}

function forbidden(error: string, status = 403): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Every real account has exactly one active workspace membership (their own, as owner, or one
// they were invited into — see handle_new_user() and api.workspace.members.ts) — v1 doesn't
// support belonging to more than one workspace, so there's no ambiguity to resolve here.
export async function getWorkspaceContext(
  request: Request,
  options: WorkspaceContextOptions = {},
): Promise<WorkspaceContext> {
  const { client, user, setCookieHeaders } = await requireSessionUser(request);
  const { data: membership, error } = await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Workspace membership lookup failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }
  if (!membership) throw forbidden("NO_WORKSPACE");
  const workspaceId = membership.workspace_id as string;
  const plan = await resolveWorkspacePlan(createServiceSupabaseClient(), {
    workspaceId,
    userId: user.id,
  });
  if ((options.requirePlan ?? true) && !plan.plan) throw subscriptionRequired(plan);
  return {
    client,
    user,
    workspaceId,
    workspaceRole: membership.role as WorkspaceRole,
    setCookieHeaders,
    plan,
  };
}

/**
 * For a route scoped to the signed-in user rather than read through a workspace (the YouTube
 * data and AI routes): the same session requireSessionUser gives, after the same plan check every
 * workspace route makes — through the user's own workspace.
 */
export async function requirePaidSession(
  request: Request,
): Promise<
  Pick<WorkspaceContext, "client" | "user" | "setCookieHeaders" | "workspaceId" | "plan">
> {
  const { client, user, setCookieHeaders, workspaceId, plan } = await getWorkspaceContext(request);
  return { client, user, setCookieHeaders, workspaceId, plan };
}

// Real server-side enforcement for workspace data routes — mirrors requireFeatureEnabled in
// feature-access.ts exactly, but resolves the caller's role from their workspace membership
// instead of profiles.role, so an invited teammate's access respects the same Superadmin-
// configured role_feature_access matrix as everyone else, not a separate permission system.
export async function requireWorkspaceFeature(
  request: Request,
  featureKey: string,
  options: WorkspaceContextOptions = {},
): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext(request, options);
  const status = await workspaceFeatureStatus(ctx, featureKey);
  if (status === "unavailable") throw forbidden("FEATURE_UNAVAILABLE");
  if (status === "disabled") throw forbidden("FEATURE_DISABLED");
  return ctx;
}

/**
 * Whether the caller's role may use a feature, without throwing — for a route that combines
 * several features and leaves out what a role may not use (requireWorkspaceFeature is the same
 * check for a route that needs one feature outright):
 *
 *   unavailable  the feature does not exist or is switched off for everyone
 *   disabled     it is switched off for the caller's role
 *   enabled      otherwise (a role with no override has it)
 */
export async function workspaceFeatureStatus(
  ctx: Pick<WorkspaceContext, "client" | "workspaceRole">,
  featureKey: string,
): Promise<"enabled" | "disabled" | "unavailable"> {
  const { data: feature } = await ctx.client
    .from("features")
    .select("id, is_active")
    .eq("key", featureKey)
    .maybeSingle();
  if (!feature || !feature.is_active) return "unavailable";

  const { data: override } = await ctx.client
    .from("role_feature_access")
    .select("enabled")
    .eq("role", ctx.workspaceRole)
    .eq("feature_id", feature.id)
    .maybeSingle();
  return (override?.enabled ?? true) ? "enabled" : "disabled";
}

// The role rules themselves live in lib/team-policy.ts (pure, shared with the Team page and
// unit-tested there). These names are kept because other workspace-settings routes gate on them.
export function canManageWorkspaceMembers(role: WorkspaceRole): boolean {
  return canManageMembers(role);
}

export function canManageWorkspaceRole(
  actingRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  return canManageRole(actingRole, targetRole);
}
