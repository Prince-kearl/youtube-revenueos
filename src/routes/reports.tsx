import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DollarSign, Users, Video, FileText, Download, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FlatKpiCard } from "@/components/KpiTrendCard";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reports")({
  component: Reports,
});

type ReportType = "deals" | "leads" | "videos";

type Summary = {
  periodLabel: string;
  revenueThisPeriod: number;
  revenueChangePct: number | null;
  activePipeline: number;
  leadsThisPeriod: number;
  leadsChangePct: number | null;
  videosThisPeriod: number;
  dealsClosedThisPeriod: number;
  totals: { deals: number; leads: number; videos: number };
};
type SummaryResponse = { data?: Summary; error?: string };

const REPORT_TYPES: { type: ReportType; title: string; icon: typeof FileText; color: string }[] = [
  {
    type: "deals",
    title: "Brand Deals",
    icon: DollarSign,
    color: "bg-brand-purple/10 text-brand-purple",
  },
  { type: "leads", title: "Leads", icon: Users, color: "bg-brand-green/10 text-brand-green" },
  { type: "videos", title: "Videos", icon: Video, color: "bg-brand-amber/10 text-brand-amber" },
];

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function downloadReport(type: ReportType, startDate: string, endDate: string) {
  const params = new URLSearchParams({ type });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const a = document.createElement("a");
  a.href = `/api/reports/export?${params.toString()}`;
  a.click();
}

function Reports() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [customType, setCustomType] = useState<ReportType>("deals");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/reports/summary", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as SummaryResponse;
        if (!response.ok || !body.data) throw new Error();
        setSummary(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [retryNonce]);

  return (
    <DashboardLayout title="Reports">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        </div>
      </div>

      {status === "loading" && (
        <p className="mt-6 text-sm text-muted-foreground">Loading your reports…</p>
      )}

      {status === "error" && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load your reports.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && summary && (
        <>
          <h2 className="mt-6 text-lg font-semibold">Key Insights — {summary.periodLabel}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            <FlatKpiCard
              title="Revenue Closed"
              value={fmtMoney(summary.revenueThisPeriod)}
              caption={
                summary.revenueChangePct !== null
                  ? `${summary.revenueChangePct >= 0 ? "+" : ""}${summary.revenueChangePct.toFixed(1)}% vs prior 30 days`
                  : "From closed brand deals"
              }
            />
            <FlatKpiCard
              title="Active Pipeline"
              value={fmtMoney(summary.activePipeline)}
              caption="Deals not yet closed"
            />
            <FlatKpiCard
              title="Leads Captured"
              value={String(summary.leadsThisPeriod)}
              caption={
                summary.leadsChangePct !== null
                  ? `${summary.leadsChangePct >= 0 ? "+" : ""}${summary.leadsChangePct.toFixed(1)}% vs prior 30 days`
                  : undefined
              }
            />
            <FlatKpiCard
              title="Deals Closed"
              value={String(summary.dealsClosedThisPeriod)}
              caption={`${summary.videosThisPeriod} video${summary.videosThisPeriod === 1 ? "" : "s"} published`}
            />
          </div>

          <h2 className="mt-8 text-lg font-semibold">Available Reports</h2>
          <div className="mt-3 space-y-4">
            {REPORT_TYPES.map((r) => (
              <div
                key={r.type}
                className="relative flex flex-wrap items-center justify-between gap-4 rounded-xl card-gradient-outline p-5"
              >
                <GlowingEffect
                  spread={40}
                  glow
                  disabled={false}
                  proximity={64}
                  inactiveZone={0.01}
                />
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-full ${r.color}`}
                  >
                    <r.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{r.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {summary.totals[r.type]} total {r.title.toLowerCase()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => downloadReport(r.type, "", "")}
                  className="flex h-9 items-center gap-2 rounded-full border border-border bg-accent/30 px-3.5 text-sm hover:bg-accent"
                >
                  <Download className="h-4 w-4" /> Export CSV
                </button>
              </div>
            ))}
          </div>

          <div className="relative mt-8 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h2 className="text-lg font-semibold">Custom Report</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Export a CSV for a date range. PDF/XLSX coming later.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">Start date</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">End date</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">Report Type</label>
                <div className="flex h-11 rounded-full border border-border bg-accent/20 p-1 text-sm">
                  {REPORT_TYPES.map((r) => (
                    <button
                      key={r.type}
                      onClick={() => setCustomType(r.type)}
                      className={`flex-1 rounded-[var(--button-radius)] font-medium ${customType === r.type ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => downloadReport(customType, startDate, endDate)}
              className="mt-5 flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-4 w-4" /> Generate &amp; Export
            </button>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
