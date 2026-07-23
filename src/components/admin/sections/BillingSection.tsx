import { useState } from "react";
import { CreditCard, DollarSign, AlertTriangle, Ticket, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { StatCard, Tag } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import {
  usePlanConfigs, useCoupons, usePayments, useTenants,
  type PaymentStatus, type TenantPlan,
} from "@/lib/stores";
import { useAuditLogger } from "../useAuditLogger";

const paymentColor: Record<PaymentStatus, string> = {
  Paid: "bg-success/15 text-success",
  Failed: "bg-destructive/15 text-destructive",
  Refunded: "bg-accent text-muted-foreground",
};
const planColor: Record<TenantPlan, string> = { Starter: "neutral", Pro: "blue", Scale: "purple" };

export function BillingSection() {
  const [plans, setPlans] = usePlanConfigs();
  const [coupons, setCoupons] = useCoupons();
  const [payments] = usePayments();
  const [tenants] = useTenants();
  const log = useAuditLogger();

  const mrr = tenants.filter((t) => t.status === "Active" || t.status === "Past Due").reduce((a, t) => a + t.mrr, 0);
  const failed = payments.filter((p) => p.status === "Failed");

  const updatePrice = (planId: TenantPlan, price: number) => {
    setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, price } : p)));
  };
  const commitPrice = (planId: TenantPlan) => {
    log("Edited plan pricing", "Billing", `${planId} plan`);
    toast.success(`${planId} plan pricing updated`);
  };
  const toggleCoupon = (id: string) => {
    setCoupons((prev) => prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)));
    const c = coupons.find((x) => x.id === id);
    if (c) { log(c.active ? "Deactivated coupon" : "Activated coupon", "Billing", c.code); toast.success(`${c.code} ${c.active ? "deactivated" : "activated"}`); }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">Plans, coupons, and payment operations across the platform.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<DollarSign className="h-5 w-5" />} value={`$${mrr.toLocaleString()}`} label="MRR" />
        <StatCard icon={<CreditCard className="h-5 w-5" />} value={String(payments.filter((p) => p.status === "Paid").length)} label="Payments (30d)" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} value={String(failed.length)} label="Failed Payments" />
        <StatCard icon={<Ticket className="h-5 w-5" />} value={String(coupons.filter((c) => c.active).length)} label="Active Coupons" />
      </div>

      <h3 className="mt-6 text-sm font-semibold">Plans</h3>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-card p-5">
            <p className="font-semibold">{p.id}</p>
            <div className="mt-2 flex items-center gap-1">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                value={p.price}
                onChange={(e) => updatePrice(p.id, Number(e.target.value))}
                onBlur={() => commitPrice(p.id)}
                className="h-8 w-20"
              />
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>{p.seats} seat{p.seats > 1 ? "s" : ""}</p>
              <p>{p.storageGb} GB storage</p>
              <p>{p.aiCredits.toLocaleString()} AI credits / mo</p>
            </div>
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Coupons</h3>
      <div className="mt-3 rounded-xl border border-border bg-card">
        {coupons.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-0">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-accent px-2 py-1 font-mono text-xs font-semibold">{c.code}</span>
              <span className="text-sm text-muted-foreground">{c.discountPct}% off · {c.scope}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{c.redemptions}/{c.maxRedemptions} redeemed</span>
              <span>expires {c.expires}</span>
              <button onClick={() => toggleCoupon(c.id)} className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${c.active ? "bg-success/15 text-success" : "bg-accent text-muted-foreground"}`}>
                <Power className="h-3 w-3" /> {c.active ? "Active" : "Inactive"}
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => toast("Coupon creation isn't wired up in this preview")}
          className="flex w-full items-center justify-center gap-1.5 p-3 text-xs font-medium text-primary hover:bg-accent/40"
        >
          <Plus className="h-3.5 w-3.5" /> New coupon
        </button>
      </div>

      <h3 className="mt-6 text-sm font-semibold">Payments</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Amount</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 max-w-[200px] truncate">{p.org}</td>
                <td className="px-3 py-3"><Tag label={p.plan} color={planColor[p.plan]} /></td>
                <td className="px-3 py-3 font-medium">${p.amount}</td>
                <td className="px-3 py-3"><span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${paymentColor[p.status]}`}>{p.status}</span></td>
                <td className="px-3 py-3 text-muted-foreground">{p.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
