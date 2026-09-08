import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createPortalSession, isStripeConfigured } from "@/lib/server/stripe";

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
          if (!isStripeConfigured())
            return json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
          const { client, user } = await requireSessionUser(request);
          const { data: profile } = await client
            .from("profiles")
            .select("stripe_customer_id")
            .eq("id", user.id)
            .maybeSingle();
          if (!profile?.stripe_customer_id) {
            return json({ error: "NO_STRIPE_CUSTOMER" }, { status: 404 });
          }
          const origin = new URL(request.url).origin;
          const session = await createPortalSession(
            profile.stripe_customer_id,
            `${origin}/settings`,
          );
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
