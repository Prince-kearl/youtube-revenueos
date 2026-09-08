import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Youtube } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/billing")({
  component: BillingCheckout,
});

type PlanId = string;
type Interval = "month" | "year";
type Plan = {
  id: PlanId;
  name: string;
  description: string | null;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  available: boolean;
};
type Subscription = {
  plan_id: PlanId;
  billing_interval: Interval;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};
type SubscriptionData = {
  stripeConfigured: boolean;
  subscription: Subscription | null;
  plans: Plan[];
};
type SubscriptionResponse = { data?: SubscriptionData; error?: string };
type CheckoutResponse = { data?: { url: string }; error?: string };
type PortalResponse = { data?: { url: string }; error?: string };

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    STRIPE_NOT_CONFIGURED:
      "Billing isn't set up yet — add Stripe API keys to enable subscriptions.",
    STRIPE_PRICE_NOT_CONFIGURED: "This plan isn't available for checkout yet. Try another plan.",
    STRIPE_CHECKOUT_FAILED: "We couldn't start checkout. Please try again.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function BillingCheckout() {
  const navigate = useNavigate();
  const [planId, setPlanId] = useState<PlanId | null>(null);
  const [billingInterval, setBillingInterval] = useState<Interval>("month");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    fetch("/api/billing/subscription", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as SubscriptionResponse;
        if (!response.ok || !body.data) throw new Error();
        setData(body.data);
        // Prefer a plan named "Pro" if the catalog still has one (matches the previous default),
        // otherwise just default to whatever sorts first — the catalog is Superadmin-managed now,
        // so a hardcoded slug can't be assumed to exist.
        setPlanId(
          (current) =>
            current ??
            body.data!.plans.find((p) => p.name.toLowerCase() === "pro")?.id ??
            body.data!.plans[0]?.id ??
            null,
        );
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const plans = data?.plans ?? [];
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const monthlyCents = plan?.monthlyPriceCents ?? 0;
  const annualCents = plan?.annualPriceCents ?? 0;
  const annualMonthlyCents = annualCents / 12;
  const totalCents = billingInterval === "year" ? annualCents : monthlyCents;
  const annualSavingsPct =
    monthlyCents > 0 && annualCents > 0
      ? Math.round((1 - annualCents / (monthlyCents * 12)) * 100)
      : 0;

  const activeSubscription =
    data?.subscription &&
    (data.subscription.status === "active" || data.subscription.status === "trialing")
      ? data.subscription
      : null;

  const startCheckout = async () => {
    if (!plan) return;
    setCheckingOut(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, interval: billingInterval }),
      });
      const body = (await response.json()) as CheckoutResponse;
      if (!response.ok || !body.data) throw new Error(body.error ?? "STRIPE_CHECKOUT_FAILED");
      window.location.href = body.data.url;
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "STRIPE_CHECKOUT_FAILED"));
      setCheckingOut(false);
    }
  };

  const openPortal = async () => {
    setOpeningPortal(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await response.json()) as PortalResponse;
      if (!response.ok || !body.data) throw new Error(body.error ?? "STRIPE_PORTAL_FAILED");
      window.location.href = body.data.url;
    } catch {
      toast.error("We couldn't open the billing portal. Please try again.");
      setOpeningPortal(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">We couldn't load billing information.</p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 sm:p-10">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() => navigate({ to: "/settings" })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </button>

        <div className="mt-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Youtube className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium">Tubify Billing</span>
        </div>

        {!data.stripeConfigured && (
          <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            Billing isn't configured yet — Stripe API keys haven't been added. Plans are shown for
            preview, but checkout won't work until that's set up.
          </div>
        )}

        {activeSubscription ? (
          <div className="mt-8 rounded-xl card-gradient-outline p-6">
            <p className="text-sm text-muted-foreground">You're subscribed to</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">
              {plans.find((p) => p.id === activeSubscription.plan_id)?.name ??
                activeSubscription.plan_id}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Billed {activeSubscription.billing_interval === "year" ? "annually" : "monthly"}
              {activeSubscription.current_period_end &&
                ` · renews ${new Date(activeSubscription.current_period_end).toLocaleDateString()}`}
              {activeSubscription.cancel_at_period_end && " · cancels at period end"}
            </p>
            <button
              onClick={() => void openPortal()}
              disabled={openingPortal}
              className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {openingPortal ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              Manage billing
            </button>
          </div>
        ) : (
          <div className="mt-8 rounded-xl card-gradient-outline p-6">
            <div className="flex flex-wrap gap-1.5">
              {plans.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlanId(p.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    p.id === planId
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-muted-foreground hover:bg-accent/70"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {plan?.description && (
              <p className="mt-2 text-xs text-muted-foreground">{plan.description}</p>
            )}

            <div className="mt-4 inline-flex rounded-full bg-accent p-1 text-xs">
              {(["month", "year"] as const).map((i) => (
                <button
                  key={i}
                  onClick={() => setBillingInterval(i)}
                  className={`rounded-full px-3 py-1 font-medium ${i === billingInterval ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {i === "month"
                    ? "Monthly"
                    : annualSavingsPct > 0
                      ? `Annual · save ${annualSavingsPct}%`
                      : "Annual"}
                </button>
              ))}
            </div>

            <div className="mt-6 flex items-end gap-1.5">
              <span className="text-4xl font-bold tracking-tight">
                US${money(totalCents / 100)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">per {billingInterval}</span>
            </div>
            {billingInterval === "year" && (
              <p className="mt-1 text-sm text-muted-foreground">
                US${money(annualMonthlyCents / 100)} / month billed annually
              </p>
            )}

            <button
              onClick={() => void startCheckout()}
              disabled={checkingOut || !plan?.available}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checkingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              {checkingOut ? "Redirecting to Stripe…" : "Continue to Stripe Checkout"}
            </button>
            {plan && !plan.available && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                This plan's Stripe price isn't configured yet.
              </p>
            )}
            <p className="mt-3 text-center text-xs text-muted-foreground">
              You'll enter payment details securely on Stripe's own checkout page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
