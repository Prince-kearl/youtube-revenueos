import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";
import { retrievePrice, isStripeConfigured } from "@/lib/server/stripe";
import { logPlanAudit } from "@/lib/server/plan-audit";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

// One-time import for the three plans that predate this system, whose Stripe Prices were created
// manually and referenced only via env vars (STRIPE_PRICE_STARTER_MONTH etc). This makes only
// read-only Stripe calls (retrieving each existing price to learn its real amount/currency/
// product) — it never creates new Stripe objects, so running it is safe and reuses what's already
// there rather than duplicating it. Skips any plan whose slug already exists, so it's safe to
// call more than once.
const LEGACY_PLANS = [
  {
    slug: "starter",
    name: "Starter",
    description: "For new creators. Single-creator plan — team management not included.",
    sortOrder: 0,
    monthEnv: "STRIPE_PRICE_STARTER_MONTH",
    yearEnv: "STRIPE_PRICE_STARTER_YEAR",
    features: ["YouTube analytics", "Basic video insights", "1 channel", "5 AI analyses/month"],
  },
  {
    slug: "pro",
    name: "Pro",
    description: "For growing creators. Single-creator plan — team management not included.",
    sortOrder: 1,
    monthEnv: "STRIPE_PRICE_PRO_MONTH",
    yearEnv: "STRIPE_PRICE_PRO_YEAR",
    features: [
      "Advanced analytics",
      "AI insights",
      "3 channels",
      "50 AI analyses/month",
      "Revenue analytics",
      "Content opportunities",
    ],
  },
  {
    slug: "scale",
    name: "Scale",
    description: "For professional creators & agencies",
    sortOrder: 2,
    monthEnv: "STRIPE_PRICE_SCALE_MONTH",
    yearEnv: "STRIPE_PRICE_SCALE_YEAR",
    features: [
      "10+ channels",
      "250 AI analyses/month",
      "Advanced AI tools",
      "Creator growth tools",
      "Team management",
      "Manager, Editor & Setter roles",
      "Role & permission management",
      "Multi-user collaboration",
      "Premium support",
    ],
  },
] as const;

export const Route = createFileRoute("/api/admin/plans/seed-legacy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isStripeConfigured())
            return json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
          const { user } = await requirePermission(request, "manage_plans");
          // Admin authorization above runs on the session-bound client (subject to RLS), but plans/
          // plan_prices/plan_audit_log deliberately have no insert/update policy for regular
          // authenticated users — only the service-role client can write here, by design.
          const service = createServiceSupabaseClient();

          const results: Array<{
            slug: string;
            status: "created" | "skipped" | "failed";
            reason?: string;
          }> = [];

          for (const legacy of LEGACY_PLANS) {
            const { data: existing } = await service
              .from("plans")
              .select("id")
              .eq("slug", legacy.slug)
              .maybeSingle();
            if (existing) {
              results.push({ slug: legacy.slug, status: "skipped", reason: "already imported" });
              continue;
            }

            const monthPriceId = getServerEnv(legacy.monthEnv);
            const yearPriceId = getServerEnv(legacy.yearEnv);
            if (!monthPriceId || !yearPriceId) {
              results.push({
                slug: legacy.slug,
                status: "failed",
                reason: "env vars not configured",
              });
              continue;
            }

            try {
              const [monthPrice, yearPrice] = await Promise.all([
                retrievePrice(monthPriceId),
                retrievePrice(yearPriceId),
              ]);
              const productId = monthPrice.product;

              const { data: plan, error: planError } = await service
                .from("plans")
                .insert({
                  name: legacy.name,
                  slug: legacy.slug,
                  description: legacy.description,
                  currency: monthPrice.currency,
                  features: legacy.features,
                  is_active: true,
                  is_public: true,
                  sort_order: legacy.sortOrder,
                  stripe_product_id: productId,
                })
                .select()
                .single();
              if (planError || !plan) {
                results.push({ slug: legacy.slug, status: "failed", reason: "database error" });
                continue;
              }

              await service.from("plan_prices").insert([
                {
                  plan_id: plan.id,
                  billing_interval: "month",
                  amount_cents: monthPrice.unit_amount ?? 0,
                  currency: monthPrice.currency,
                  stripe_price_id: monthPrice.id,
                  is_active: true,
                },
                {
                  plan_id: plan.id,
                  billing_interval: "year",
                  amount_cents: yearPrice.unit_amount ?? 0,
                  currency: yearPrice.currency,
                  stripe_price_id: yearPrice.id,
                  is_active: true,
                },
              ]);

              await logPlanAudit(service, {
                adminUserId: user.id,
                action: "plan_imported_from_env",
                planId: plan.id,
                planName: plan.name,
                newValue: { monthPriceId, yearPriceId },
              });

              results.push({ slug: legacy.slug, status: "created" });
            } catch {
              results.push({ slug: legacy.slug, status: "failed", reason: "Stripe lookup failed" });
            }
          }

          return json({ data: { results } });
        } catch (error) {
          if (error instanceof Response) return error;
          console.error("Legacy plan import failed");
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
