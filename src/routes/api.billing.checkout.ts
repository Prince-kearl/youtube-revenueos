import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import {
  createCheckoutSession,
  isStripeBillingAvailable,
  listCustomerSubscriptions,
} from "@/lib/server/stripe";
import { activePriceFor, getPlanBySlug } from "@/lib/server/billing-plans";
import { TRIAL_DAYS } from "@/lib/server/plan-access";

// One subscription per customer. A new Checkout session always creates a NEW subscription, so a
// customer who already has one would be billed twice. Checkout is therefore refused (409, with
// "use Manage billing" as the way to change or renew a plan) while any subscription is:
//
//   active, trialing        live — it is billing, or will
//   past_due, unpaid        live — Stripe is still collecting it; paying it renews it
//   incomplete, paused      pending — its first payment is still being confirmed, or it can
//                           resume; a second one could start billing beside it
//
// "canceled" and "incomplete_expired" are over for good and do not block. Both Tubify's record
// and Stripe's own are checked: the record can miss a subscription (a webhook not yet delivered,
// or one created in Stripe directly), and Stripe is asked only when the user already has a Stripe
// customer — a first purchase costs no extra request. When either cannot be read, checkout is
// refused (503): never a guess that could charge twice.
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid"] as const;
const PENDING_STATUSES = ["incomplete", "paused"] as const;
const BLOCKING_STATUSES: readonly string[] = [...LIVE_STATUSES, ...PENDING_STATUSES];
// The introductory trial (TRIAL_DAYS, 14): one per customer, for their FIRST subscription only.
// A customer who has ever had a subscription — in Tubify's record or in Stripe's, in any state:
// trialing, active, canceled during or after a trial, expired — gets Checkout without a trial, so
// a trial cannot be had again by canceling and resubscribing, by choosing another plan, or by
// opening Checkout twice. The same reads the duplicate check makes decide it; nothing new is
// stored. (Stripe's list is asked only for a user who already has a Stripe customer — one without
// has never completed a Checkout, so has never had a subscription.)

// The local record cannot hold "paused" (not a value of public.subscription_status): asking for
// it would fail the query, so only Stripe's own list is checked for it.
const RECORDED_BLOCKING_STATUSES = BLOCKING_STATUSES.filter((status) => status !== "paused");

function existingSubscriptionError(statuses: readonly string[]): Response | null {
  const blocking = statuses.filter((status) => BLOCKING_STATUSES.includes(status));
  if (blocking.length === 0) return null;
  const live = blocking.some((status) => (LIVE_STATUSES as readonly string[]).includes(status));
  return json(
    live
      ? {
          error: "SUBSCRIPTION_EXISTS",
          message: "You already have a subscription. Use Manage billing to change or renew it.",
        }
      : {
          error: "SUBSCRIPTION_PENDING",
          message:
            "Your last subscription is still being confirmed. Use Manage billing to complete or cancel it.",
        },
    { status: 409 },
  );
}

const BILLING_STATE_UNAVAILABLE = () =>
  json(
    {
      error: "BILLING_STATE_UNAVAILABLE",
      message: "We couldn't check your current subscription. Please try again in a moment.",
    },
    { status: 503 },
  );

const bodySchema = z.object({
  planId: z.string().trim().min(1).max(60),
  interval: z.enum(["month", "year"]),
  referralCode: z.string().trim().max(60).nullable().optional(),
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

export const Route = createFileRoute("/api/billing/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isStripeBillingAvailable())
            return json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
          const { client, user } = await requireSessionUser(request);
          const input = bodySchema.parse(await parseJson(request));

          // Never trust a Stripe price id from the browser — resolve it server-side from the
          // plan slug + interval the client sent, and refuse anything that isn't currently
          // purchasable (active + public), even if the plan/price rows still exist for historical
          // subscribers.
          const plan = await getPlanBySlug(client, input.planId);
          if (!plan || !plan.isActive || !plan.isPublic) {
            return json({ error: "PLAN_NOT_AVAILABLE" }, { status: 404 });
          }
          const price = activePriceFor(plan, input.interval);
          if (!price?.stripePriceId) {
            return json({ error: "STRIPE_PRICE_NOT_CONFIGURED" }, { status: 503 });
          }
          const priceId = price.stripePriceId;

          // The caller's own billing state, through their session (row-level security: their
          // own profile and subscription rows only).
          const { data: profile, error: profileError } = await client
            .from("profiles")
            .select("stripe_customer_id, email")
            .eq("id", user.id)
            .maybeSingle();
          if (profileError) return BILLING_STATE_UNAVAILABLE();
          // Every subscription on record, in any state: the live ones block a second one, and
          // any at all means the introductory trial has been used.
          const { data: recorded, error: recordedError } = await client
            .from("subscriptions")
            .select("status")
            .eq("user_id", user.id);
          if (recordedError) return BILLING_STATE_UNAVAILABLE();
          const recordedStatuses = (recorded ?? []).map((row) => row.status as string);
          const local = existingSubscriptionError(
            recordedStatuses.filter((status) => RECORDED_BLOCKING_STATUSES.includes(status)),
          );
          if (local) return local;
          let held: Array<{ status: string }> = [];
          if (profile?.stripe_customer_id) {
            try {
              held = await listCustomerSubscriptions(profile.stripe_customer_id);
            } catch {
              return BILLING_STATE_UNAVAILABLE();
            }
            const remote = existingSubscriptionError(
              held.map((subscription) => subscription.status),
            );
            if (remote) return remote;
          }
          const trialEligible = recordedStatuses.length === 0 && held.length === 0;

          const origin = new URL(request.url).origin;
          const session = await createCheckoutSession({
            priceId,
            userId: user.id,
            customerId: profile?.stripe_customer_id ?? null,
            customerEmail: profile?.stripe_customer_id
              ? null
              : (profile?.email ?? user.email ?? null),
            successUrl: `${origin}/settings?checkout=success`,
            cancelUrl: `${origin}/billing`,
            referralCode: input.referralCode ?? null,
            trialDays: trialEligible ? TRIAL_DAYS : null,
          });
          if (!session.url) return json({ error: "STRIPE_CHECKOUT_FAILED" }, { status: 502 });
          return json({ data: { url: session.url, trialDays: trialEligible ? TRIAL_DAYS : 0 } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          console.error("Stripe checkout session creation failed");
          return json({ error: "STRIPE_CHECKOUT_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
