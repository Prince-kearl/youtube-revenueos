import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import {
  DollarSign, TrendingUp, Eye, Globe, Download, Search, ChevronLeft, ChevronRight,
  CheckCircle2, Clock, RefreshCw, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { analyticsBars, revenueSplit, geoRevenue, cpmTrend, revenueTransactions, type RevenueTransaction } from "@/lib/data";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
});

const tabs = ["Revenue Sources", "Geo Heatmap", "CPM Trends"];
const ranges = ["7D", "30D", "90D", "12M"] as const;

const geoBadgeColors = [
  "bg-brand-purple/15 text-brand-purple",
  "bg-brand-blue/15 text-brand-blue",
  "bg-brand-green/15 text-brand-green",
  "bg-brand-amber/15 text-brand-amber",
  "bg-brand-red/15 text-brand-red",
  "bg-info/15 text-info",
];

function Analytics() {
  const [tab, setTab] = useState("Revenue Sources");
  const [range, setRange] = useState<(typeof ranges)[number]>("12M");
  const bars = useMemo(() => {
    const n = range === "7D" ? 1 : range === "30D" ? 2 : range === "90D" ? 3 : analyticsBars.length;
    return analyticsBars.slice(-n);
  }, [range]);
  const cpmData = useMemo(() => {
    const n = range === "7D" ? 1 : range === "30D" ? 2 : range === "90D" ? 3 : cpmTrend.length;
    return cpmTrend.slice(-n);
  }, [range]);
  const maxGeoPct = Math.max(...geoRevenue.map((g) => g.pct));
  const sortedGeoRevenue = useMemo(() => [...geoRevenue].sort((a, b) => b.pct - a.pct), []);
  const cpmChange = ((cpmTrend[cpmTrend.length - 1].cpm - cpmTrend[0].cpm) / cpmTrend[0].cpm) * 100;
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
              <button key={r} onClick={() => setRange(r)} className={`rounded-[var(--button-radius)] px-3 py-1 font-medium ${r === range ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {r}
              </button>
            ))}
          </div>
          <button onClick={exportPdf} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3 text-sm font-medium hover:bg-accent print:hidden">
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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <StatCard icon={<DollarSign className="h-5 w-5" />} value="$0.052" label="Revenue/View" change="8.4%" up />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value="$9.84" label="Avg CPM" change="12.1%" up />
        <StatCard icon={<Eye className="h-5 w-5" />} value="2.4M hrs" label="Watch Time" change="6.8%" up />
        <StatCard icon={<Globe className="h-5 w-5" />} value="48" label="Countries" change="4%" up />
      </div>

      <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
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

        {tab === "Revenue Sources" && (
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
        )}

        {tab === "Geo Heatmap" && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Revenue by Country</h3>
                  <p className="text-sm text-muted-foreground">Ranked by share of total revenue</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Low</span>
                  <span className="h-1.5 w-16 rounded-full border border-border" style={{ background: "linear-gradient(to right, var(--color-accent), var(--color-primary))" }} />
                  <span>High</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sortedGeoRevenue.map((g, i) => {
                  const intensity = g.pct / maxGeoPct;
                  return (
                    <div key={g.country} className="relative rounded-xl card-gradient-outline p-4 transition-shadow hover:shadow-sm">
                      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
                      <div className="flex items-start justify-between">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold ${geoBadgeColors[i % geoBadgeColors.length]}`}>
                          {g.code}
                        </span>
                        <span className="text-[11px] font-medium text-muted-foreground">#{i + 1}</span>
                      </div>
                      <p className="mt-3 truncate text-sm font-semibold">{g.country}</p>
                      <p className="mt-0.5 text-lg font-bold tracking-tight">${g.revenue.toLocaleString()}</p>
                      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${intensity * 100}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{g.views}M views · {g.pct}% share</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold">Top Countries</h3>
              <p className="text-sm text-muted-foreground">Share of total revenue</p>
              <div className="mt-4 space-y-4">
                {sortedGeoRevenue.slice(0, 6).map((g, i) => (
                  <div key={g.country}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${geoBadgeColors[i % geoBadgeColors.length]}`}>
                          {g.code}
                        </span>
                        {g.country}
                      </span>
                      <span className="font-semibold">{g.pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${g.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "CPM Trends" && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h3 className="text-lg font-semibold">CPM Trend</h3>
              <p className="text-sm text-muted-foreground">Average cost per 1,000 monetized views</p>
              <div className="mt-4 h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cpmData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `$${v}`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number) => [`$${v}`, "CPM"]}
                    />
                    <Line type="monotone" dataKey="cpm" stroke="var(--color-brand-purple)" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold">Insights</h3>
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-xs text-muted-foreground">Current CPM</p>
                  <p className="mt-1 text-2xl font-bold">${cpmTrend[cpmTrend.length - 1].cpm.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-xs text-muted-foreground">Change over period</p>
                  <p className="mt-1 text-2xl font-bold text-success">+{cpmChange.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-border bg-accent/20 p-4">
                  <p className="text-xs text-muted-foreground">Peak month</p>
                  <p className="mt-1 text-lg font-semibold">Dec — Q4 seasonality</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <RevenueTransactionsTable />
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

const statusMeta: Record<RevenueTransaction["status"], { icon: typeof CheckCircle2; className: string }> = {
  Received: { icon: CheckCircle2, className: "text-success" },
  Processed: { icon: RefreshCw, className: "text-info" },
  Pending: { icon: Clock, className: "text-warning" },
  Failed: { icon: XCircle, className: "text-destructive" },
};

const PAGE_SIZE = 8;

function RevenueTransactionsTable() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | RevenueTransaction["status"]>("All");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return revenueTransactions.filter((t) => {
      if (status !== "All" && t.status !== status) return false;
      if (!q) return true;
      return t.id.toLowerCase().includes(q) || t.video.toLowerCase().includes(q) || t.source.toLowerCase().includes(q);
    });
  }, [query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const setFilteredQuery = (v: string) => { setQuery(v); setPage(1); };
  const setFilteredStatus = (v: "All" | RevenueTransaction["status"]) => { setStatus(v); setPage(1); };

  const pageAllSelected = paged.length > 0 && paged.every((t) => selected.has(t.id));
  const toggleAll = () => {
    setSelected((prev) => {
      if (pageAllSelected) {
        const next = new Set(prev);
        paged.forEach((t) => next.delete(t.id));
        return next;
      }
      return new Set([...prev, ...paged.map((t) => t.id)]);
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    toast.success(`Exporting ${selected.size || filtered.length} transactions`, {
      description: "Your CSV download will start shortly.",
    });
  };

  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const nums = new Set([1, 2, 3, totalPages]);
    return [...nums].sort((a, b) => a - b);
  }, [totalPages]);

  return (
    <div className="relative mt-5 rounded-xl card-gradient-outline">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <h3 className="text-lg font-semibold">Revenue Transactions</h3>
        <button onClick={exportCsv} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3 text-sm font-medium hover:bg-accent">
          <Download className="h-4 w-4" /> Export{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setFilteredQuery(e.target.value)}
            placeholder="Search transactions..."
            className="h-9 w-full rounded-lg border border-border bg-accent/20 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Select value={status} onValueChange={(v) => setFilteredStatus(v as typeof status)}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Status</SelectItem>
            <SelectItem value="Received">Received</SelectItem>
            <SelectItem value="Processed">Processed</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mobile: stacked cards */}
      <div className="space-y-3 sm:hidden">
        {paged.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No transactions match your filters.</p>
        ) : paged.map((t) => {
          const meta = statusMeta[t.status];
          const StatusIcon = meta.icon;
          return (
            <div key={t.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <Checkbox className="mt-0.5" checked={selected.has(t.id)} onCheckedChange={() => toggleOne(t.id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t.id}</span>
                    <span className="font-semibold">${t.amount.toLocaleString()}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{t.video}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-md bg-accent px-2 py-1 font-medium">{t.source}</span>
                    <span>{t.method}</span>
                    <span>· {t.date}</span>
                  </div>
                  <span className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${meta.className}`}>
                    <StatusIcon className="h-3.5 w-3.5" /> {t.status}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-5 py-3">
                <Checkbox checked={pageAllSelected} onCheckedChange={toggleAll} disabled={paged.length === 0} />
              </th>
              <th className="px-3 py-3 font-medium">Transaction ID</th>
              <th className="px-3 py-3 font-medium">Amount</th>
              <th className="px-3 py-3 font-medium">Source</th>
              <th className="px-3 py-3 font-medium">Video</th>
              <th className="px-3 py-3 font-medium">Method</th>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((t) => {
              const meta = statusMeta[t.status];
              const StatusIcon = meta.icon;
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="px-5 py-3.5"><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleOne(t.id)} /></td>
                  <td className="px-3 py-3.5 font-medium">{t.id}</td>
                  <td className="px-3 py-3.5 font-semibold">${t.amount.toLocaleString()}</td>
                  <td className="px-3 py-3.5">
                    <span className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-muted-foreground">{t.source}</span>
                  </td>
                  <td className="px-3 py-3.5 max-w-[220px] truncate text-muted-foreground">{t.video}</td>
                  <td className="px-3 py-3.5 text-muted-foreground">{t.method}</td>
                  <td className="px-3 py-3.5 text-muted-foreground">{t.date}</td>
                  <td className="px-3 py-3.5">
                    <span className={`flex items-center gap-1.5 font-medium ${meta.className}`}>
                      <StatusIcon className="h-3.5 w-3.5" /> {t.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">No transactions match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} entries
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers.map((n, i) => (
            <span key={n} className="flex items-center">
              {i > 0 && n - pageNumbers[i - 1] > 1 && <span className="px-1 text-sm text-muted-foreground">…</span>}
              <button
                onClick={() => setPage(n)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium ${n === currentPage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              >
                {n}
              </button>
            </span>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
