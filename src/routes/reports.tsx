import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BarChart3, DollarSign, TrendingUp, Eye, FileText, Download, Calendar } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { reports } from "@/lib/data";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/reports")({
  component: Reports,
});

const insights = [
  { icon: DollarSign, value: "+18.4%", title: "Revenue Growth", desc: "Year-over-year revenue growth driven by 6-figure brand deals pipeline" },
  { icon: TrendingUp, value: "Brand Deals", title: "Top Revenue Driver", desc: "62% of monthly revenue now comes from direct sponsorships" },
  { icon: Eye, value: "$0.052/view", title: "View Efficiency", desc: "Revenue per view increased 22% through better CTA placement" },
  { icon: BarChart3, value: "+62.9%", title: "CPM Trend", desc: "CPM grew from $6.20 to $10.10 over 6 months — Q4 seasonality peak" },
];

const badgeColor: Record<string, string> = {
  purple: "bg-brand-purple/10 text-brand-purple",
  green: "bg-brand-green/10 text-brand-green",
  amber: "bg-brand-amber/10 text-brand-amber",
};

function Reports() {
  const [format, setFormat] = useState("PDF");

  return (
    <DashboardLayout title="Reports">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Performance summaries and exportable reports</p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <BarChart3 className="h-4 w-4" /> Generate Report
        </button>
      </div>

      <h2 className="mt-6 text-lg font-semibold">Key Insights</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        {insights.map((it) => (
          <div key={it.title} className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
              <it.icon className="h-5 w-5" />
            </div>
            <p className="mt-4 text-xl font-bold">{it.value}</p>
            <p className="mt-1 text-sm font-medium">{it.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{it.desc}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Available Reports</h2>
      <div className="mt-3 space-y-4">
        {reports.map((r) => (
          <div key={r.title} className="relative flex flex-wrap items-center justify-between gap-4 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start gap-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${badgeColor[r.color]}`}>
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">{r.title}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" /> {r.range}
                  <span className="rounded bg-success/15 px-1.5 py-0.5 font-medium text-success">Ready</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.badges.map((b) => (
                    <span key={b} className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${badgeColor[r.color]}`}>{b}</span>
                  ))}
                </div>
              </div>
            </div>
            <button className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-accent/30 px-3.5 text-sm hover:bg-accent">
              <Download className="h-4 w-4" /> Export
            </button>
          </div>
        ))}
      </div>

      <div className="relative mt-8 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <h2 className="text-lg font-semibold">Custom Report</h2>
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm text-muted-foreground">Date Range</label>
            <input type="text" placeholder="dd/mm/yyyy" className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-2 block text-sm text-muted-foreground">Report Type</label>
            <div className="flex h-11 items-center rounded-xl border border-border bg-accent/20 px-4 text-sm">Full Revenue Report</div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-muted-foreground">Format</label>
            <div className="flex h-11 rounded-xl border border-border bg-accent/20 p-1 text-sm">
              {["PDF", "CSV", "XLSX"].map((f) => (
                <button key={f} onClick={() => setFormat(f)} className={`flex-1 rounded-[var(--button-radius)] font-medium ${format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button className="mt-5 flex h-11 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Download className="h-4 w-4" /> Generate & Export
        </button>
      </div>
    </DashboardLayout>
  );
}
