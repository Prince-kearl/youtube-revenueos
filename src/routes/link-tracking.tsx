import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Plus, Copy, Pencil, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ChangeCell } from "@/components/ui-bits";
import { useLinks, TrackLink } from "@/lib/stores";
import { LinkDialog, ConfirmDialog } from "@/components/modals";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/link-tracking")({
  component: LinkTracking,
});

function LinkTracking() {
  const [links, setLinks] = useLinks();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TrackLink | null>(null);
  const [deleting, setDeleting] = useState<TrackLink | null>(null);

  const save = (l: TrackLink) =>
    setLinks((prev) => (prev.some((x) => x.id === l.id) ? prev.map((x) => (x.id === l.id ? l : x)) : [l, ...prev]));

  const filtered = links.filter((l) =>
    (l.short + l.full + l.source).toLowerCase().includes(query.toLowerCase()),
  );

  const totalClicks = links.reduce((a, l) => a + (Number(l.clicks.replace(/,/g, "")) || 0), 0);
  const totalConv = links.reduce((a, l) => a + (Number(l.conversions.replace(/,/g, "")) || 0), 0);
  const avgCvr = totalClicks > 0 ? ((totalConv / totalClicks) * 100).toFixed(1) + "%" : "0%";

  const copy = async (short: string) => {
    try { await navigator.clipboard.writeText("https://" + short); toast.success("Copied to clipboard"); }
    catch { toast.error("Copy failed"); }
  };

  return (
    <DashboardLayout title="Link Tracking">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Link Tracking</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track every click, conversion, and revenue path</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Create Link
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <Summary value={String(links.length)} label="Total Links" />
        <Summary value={totalClicks.toLocaleString()} label="Total Clicks" />
        <Summary value={totalConv.toLocaleString()} label="Total Conversions" />
        <Summary value={avgCvr} label="Avg CVR" />
      </div>

      <div className="relative mt-5">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search links..." className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-primary" />
      </div>

      {filtered.length === 0 ? (
        <div className="relative mt-5 rounded-xl card-gradient-outline">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query ? "No links match your search." : "No links yet — click Create Link to add one."}
          </p>
        </div>
      ) : (
      <>
        {/* Mobile: stacked cards */}
        <div className="mt-5 space-y-3 sm:hidden">
          {filtered.map((l) => (
            <div key={l.id} className="relative rounded-xl card-gradient-outline p-4">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-brand-purple">{l.short}</p>
                  <p className="truncate text-xs text-muted-foreground">{l.full}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Source: {l.source}</p>
              <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-accent/30 p-2.5 text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Clicks</p>
                  <p className="mt-0.5 font-medium">{l.clicks}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Unique</p>
                  <p className="mt-0.5 font-medium">{l.unique}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Conv.</p>
                  <p className="mt-0.5 font-medium">{l.conversions}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">CVR</p>
                  <p className="mt-0.5 font-medium">{l.cvr}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-semibold">{l.revenue}</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <ChangeCell change={l.change} up={l.up} />
                  <button onClick={() => copy(l.short)} className="hover:text-foreground" aria-label="Copy"><Copy className="h-4 w-4" /></button>
                  <button onClick={() => setEditing(l)} className="hover:text-foreground" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => setDeleting(l)} className="hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
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
                <th className="px-5 py-4 font-medium">Short Link</th>
                <th className="px-3 py-4 font-medium">Source Video</th>
                <th className="px-3 py-4 font-medium">Clicks</th>
                <th className="px-3 py-4 font-medium">Unique</th>
                <th className="px-3 py-4 font-medium">Conv.</th>
                <th className="px-3 py-4 font-medium">CVR</th>
                <th className="px-3 py-4 font-medium">Revenue</th>
                <th className="px-3 py-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-accent/30">
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
                    <div className="flex items-center justify-end gap-2 text-muted-foreground">
                      <ChangeCell change={l.change} up={l.up} />
                      <button onClick={() => copy(l.short)} className="hover:text-foreground" aria-label="Copy"><Copy className="h-4 w-4" /></button>
                      <button onClick={() => setEditing(l)} className="hover:text-foreground" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => setDeleting(l)} className="hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
      )}

      <LinkDialog open={creating} onOpenChange={setCreating} onSave={save} />
      <LinkDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} onSave={save} />
      <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete ${deleting?.short}?`} onConfirm={() => { if (deleting) { setLinks((p) => p.filter((x) => x.id !== deleting.id)); toast.success("Link deleted"); } setDeleting(null); }} />
    </DashboardLayout>
  );
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
