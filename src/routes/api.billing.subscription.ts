import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { isStripeBillingAvailable } from "@/lib/server/stripe";
import { trustedLivemode } from "@/lib/server/stripe-mode";
import { activePriceFor, listPlans } from "@/lib/server/billing-plans";
import { getWorkspaceContext } from "@/lib/server/workspace";
import type { WorkspaceAccess } from "@/lib/plan-notice";

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
          // Only a subscription recorded in this deployment's mode is shown: a test or
          // unclassified one grants nothing (plan-access.ts), so it is not shown as one either.
          const livemode = trustedLivemode();
          const { data: subscription } =
            livemode === null
              ? { data: null }
              : await client
                  .from("subscriptions")
                  .select(
                    "plan_id, billing_interval, status, current_period_end, cancel_at_period_end, created_at",
                  )
                  .eq("user_id", user.id)
                  .eq("livemode", livemode)
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
              features: plan.features,
              monthlyPriceCents: monthly?.amountCents ?? null,
              annualPriceCents: annual?.amountCents ?? null,
              available: Boolean(monthly?.stripePriceId && annual?.stripePriceId),
            };
          });

          // The plan of the caller's WORKSPACE (its owner's subscription) — what decides access —
          // as opposed to the caller's own subscription above. Null for an account with no
          // workspace.
          let access: WorkspaceAccess | null = null;
          try {
            const ctx = await getWorkspaceContext(request, { requirePlan: false });
            access = {
              plan: ctx.plan.plan,
              status: ctx.plan.status,
              source: ctx.plan.source,
              periodEnd: ctx.plan.periodEnd,
              isOwner: ctx.workspaceRole === "owner",
            };
          } catch (error) {
            if (!(error instanceof Response)) throw error;
          }

          return json({
            data: {
              stripeConfigured: isStripeBillingAvailable(),
              subscription: subscription ?? null,
              plans,
              access,
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
