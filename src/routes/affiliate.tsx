import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { DollarSign, Clock, Users, Percent, Copy, Check } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";

export const Route = createFileRoute("/affiliate")({
  component: Affiliate,
});

const monthly = [
  { month: "Jul", revenue: 640 },
  { month: "Aug", revenue: 980 },
  { month: "Sep", revenue: 1240 },
  { month: "Oct", revenue: 1580 },
  { month: "Nov", revenue: 2110 },
  { month: "Dec", revenue: 2840 },
];

const referrals = [
  { user: "creatorstudio.io", plan: "Pro (annual)", date: "Dec 28, 2024", commission: "$118.00", status: "Converted" },
  { user: "mediahouse.co", plan: "Pro (monthly)", date: "Dec 21, 2024", commission: "$19.80", status: "Converted" },
  { user: "growthlab.xyz", plan: "—", date: "Dec 19, 2024", commission: "$0.00", status: "Pending" },
  { user: "tubevault.app", plan: "Business", date: "Dec 12, 2024", commission: "$59.40", status: "Converted" },
  { user: "clipfarm.io", plan: "—", date: "Dec 8, 2024", commission: "$0.00", status: "Pending" },
];

function Affiliate() {
  const [copied, setCopied] = useState(false);
  const link = "app.yourdomain.com/signup?aff=alexchen20";

  const copy = () => {
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <DashboardLayout title="Affiliate">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Affiliate Program</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn 20% recurring commission on every creator you refer. Payouts route automatically via Stripe Connect.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<DollarSign className="h-5 w-5" />} value="$9,390" label="Total Earnings" change="22.4%" up />
        <StatCard icon={<Clock className="h-5 w-5" />} value="$2,840" label="Pending Payouts" />
        <StatCard icon={<Users className="h-5 w-5" />} value="47" label="Referred Clients" change="8.1%" up />
        <StatCard icon={<Percent className="h-5 w-5" />} value="18.6%" label="Conversion Rate" sub="clicks → signups" />
      </div>

      {/* Link builder */}
      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Your Affiliate Link</h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <div className="flex h-11 flex-1 items-center rounded-lg border border-border bg-background px-3 font-mono text-sm text-muted-foreground">
            {link}
          </div>
          <button
            onClick={copy}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy Link"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">30-day first-party cookie attribution. Commission pays out on every successful invoice.</p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Revenue chart */}
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="text-lg font-semibold">Monthly Commission</h3>
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
                <Line dataKey="revenue" name="Commission" stroke="var(--color-brand-green)" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active subscriptions */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-lg font-semibold">Active Subscriptions</h3>
          <div className="mt-4 space-y-3 text-sm">
            {[
              { plan: "Pro", count: 28, mrr: "$556" },
              { plan: "Business", count: 11, mrr: "$649" },
              { plan: "Starter", count: 8, mrr: "$72" },
            ].map((s) => (
              <div key={s.plan} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-3">
                <div>
                  <p className="font-medium">{s.plan}</p>
                  <p className="text-[11px] text-muted-foreground">{s.count} clients</p>
                </div>
                <span className="font-semibold text-brand-green">{s.mrr}/mo</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Referrals table */}
      <div className="mt-5 rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h3 className="text-lg font-semibold">Recent Referrals</h3>
        </div>
        {/* Mobile: stacked cards */}
        <div className="space-y-3 p-5 sm:hidden">
          {referrals.map((r) => (
            <div key={r.user} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate font-medium">{r.user}</p>
                <span className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium ${r.status === "Converted" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                  {r.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{r.plan} · {r.date}</p>
              <p className="mt-2 text-sm font-semibold">{r.commission}</p>
            </div>
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Referred Client</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Commission</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.user} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 font-medium">{r.user}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{r.plan}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{r.date}</td>
                  <td className="px-5 py-3.5 font-semibold">{r.commission}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${r.status === "Converted" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
