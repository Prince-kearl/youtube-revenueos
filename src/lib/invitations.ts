// Sharing a workspace invitation link (the Team page) and describing invitation states. Pure and
// browser-safe, so every message and URL is unit-tested. Tubify sends no email: the person
// inviting shares the link themselves, through any app.

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};

export function invitationMessage(url: string): string {
  return (
    "Hi! You've been invited to join my Tubify workspace. Use the link below to accept your " +
    `invitation and access your assigned YouTube workspace:\n\n${url}`
  );
}

export const INVITATION_EMAIL_SUBJECT = "Your invitation to my Tubify workspace";

/** WhatsApp's share link, with the message prefilled (the person picks the chat). */
export function whatsappShareUrl(url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(invitationMessage(url))}`;
}

/** Opens the person's own email app with the message ready; `to` is the invited address. */
export function mailtoShareUrl(url: string, to: string): string {
  const params = `subject=${encodeURIComponent(INVITATION_EMAIL_SUBJECT)}&body=${encodeURIComponent(invitationMessage(url))}`;
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${params}`;
}

/** The path an invitation link opens, and the one sign-in and sign-up return to. */
export function invitationPath(token: string): string {
  return `/invite/${token}`;
}

/** Whether a post-sign-in destination is an invitation (it then skips the YouTube step). */
export function isInvitationPath(path: string | null | undefined): boolean {
  return /^\/invite\/[A-Za-z0-9_-]{43}$/.test(path ?? "");
}

/**
 * Remembers where to go after a Google sign-in (read by /auth/callback, which only ever sends
 * people to a safe app page). Short-lived; the invitation link itself still works afterwards.
 */
export function rememberPostLoginPath(path: string): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `post_login_next=${encodeURIComponent(path)}; Path=/; Max-Age=1800; SameSite=Lax${secure}`;
}
