import { createFileRoute } from "@tanstack/react-router";
import { Plus, TrendingUp, Users, DollarSign, MoreHorizontal, User, Calendar } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard, Tag } from "@/components/ui-bits";
import { dealStages } from "@/lib/data";

export const Route = createFileRoute("/brand-deals")({
  component: BrandDeals,
});

function BrandDeals() {
  return (
    <DashboardLayout title="Brand Deals">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Deal Board</h1>
          <p className="mt-1 text-sm text-muted-foreground">CRM-style pipeline for sponsorship management</p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Deal
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value="$161K" label="Pipeline Value" />
        <StatCard icon={<Users className="h-5 w-5" />} value="10" label="Active Deals" />
        <StatCard icon={<DollarSign className="h-5 w-5" />} value="$39K" label="Closed Revenue" />
        <StatCard icon={<MoreHorizontal className="h-5 w-5" />} value="$16.1K" label="Avg Deal Size" />
      </div>

      <div className="mt-6 flex gap-4 overflow-x-auto pb-4">
        {dealStages.map((stage) => (
          <div key={stage.name} className="w-[290px] shrink-0">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
                <span className="text-sm font-semibold">{stage.name}</span>
                <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">{stage.count}</span>
              </div>
              <span className="text-xs text-muted-foreground">{stage.total}</span>
            </div>

            <div className="space-y-3">
              {stage.deals.map((d) => (
                <div key={d.company} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{d.company}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />{d.contact}
                      </p>
                    </div>
                    <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="flex items-center gap-1 font-bold text-brand-green">
                      <DollarSign className="h-4 w-4" />{d.value.replace("$", "")}
                    </span>
                    <Tag label={d.tag} />
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Progress</span>
                      <span className="font-medium text-foreground">{d.progress}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${d.progress}%`,
                          background: d.progress === 100 ? "var(--color-brand-amber)" : "var(--color-brand-green)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Next action</p>
                      <p className="text-xs font-medium">{d.action}</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />{d.date}
                    </span>
                  </div>
                </div>
              ))}

              <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                <Plus className="h-4 w-4" /> Add deal
              </button>
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
