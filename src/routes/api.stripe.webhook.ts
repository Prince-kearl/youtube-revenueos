import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  constructWebhookEvent,
  retrieveSubscription,
  StripeSignatureError,
  type StripeCheckoutSessionObject,
  type StripeInvoiceObject,
  type StripeSubscriptionObject,
} from "@/lib/server/stripe";
import { findPlanByStripePriceId } from "@/lib/server/billing-plans";

// 20% recurring commission, matching what the Affiliate Program page has always advertised — the
// one number in this whole feature that was already a real product decision rather than filler,
// so it's kept as the actual rate real commissions are computed at.
const COMMISSION_RATE = 0.2;

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

type SupabaseServiceClient = ReturnType<typeof createServiceSupabaseClient>;

async function upsertSubscriptionRow(
  service: SupabaseServiceClient,
  userId: string,
  subscription: StripeSubscriptionObject,
) {
  const priceId = subscription.items.data[0]?.price.id;
  const match = priceId ? await findPlanByStripePriceId(service, priceId) : null;
  if (!match) {
    console.warn("Stripe webhook: subscription price id not mapped to a known plan", { priceId });
    return;
  }
  // subscriptions.plan_id stores the plan SLUG (not the plans.id uuid) — kept loosely coupled to
  // the plans table rather than a foreign key, since a subscriber's row must stay valid even if
  // the plan is later renamed/deactivated/deleted from Superadmin; the slug is a stable label.
  await service.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan_id: match.plan.slug,
      billing_interval: match.price.billingInterval,
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
    { onConflict: "stripe_subscription_id" },
  );
}

// Commission only ever accrues from a real paid invoice for a real referred user — never
// estimated from a subscription price or backdated for signups before the referral was recorded.
async function recordCommissionIfReferred(
  service: SupabaseServiceClient,
  invoice: StripeInvoiceObject,
) {
  if (invoice.status !== "paid" || invoice.amount_paid <= 0) return;
  const { data: payer } = await service
    .from("profiles")
    .select("id, referred_by")
    .eq("stripe_customer_id", invoice.customer)
    .maybeSingle();
  if (!payer?.referred_by) return;

  await service.from("referral_commissions").upsert(
    {
      referrer_id: payer.referred_by,
      referred_user_id: payer.id,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency,
      commission_cents: Math.round(invoice.amount_paid * COMMISSION_RATE),
      status: "pending",
    },
    { onConflict: "stripe_invoice_id", ignoreDuplicates: true },
  );
}

// Only source of truth for who paid Tubify what — every write here comes from a signature-
// verified Stripe event, never from the client, since this directly determines subscription
// access and (once built) affiliate commission amounts.
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        let event;
        try {
          event = await constructWebhookEvent(rawBody, request.headers.get("stripe-signature"));
        } catch (error) {
          if (error instanceof StripeSignatureError) {
            console.warn("Stripe webhook signature verification failed", { reason: error.message });
            return json({ error: "INVALID_SIGNATURE" }, { status: 400 });
          }
          return json({ error: "INVALID_PAYLOAD" }, { status: 400 });
        }

        const service = createServiceSupabaseClient();
        try {
          if (event.type === "checkout.session.completed") {
            const session = event.data.object as unknown as StripeCheckoutSessionObject;
            const userId = session.client_reference_id;
            if (!userId) {
              console.warn("Stripe webhook: checkout session missing client_reference_id");
              return json({ received: true });
            }
            if (session.customer) {
              await service
                .from("profiles")
                .update({ stripe_customer_id: session.customer })
                .eq("id", userId);
            }
            if (session.subscription) {
              const subscription = await retrieveSubscription(session.subscription);
              await upsertSubscriptionRow(service, userId, subscription);
            }
          } else if (
            event.type === "customer.subscription.updated" ||
            event.type === "customer.subscription.deleted"
          ) {
            const subscription = event.data.object as unknown as StripeSubscriptionObject;
            const userId = subscription.metadata?.user_id;
            if (userId) {
              await upsertSubscriptionRow(service, userId, subscription);
            } else {
              // Subscriptions created outside our own Checkout flow (or predating this metadata
              // field) won't carry user_id — fall back to the row we already have on file.
              const { data: existing } = await service
                .from("subscriptions")
                .select("user_id")
                .eq("stripe_subscription_id", subscription.id)
                .maybeSingle();
              if (existing) await upsertSubscriptionRow(service, existing.user_id, subscription);
              else
                console.warn("Stripe webhook: subscription update for unknown user", {
                  subscriptionId: subscription.id,
                });
            }
          } else if (event.type === "invoice.paid") {
            const invoice = event.data.object as unknown as StripeInvoiceObject;
            await recordCommissionIfReferred(service, invoice);
          }
          return json({ received: true });
        } catch (error) {
          console.error("Stripe webhook handling failed", {
            type: event.type,
            reason: error instanceof Error ? error.message : "unknown",
          });
          // 500 so Stripe retries — the event may just have hit a transient DB error.
          return json({ error: "WEBHOOK_HANDLER_FAILED" }, { status: 500 });
        }
      },
    },
  },
});
