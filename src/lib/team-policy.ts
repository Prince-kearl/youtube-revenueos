// Team Management authorization rules. Pure (no database, no React), so every rule is
// unit-tested, and shared: the server enforces these in api.workspace.members.ts and the Team
// page uses the same functions to decide which controls to show.
//
// An action is allowed only when ALL of these hold:
//
//   signed in  +  a member of the workspace  +  a role that permits it  +  a plan that permits it
//
// The first two are established before these functions are called (getWorkspaceContext). The
// functions here answer the last two, and they are independent: a plan never grants what a role
// forbids, and a role never grants what the plan withholds.
//
// Which actions need the Team Management entitlement (Scale):
//
//   invite a member        yes — it expands the team
//   change a member's role yes — it reconfigures the team
//   view members           no
//   remove a member        no  — a workspace that downgrades must still be able to shrink
//   edit job title         no
//   edit lead share, commission or cost   no (role rules only)

export type WorkspaceRole = "owner" | "manager" | "setter" | "editor";

/** Only an owner or a manager may invite, change roles or remove members. */
export function canManageMembers(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Whether `actingRole` may act on a member holding `targetRole`. An owner may act on anyone;
 * a manager only on setters and editors — never on an owner or a fellow manager. */
export function canManageRole(
  actingRole: WorkspaceRole | null | undefined,
  targetRole: WorkspaceRole,
): boolean {
  if (actingRole === "owner") return true;
  if (actingRole !== "manager") return false;
  return targetRole === "setter" || targetRole === "editor";
}

// ---------- the plan entitlement ----------

export const TEAM_MANAGEMENT_PLAN = "scale";

export type TeamEntitlementReason =
  /** The workspace owner's plan includes team management. */
  | "plan"
  /** The caller is platform staff and a member of this workspace (see workspace-entitlements.ts). */
  | "superadmin_exception"
  /** The workspace owner's plan does not include team management (or there is no plan). */
  | "plan_required"
  /** The entitlement could not be determined; treated as not entitled. */
  | "unavailable";

export interface TeamEntitlement {
  allowed: boolean;
  reason: TeamEntitlementReason;
  requiredPlan: typeof TEAM_MANAGEMENT_PLAN;
}

export const TEAM_NOT_ENTITLED: TeamEntitlement = {
  allowed: false,
  reason: "plan_required",
  requiredPlan: TEAM_MANAGEMENT_PLAN,
};

// ---------- decisions ----------

export interface TeamDenial {
  ok: false;
  status: number;
  /** Stable machine-readable code. PLAN_REQUIRED is used only for a plan restriction. */
  error:
    | "CANNOT_MANAGE_MEMBERS"
    | "CANNOT_ASSIGN_ROLE"
    | "CANNOT_CHANGE_OWN_ROLE"
    | "CANNOT_EDIT_COMPENSATION"
    | "CANNOT_EDIT_MEMBER"
    | "CANNOT_REMOVE_MEMBER"
    | "NO_CHANGES"
    | "PLAN_REQUIRED"
    | "ENTITLEMENT_UNAVAILABLE";
}
export type TeamDecision = { ok: true } | TeamDenial;

const allow: TeamDecision = { ok: true };
const deny = (error: TeamDenial["error"], status = 403): TeamDenial => ({
  ok: false,
  status,
  error,
});

/** Why an action that needs the plan is refused. "Upgrade" is said only when the plan really is
 * the reason; if the plan could not be determined the action is still refused, but as a
 * temporary failure — never as a prompt to pay. */
function planDenial(entitlement: TeamEntitlement): TeamDenial {
  return entitlement.reason === "unavailable"
    ? deny("ENTITLEMENT_UNAVAILABLE", 503)
    : deny("PLAN_REQUIRED");
}

/** The body of a PLAN_REQUIRED response. */
export const PLAN_REQUIRED_BODY = {
  error: "PLAN_REQUIRED",
  message: "Team management is available on Scale.",
  requiredPlan: TEAM_MANAGEMENT_PLAN,
} as const;

/** Inviting someone at `inviteRole`. Role rules are checked first, so a caller whose role does
 * not allow inviting is told so — not told to upgrade. */
export function authorizeInvite(input: {
  actorRole: WorkspaceRole;
  inviteRole: WorkspaceRole;
  entitlement: TeamEntitlement;
}): TeamDecision {
  if (!canManageMembers(input.actorRole)) return deny("CANNOT_MANAGE_MEMBERS");
  if (!canManageRole(input.actorRole, input.inviteRole)) return deny("CANNOT_ASSIGN_ROLE");
  if (!input.entitlement.allowed) return planDenial(input.entitlement);
  return allow;
}

/** What a PATCH is asking to change. */
export interface MemberChanges {
  /** The new role, when the request changes it. */
  role?: WorkspaceRole;
  /** The request touches lead share, commission or cost (whatever the values). */
  compensation: boolean;
  /** The request touches the job title. */
  jobTitle: boolean;
}

/**
 * Updating a member. Every requested field is authorised before anything is written, so a
 * request cannot smuggle a forbidden change in beside a permitted one.
 *
 *   role          not your own; owner/manager only; within the hierarchy for both the member's
 *                 current role and the new one; and the workspace must have team management
 *   compensation  only someone who may manage that member's role — so never your own, except
 *                 for an owner (who is the authority over the workspace's money). No plan needed
 *   job title     your own, or a member you may manage. No plan needed
 */
export function authorizeMemberUpdate(input: {
  actorRole: WorkspaceRole;
  isSelf: boolean;
  targetRole: WorkspaceRole;
  changes: MemberChanges;
  entitlement: TeamEntitlement;
}): TeamDecision {
  const { actorRole, isSelf, targetRole, changes, entitlement } = input;
  if (changes.role === undefined && !changes.compensation && !changes.jobTitle)
    return deny("NO_CHANGES", 422);

  const managesTarget = canManageMembers(actorRole) && canManageRole(actorRole, targetRole);

  if (changes.role !== undefined) {
    if (isSelf) return deny("CANNOT_CHANGE_OWN_ROLE");
    if (!canManageMembers(actorRole)) return deny("CANNOT_MANAGE_MEMBERS");
    if (!canManageRole(actorRole, targetRole) || !canManageRole(actorRole, changes.role))
      return deny("CANNOT_ASSIGN_ROLE");
  }
  if (changes.compensation && !managesTarget)
    return deny(
      isSelf || canManageMembers(actorRole) ? "CANNOT_EDIT_COMPENSATION" : "CANNOT_MANAGE_MEMBERS",
    );
  if (changes.jobTitle && !isSelf && !managesTarget)
    return deny(canManageMembers(actorRole) ? "CANNOT_EDIT_MEMBER" : "CANNOT_MANAGE_MEMBERS");

  // The plan is consulted last, and only for the one change that needs it.
  if (changes.role !== undefined && !entitlement.allowed) return planDenial(entitlement);
  return allow;
}

/** Removing a member (or cancelling a pending invite). Never needs a plan. Anyone may leave;
 * otherwise only someone who may manage that member's role. The caller still has to make sure
 * the workspace keeps at least one owner. */
export function authorizeMemberRemoval(input: {
  actorRole: WorkspaceRole;
  isSelf: boolean;
  targetRole: WorkspaceRole;
}): TeamDecision {
  if (input.isSelf) return allow;
  if (!canManageMembers(input.actorRole)) return deny("CANNOT_MANAGE_MEMBERS");
  if (!canManageRole(input.actorRole, input.targetRole)) return deny("CANNOT_REMOVE_MEMBER");
  return allow;
}

// ---------- who may see compensation ----------

/** Whether `viewerRole` may see a member's lead share, commission and cost: always your own;
 * an owner sees everyone's; a manager sees those of the roles they manage. */
export function canViewCompensation(input: {
  viewerRole: WorkspaceRole;
  isSelf: boolean;
  memberRole: WorkspaceRole;
}): boolean {
  if (input.isSelf) return true;
  return canManageMembers(input.viewerRole) && canManageRole(input.viewerRole, input.memberRole);
}

export const COMPENSATION_COLUMNS = ["lead_share", "commission", "cost_amount"] as const;

/** A member row as it may be shown to one viewer: compensation is blanked (null) unless that
 * viewer may see it, and `compensation_visible` says which it was. */
export function redactMember<
  T extends { user_id: string | null; role: string } & Partial<
    Record<(typeof COMPENSATION_COLUMNS)[number], number | null>
  >,
>(row: T, viewer: { userId: string; role: WorkspaceRole }): T & { compensation_visible: boolean } {
  const visible = canViewCompensation({
    viewerRole: viewer.role,
    isSelf: row.user_id !== null && row.user_id === viewer.userId,
    memberRole: row.role as WorkspaceRole,
  });
  return visible
    ? { ...row, compensation_visible: true }
    : {
        ...row,
        lead_share: null,
        commission: null,
        cost_amount: null,
        compensation_visible: false,
      };
}

// ---------- what the Team page shows where "Invite Member" goes ----------

export type TeamInviteState =
  /** Access is not known yet (loading), or could not be determined: nothing is offered. */
  | "hidden"
  /** The caller may invite. */
  | "invite"
  /** The caller's role would allow it, but the workspace's plan does not. */
  | "upgrade"
  /** The caller's role does not allow managing the team (whatever the plan). */
  | "role_restricted";

export function teamInviteState(input: {
  role: WorkspaceRole | null | undefined;
  entitlement: TeamEntitlement | null | undefined;
}): TeamInviteState {
  if (!input.role || !input.entitlement) return "hidden";
  if (!canManageMembers(input.role)) return "role_restricted";
  if (input.entitlement.reason === "unavailable") return "hidden";
  return input.entitlement.allowed ? "invite" : "upgrade";
}
