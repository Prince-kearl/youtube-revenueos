import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createCheckoutSession, isStripeConfigured } from "@/lib/server/stripe";
import { activePriceFor, getPlanBySlug } from "@/lib/server/billing-plans";

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
          if (!isStripeConfigured())
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

          const { data: profile } = await client
            .from("profiles")
            .select("stripe_customer_id, email")
            .eq("id", user.id)
            .maybeSingle();

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
          });
          if (!session.url) return json({ error: "STRIPE_CHECKOUT_FAILED" }, { status: 502 });
          return json({ data: { url: session.url } });
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
