// Who may see money in a workspace. Pure (no database, no React), shared by the server — which
// enforces it — and the pages, which use it only to choose what to render.
//
// "Revenue" here means the workspace's business figures: YouTube estimated revenue and its ad /
// Premium split, RPM and CPM, revenue totals and trends, and brand-deal values.
//
//   owner, manager      always
//   editor, setter      only when the workspace has switched it on for that role (default: off)
//   platform superadmin always, in a workspace they are an active member of
//
// It is a setting of the WORKSPACE, per role. There are no per-member overrides.
//
// What this does NOT cover, on purpose: teammates' lead share, commission and cost. Those are
// compensation, they are stricter, and they keep their own rules (canViewCompensation in
// team-policy.ts). Switching revenue on for editors never shows them anyone's pay.

import type { WorkspaceRole } from "./team-policy";

/** The stored setting: which of the two configurable roles may see revenue. */
export interface RevenueVisibilitySettings {
  editor: boolean;
  setter: boolean;
}

/** What applies when nothing is stored, or the stored value cannot be read. */
export const DEFAULT_REVENUE_VISIBILITY: RevenueVisibilitySettings = {
  editor: false,
  setter: false,
};

/** The roles whose visibility a workspace can configure. Owners and managers are not on it. */
export const CONFIGURABLE_REVENUE_ROLES = ["editor", "setter"] as const;
export type ConfigurableRevenueRole = (typeof CONFIGURABLE_REVENUE_ROLES)[number];

export interface RevenueViewer {
  /** The caller's role in THIS workspace, from their active membership. */
  role: WorkspaceRole | null | undefined;
  /** Platform staff (profiles.role = "superadmin"), already a member of this workspace. */
  isSuperadmin?: boolean;
}

/** Whether this member may see revenue amounts in the workspace. Anything unrecognised is no. */
export function canViewWorkspaceRevenue(
  viewer: RevenueViewer,
  settings: RevenueVisibilitySettings | null | undefined,
): boolean {
  // Without a role there is no membership, and the staff exception presupposes one.
  if (!viewer.role) return false;
  if (viewer.isSuperadmin === true) return true;
  if (viewer.role === "owner" || viewer.role === "manager") return true;
  if (viewer.role === "editor") return settings?.editor === true;
  if (viewer.role === "setter") return settings?.setter === true;
  return false;
}

/**
 * Whether this member may create, change or remove a revenue amount (a deal's value).
 *
 * Nobody may write an amount they are not allowed to see: that would be a blind overwrite — and
 * setting one to 0, clearing it or deleting the deal that holds it are all writes. So this is
 * never true without canViewWorkspaceRevenue. It is deliberately a separate function: being able
 * to see amounts is necessary for writing them, and whatever else a route requires (its feature
 * gate, its own role rules) still applies on top.
 */
export function canWriteWorkspaceRevenue(
  viewer: RevenueViewer,
  settings: RevenueVisibilitySettings | null | undefined,
): boolean {
  return canViewWorkspaceRevenue(viewer, settings);
}

// ---------- deal stages that carry financial meaning ----------
//
// A deal's stage is ordinary pipeline data — until it says money is agreed or earned. Moving a
// deal into "contracted" or "completed" puts its value into the contracted and closed totals;
// moving it out takes it away again (and leaving "completed" clears its close date for good).
// Someone who may not see the deal's value cannot know what either move does to those totals —
// the value may be real, or the 0 a deal starts with when nobody has entered one — so they may
// do neither. The rule is about the CALLER's access (canWriteWorkspaceRevenue). It never looks
// at the deal's value.

/** The stages in which a deal counts toward contracted or closed revenue. */
export const FINANCIAL_DEAL_STAGES = ["contracted", "completed"] as const;

export function isFinancialDealStage(stage: string | null | undefined): boolean {
  return (FINANCIAL_DEAL_STAGES as readonly string[]).includes(stage ?? "");
}

/**
 * Whether setting a deal's stage to `next` needs revenue access.
 *
 *   `current`  the deal's stage now, or null when the deal is being created
 *   `next`     the stage the request asks for, or undefined when it does not mention the stage
 *
 * Asking for the stage the deal already has is not a change, so editing other fields of a
 * contracted or completed deal stays open to everyone who could edit it before — whether or not
 * the request repeats the stage. Any real change that enters OR leaves a financial stage needs
 * the access.
 */
export function dealStageChangeNeedsRevenueAccess(
  current: string | null,
  next: string | undefined,
): boolean {
  if (next === undefined || next === current) return false;
  return isFinancialDealStage(next) || isFinancialDealStage(current);
}

/** Whether this member may change the workspace's revenue visibility. Editors and setters never
 * can — including when they have been allowed to see revenue. */
export function canManageRevenueVisibility(viewer: RevenueViewer): boolean {
  if (!viewer.role) return false;
  if (viewer.isSuperadmin === true) return true;
  return viewer.role === "owner" || viewer.role === "manager";
}

// ---------- how a hidden amount is represented ----------
//
// Three different things must stay different everywhere:
//
//   0        the amount is known and it is zero
//   null     the amount is not available (not reported, not stored)
//   hidden   the amount exists but this viewer may not see it
//
// A hidden amount is sent as null TOGETHER WITH an explicit marker, never as 0 and never as a
// bare null.

/** The error code of a financial endpoint that refuses a viewer outright. */
export const REVENUE_HIDDEN_ERROR = "REVENUE_HIDDEN";

/** What a page prints in place of a hidden amount. */
export const HIDDEN_AMOUNT_TEXT = "Hidden";

/** The one sentence shown wherever amounts are hidden. */
export const REVENUE_HIDDEN_MESSAGE = "Revenue hidden by workspace settings";

/** Carried by every response whose amounts depend on the viewer. */
export interface RevenueVisibilityMarker {
  revenue: "visible" | "hidden";
}
export const REVENUE_VISIBLE: RevenueVisibilityMarker = { revenue: "visible" };
export const REVENUE_HIDDEN: RevenueVisibilityMarker = { revenue: "hidden" };

/** True when a response says its amounts were withheld from this viewer. A response without a
 * marker (an older deployment, or demo data) is read as visible. */
export function isRevenueHidden(
  response: { visibility?: RevenueVisibilityMarker | null } | null | undefined,
): boolean {
  return response?.visibility?.revenue === "hidden";
}
