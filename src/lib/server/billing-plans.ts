import type { SupabaseClient } from "@supabase/supabase-js";

export type BillingInterval = "month" | "year";

export type PlanPrice = {
  id: string;
  planId: string;
  billingInterval: BillingInterval;
  amountCents: number;
  currency: string;
  stripePriceId: string | null;
  isActive: boolean;
};

export type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currency: string;
  features: string[];
  limits: Record<string, unknown>;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  stripeProductId: string | null;
  prices: PlanPrice[];
};

type PlanRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currency: string;
  features: unknown;
  limits: unknown;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  stripe_product_id: string | null;
  plan_prices?: PlanPriceRow[];
};
type PlanPriceRow = {
  id: string;
  plan_id: string;
  billing_interval: string;
  amount_cents: number;
  currency: string;
  stripe_price_id: string | null;
  is_active: boolean;
};

function mapPrice(row: PlanPriceRow): PlanPrice {
  return {
    id: row.id,
    planId: row.plan_id,
    billingInterval: row.billing_interval as BillingInterval,
    amountCents: row.amount_cents,
    currency: row.currency,
    stripePriceId: row.stripe_price_id,
    isActive: row.is_active,
  };
}

function mapPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    currency: row.currency,
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    limits: (row.limits as Record<string, unknown>) ?? {},
    isActive: row.is_active,
    isPublic: row.is_public,
    sortOrder: row.sort_order,
    stripeProductId: row.stripe_product_id,
    prices: (row.plan_prices ?? []).map(mapPrice),
  };
}

const PLAN_COLUMNS = "*, plan_prices(*)";

export async function listPlans(
  client: SupabaseClient,
  options: { publicOnly?: boolean } = {},
): Promise<Plan[]> {
  let query = client.from("plans").select(PLAN_COLUMNS).order("sort_order", { ascending: true });
  if (options.publicOnly) query = query.eq("is_active", true).eq("is_public", true);
  const { data, error } = await query;
  if (error) throw new Error("PLANS_QUERY_FAILED");
  return (data ?? []).map((row) => mapPlan(row as PlanRow));
}

export async function getPlanBySlug(client: SupabaseClient, slug: string): Promise<Plan | null> {
  const { data, error } = await client
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return mapPlan(data as PlanRow);
}

export async function getPlanById(client: SupabaseClient, id: string): Promise<Plan | null> {
  const { data, error } = await client
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return mapPlan(data as PlanRow);
}

export function activePriceFor(plan: Plan, interval: BillingInterval): PlanPrice | undefined {
  return plan.prices.find((p) => p.billingInterval === interval && p.isActive);
}

// Looks a Stripe price id back up to the Tubify plan it belongs to — checked against ALL prices,
// not just active ones, since a webhook for an existing subscriber may reference a price that has
// since been retired by a Superadmin price change. That subscriber keeps working normally; only
// new checkouts are steered to the current active price.
export async function findPlanByStripePriceId(
  client: SupabaseClient,
  stripePriceId: string,
): Promise<{ plan: Plan; price: PlanPrice } | null> {
  const { data, error } = await client
    .from("plan_prices")
    .select(`*, plan:plans(${PLAN_COLUMNS})`)
    .eq("stripe_price_id", stripePriceId)
    .maybeSingle();
  if (error || !data) return null;
  const planRow = (data as unknown as { plan: PlanRow }).plan;
  if (!planRow) return null;
  return { plan: mapPlan(planRow), price: mapPrice(data as PlanPriceRow) };
}
