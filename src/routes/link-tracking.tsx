import { createFileRoute } from "@tanstack/react-router";
import { Search, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ChangeCell } from "@/components/ui-bits";
import { links } from "@/lib/data";

export const Route = createFileRoute("/link-tracking")({
  component: LinkTracking,
});

function LinkTracking() {
  return (
    <DashboardLayout title="Link Tracking">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Link Tracking</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track every click, conversion, and revenue path</p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Create Link
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Summary value="5" label="Total Links" />
        <Summary value="12,688" label="Total Clicks" />
        <Summary value="2,343" label="Total Conversions" />
        <Summary value="18.5%" label="Avg CVR" />
      </div>

      <div className="relative mt-5">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input placeholder="Search links..." className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-primary" />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-4 font-medium">Short Link</th>
              <th className="px-3 py-4 font-medium">Source Video</th>
              <th className="px-3 py-4 font-medium">Clicks</th>
              <th className="px-3 py-4 font-medium">Unique</th>
              <th className="px-3 py-4 font-medium">Conversions</th>
              <th className="px-3 py-4 font-medium">CVR</th>
              <th className="px-3 py-4 font-medium">Revenue</th>
              <th className="px-3 py-4 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.short} className="border-b border-border last:border-0 hover:bg-accent/30">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                    <div>
                      <p className="font-medium text-brand-purple">{l.short}</p>
                      <p className="text-xs text-muted-foreground">{l.full}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-4 text-muted-foreground">{l.source}</td>
                <td className="px-3 py-4">{l.clicks}</td>
                <td className="px-3 py-4 text-muted-foreground">{l.unique}</td>
                <td className="px-3 py-4">{l.conversions}</td>
                <td className="px-3 py-4 font-semibold">{l.cvr}</td>
                <td className="px-3 py-4 font-semibold">{l.revenue}</td>
                <td className="px-3 py-4">
                  <div className="flex justify-end"><ChangeCell change={l.change} up={l.up} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
