import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { createPrice, isStripeConfigured } from "@/lib/server/stripe";
import { logPlanAudit } from "@/lib/server/plan-audit";

const bodySchema = z.object({
  planId: z.string().uuid(),
  billingInterval: z.enum(["month", "year"]),
  amountCents: z.number().int().min(0),
});

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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

// Stripe Prices are immutable — this always creates a brand-new Price and retires the old
// plan_prices row (marks it inactive; never deletes it), so subscribers already on the old price
// keep working exactly as before. Only new checkouts pick up the new price. See the migration's
// plan_prices_one_active_per_interval index, which is what makes "exactly one active price per
// plan+interval" a real database guarantee, not just an application convention.
export const Route = createFileRoute("/api/admin/plans/prices")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isStripeConfigured())
            return json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
          const { user } = await requirePermission(request, "manage_plans");
          const service = createServiceSupabaseClient();
          const input = bodySchema.parse(await parseJson(request));

          const { data: plan } = await service
            .from("plans")
            .select("id, name, stripe_product_id, currency")
            .eq("id", input.planId)
            .maybeSingle();
          if (!plan) return json({ error: "PLAN_NOT_FOUND" }, { status: 404 });
          if (!plan.stripe_product_id) {
            return json({ error: "PLAN_MISSING_STRIPE_PRODUCT" }, { status: 409 });
          }

          const { data: oldPrice } = await service
            .from("plan_prices")
            .select("id, amount_cents, stripe_price_id")
            .eq("plan_id", plan.id)
            .eq("billing_interval", input.billingInterval)
            .eq("is_active", true)
            .maybeSingle();

          let newStripePrice;
          try {
            newStripePrice = await createPrice({
              productId: plan.stripe_product_id,
              unitAmountCents: input.amountCents,
              currency: plan.currency,
              interval: input.billingInterval,
              planId: plan.id,
            });
          } catch {
            return json({ error: "STRIPE_PRICE_CREATE_FAILED" }, { status: 502 });
          }

          // Deactivate the old row before inserting the new active one — the partial unique index
          // only allows one active row per (plan, interval), so this order avoids a conflict.
          if (oldPrice) {
            await service.from("plan_prices").update({ is_active: false }).eq("id", oldPrice.id);
          }
          const { data: inserted, error: insertError } = await service
            .from("plan_prices")
            .insert({
              plan_id: plan.id,
              billing_interval: input.billingInterval,
              amount_cents: input.amountCents,
              currency: plan.currency,
              stripe_price_id: newStripePrice.id,
              is_active: true,
            })
            .select()
            .single();
          if (insertError) {
            // Best-effort revert so a DB failure doesn't leave the plan with zero active prices
            // for this interval.
            if (oldPrice) {
              await service.from("plan_prices").update({ is_active: true }).eq("id", oldPrice.id);
            }
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          await logPlanAudit(service, {
            adminUserId: user.id,
            action: `price_changed_${input.billingInterval}`,
            planId: plan.id,
            planName: plan.name,
            oldValue: oldPrice
              ? { amountCents: oldPrice.amount_cents, stripePriceId: oldPrice.stripe_price_id }
              : null,
            newValue: { amountCents: input.amountCents, stripePriceId: newStripePrice.id },
          });

          return json({ data: inserted }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          console.error("Admin price change failed");
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
