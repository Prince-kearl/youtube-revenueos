import type { SupabaseClient } from "@supabase/supabase-js";

// Admin-granted subscriptions (supabase/migrations/202611080001_subscription_grants.sql): a paid
// plan given by platform staff for a number of days, or with no end, without payment. No Stripe.
//
// A grant counts while it is active and its end (if any) is still ahead — checked here at read
// time, so access ends exactly when the grant does; the daily sweep only records the expiry.
// Every read and write uses the service-role client (the tables have no policies: no browser
// session can see them), and the reason and granting admin are never returned to the user.
//
// No module imports beyond the Supabase types, so plan-access.ts and subscription-tier.ts can use
// it without growing their import graphs.

export const GRANT_PLANS = ["starter", "pro", "scale"] as const;
export type GrantPlan = (typeof GRANT_PLANS)[number];

/** The longest fixed grant: ten years. Longer than that is "lifetime". */
export const MAX_GRANT_DAYS = 3650;

export interface ActiveGrant {
  id: string;
  plan: GrantPlan;
  /** null = no end. */
  expiresAt: string | null;
}

export type GrantRead =
  | { ok: true; grant: ActiveGrant | null }
  /** The grant could not be read. The caller decides whether that is "unavailable". */
  | { ok: false };

// The table does not exist (the migration is not applied yet): no one has a grant. Any other
// error is reported as unreadable.
function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*subscription_grants.* does not exist/i.test(error.message ?? "")
  );
}

function isGrantPlan(value: unknown): value is GrantPlan {
  return typeof value === "string" && (GRANT_PLANS as readonly string[]).includes(value);
}

/** The user's active grant, whose end (if any) is after `now`. */
export async function readActiveGrant(
  service: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<GrantRead> {
  try {
    const { data, error } = await service
      .from("subscription_grants")
      .select("id, plan_id, expires_at, starts_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return missingTable(error) ? { ok: true, grant: null } : { ok: false };
    if (!data || !isGrantPlan(data.plan_id)) return { ok: true, grant: null };
    // At most one grant is active (a unique index); it counts from its start until its end.
    const startsAt = Date.parse(data.starts_at as string);
    const expiresAt = data.expires_at ? Date.parse(data.expires_at as string) : null;
    if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return { ok: true, grant: null };
    if (expiresAt !== null && !(expiresAt > now.getTime())) return { ok: true, grant: null };
    return {
      ok: true,
      grant: {
        id: data.id as string,
        plan: data.plan_id,
        expiresAt: (data.expires_at as string | null) ?? null,
      },
    };
  } catch {
    return { ok: false };
  }
}

/** The end of a grant of `days` days from `now`, or null for no end. */
export function grantEnd(duration: { days: number } | "lifetime", from: Date): string | null {
  if (duration === "lifetime") return null;
  return new Date(from.getTime() + duration.days * 86_400_000).toISOString();
}

export type GrantActionError =
  | "ACTIVE_GRANT_EXISTS"
  | "GRANT_NOT_FOUND"
  | "GRANT_ALREADY_LIFETIME"
  | "GRANT_NOT_LATER"
  | "GRANT_END_IN_PAST"
  | "GRANTS_NOT_AVAILABLE"
  | "DATABASE_ERROR";

/** Maps a database error from the grant functions to the API's error code. */
export function grantActionError(error: { code?: string; message?: string }): GrantActionError {
  const message = error.message ?? "";
  if (error.code === "23505") return "ACTIVE_GRANT_EXISTS";
  for (const code of [
    "GRANT_NOT_FOUND",
    "GRANT_ALREADY_LIFETIME",
    "GRANT_NOT_LATER",
    "GRANT_END_IN_PAST",
  ] as const)
    if (message.includes(code)) return code;
  if (error.code === "P0002") return "GRANT_NOT_FOUND";
  // The functions are not there: the migration has not been applied.
  if (error.code === "42883" || error.code === "PGRST202" || missingTable(error))
    return "GRANTS_NOT_AVAILABLE";
  return "DATABASE_ERROR";
}

/**
 * The daily sweep: records grants whose end has passed as expired (their access already ended at
 * that moment). Best effort, for the cron: never throws; returns how many it recorded, or null.
 */
export async function expireSubscriptionGrants(service: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await service.rpc("expire_subscription_grants");
    if (error) return null;
    return typeof data === "number" ? data : null;
  } catch {
    return null;
  }
}
