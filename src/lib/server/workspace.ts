import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireSessionUser } from "./supabase-ssr";

// Workspace membership role — a DIFFERENT axis from profiles.role / AppRole in roles.ts, even
// though the label strings overlap. profiles.role is the platform-staff role (Superadmin console,
// requirePermission/requireAdminUser); this is "what can this person do inside THIS creator's
// workspace." Never pass a WorkspaceRole into requirePermission/requireAdminUser/canAccessConsole
// or vice versa — every signed-up user is "owner" of their own workspace by default, and
// confusing the two would silently grant Superadmin-console permissions to every new signup.
export type WorkspaceRole = "owner" | "manager" | "setter" | "editor";

export interface WorkspaceContext {
  client: SupabaseClient;
  user: User;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  setCookieHeaders: string[];
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
export async function getWorkspaceContext(request: Request): Promise<WorkspaceContext> {
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
  return {
    client,
    user,
    workspaceId: membership.workspace_id as string,
    workspaceRole: membership.role as WorkspaceRole,
    setCookieHeaders,
  };
}

// Real server-side enforcement for workspace data routes — mirrors requireFeatureEnabled in
// feature-access.ts exactly, but resolves the caller's role from their workspace membership
// instead of profiles.role, so an invited teammate's access respects the same Superadmin-
// configured role_feature_access matrix as everyone else, not a separate permission system.
export async function requireWorkspaceFeature(
  request: Request,
  featureKey: string,
): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext(request);
  const { data: feature } = await ctx.client
    .from("features")
    .select("id, is_active")
    .eq("key", featureKey)
    .maybeSingle();
  if (!feature || !feature.is_active) throw forbidden("FEATURE_UNAVAILABLE");

  const { data: override } = await ctx.client
    .from("role_feature_access")
    .select("enabled")
    .eq("role", ctx.workspaceRole)
    .eq("feature_id", feature.id)
    .maybeSingle();
  const enabled = override?.enabled ?? true;
  if (!enabled) throw forbidden("FEATURE_DISABLED");

  return ctx;
}

// Only owner/manager may invite, change roles, or remove members — mirrors canManageRole's
// conservatism in roles.ts (setter/editor can't touch team composition at all).
export function canManageWorkspaceMembers(role: WorkspaceRole): boolean {
  return role === "owner" || role === "manager";
}

// A manager can invite/edit/remove setters and editors, but never another owner or manager
// (can't create a peer or superior) — only the owner can do that. Mirrors canManageRole's
// "can't touch anyone at or above your own level" rule in roles.ts.
export function canManageWorkspaceRole(
  actingRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): boolean {
  if (actingRole === "owner") return true;
  if (actingRole !== "manager") return false;
  return targetRole === "setter" || targetRole === "editor";
}
