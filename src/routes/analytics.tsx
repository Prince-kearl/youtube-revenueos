import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { DollarSign, TrendingUp, Eye, Globe, Download } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { analyticsBars, revenueSplit } from "@/lib/data";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
});

const tabs = ["Revenue Sources", "Geo Heatmap", "CPM Trends"];
const ranges = ["7D", "30D", "90D", "12M"] as const;

function Analytics() {
  const [tab, setTab] = useState("Revenue Sources");
  const [range, setRange] = useState<(typeof ranges)[number]>("12M");
  const bars = useMemo(() => {
    const n = range === "7D" ? 1 : range === "30D" ? 2 : range === "90D" ? 3 : analyticsBars.length;
    return analyticsBars.slice(-n);
  }, [range]);
  const exportPdf = () => {
    toast.success("Preparing PDF — use your browser's Save as PDF");
    setTimeout(() => window.print(), 300);
  };

  return (
    <DashboardLayout title="Analytics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Engine</h1>
          <p className="mt-1 text-sm text-muted-foreground">Multi-dimensional revenue analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-accent p-1 text-xs">
            {ranges.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`rounded-md px-3 py-1 font-medium ${r === range ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {r}
              </button>
            ))}
          </div>
          <button onClick={exportPdf} className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-accent print:hidden">
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-amber/30 bg-brand-amber/5 px-4 py-3 text-xs">
        <span className="inline-flex h-2 w-2 rounded-full bg-brand-amber" />
        <span className="font-semibold text-brand-amber">Data freshness</span>
        <span className="text-muted-foreground">
          YouTube Analytics: 24–72h lag · Revenue metrics: ~48h · Clicks &amp; Stripe attribution: real-time
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<DollarSign className="h-5 w-5" />} value="$0.052" label="Revenue/View" change="8.4%" up />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value="$9.84" label="Avg CPM" change="12.1%" up />
        <StatCard icon={<Eye className="h-5 w-5" />} value="2.4M hrs" label="Watch Time" change="6.8%" up />
        <StatCard icon={<Globe className="h-5 w-5" />} value="48" label="Countries" change="4%" up />
      </div>

      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <div className="flex gap-2 rounded-lg bg-accent/50 p-1 text-sm w-fit">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-2 font-medium transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h3 className="text-lg font-semibold">Revenue by Source</h3>
            <div className="mt-4 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `$${v}k`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--color-accent)" }} contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="brand" stackId="a" fill="var(--color-brand-purple)" />
                  <Bar dataKey="adsense" stackId="a" fill="var(--color-brand-blue)" />
                  <Bar dataKey="memberships" stackId="a" fill="var(--color-brand-green)" />
                  <Bar dataKey="affiliates" stackId="a" fill="var(--color-brand-amber)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <Legend color="var(--color-brand-purple)" label="Brand Deals" />
              <Legend color="var(--color-brand-blue)" label="AdSense" />
              <Legend color="var(--color-brand-green)" label="Memberships" />
              <Legend color="var(--color-brand-amber)" label="Affiliates" />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold">Revenue Share</h3>
            <div className="mt-4 h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={revenueSplit} dataKey="pct" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                    {revenueSplit.map((r, i) => (
                      <Cell key={i} fill={r.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {revenueSplit.map((r) => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                    {r.label}
                  </span>
                  <span className="font-semibold">{r.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
