import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";
import { hashInviteToken, newInviteToken } from "./connect-invites";

// Shareable workspace invitations (table workspace_invitations, migration 202611170001).
//
// An owner or manager invites one email address to their workspace with a role. Tubify sends no
// email: the inviter shares the link themselves. The link carries a 256-bit random secret; only
// its SHA-256 hash is stored, and the secret is shown once (on create and on regenerate).
// Accepting needs a signed-in account whose CONFIRMED email (read from Supabase Auth) is the
// invited one, and happens in one database function (accept_workspace_invitation).
//
// Every function takes the service-role client and is given the workspace it acts on by its
// caller, which has already established the caller's membership and role.

export const INVITATION_TTL_DAYS = 7;
/** Open invitations a workspace may have at once. */
export const MAX_PENDING_INVITATIONS = 50;
/** Invitations (new or regenerated) a workspace may issue in an hour / a day. */
export const INVITATIONS_PER_HOUR = 20;
export const INVITATIONS_PER_DAY = 100;
export const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type InvitationStatus = "pending" | "accepted" | "revoked";
export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: "owner" | "manager" | "setter" | "editor";
  revenue_visible: boolean;
  lead_share: number;
  commission: number;
  job_title: string | null;
  cost_amount: number;
  status: InvitationStatus;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
}

export const INVITATION_COLUMNS =
  "id, workspace_id, email, role, revenue_visible, lead_share, commission, job_title, cost_amount, status, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at";

export { hashInviteToken as hashInvitationToken, newInviteToken as newInvitationToken };

export function invitationState(
  row: Pick<InvitationRow, "status" | "expires_at">,
  now = new Date(),
): InvitationState {
  if (row.status !== "pending") return row.status;
  return new Date(row.expires_at).getTime() <= now.getTime() ? "expired" : "pending";
}

export function invitationExpiry(now = new Date()): string {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000).toISOString();
}

/**
 * The link to share. The configured APP_URL (production), so a link is never made for whatever
 * host a request happened to arrive on — except on a local development server, whose own origin
 * is the only one that can serve the page there.
 */
export function invitationUrl(request: Request, token: string): string {
  const origin = new URL(request.url);
  const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  const base = local ? origin.origin : (getServerEnv("APP_URL") ?? origin.origin);
  return `${base.replace(/\/+$/, "")}/invite/${token}`;
}

/** "j***@gmail.com": enough for the recipient to know which account to use, shown before sign-in. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

/** The invitation a link's secret belongs to, or null (malformed or unknown). */
export async function loadInvitationByToken(
  service: SupabaseClient,
  token: string,
): Promise<InvitationRow | null> {
  if (!INVITATION_TOKEN.test(token)) return null;
  const { data, error } = await service
    .from("workspace_invitations")
    .select(INVITATION_COLUMNS)
    .eq("token_hash", await hashInviteToken(token))
    .maybeSingle();
  if (error) throw new Error("INVITATION_LOOKUP_FAILED");
  return (data as InvitationRow | null) ?? null;
}

/** How many invitations the workspace issued since `since` (new and regenerated alike are
 * recorded in audit_events). Errors count as "too many": the limit fails closed. */
export async function invitationsIssuedSince(
  service: SupabaseClient,
  workspaceId: string,
  since: Date,
): Promise<number> {
  const { data, error } = await service
    .from("audit_events")
    .select("id, metadata")
    .eq("resource_type", "workspace_invitation")
    .in("action", ["workspace_invitation.created", "workspace_invitation.regenerated"])
    .gte("created_at", since.toISOString())
    .limit(INVITATIONS_PER_DAY * 4);
  if (error) return Number.POSITIVE_INFINITY;
  return ((data ?? []) as Array<{ metadata: { workspaceId?: string } | null }>).filter(
    (row) => row.metadata?.workspaceId === workspaceId,
  ).length;
}

/** Whether the workspace may issue another invitation now. */
export async function invitationRateLimited(
  service: SupabaseClient,
  workspaceId: string,
  now = new Date(),
): Promise<boolean> {
  const [hour, day] = await Promise.all([
    invitationsIssuedSince(service, workspaceId, new Date(now.getTime() - 3_600_000)),
    invitationsIssuedSince(service, workspaceId, new Date(now.getTime() - 86_400_000)),
  ]);
  return hour >= INVITATIONS_PER_HOUR || day >= INVITATIONS_PER_DAY;
}

/**
 * An audit record of an invitation event. Never the token or its hash. Best effort for reads,
 * but its failure is reported to the caller, which decides (creation refuses without it, since
 * the rate limit counts these rows).
 */
export async function recordInvitationEvent(
  service: SupabaseClient,
  event: {
    action:
      | "workspace_invitation.created"
      | "workspace_invitation.regenerated"
      | "workspace_invitation.revoked"
      | "workspace_invitation.accepted";
    userId: string;
    invitationId: string;
    workspaceId: string;
    role?: string;
    outcome?: string;
  },
): Promise<boolean> {
  const { error } = await service.from("audit_events").insert({
    user_id: event.userId,
    action: event.action,
    resource_type: "workspace_invitation",
    resource_id: event.invitationId,
    metadata: {
      workspaceId: event.workspaceId,
      ...(event.role ? { role: event.role } : {}),
      ...(event.outcome ? { outcome: event.outcome } : {}),
    },
  });
  return !error;
}
