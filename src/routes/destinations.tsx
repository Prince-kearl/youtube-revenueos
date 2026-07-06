import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Plus, Pencil, Trash2, ShoppingCart, TrendingUp, MousePointer2, Link2, ExternalLink,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tag } from "@/components/ui-bits";
import { destinations } from "@/lib/data";

export const Route = createFileRoute("/destinations")({
  component: Destinations,
});

const icons = { cart: ShoppingCart, trend: TrendingUp, cursor: MousePointer2, link: Link2, external: ExternalLink };
const iconBg: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  green: "bg-brand-green/15 text-brand-green",
  blue: "bg-brand-blue/15 text-brand-blue",
  amber: "bg-brand-amber/15 text-brand-amber",
  red: "bg-brand-red/15 text-brand-red",
};

function Destinations() {
  const [view, setView] = useState<"Cards" | "List">("Cards");

  return (
    <DashboardLayout title="Destinations">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Destinations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage and track all your conversion links</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-border bg-card p-1 text-sm">
            {(["Cards", "List"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 font-medium ${view === v ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
                {v}
              </button>
            ))}
          </div>
          <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add Destination
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Summary value="5" label="Total Destinations" />
        <Summary value="67.8K" label="Total Clicks" />
        <Summary value="16.9K" label="Total Conversions" />
        <Summary value="$76.2K" label="Revenue Attributed" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {destinations.map((d) => {
          const Icon = icons[d.icon as keyof typeof icons];
          return (
            <div key={d.name} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg[d.tagColor]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <Tag label={d.tag} color={d.tagColor} />
                  </div>
                </div>
                <div className="flex gap-1 text-muted-foreground">
                  <button className="hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                  <button className="hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <p className="mt-4 truncate text-xs text-muted-foreground">{d.url}</p>
              <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
                <Metric value={d.clicks} label="Clicks" />
                <Metric value={d.cvr} label="CVR" />
                <Metric value={d.revenue} label="Revenue" muted={d.revenue === "N/A"} />
              </div>
            </div>
          );
        })}

        <button className="flex min-h-[196px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
            <Plus className="h-5 w-5" />
          </div>
          Add new destination
        </button>
      </div>
    </DashboardLayout>
  );
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function Metric({ value, label, muted }: { value: string; label: string; muted?: boolean }) {
  return (
    <div className="px-2 py-3 text-center">
      <p className={`text-sm font-bold ${muted ? "text-muted-foreground" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
