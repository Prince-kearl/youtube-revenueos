import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Plus, Pencil, Trash2, ShoppingCart, TrendingUp, MousePointer2, Link2, ExternalLink,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tag } from "@/components/ui-bits";
import { useDestinations, Destination } from "@/lib/stores";
import { DestinationDialog, ConfirmDialog } from "@/components/modals";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

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
  const [destinations, setDestinations] = useDestinations();
  const [editing, setEditing] = useState<Destination | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Destination | null>(null);

  const save = (d: Destination) =>
    setDestinations((prev) => (prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? d : x)) : [d, ...prev]));
  const remove = (d: Destination) => { setDestinations((prev) => prev.filter((x) => x.id !== d.id)); toast.success("Destination deleted"); };

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
              <button key={v} onClick={() => setView(v)} className={`rounded-[var(--button-radius)] px-3 py-1 font-medium ${view === v ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add Destination
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <Summary value={String(destinations.length)} label="Total Destinations" />
        <Summary value={sumStr(destinations.map((d) => d.clicks))} label="Total Clicks" />
        <Summary value={"—"} label="Total Conversions" />
        <Summary value={"—"} label="Revenue Attributed" />
      </div>

      {destinations.length === 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No destinations yet.</p>
          <button onClick={() => setCreating(true)} className="mt-3 inline-flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> Add your first destination
          </button>
        </div>
      )}

      {view === "Cards" ? (
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {destinations.map((d) => {
            const Icon = icons[d.icon as keyof typeof icons] ?? Link2;
            return (
              <div key={d.id} className="relative rounded-xl card-gradient-outline p-5">
                <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg[d.tagColor] ?? iconBg.purple}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{d.name}</p>
                      <Tag label={d.tag} color={d.tagColor} />
                    </div>
                  </div>
                  <div className="flex gap-1 text-muted-foreground">
                    <button onClick={() => setEditing(d)} className="hover:text-foreground" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(d)} className="hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="mt-4 block truncate text-xs text-muted-foreground hover:text-primary hover:underline">{d.url}</a>
                <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
                  <Metric value={d.clicks} label="Clicks" />
                  <Metric value={d.cvr} label="CVR" />
                  <Metric value={d.revenue} label="Revenue" muted={d.revenue === "N/A"} />
                </div>
              </div>
            );
          })}
          <button onClick={() => setCreating(true)} className="flex min-h-[196px] flex-col items-center justify-center gap-3 rounded-[var(--button-radius)] border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent"><Plus className="h-5 w-5" /></div>
            Add new destination
          </button>
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="mt-5 space-y-3 sm:hidden">
            {destinations.map((d) => (
              <div key={d.id} className="relative rounded-xl card-gradient-outline p-4">
                <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{d.url}</p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-muted-foreground">
                    <button onClick={() => setEditing(d)} aria-label="Edit" className="hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(d)} aria-label="Delete" className="hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-accent/30 p-2.5 text-center text-xs">
                  <div>
                    <p className="text-muted-foreground">Clicks</p>
                    <p className="mt-0.5 font-medium">{d.clicks}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">CVR</p>
                    <p className="mt-0.5 font-medium">{d.cvr}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Revenue</p>
                    <p className="mt-0.5 font-medium">{d.revenue}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="relative mt-5 hidden overflow-x-auto rounded-xl card-gradient-outline sm:block">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">URL</th>
                  <th className="px-3 py-3 font-medium">Clicks</th>
                  <th className="px-3 py-3 font-medium">CVR</th>
                  <th className="px-3 py-3 font-medium">Revenue</th>
                  <th className="px-3 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                    <td className="px-4 py-3 font-medium">{d.name}</td>
                    <td className="px-3 py-3 text-muted-foreground truncate max-w-[240px]">{d.url}</td>
                    <td className="px-3 py-3">{d.clicks}</td>
                    <td className="px-3 py-3">{d.cvr}</td>
                    <td className="px-3 py-3">{d.revenue}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2 text-muted-foreground">
                        <button onClick={() => setEditing(d)} className="hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => setDeleting(d)} className="hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <DestinationDialog open={creating} onOpenChange={setCreating} onSave={save} />
      <DestinationDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} onSave={save} />
      <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete ${deleting?.name}?`} onConfirm={() => { if (deleting) remove(deleting); setDeleting(null); }} />
    </DashboardLayout>
  );
}

function sumStr(vals: string[]) {
  const total = vals.reduce((a, v) => a + Number(v.replace(/[^\d.]/g, "")) || 0, 0);
  return total.toLocaleString();
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
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
