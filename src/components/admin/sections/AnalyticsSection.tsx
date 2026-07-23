import { toast } from "sonner";
import { FileDown, TrendingDown, Filter, Repeat } from "lucide-react";
import { StatCard } from "@/components/ui-bits";

const funnel = [
  { stage: "Visited landing page", value: 18400 },
  { stage: "Signed up", value: 4920 },
  { stage: "Activated (connected channel)", value: 3480 },
  { stage: "Subscribed to a paid plan", value: 1120 },
];
const retention = [
  { month: "Month 1", pct: 100 }, { month: "Month 2", pct: 68 }, { month: "Month 3", pct: 54 },
  { month: "Month 4", pct: 47 }, { month: "Month 5", pct: 42 }, { month: "Month 6", pct: 39 },
];
const adoption = [
  { feature: "Link Tracking", pct: 91 }, { feature: "AI Lab", pct: 78 }, { feature: "Comment Automation", pct: 64 },
  { feature: "Brand Deals", pct: 52 }, { feature: "Affiliate", pct: 34 }, { feature: "Email Campaigns", pct: 21 },
];

export function AnalyticsSection() {
  const exportAs = (fmt: string) => toast.success(`Exporting analytics as ${fmt}…`, { description: "Download isn't wired up in this preview." });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics &amp; Reporting</h1>
          <p className="mt-1 text-sm text-muted-foreground">Churn, conversion, retention, and feature adoption across the platform.</p>
        </div>
        <div className="flex gap-1.5">
          {["CSV", "Excel", "PDF"].map((f) => (
            <button key={f} onClick={() => exportAs(f)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
              <FileDown className="h-3.5 w-3.5" /> {f}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<TrendingDown className="h-5 w-5" />} value="3.8%" label="Monthly Churn" change="0.4%" up={false} />
        <StatCard icon={<Filter className="h-5 w-5" />} value="6.1%" label="Visitor → Paid Conversion" change="0.9%" up />
        <StatCard icon={<Repeat className="h-5 w-5" />} value="39%" label="6-Month Retention" change="3%" up />
        <StatCard icon={<TrendingDown className="h-5 w-5" />} value="4.2m" label="Avg. Support Response" change="18%" up />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">Conversion Funnel</h3>
          <div className="mt-4 space-y-3">
            {funnel.map((f, i) => {
              const pct = Math.round((f.value / funnel[0].value) * 100);
              return (
                <div key={f.stage}>
                  <div className="flex justify-between text-xs text-muted-foreground"><span>{f.stage}</span><span>{f.value.toLocaleString()} · {pct}%</span></div>
                  <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-accent">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, opacity: 1 - i * 0.15 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">Retention by Cohort Month</h3>
          <div className="mt-4 space-y-3">
            {retention.map((r) => (
              <div key={r.month}>
                <div className="flex justify-between text-xs text-muted-foreground"><span>{r.month}</span><span>{r.pct}%</span></div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-accent">
                  <div className="h-full rounded-full bg-brand-green" style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold">Feature Adoption</h3>
          <p className="mt-1 text-xs text-muted-foreground">Share of organizations that have used each feature in the last 30 days.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {adoption.map((a) => (
              <div key={a.feature}>
                <div className="flex justify-between text-xs text-muted-foreground"><span>{a.feature}</span><span>{a.pct}%</span></div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-accent">
                  <div className="h-full rounded-full bg-brand-purple" style={{ width: `${a.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
