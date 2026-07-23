import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Mail, MailOpen, MousePointerClick, AlertOctagon, Plus, Pencil, Trash2,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { useCampaigns, Campaign } from "@/lib/stores";
import { CampaignDialog, ConfirmDialog } from "@/components/modals";
import { toast } from "sonner";

export const Route = createFileRoute("/email")({
  component: EmailSender,
});

const funnel = [
  { stage: "Sent", value: 12480, color: "var(--color-brand-blue)" },
  { stage: "Delivered", value: 12106, color: "var(--color-brand-purple)" },
  { stage: "Opened", value: 5934, color: "var(--color-brand-green)" },
  { stage: "Clicked", value: 2218, color: "var(--color-brand-amber)" },
  { stage: "Converted", value: 486, color: "var(--color-success)" },
];

const activity = [
  { email: "m***@gmail.com", event: "Opened", loc: "London, UK", device: "iPhone", time: "just now" },
  { email: "s***@outlook.com", event: "Clicked", loc: "Austin, US", device: "Chrome", time: "1m" },
  { email: "d***@yahoo.com", event: "Opened", loc: "Toronto, CA", device: "Android", time: "2m" },
  { email: "e***@icloud.com", event: "Converted", loc: "Sydney, AU", device: "Safari", time: "4m" },
  { email: "j***@gmail.com", event: "Clicked", loc: "Berlin, DE", device: "Firefox", time: "6m" },
];

const eventColor: Record<string, string> = {
  Opened: "bg-brand-green/15 text-brand-green",
  Clicked: "bg-brand-amber/15 text-brand-amber",
  Converted: "bg-success/15 text-success",
};

const statusColor: Record<string, string> = {
  Sending: "bg-brand-blue/15 text-brand-blue",
  Sent: "bg-success/15 text-success",
  Scheduled: "bg-warning/15 text-warning",
  Draft: "bg-accent text-muted-foreground",
};

function EmailSender() {
  const max = funnel[0].value;
  const [campaigns, setCampaigns] = useCampaigns();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const save = (c: Campaign) =>
    setCampaigns((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [c, ...prev]));

  return (
    <DashboardLayout title="Email">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Email & Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            High-deliverability broadcasts and drip sequences tied directly to your freebie funnels.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Campaign
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<MailOpen className="h-5 w-5" />} value="49.0%" label="Open Rate" change="3.4%" up />
        <StatCard icon={<MousePointerClick className="h-5 w-5" />} value="18.3%" label="Click Rate" change="1.9%" up />
        <StatCard icon={<AlertOctagon className="h-5 w-5" />} value="3.0%" label="Bounce Rate" change="0.4%" up={false} />
        <StatCard icon={<Mail className="h-5 w-5" />} value="1.1%" label="Unsubscribe Rate" change="0.2%" up={false} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="text-lg font-semibold">Conversion Funnel</h3>
          <div className="mt-5 space-y-3">
            {funnel.map((f) => {
              const pct = Math.round((f.value / max) * 100);
              return (
                <div key={f.stage}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{f.stage}</span>
                    <span className="font-semibold">{f.value.toLocaleString()} · {pct}%</span>
                  </div>
                  <div className="h-6 w-full overflow-hidden rounded-lg bg-accent">
                    <div className="h-full rounded-lg" style={{ width: `${pct}%`, background: f.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-lg font-semibold">Live Activity</h3>
          <div className="mt-4 space-y-2.5">
            {activity.map((a, i) => (
              <div key={i} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{a.email}</span>
                  <span className="text-[11px] text-muted-foreground">{a.time}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${eventColor[a.event]}`}>{a.event}</span>
                  <span>{a.loc} · {a.device}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h3 className="text-lg font-semibold">Campaigns</h3>
        </div>
        {campaigns.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 p-5 sm:hidden">
            {campaigns.map((c) => (
              <div key={c.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{c.name}</p>
                  <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    <button onClick={() => setEditing(c)} className="hover:text-foreground" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(c)} className="hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[c.status]}`}>{c.status}</span>
                  <span className="text-xs text-muted-foreground">{c.sent} sent</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-accent/30 p-2.5 text-center text-xs">
                  <div>
                    <p className="text-muted-foreground">Open Rate</p>
                    <p className="mt-0.5 font-medium">{c.open}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Click Rate</p>
                    <p className="mt-0.5 font-medium">{c.click}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-5 py-3 font-medium">Sent</th>
                  <th className="px-5 py-3 font-medium">Open Rate</th>
                  <th className="px-5 py-3 font-medium">Click Rate</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 font-medium">{c.name}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{c.sent}</td>
                    <td className="px-5 py-3.5 font-semibold">{c.open}</td>
                    <td className="px-5 py-3.5 font-semibold">{c.click}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[c.status]}`}>{c.status}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2 text-muted-foreground">
                        <button onClick={() => setEditing(c)} className="hover:text-foreground" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => setDeleting(c)} className="hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
        )}
      </div>

      <CampaignDialog open={creating} onOpenChange={setCreating} onSave={save} />
      <CampaignDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} onSave={save} />
      <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete "${deleting?.name}"?`} onConfirm={() => { if (deleting) { setCampaigns((p) => p.filter((x) => x.id !== deleting.id)); toast.success("Campaign deleted"); } setDeleting(null); }} />
    </DashboardLayout>
  );
}
