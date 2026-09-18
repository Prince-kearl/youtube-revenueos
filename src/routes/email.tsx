import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/modals";

export const Route = createFileRoute("/email")({
  component: EmailSender,
});

type CampaignStatus = "draft" | "ready";
type Campaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
};
type AudienceMember = {
  id: string;
  name: string | null;
  email: string;
  platform: string;
  status: string;
  created_at: string;
};
type CampaignsResponse = { data?: Campaign[]; error?: string };
type AudienceResponse = { data?: AudienceMember[]; error?: string };

const statusMeta: Record<CampaignStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-accent text-muted-foreground" },
  ready: { label: "Ready to Send", className: "bg-success/15 text-success" },
};

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
function monthLabel(key: string | undefined): string {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return "";
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
function signed(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value)}`;
}
function pctChange(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series.at(-2)!;
  const curr = series.at(-1)!;
  if (prev === 0) return curr > 0 ? 100 : null;
  return ((curr - prev) / prev) * 100;
}
function lastMonthKeys(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    monthKey(
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1),
      ).toISOString(),
    ),
  );
}
function cumulativeSeriesFor(dates: string[], months: string[]): number[] {
  const countByMonth = new Map<string, number>();
  for (const d of dates) countByMonth.set(monthKey(d), (countByMonth.get(monthKey(d)) ?? 0) + 1);
  const before = dates.filter((d) => monthKey(d) < months[0]).length;
  let running = before;
  return months.map((k) => (running += countByMonth.get(k) ?? 0));
}
function perMonthSeriesFor(dates: string[], months: string[]): number[] {
  const countByMonth = new Map<string, number>();
  for (const d of dates) countByMonth.set(monthKey(d), (countByMonth.get(monthKey(d)) ?? 0) + 1);
  return months.map((k) => countByMonth.get(k) ?? 0);
}

function EmailSender() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsStatus, setCampaignsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [audience, setAudience] = useState<AudienceMember[]>([]);
  const [audienceStatus, setAudienceStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const load = () => {
    setCampaignsStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    setAudienceStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/campaigns", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as CampaignsResponse;
        if (!response.ok || !body.data) throw new Error();
        setCampaigns(body.data);
        setCampaignsStatus("ready");
      })
      .catch(() => setCampaignsStatus("error"));
    fetch("/api/email/audience", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as AudienceResponse;
        if (!response.ok || !body.data) throw new Error();
        setAudience(body.data);
        setAudienceStatus("ready");
      })
      .catch(() => setAudienceStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const campaignStats = useMemo(() => {
    const months = lastMonthKeys(6);
    const dates = campaigns.map((c) => c.created_at);
    const cumulativeSeries = cumulativeSeriesFor(dates, months);
    const perMonthSeries = perMonthSeriesFor(dates, months);
    return {
      total: campaigns.length,
      thisMonthCount: perMonthSeries.at(-1) ?? 0,
      totalChangePct: pctChange(cumulativeSeries),
      monthChangePct: pctChange(perMonthSeries),
      cumulativeSeries,
      perMonthSeries,
      latestMonthLabel: monthLabel(months.at(-1)),
      periodLabel: `Past ${months.length} months`,
    };
  }, [campaigns]);

  const audienceStats = useMemo(() => {
    const months = lastMonthKeys(6);
    const dates = audience.map((a) => a.created_at);
    const cumulativeSeries = cumulativeSeriesFor(dates, months);
    const byPlatform = new Map<string, number>();
    for (const a of audience) byPlatform.set(a.platform, (byPlatform.get(a.platform) ?? 0) + 1);
    return {
      total: audience.length,
      changePct: pctChange(cumulativeSeries),
      cumulativeSeries,
      byPlatform: [...byPlatform.entries()].sort((a, b) => b[1] - a[1]),
      recent: audience.slice(0, 6),
    };
  }, [audience]);

  const createCampaign = async (input: {
    name: string;
    subject: string;
    body: string;
    status: CampaignStatus;
  }) => {
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "CREATE_FAILED");
    setCampaigns((prev) => [body.data, ...prev]);
    toast.success("Campaign created");
  };

  const updateCampaign = async (
    id: string,
    input: { name: string; subject: string; body: string; status: CampaignStatus },
  ) => {
    const response = await fetch(`/api/campaigns?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "UPDATE_FAILED");
    setCampaigns((prev) => prev.map((c) => (c.id === id ? body.data : c)));
    toast.success("Campaign updated");
  };

  const deleteCampaign = async (campaign: Campaign) => {
    try {
      const response = await fetch(`/api/campaigns?id=${campaign.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
      toast.success("Campaign deleted");
    } catch {
      toast.error("Couldn't delete that campaign. Please try again.");
    }
  };

  return (
    <DashboardLayout title="Email">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Email &amp; Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose campaigns for your audience. Sending isn't connected yet — campaigns are saved
            as drafts.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Campaign
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTrendCard
          title="Total Campaigns"
          accent="var(--brand-blue)"
          value={String(campaignStats.total)}
          deltaLabel={signed(campaignStats.cumulativeSeries.at(-1) ?? 0)}
          deltaSuffix="all time"
          changePercent={campaignStats.totalChangePct}
          periodLabel={campaignStats.periodLabel}
          series={campaignStats.cumulativeSeries}
          markerTitle={String(campaignStats.cumulativeSeries.at(-1) ?? 0)}
          markerSubtitle={campaignStats.latestMonthLabel}
          positive={(campaignStats.totalChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Created This Month"
          accent="var(--brand-purple)"
          value={String(campaignStats.thisMonthCount)}
          deltaLabel={signed(campaignStats.thisMonthCount)}
          deltaSuffix="this month"
          changePercent={campaignStats.monthChangePct}
          periodLabel={campaignStats.periodLabel}
          series={campaignStats.perMonthSeries}
          markerTitle={String(campaignStats.thisMonthCount)}
          markerSubtitle={campaignStats.latestMonthLabel}
          positive={(campaignStats.monthChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Addressable Audience"
          accent="var(--brand-green)"
          value={String(audienceStats.total)}
          deltaLabel={signed(audienceStats.cumulativeSeries.at(-1) ?? 0)}
          deltaSuffix="leads with email"
          changePercent={audienceStats.changePct}
          periodLabel={campaignStats.periodLabel}
          series={audienceStats.cumulativeSeries}
          markerTitle={String(audienceStats.cumulativeSeries.at(-1) ?? 0)}
          markerSubtitle={campaignStats.latestMonthLabel}
          positive={(audienceStats.changePct ?? 0) >= 0}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">Audience Breakdown</h3>
          <p className="text-xs text-muted-foreground">Leads with an email on file, by source.</p>
          {audienceStatus === "loading" && (
            <p className="mt-5 text-sm text-muted-foreground">Loading…</p>
          )}
          {audienceStatus === "ready" && audienceStats.byPlatform.length === 0 && (
            <p className="mt-5 text-sm text-muted-foreground">
              No leads with an email yet — add one in Lead Inbox, or capture one through Comment
              Automation.
            </p>
          )}
          {audienceStatus === "ready" && audienceStats.byPlatform.length > 0 && (
            <div className="mt-5 space-y-3">
              {audienceStats.byPlatform.map(([platform, count]) => {
                const pct = Math.round((count / audienceStats.total) * 100);
                return (
                  <div key={platform}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{platform}</span>
                      <span className="font-semibold">
                        {count.toLocaleString()} · {pct}%
                      </span>
                    </div>
                    <div className="h-6 w-full overflow-hidden rounded-lg bg-accent">
                      <div
                        className="h-full rounded-lg bg-brand-blue"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">Recent Recipients</h3>
          {audienceStatus === "ready" && audienceStats.recent.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No recipients yet.</p>
          )}
          <div className="mt-4 space-y-2.5">
            {audienceStats.recent.map((a) => (
              <div key={a.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {a.name || a.email}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{a.email}</span>
                  <span className="shrink-0">· {a.platform}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mt-5 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="flex items-center justify-between border-b border-border p-5">
          <h3 className="text-lg font-semibold">Campaigns</h3>
        </div>

        {campaignsStatus === "loading" && (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Loading campaigns…</p>
        )}

        {campaignsStatus === "error" && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load your campaigns.</p>
            <button
              onClick={() => setRetryNonce((n) => n + 1)}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        )}

        {campaignsStatus === "ready" && campaigns.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No campaigns yet. Create your first one above.
          </p>
        )}

        {campaignsStatus === "ready" && campaigns.length > 0 && (
          <>
            {/* Mobile: stacked cards */}
            <div className="space-y-3 p-5 sm:hidden">
              {campaigns.map((c) => (
                <div key={c.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium">{c.name}</p>
                    <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <button
                        onClick={() => setEditing(c)}
                        className="hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleting(c)}
                        className="hover:text-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{c.subject}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusMeta[c.status].className}`}
                    >
                      {statusMeta[c.status].label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
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
                    <th className="px-5 py-3 font-medium">Subject</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3.5 font-medium">{c.name}</td>
                      <td className="max-w-[280px] truncate px-5 py-3.5 text-muted-foreground">
                        {c.subject}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusMeta[c.status].className}`}
                        >
                          {statusMeta[c.status].label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2 text-muted-foreground">
                          <button
                            onClick={() => setEditing(c)}
                            className="hover:text-foreground"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleting(c)}
                            className="hover:text-destructive"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      <CampaignFormDialog open={creating} onOpenChange={setCreating} onSubmit={createCampaign} />
      <CampaignFormDialog
        open={!!editing}
        campaign={editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSubmit={(input) => (editing ? updateCampaign(editing.id, input) : Promise.resolve())}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        onConfirm={() => {
          if (deleting) void deleteCampaign(deleting);
          setDeleting(null);
        }}
      />
    </DashboardLayout>
  );
}

function CampaignFormDialog({
  open,
  campaign,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  campaign?: Campaign | null;
  onOpenChange: (v: boolean) => void;
  onSubmit: (input: {
    name: string;
    subject: string;
    body: string;
    status: CampaignStatus;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(campaign?.name ?? "");
    setSubject(campaign?.subject ?? "");
    setBody(campaign?.body ?? "");
    setStatus(campaign?.status ?? "draft");
  }, [open, campaign]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Campaign name is required");
    if (!subject.trim()) return toast.error("Subject is required");
    if (!body.trim()) return toast.error("Email body is required");
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), subject: subject.trim(), body: body.trim(), status });
      onOpenChange(false);
    } catch {
      toast.error("Couldn't save that campaign. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{campaign ? "Edit Campaign" : "New Campaign"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Campaign name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome — Freebie Delivery"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Subject line</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Here's your free cheatsheet"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email body</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Write your email…"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Status</label>
            <div className="flex gap-2">
              {(["draft", "ready"] as CampaignStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                    status === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {statusMeta[s].label}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Saving…" : campaign ? "Save Changes" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
