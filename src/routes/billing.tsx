import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Crown,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Rocket,
  Star,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useSiteContent } from "@/lib/stores";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/billing")({
  component: BillingCheckout,
});

type PlanId = string;
type Interval = "month" | "year";
type Plan = {
  id: PlanId;
  name: string;
  description: string | null;
  features: string[];
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

// Cycled per plan card position so a multi-tier catalog reads as visually distinct without any
// per-plan color config existing in the data model. Each entry pairs an icon color with a
// matching soft background "blob" color for that card's corner glow.
const CARD_ACCENTS = [
  { text: "text-brand-blue", blob: "bg-brand-blue" },
  { text: "text-brand-purple", blob: "bg-brand-purple" },
  { text: "text-brand-green", blob: "bg-brand-green" },
  { text: "text-brand-amber", blob: "bg-brand-amber" },
];

// Recognized tier names get a purposeful emblem (rocket for getting started, up through a crown
// for the top tier); anything else falls back to cycling the same set by position.
const NAMED_PLAN_ICONS: Record<string, typeof Rocket> = { starter: Rocket, pro: Zap, scale: Crown };
const FALLBACK_PLAN_ICONS = [Rocket, Zap, Crown, Star];
function planIcon(name: string, index: number) {
  return (
    NAMED_PLAN_ICONS[name.trim().toLowerCase()] ??
    FALLBACK_PLAN_ICONS[index % FALLBACK_PLAN_ICONS.length]
  );
}

function BillingCheckout() {
  const navigate = useNavigate();
  const [content] = useSiteContent();
  const [billingInterval, setBillingInterval] = useState<Interval>("month");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<PlanId | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    fetch("/api/billing/subscription", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as SubscriptionResponse;
        if (!response.ok || !body.data) throw new Error();
        setData(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const plans = data?.plans ?? [];
  // Odd-length catalogs land the badge dead center (matches the 3-plan reference); even-length
  // ones land it just left of center, which is the closest a single index can get.
  const featuredIndex = plans.length >= 3 ? Math.floor((plans.length - 1) / 2) : -1;

  const activeSubscription =
    data?.subscription &&
    (data.subscription.status === "active" || data.subscription.status === "trialing")
      ? data.subscription
      : null;

  const startCheckout = async (plan: Plan) => {
    setCheckingOutId(plan.id);
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
      setCheckingOutId(null);
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
      <div className={`mx-auto ${activeSubscription ? "max-w-2xl" : "max-w-6xl"}`}>
        <button
          onClick={() => navigate({ to: "/settings" })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </button>

        <h1 className="mt-6 text-center text-3xl font-extrabold uppercase tracking-normal text-foreground sm:text-4xl">
          Plans and Pricing
        </h1>

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
          <div className="mt-8">
            <div className="flex justify-center">
              <div className="inline-flex rounded-full bg-accent p-1 text-xs">
                {(["month", "year"] as const).map((i) => (
                  <button
                    key={i}
                    onClick={() => setBillingInterval(i)}
                    className={`rounded-full px-4 py-1.5 font-medium transition-colors ${i === billingInterval ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {i === "month" ? "Monthly" : "Annual"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:items-start">
              {plans.map((p, index) => {
                const featured = index === featuredIndex;
                const hasPrice = p.monthlyPriceCents != null && p.annualPriceCents != null;
                const monthlyCents = p.monthlyPriceCents ?? 0;
                const annualCents = p.annualPriceCents ?? 0;
                const totalCents = billingInterval === "year" ? annualCents : monthlyCents;
                const savingsPct =
                  monthlyCents > 0 && annualCents > 0
                    ? Math.round((1 - annualCents / (monthlyCents * 12)) * 100)
                    : 0;
                const isCheckingOut = checkingOutId === p.id;

                const accent = CARD_ACCENTS[index % CARD_ACCENTS.length];
                const Emblem = planIcon(p.name, index);

                return (
                  <div
                    key={p.id}
                    className="group relative flex flex-col overflow-hidden rounded-3xl p-6 shadow-lg shadow-black/[0.03] transition-transform duration-300 hover:-translate-y-1 card-gradient-outline"
                  >
                    <GlowingEffect
                      spread={40}
                      glow
                      disabled={false}
                      proximity={64}
                      inactiveZone={0.01}
                    />
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute -right-14 -top-20 h-56 w-56 rounded-full opacity-40 blur-3xl transition-opacity duration-300 group-hover:opacity-60 ${accent.blob}`}
                    />
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute right-0 top-0 h-40 w-40 opacity-[0.18] transition-opacity duration-300 group-hover:opacity-30 ${accent.text}`}
                      style={{
                        backgroundImage: "radial-gradient(currentColor 1.5px, transparent 1.5px)",
                        backgroundSize: "16px 16px",
                        WebkitMaskImage:
                          "radial-gradient(circle at top right, black, transparent 70%)",
                        maskImage: "radial-gradient(circle at top right, black, transparent 70%)",
                      }}
                    />

                    {featured && (
                      <span className="absolute right-6 top-6 rounded-full bg-gradient-to-r from-primary to-brand-purple px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
                        Most popular
                      </span>
                    )}

                    <span
                      className={`relative flex h-11 w-11 items-center justify-center rounded-full ${accent.text}`}
                    >
                      <Emblem className="h-6 w-6" />
                    </span>

                    <h3 className="relative mt-4 text-lg font-semibold tracking-tight">{p.name}</h3>
                    {p.description && (
                      <p className="relative mt-1.5 text-sm text-muted-foreground">
                        {p.description}
                      </p>
                    )}

                    <div className="relative mt-5 flex items-end gap-1.5">
                      {hasPrice ? (
                        <>
                          <span className="text-3xl font-bold tracking-tight">
                            US${money(totalCents / 100)}
                          </span>
                          <span className="pb-1 text-sm text-muted-foreground">
                            /{billingInterval}
                          </span>
                        </>
                      ) : (
                        <span className="text-3xl font-bold tracking-tight">Contact us</span>
                      )}
                    </div>
                    {hasPrice && billingInterval === "year" && savingsPct > 0 && (
                      <p className="relative mt-1 text-xs text-muted-foreground">
                        Save {savingsPct}% vs monthly
                      </p>
                    )}

                    {hasPrice ? (
                      <button
                        onClick={() => void startCheckout(p)}
                        disabled={isCheckingOut || !p.available}
                        className="relative mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-opacity hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isCheckingOut ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4" />
                        )}
                        {isCheckingOut ? "Redirecting…" : "Choose this plan"}
                      </button>
                    ) : (
                      <a
                        href={`mailto:${content.contactEmail}`}
                        className="relative mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-accent"
                      >
                        <Mail className="h-4 w-4" /> Contact us
                      </a>
                    )}
                    {hasPrice && !p.available && (
                      <p className="relative mt-2 text-center text-xs text-muted-foreground">
                        This plan's Stripe price isn't configured yet.
                      </p>
                    )}

                    {p.features.length > 0 && (
                      <div className="relative mt-6 border-t border-border pt-5">
                        {index > 0 && (
                          <p className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Everything in{" "}
                            {plans
                              .slice(0, index)
                              .map((pl) => pl.name)
                              .join(" & ")}
                            , plus
                          </p>
                        )}
                        <ul className={`space-y-2.5 ${index > 0 ? "mt-3" : ""}`}>
                          {p.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2 text-sm">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              <span className="text-muted-foreground">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              You'll enter payment details securely on Stripe's own checkout page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
