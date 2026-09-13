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
