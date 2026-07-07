import { createFileRoute } from "@tanstack/react-router";
import {
  Mail, MailOpen, MousePointerClick, AlertOctagon, Plus,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";

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

const campaigns = [
  { name: "Welcome — Freebie Delivery", sent: "4,210", open: "62.4%", click: "24.1%", status: "Sending" },
  { name: "Day 2 — Value Drop", sent: "3,980", open: "48.9%", click: "18.7%", status: "Sent" },
  { name: "Day 5 — Offer", sent: "3,640", open: "41.2%", click: "12.4%", status: "Sent" },
  { name: "December Broadcast", sent: "650", open: "39.8%", click: "9.6%", status: "Scheduled" },
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
};

function EmailSender() {
  const max = funnel[0].value;

  return (
    <DashboardLayout title="Email">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Email & Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            High-deliverability broadcasts and drip sequences tied directly to your freebie funnels.
          </p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Campaign
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<MailOpen className="h-5 w-5" />} value="49.0%" label="Open Rate" change="3.4%" up />
        <StatCard icon={<MousePointerClick className="h-5 w-5" />} value="18.3%" label="Click Rate" change="1.9%" up />
        <StatCard icon={<AlertOctagon className="h-5 w-5" />} value="3.0%" label="Bounce Rate" change="0.4%" up={false} />
        <StatCard icon={<Mail className="h-5 w-5" />} value="1.1%" label="Unsubscribe Rate" change="0.2%" up={false} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Funnel */}
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

        {/* Live activity */}
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

      {/* Campaigns table */}
      <div className="mt-5 rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h3 className="text-lg font-semibold">Campaigns</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-5 py-3 font-medium">Sent</th>
                <th className="px-5 py-3 font-medium">Open Rate</th>
                <th className="px-5 py-3 font-medium">Click Rate</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.name} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 font-medium">{c.name}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{c.sent}</td>
                  <td className="px-5 py-3.5 font-semibold">{c.open}</td>
                  <td className="px-5 py-3.5 font-semibold">{c.click}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[c.status]}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
