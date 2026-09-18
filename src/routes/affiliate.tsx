import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Copy, Check, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { KpiTrendCardSkeleton } from "@/components/skeletons";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/affiliate")({
  component: Affiliate,
});

type MonthCents = { month: string; cents: number };
type MonthCount = { month: string; count: number };
type MonthRate = { month: string; ratePct: number | null };
type ActiveSub = { planId: string; name: string; count: number; mrrCents: number };
type RecentReferral = {
  id: string;
  client: string;
  plan: string | null;
  commissionCents: number;
  date: string;
  status: "converted" | "pending";
};
type AffiliateData = {
  referralCode: string;
  referralLink: string;
  totalEarningsCents: number;
  pendingPayoutCents: number;
  referredClients: number;
  totalSignups: number;
  totalClicks: number;
  conversionRatePct: number | null;
  monthlyCommission: MonthCents[];
  monthlyPending: MonthCents[];
  referredClientsByMonth: MonthCount[];
  conversionRateByMonth: MonthRate[];
  activeSubscriptions: ActiveSub[];
  recentReferrals: RecentReferral[];
};
type AffiliateResponse = { data?: AffiliateData; error?: string };

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function monthLabel(monthKey: string | undefined): string {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return "";
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function pctChange(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series.at(-2)!;
  const curr = series.at(-1)!;
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function signed(value: number, formatter: (n: number) => string): string {
  return `${value >= 0 ? "+" : "-"}${formatter(Math.abs(value))}`;
}

function Affiliate() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<AffiliateData | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/affiliate/summary", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as AffiliateResponse;
        if (!response.ok || !body.data) throw new Error();
        setData(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [retryNonce]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard access can be denied — the link is still visible to copy manually
    }
  };

  const commissionSeries = (data?.monthlyCommission ?? []).map((m) => m.cents / 100);
  const pendingSeries = (data?.monthlyPending ?? []).map((m) => m.cents / 100);
  const clientsSeries = (data?.referredClientsByMonth ?? []).map((m) => m.count);
  const rateSeries = (data?.conversionRateByMonth ?? []).map((m) => m.ratePct ?? 0);
  const latestMonthLabel = monthLabel(
    data?.monthlyCommission.at(-1)?.month ?? data?.referredClientsByMonth.at(-1)?.month,
  );
  const periodLabel = commissionSeries.length ? `Past ${commissionSeries.length} months` : "";

  return (
    <DashboardLayout title="Affiliate">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Affiliate Program</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn 20% recurring commission on every creator you refer who subscribes to Tubify.
        </p>
      </div>

      {status === "error" ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">We couldn't load your affiliate data.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : (
        <>
          <div
            className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-busy={status === "loading"}
            aria-label={status === "loading" ? "Loading affiliate metrics" : undefined}
          >
            {status === "loading" ? (
              <>
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
              </>
            ) : (
              <>
                <KpiTrendCard
                  title="Total Earnings"
                  accent="var(--brand-green)"
                  value={formatMoney(data!.totalEarningsCents)}
                  deltaLabel={
                    commissionSeries.length
                      ? signed(commissionSeries.at(-1) ?? 0, (n) => `$${n.toFixed(2)}`)
                      : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={pctChange(commissionSeries)}
                  periodLabel={periodLabel}
                  series={commissionSeries}
                  markerTitle={`$${(commissionSeries.at(-1) ?? 0).toFixed(2)}`}
                  markerSubtitle={latestMonthLabel}
                  positive={(pctChange(commissionSeries) ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Pending Payouts"
                  accent="var(--brand-amber)"
                  value={formatMoney(data!.pendingPayoutCents)}
                  deltaLabel={
                    pendingSeries.length
                      ? signed(pendingSeries.at(-1) ?? 0, (n) => `$${n.toFixed(2)}`)
                      : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={pctChange(pendingSeries)}
                  periodLabel={periodLabel}
                  series={pendingSeries}
                  markerTitle={`$${(pendingSeries.at(-1) ?? 0).toFixed(2)}`}
                  markerSubtitle={latestMonthLabel}
                  positive={(pctChange(pendingSeries) ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Referred Clients"
                  accent="var(--brand-blue)"
                  value={String(data!.referredClients)}
                  deltaLabel={
                    clientsSeries.length ? signed(clientsSeries.at(-1) ?? 0, (n) => String(n)) : "—"
                  }
                  deltaSuffix="new this month"
                  changePercent={pctChange(clientsSeries)}
                  periodLabel={periodLabel}
                  series={clientsSeries}
                  markerTitle={`${clientsSeries.at(-1) ?? 0} new`}
                  markerSubtitle={latestMonthLabel}
                  positive={(pctChange(clientsSeries) ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Conversion Rate"
                  accent="var(--brand-purple)"
                  value={
                    data!.conversionRatePct !== null ? formatPct(data!.conversionRatePct) : "—"
                  }
                  deltaLabel={rateSeries.length ? signed(rateSeries.at(-1) ?? 0, formatPct) : "—"}
                  deltaSuffix="this month"
                  changePercent={pctChange(rateSeries)}
                  periodLabel={periodLabel}
                  series={rateSeries}
                  markerTitle={formatPct(rateSeries.at(-1) ?? 0)}
                  markerSubtitle={`${latestMonthLabel} · clicks → signups`}
                  positive={(pctChange(rateSeries) ?? 0) >= 0}
                />
              </>
            )}
          </div>

          {/* Link builder */}
          <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h3 className="font-semibold">Your Affiliate Link</h3>
            {status === "loading" ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading your link…</p>
            ) : (
              <>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <div className="flex h-14 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-full border border-border bg-background px-4 font-mono text-sm text-muted-foreground">
                    {data!.referralLink}
                  </div>
                  <button
                    onClick={() => void copy()}
                    className="flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Commissions accrue automatically from subscription payments. Payouts are currently
                  processed manually.
                </p>
              </>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Revenue chart */}
            <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h3 className="text-lg font-semibold">Monthly Commission</h3>
              {status === "loading" ? (
                <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
              ) : data!.monthlyCommission.length === 0 ? (
                <p className="mt-4 py-10 text-center text-sm text-muted-foreground">
                  No commission activity yet — it'll show up here as soon as someone you refer
                  subscribes.
                </p>
              ) : (
                <div className="mt-4 h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data!.monthlyCommission.map((m) => ({
                        month: monthLabel(m.month),
                        commission: m.cents / 100,
                      }))}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => `$${v}`}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value: number) => [`$${value.toFixed(2)}`, "Commission"]}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        dataKey="commission"
                        name="Commission"
                        stroke="var(--color-brand-green)"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Active subscriptions among referred clients */}
            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h3 className="text-lg font-semibold">Active Subscriptions</h3>
              <p className="text-xs text-muted-foreground">Among the clients you referred</p>
              {status === "loading" ? (
                <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
              ) : data!.activeSubscriptions.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No referred clients are actively subscribed yet.
                </p>
              ) : (
                <div className="mt-4 space-y-3 text-sm">
                  {data!.activeSubscriptions.map((s) => (
                    <div
                      key={s.planId}
                      className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-3"
                    >
                      <div>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.count} client{s.count === 1 ? "" : "s"}
                        </p>
                      </div>
                      <span className="font-semibold text-brand-green">
                        {formatMoney(s.mrrCents)}/mo
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Referrals table */}
          <div className="relative mt-5 rounded-xl card-gradient-outline">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="border-b border-border p-5">
              <h3 className="text-lg font-semibold">Recent Referrals</h3>
            </div>
            {status === "loading" ? (
              <p className="p-5 text-sm text-muted-foreground">Loading…</p>
            ) : data!.recentReferrals.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                No one has signed up through your link yet.
              </p>
            ) : (
              <>
                {/* Mobile: stacked cards */}
                <div className="space-y-3 p-5 sm:hidden">
                  {data!.recentReferrals.map((r) => (
                    <div key={r.id} className="rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate font-medium">{r.client}</p>
                        <span
                          className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium ${r.status === "converted" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                        >
                          {r.status === "converted" ? "Converted" : "Pending"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.plan ?? "—"} · {new Date(r.date).toLocaleDateString()}
                      </p>
                      <p className="mt-2 text-sm font-semibold">{formatMoney(r.commissionCents)}</p>
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
                      {data!.recentReferrals.map((r) => (
                        <tr key={r.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-3.5 font-medium">{r.client}</td>
                          <td className="px-5 py-3.5 text-muted-foreground">{r.plan ?? "—"}</td>
                          <td className="px-5 py-3.5 text-muted-foreground">
                            {new Date(r.date).toLocaleDateString()}
                          </td>
                          <td className="px-5 py-3.5 font-semibold">
                            {formatMoney(r.commissionCents)}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${r.status === "converted" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                            >
                              {r.status === "converted" ? "Converted" : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
