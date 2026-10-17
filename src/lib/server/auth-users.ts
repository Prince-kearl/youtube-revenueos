import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthUserSummary = {
  id: string;
  banned_until?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
};

// auth.users (email confirmation, ban status, last sign-in, user_metadata) is only reachable
// through the Admin API, never through PostgREST — every place that needs to merge it with a
// profiles row goes through this same paginated fetch rather than re-implementing it.
export async function listAllAuthUsers(
  service: SupabaseClient,
): Promise<Map<string, AuthUserSummary>> {
  const byId = new Map<string, AuthUserSummary>();
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data.users) byId.set(u.id, u);
    if (data.users.length < 200) break;
    page += 1;
    if (page > 10) break; // hard stop — no pagination UI anywhere yet, 2000 users is plenty for now
  }
  return byId;
}

/** An account as Supabase Auth holds it — the authoritative identity. */
export type AuthIdentity = {
  id: string;
  /** The account's sign-in email, or null if it has none. */
  email: string | null;
  /** Whether Supabase Auth has confirmed that the account controls `email`. */
  emailConfirmed: boolean;
};

/** Supabase Auth could not be asked (as opposed to: it has no such account). */
export class AuthLookupError extends Error {
  constructor() {
    super("AUTH_LOOKUP_FAILED");
  }
}

/**
 * The account with this id, as Supabase Auth holds it, or null when Auth has no such account.
 * Anything that sends an authentication link or matches an account by email goes through this
 * — never profiles.email, which is a copy the account holder can edit.
 */
export async function getAuthIdentity(
  service: SupabaseClient,
  userId: string,
): Promise<AuthIdentity | null> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404) return null;
    throw new AuthLookupError();
  }
  const user = data?.user;
  if (!user || user.id !== userId) return null;
  return {
    id: user.id,
    email: user.email?.trim() || null,
    emailConfirmed: Boolean(user.email_confirmed_at),
  };
}

/** The same address, compared as Supabase Auth compares them (case-insensitively). */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}
