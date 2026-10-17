import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createPortalSession, isStripeBillingAvailable } from "@/lib/server/stripe";
import { billingLivemode, customerIdColumn } from "@/lib/server/stripe-mode";

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

export const Route = createFileRoute("/api/billing/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isStripeBillingAvailable())
            return json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
          const { client, user } = await requireSessionUser(request);
          // The customer id of the mode this deployment's key bills in: a test customer is never
          // sent to the live API, nor a live one to the test API.
          const column = customerIdColumn(billingLivemode());
          const { data: profile } = await client
            .from("profiles")
            .select(column)
            .eq("id", user.id)
            .maybeSingle();
          const customerId = (profile as Record<string, unknown> | null)?.[column];
          if (typeof customerId !== "string" || !customerId) {
            return json({ error: "NO_STRIPE_CUSTOMER" }, { status: 404 });
          }
          const origin = new URL(request.url).origin;
          const session = await createPortalSession(customerId, `${origin}/settings`);
          return json({ data: { url: session.url } });
        } catch (error) {
          if (error instanceof Response) return error;
          console.error("Stripe portal session creation failed");
          return json({ error: "STRIPE_PORTAL_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
