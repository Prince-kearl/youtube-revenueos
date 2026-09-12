import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireSessionUser } from "./supabase-ssr";

// The one canonical, server-authenticated role type — profiles.role is the single source of
// truth. 'admin' is a legacy value that may still exist in the database enum for historical
// safety, but no profile row should carry it after the 202609130002_rbac_data.sql migration
// promotes existing admins to 'superadmin'; toAppRole() below treats it as 'superadmin' defensively
// in case a row somehow still has it.
export const APP_ROLES = ["user", "editor", "setter", "manager", "owner", "superadmin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

// Lowest to highest. 'user' is the baseline normal-account role, sitting below the staff
// hierarchy (Editor < Setter < Manager < Owner < Superadmin) rather than being part of it.
export const ROLE_LEVEL: Record<AppRole, number> = {
  user: 0,
  editor: 1,
  setter: 2,
  manager: 3,
  owner: 4,
  superadmin: 5,
};

// Roles that may sign into and act within the Superadmin console at all — Manager/Setter/Editor
// are real operational/content roles for the product itself, not platform administration, so they
// don't get a foot in the admin console door (they can still have rich feature_access-driven
// product permissions, just not console access).
const CONSOLE_ROLES: ReadonlySet<AppRole> = new Set(["superadmin", "owner"]);

export function toAppRole(rawRole: string | null | undefined): AppRole {
  if (rawRole === "admin") return "superadmin"; // legacy value defensive fallback, see migration
  return (APP_ROLES as readonly string[]).includes(rawRole ?? "") ? (rawRole as AppRole) : "user";
}

export function hasMinimumRole(role: AppRole, minimum: AppRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minimum];
}

export function canAccessConsole(role: AppRole): boolean {
  return CONSOLE_ROLES.has(role);
}

// Whether `actingRole` may change a user currently at `targetCurrentRole` to `targetNewRole`.
// Deliberately conservative: only superadmin and owner may touch roles at all (this also
// satisfies "Manager cannot promote themselves" — Manager can't touch roles, period). Owner is
// scoped to targets and new roles below Owner, so an Owner can never create/edit another Owner or
// a Superadmin — only a Superadmin can do that. Self-changes are blocked by the caller
// (api.admin.users.ts), not here, since that check doesn't depend on the target's current role.
export function canManageRole(
  actingRole: AppRole,
  targetCurrentRole: AppRole,
  targetNewRole: AppRole,
): boolean {
  if (actingRole === "superadmin") return true;
  if (actingRole !== "owner") return false;
  const belowOwner = (r: AppRole) => ROLE_LEVEL[r] < ROLE_LEVEL["owner"];
  return belowOwner(targetCurrentRole) && belowOwner(targetNewRole);
}

// ============ PERMISSIONS ============
// A permission layer alongside (not instead of) the role hierarchy and per-role feature access —
// only permissions that correspond to real, already-built Tubify admin capabilities.
export const PERMISSIONS = [
  "view_dashboard",
  "manage_users",
  "manage_roles",
  "manage_features",
  "manage_plans",
  "manage_billing",
  "manage_releases",
  "view_audit_logs",
  "manage_integrations",
  "manage_support",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  superadmin: ALL_PERMISSIONS,
  owner: ALL_PERMISSIONS,
  // Operational management: can see platform health and manage integrations/audit history, but
  // not touch billing, plans, other users' roles, or feature availability.
  manager: ["view_dashboard", "manage_integrations", "view_audit_logs", "manage_support"],
  setter: ["view_dashboard"],
  editor: ["view_dashboard"],
  user: ["view_dashboard"],
};

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

async function resolveRole(client: SupabaseClient, userId: string): Promise<AppRole> {
  const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
  return toAppRole(data?.role as string | undefined);
}

interface AuthedResult {
  client: SupabaseClient;
  user: User;
  role: AppRole;
  setCookieHeaders: string[];
}

function forbidden(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

// Real server-side role resolution — the one place every role-gated route/API ultimately goes
// through. Fails closed: an unauthenticated request gets requireSessionUser's own 401, never a
// silent default role.
export async function getAuthenticatedRole(request: Request): Promise<AuthedResult> {
  const { client, user, setCookieHeaders } = await requireSessionUser(request);
  const role = await resolveRole(client, user.id);
  return { client, user, role, setCookieHeaders };
}

export async function requireMinimumRole(
  request: Request,
  minimum: AppRole,
): Promise<AuthedResult> {
  const result = await getAuthenticatedRole(request);
  if (!hasMinimumRole(result.role, minimum)) throw forbidden("ROLE_REQUIRED");
  return result;
}

export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<AuthedResult> {
  const result = await getAuthenticatedRole(request);
  if (!hasPermission(result.role, permission)) throw forbidden("PERMISSION_REQUIRED");
  return result;
}
