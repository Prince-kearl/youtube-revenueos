// What the admin sees when a complimentary-plan request fails (SubscriptionGrantPanel): each error
// code from /api/admin/subscription-grants in plain words, and the code itself for anything else —
// so a failure is never an unexplained "Something went wrong".

const ERRORS: Record<string, string> = {
  ACTIVE_GRANT_EXISTS: "This user already has a complimentary plan. Extend or revoke it instead.",
  PAID_SUBSCRIPTION_EXISTS:
    "This user already pays for a subscription, so a complimentary plan can't be added.",
  SELF_GRANT_NOT_ALLOWED: "You can't grant a plan to your own account.",
  GRANT_NOT_FOUND: "That plan is no longer active. Refresh to see its current state.",
  GRANT_ALREADY_LIFETIME: "This plan already has no end.",
  GRANT_NOT_LATER: "The new end must be later than the current one.",
  GRANT_END_IN_PAST: "The end date must be in the future.",
  GRANTS_NOT_AVAILABLE: "Complimentary plans aren't set up on this server yet.",
  USER_NOT_FOUND: "This user no longer exists.",
  VALIDATION_ERROR: "Check the details and try again.",
  ADMIN_REQUIRED: "You don't have permission to do this.",
  PERMISSION_REQUIRED: "You don't have permission to manage billing.",
  AUTH_REQUIRED: "Your session has expired. Sign in again, then try once more.",
  ROLE_REQUIRED: "You don't have permission to do this.",
  INVALID_JSON: "The request couldn't be read. Refresh the page and try again.",
  DATABASE_ERROR: "The database didn't accept that just now. Please try again in a moment.",
  SERVER_MISCONFIGURED: "The server couldn't complete that. Please try again in a moment.",
};

/** The message for a failed request: its own wording, or the code itself when it has none. */
export function grantErrorMessage(code: string | undefined, status: number): string {
  if (code && ERRORS[code]) return ERRORS[code];
  return `Something went wrong (${code || `HTTP ${status}`}). Please try again.`;
}
