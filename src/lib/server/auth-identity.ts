import type { SupabaseClient } from "@supabase/supabase-js";

// Who an account is, according to Supabase Auth — looked up by its immutable user id. This is the
// only identity the admin and invitation routes act on: profiles.email can be rewritten by its
// owner (profiles_self_update does not protect it) and is never proof of anything.
//
// Three outcomes, kept apart so callers can fail closed without guessing:
//   found        the Auth account exists; `emailConfirmed` reflects email_confirmed_at, the
//                timestamp Auth sets only once the address itself has been verified (unlike
//                confirmed_at, which a phone confirmation alone also sets);
//   not_found    no Auth account with that id (or Auth answered for a different id);
//   unavailable  Auth could not be asked or gave an unexpected answer. Callers refuse the
//                action; the provider's message is never passed on.

export type AuthIdentity =
  | { status: "found"; id: string; email: string | null; emailConfirmed: boolean }
  | { status: "not_found" }
  | { status: "unavailable" };

export async function lookupAuthIdentity(
  service: SupabaseClient,
  userId: string,
): Promise<AuthIdentity> {
  try {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (error) return error.status === 404 ? { status: "not_found" } : { status: "unavailable" };
    const user = data?.user ?? null;
    if (!user || user.id !== userId) return { status: "not_found" };
    return {
      status: "found",
      id: user.id,
      email: user.email?.trim() || null,
      emailConfirmed: Boolean(user.email_confirmed_at),
    };
  } catch {
    return { status: "unavailable" };
  }
}
