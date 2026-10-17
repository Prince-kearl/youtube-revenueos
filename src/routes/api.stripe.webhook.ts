import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  constructWebhookEvent,
  retrieveSubscription,
  StripeRequestError,
  StripeSignatureError,
  subscriptionPeriodEnd,
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

// Supabase reports a failed query in its result instead of throwing. Every write and lookup here
// goes through this, so a failure reaches the handler's catch and is answered with a 500 — which
// makes Stripe deliver the event again — instead of a 200 that marks it delivered while the
// subscription was never recorded (a customer who paid and has no access, with nothing to retry).
function ensureOk<T extends { error: { code?: string; message?: string } | null }>(
  result: T,
  step: string,
): T {
  if (result.error) throw new Error(`${step}:${result.error.code ?? "unknown"}`);
  return result;
}

// A subscription in one of these states is over for good: Stripe never moves it anywhere else.
const FINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * The subscription as Stripe holds it NOW. Stripe does not deliver events in order, so an event's
 * snapshot can be older than one already applied — writing it would put a canceled subscription
 * back to "active", or a renewed one back to "past_due". Reading the subscription again makes
 * every delivery, in any order and any number of times, write the same current state.
 *
 * A subscription Stripe no longer returns (404) is taken from the event only when the event
 * records a final state, which nothing later can undo. Anything else that cannot be read — a
 * missing subscription in a live state, Stripe unavailable — fails the delivery, so Stripe sends
 * it again rather than Tubify recording a state it could not confirm.
 */
async function currentSubscription(
  snapshot: StripeSubscriptionObject,
): Promise<StripeSubscriptionObject> {
  try {
    return await retrieveSubscription(snapshot.id);
  } catch (error) {
    if (
      error instanceof StripeRequestError &&
      error.status === 404 &&
      FINAL_STATUSES.has(snapshot.status)
    )
      return snapshot;
    throw error;
  }
}

/**
 * Records `subscription` — its own row, matched by its Stripe id and nothing else, so an event
 * about one subscription (a customer's old, canceled one) never touches another (their current
 * one). The row's owner is fixed when it is first recorded: `candidateUserId` (the checkout's user,
 * or the subscription's metadata) only names the owner of a subscription not on file yet, and a
 * later event can never move a recorded subscription — and the plan it grants — to another user.
 */
async function upsertSubscriptionRow(
  service: SupabaseServiceClient,
  candidateUserId: string | null,
  subscription: StripeSubscriptionObject,
) {
  const { data: existing } = ensureOk(
    await service
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle(),
    "SUBSCRIPTION_LOOKUP_FAILED",
  );
  const recordedOwner = (existing?.user_id as string | undefined) ?? null;
  if (recordedOwner && candidateUserId && recordedOwner !== candidateUserId)
    console.warn("Stripe webhook: subscription names another user; its recorded owner is kept", {
      subscriptionId: subscription.id,
    });
  const userId = recordedOwner ?? candidateUserId;
  if (!userId) {
    // Not ours to attribute: no recorded owner, and nothing naming one.
    console.warn("Stripe webhook: subscription update for unknown user", {
      subscriptionId: subscription.id,
    });
    return;
  }
  const priceId = subscription.items.data[0]?.price.id;
  const match = priceId ? await findPlanByStripePriceId(service, priceId) : null;
  if (!match) {
    console.warn("Stripe webhook: subscription price id not mapped to a known plan", { priceId });
    return;
  }
  const periodEnd = subscriptionPeriodEnd(subscription);
  // subscriptions.plan_id stores the plan SLUG (not the plans.id uuid) — kept loosely coupled to
  // the plans table rather than a foreign key, since a subscriber's row must stay valid even if
  // the plan is later renamed/deactivated/deleted from Superadmin; the slug is a stable label.
  ensureOk(
    await service.from("subscriptions").upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        plan_id: match.plan.slug,
        billing_interval: match.price.billingInterval,
        status: subscription.status,
        current_period_end: periodEnd === null ? null : new Date(periodEnd * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
      { onConflict: "stripe_subscription_id" },
    ),
    "SUBSCRIPTION_WRITE_FAILED",
  );
}

// Commission only ever accrues from a real paid invoice for a real referred user — never
// estimated from a subscription price or backdated for signups before the referral was recorded.
async function recordCommissionIfReferred(
  service: SupabaseServiceClient,
  invoice: StripeInvoiceObject,
) {
  if (invoice.status !== "paid" || invoice.amount_paid <= 0) return;
  const { data: payer } = ensureOk(
    await service
      .from("profiles")
      .select("id, referred_by")
      .eq("stripe_customer_id", invoice.customer)
      .maybeSingle(),
    "PAYER_LOOKUP_FAILED",
  );
  if (!payer?.referred_by) return;

  ensureOk(
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
    ),
    "COMMISSION_WRITE_FAILED",
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
              ensureOk(
                await service
                  .from("profiles")
                  .update({ stripe_customer_id: session.customer })
                  .eq("id", userId),
                "CUSTOMER_WRITE_FAILED",
              );
            }
            if (session.subscription) {
              const subscription = await retrieveSubscription(session.subscription);
              await upsertSubscriptionRow(service, userId, subscription);
            }
          } else if (
            event.type === "customer.subscription.updated" ||
            event.type === "customer.subscription.deleted"
          ) {
            // Never the event's own snapshot: the subscription as it is now (see above).
            const subscription = await currentSubscription(
              event.data.object as unknown as StripeSubscriptionObject,
            );
            // Subscriptions created outside our own Checkout flow (or predating this metadata
            // field) carry no user_id: the recorded owner, if any, is used (see upsertSubscriptionRow).
            await upsertSubscriptionRow(
              service,
              subscription.metadata?.user_id ?? null,
              subscription,
            );
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
