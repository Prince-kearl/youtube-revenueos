import { useEffect, useState } from "react";
import { ExternalLink, DollarSign, CreditCard } from "lucide-react";
import { AdminKpiCard } from "@/components/admin/AdminKpiCard";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { PlansManager } from "./billing/PlansManager";

// Billing shows only real figures: recurring revenue and subscriptions come from the platform's
// Stripe subscriptions (the same /api/admin/dashboard numbers as the Executive Dashboard, which
// checks platform-admin rights on the server), and plans are managed below. Payments and coupons
// live in Stripe; nothing here invents them.

type BillingTotals = { mrrCents: number; activeSubscriptions: number };

export function BillingSection() {
  const [totals, setTotals] = useState<BillingTotals | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/dashboard", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: BillingTotals };
        if (!response.ok || !body.data) throw new Error("dashboard_failed");
        setTotals({
          mrrCents: body.data.mrrCents,
          activeSubscriptions: body.data.activeSubscriptions,
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const figure = (value: (t: BillingTotals) => string) =>
    status === "ready" && totals ? value(totals) : status === "error" ? "Unavailable" : "…";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Recurring revenue, subscriptions and plans across the platform.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <AdminKpiCard
          icon={DollarSign}
          tone="green"
          title="MRR"
          value={figure((t) =>
            (t.mrrCents / 100).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }),
          )}
        />
        <AdminKpiCard
          icon={CreditCard}
          tone="blue"
          title="Active Subscriptions"
          value={figure((t) => t.activeSubscriptions.toLocaleString())}
        />
      </div>
      {status === "error" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Billing figures couldn&apos;t be loaded. Try refreshing.
        </p>
      )}

      <div className="relative mt-6 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <PlansManager />
      </div>

      <p className="mt-6 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        Payments, refunds and coupons are managed in Stripe.
        <a
          href="https://dashboard.stripe.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          Open Stripe <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}
