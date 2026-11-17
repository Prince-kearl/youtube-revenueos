import { invitationState, type InvitationRow, type InvitationState } from "./workspace-invitations";

/** What the Team page is told about an invitation: never the token, its hash or compensation. */
export type PublicInvitation = {
  id: string;
  email: string;
  role: InvitationRow["role"];
  state: InvitationState;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export function publicInvitation(
  row: InvitationRow,
  inviterName: string | null = null,
): PublicInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    state: invitationState(row),
    invitedBy: inviterName,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}
