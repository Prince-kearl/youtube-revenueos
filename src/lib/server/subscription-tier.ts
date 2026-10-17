import type { SupabaseClient } from "@supabase/supabase-js";
import { trustedLivemode } from "./stripe-mode";

// A user's OWN subscription tier: their latest active or trialing subscription's plan, or "free".
// Kept in a module with no other imports (but stripe-mode.ts, which reads the environment only)
// so the modules that need it (the team entitlement, the AI burst limit) can share it without pulling each other — or the AI provider code — into every
// route's import graph. Plan ACCESS is a workspace's, decided in plan-access.ts.

export const PLAN_TIERS = ["free", "starter", "pro", "scale"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

const DEFAULT_TIER: PlanTier = "free";

function isKnownTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

// Real plan lookup — reuses the same subscriptions/plans tables billing.tsx and the admin
// dashboard already read, rather than inventing a parallel "current plan" concept. Any doubt
// (an error, an unknown plan) is "free".
export async function resolvePlanTier(service: SupabaseClient, userId: string): Promise<PlanTier> {
  // Only a subscription recorded in this deployment's mode gives a tier — a test or unclassified
  // one never does, so it can never unlock team management either. In production with a non-live
  // key none does (stripe-mode.ts).
  const livemode = trustedLivemode();
  if (livemode === null) return DEFAULT_TIER;
  try {
    const { data: sub } = await service
      .from("subscriptions")
      .select("plan_id, status")
      .eq("user_id", userId)
      .eq("livemode", livemode)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return DEFAULT_TIER;
    return isKnownTier(sub.plan_id as string) ? (sub.plan_id as PlanTier) : DEFAULT_TIER;
  } catch {
    return DEFAULT_TIER;
  }
}
