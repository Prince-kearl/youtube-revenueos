import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, CreditCard, Lock, Wallet, Youtube } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/billing")({
  component: BillingCheckout,
});

type BillingPlan = { id: string; name: string; price: number; blurb: string };

const billingPlans: BillingPlan[] = [
  { id: "starter", name: "Starter", price: 29, blurb: "For solo creators getting started" },
  { id: "pro", name: "Pro", price: 79, blurb: "Everything you need to keep growing" },
  { id: "scale", name: "Scale", price: 199, blurb: "For teams and multi-channel creators" },
];

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function BillingCheckout() {
  const navigate = useNavigate();
  const [planId, setPlanId] = useState("pro");
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [email, setEmail] = useState("alex@creator.io");

  const plan = billingPlans.find((p) => p.id === planId)!;
  const annualTotal = Math.round(plan.price * 12 * 0.85);
  const annualMonthly = annualTotal / 12;
  const total = billingInterval === "year" ? annualTotal : plan.price;

  const subscribe = () => {
    toast.success(`Subscribed to the ${plan.name} plan`, {
      description: `Billed ${billingInterval === "year" ? "annually" : "monthly"} at $${money(total)}.`,
    });
    navigate({ to: "/settings" });
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Plan summary */}
      <div className="bg-primary p-6 text-primary-foreground sm:p-10 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <button
          onClick={() => navigate({ to: "/settings" })}
          className="flex items-center gap-2 text-sm text-primary-foreground/80 hover:text-primary-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </button>

        <div className="mt-8 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
            <Youtube className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium">Tubify Billing</span>
        </div>

        <div className="mt-8 flex flex-wrap gap-1.5">
          {billingPlans.map((p) => (
            <button
              key={p.id}
              onClick={() => setPlanId(p.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                p.id === planId ? "bg-white text-primary" : "bg-white/15 text-primary-foreground/80 hover:bg-white/25"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-primary-foreground/70">{plan.blurb}</p>

        <div className="mt-4 inline-flex rounded-full bg-white/15 p-1 text-xs">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              onClick={() => setBillingInterval(i)}
              className={`rounded-full px-3 py-1 font-medium ${i === billingInterval ? "bg-white text-primary" : "text-primary-foreground/80"}`}
            >
              {i === "month" ? "Monthly" : "Annual · save 15%"}
            </button>
          ))}
        </div>

        <p className="mt-8 text-sm text-primary-foreground/80">Subscribe to {plan.name}</p>
        <div className="mt-1 flex items-end gap-1.5">
          <span className="text-4xl font-bold tracking-tight">US${money(total)}</span>
          <span className="pb-1 text-sm text-primary-foreground/80">per {billingInterval}</span>
        </div>
        {billingInterval === "year" && (
          <p className="mt-1 text-sm text-primary-foreground/70">US${money(annualMonthly)} / month billed annually</p>
        )}

        <div className="mt-8 space-y-4 border-t border-white/20 pt-6 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{plan.name} Plan</p>
              <p className="text-xs text-primary-foreground/70">Billed {billingInterval === "year" ? "annually" : "monthly"}</p>
            </div>
            <p className="font-medium">US${money(total)}</p>
          </div>

          <div className="flex items-center justify-between border-t border-white/20 pt-4">
            <span>Subtotal</span>
            <span className="font-medium">US${money(total)}</span>
          </div>

          {promoOpen ? (
            <input
              autoFocus
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Promotion code"
              className="w-full rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm text-primary-foreground placeholder:text-primary-foreground/50 outline-none"
            />
          ) : (
            <button
              onClick={() => setPromoOpen(true)}
              className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
            >
              Add promotion code
            </button>
          )}

          <div className="flex items-center justify-between border-t border-white/20 pt-4 text-base font-semibold">
            <span>Total due today</span>
            <span>US${money(total)}</span>
          </div>
        </div>
      </div>

      {/* Payment form */}
      <div className="bg-background p-6 sm:p-10">
        <div className="mx-auto max-w-md">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => toast("Apple Pay isn't wired up in this preview")}
              className="flex h-11 items-center justify-center rounded-lg bg-foreground text-sm font-semibold text-background hover:opacity-90"
            >
              Apple Pay
            </button>
            <button
              onClick={() => toast("Google Pay isn't wired up in this preview")}
              className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-semibold hover:bg-accent"
            >
              <Wallet className="h-4 w-4" /> Google Pay
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-xs font-medium text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
          </div>

          <div>
            <p className="text-sm font-semibold">Contact information</p>
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-accent/20 px-4 py-3">
              <label className="text-sm text-muted-foreground">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-6 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold">Payment method</p>
            <div className="mt-2 rounded-xl border border-border">
              <div className="flex items-center gap-2 border-b border-border p-4">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border-[5px] border-primary" />
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Card</span>
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <label className="text-xs text-muted-foreground">Card information</label>
                  <input
                    placeholder="1234 1234 1234 1234"
                    className="mt-1.5 h-11 w-full rounded-t-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary"
                  />
                  <div className="grid grid-cols-2">
                    <input
                      placeholder="MM / YY"
                      className="h-11 w-full border border-t-0 border-r-0 border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary"
                    />
                    <input
                      placeholder="CVC"
                      className="h-11 w-full rounded-br-lg border border-t-0 border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Cardholder name</label>
                  <input
                    placeholder="Full name on card"
                    className="mt-1.5 h-11 w-full rounded-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Country or region</label>
                  <select className="mt-1.5 h-11 w-full rounded-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary">
                    <option>United States</option>
                    <option>United Kingdom</option>
                    <option>Canada</option>
                    <option>Ghana</option>
                    <option>Germany</option>
                    <option>Netherlands</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 border-t border-border p-4 text-sm">
                <span className="h-4 w-4 rounded-full border border-border" />
                Apple Pay
              </label>
            </div>
          </div>

          <label className="mt-6 flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
            <input type="checkbox" className="mt-0.5" />
            <span>
              <span className="font-medium">Save my information for faster checkout</span>
              <p className="mt-0.5 text-xs text-muted-foreground">Pay securely and reuse this card next time you upgrade.</p>
            </span>
          </label>

          <button
            onClick={subscribe}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background hover:opacity-90"
          >
            Subscribe
          </button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> By subscribing, you authorize Tubify to charge you until you cancel.
          </p>
        </div>
      </div>
    </div>
  );
}
