import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { isStripeConfigured } from "@/lib/server/stripe";
import { activePriceFor, listPlans } from "@/lib/server/billing-plans";

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

export const Route = createFileRoute("/api/billing/subscription")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const { data: subscription } = await client
            .from("subscriptions")
            .select(
              "plan_id, billing_interval, status, current_period_end, cancel_at_period_end, created_at",
            )
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          // Public, unauthenticated-safe listing (RLS on plans/plan_prices allows anyone to read —
          // pricing isn't sensitive) filtered here to what's actually purchasable right now.
          // billing.tsx renders whatever comes back, so a Superadmin's plan/price edits show up
          // immediately without any frontend deploy.
          const allPlans = await listPlans(client, { publicOnly: true });
          const plans = allPlans.map((plan) => {
            const monthly = activePriceFor(plan, "month");
            const annual = activePriceFor(plan, "year");
            return {
              id: plan.slug,
              name: plan.name,
              description: plan.description,
              monthlyPriceCents: monthly?.amountCents ?? null,
              annualPriceCents: annual?.amountCents ?? null,
              available: Boolean(monthly?.stripePriceId && annual?.stripePriceId),
            };
          });

          return json({
            data: {
              stripeConfigured: isStripeConfigured(),
              subscription: subscription ?? null,
              plans,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
