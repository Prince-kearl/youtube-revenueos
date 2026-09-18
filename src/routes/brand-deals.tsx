import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  DollarSign,
  MoreHorizontal,
  User,
  Calendar,
  Pencil,
  Trash2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tag } from "@/components/ui-bits";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/modals";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/brand-deals")({
  component: BrandDeals,
});

type DealStage = "prospect" | "pitched" | "negotiating" | "contracted" | "completed";
const DEAL_STAGES: DealStage[] = ["prospect", "pitched", "negotiating", "contracted", "completed"];
const stageLabel: Record<DealStage, string> = {
  prospect: "Prospect",
  pitched: "Pitched",
  negotiating: "Negotiating",
  contracted: "Contracted",
  completed: "Completed",
};
const stageColor: Record<DealStage, string> = {
  prospect: "var(--color-muted-foreground)",
  pitched: "var(--color-warning)",
  negotiating: "var(--color-brand-purple)",
  contracted: "var(--color-brand-blue)",
  completed: "var(--color-brand-green)",
};
// Progress is derived from stage, not tracked as a separate field — a deal's completion % is
// always exactly what its pipeline stage says, never something that can drift out of sync.
const stageProgress: Record<DealStage, number> = {
  prospect: 20,
  pitched: 40,
  negotiating: 60,
  contracted: 80,
  completed: 100,
};

type Deal = {
  id: string;
  name: string;
  contact_name: string | null;
  value: number;
  currency: string;
  tag: string | null;
  stage: DealStage;
  next_action: string | null;
  expected_close_date: string | null;
  closed_at: string | null;
  notes: string | null;
  assigned_member_id: string | null;
  created_at: string;
  updated_at: string;
};
type DealsResponse = { data?: Deal[]; error?: string };
type TeamMemberOption = { id: string; name: string };
type TeamMembersResponse = {
  data?: {
    id: string;
    invited_email: string;
    member: { name: string | null } | null;
  }[];
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
// Buckets `entries` by month(dateOf) and, per month, sums valueOf — then turns that into a
// running (cumulative) total across `months`, seeded with whatever predates the window so the
// curve reflects the real historical total rather than restarting at 0.
function cumulativeValueSeries<T>(
  entries: T[],
  dateOf: (t: T) => string,
  valueOf: (t: T) => number,
  months: string[],
): number[] {
  const byMonth = new Map<string, number>();
  for (const e of entries) {
    const k = monthKey(dateOf(e));
    byMonth.set(k, (byMonth.get(k) ?? 0) + valueOf(e));
  }
  const before = entries
    .filter((e) => monthKey(dateOf(e)) < months[0])
    .reduce((a, e) => a + valueOf(e), 0);
  let running = before;
  return months.map((k) => (running += byMonth.get(k) ?? 0));
}
function perMonthCountSeries<T>(
  entries: T[],
  dateOf: (t: T) => string,
  months: string[],
): number[] {
  const byMonth = new Map<string, number>();
  for (const e of entries)
    byMonth.set(monthKey(dateOf(e)), (byMonth.get(monthKey(dateOf(e))) ?? 0) + 1);
  return months.map((k) => byMonth.get(k) ?? 0);
}

function fmtK(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;
}

const SPONSOR_COLORS = [
  "var(--brand-blue)",
  "var(--brand-purple)",
  "var(--brand-green)",
  "var(--brand-amber)",
  "var(--brand-red)",
];
const MAX_SPONSOR_LINES = 5;

function BrandDeals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [creating, setCreating] = useState<{ open: boolean; stage?: DealStage }>({ open: false });
  const [deleting, setDeleting] = useState<Deal | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/deals", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as DealsResponse;
        if (!response.ok || !body.data) throw new Error();
        setDeals(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    fetch("/api/workspace/members", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as TeamMembersResponse;
        if (!response.ok || !body.data) return;
        setTeamMembers(
          body.data.map((m) => ({ id: m.id, name: m.member?.name || m.invited_email })),
        );
      })
      .catch(() => {});
  }, []);
  useEffect(load, [retryNonce]);

  const stats = useMemo(() => {
    const months = lastMonthKeys(6);
    const periodLabel = `Past ${months.length} months`;
    const latestMonthLabel = monthLabel(months.at(-1));

    const pipeline = deals.reduce((a, d) => a + d.value, 0);
    const active = deals.filter((d) => d.stage !== "completed").length;
    const closedDeals = deals.filter((d) => d.stage === "completed");
    const closed = closedDeals.reduce((a, d) => a + d.value, 0);
    const avg = deals.length ? pipeline / deals.length : 0;

    const pipelineSeries = cumulativeValueSeries(
      deals,
      (d) => d.created_at,
      (d) => d.value,
      months,
    );
    const newDealsSeries = perMonthCountSeries(deals, (d) => d.created_at, months);
    const closedSeries = cumulativeValueSeries(
      closedDeals,
      (d) => d.closed_at ?? d.created_at,
      (d) => d.value,
      months,
    );
    // Not cumulative — a running total of an average would be meaningless. Each point is the mean
    // deal value among deals actually created that month (0 for a month with none).
    const avgByMonthCount = new Map<string, number>();
    const avgByMonthSum = new Map<string, number>();
    for (const d of deals) {
      const k = monthKey(d.created_at);
      avgByMonthCount.set(k, (avgByMonthCount.get(k) ?? 0) + 1);
      avgByMonthSum.set(k, (avgByMonthSum.get(k) ?? 0) + d.value);
    }
    const avgSeries = months.map((k) => {
      const count = avgByMonthCount.get(k) ?? 0;
      return count > 0 ? Math.round((avgByMonthSum.get(k) ?? 0) / count) : 0;
    });

    return {
      pipeline,
      active,
      closed,
      avg,
      periodLabel,
      latestMonthLabel,
      pipelineSeries,
      pipelineChangePct: pctChange(pipelineSeries),
      newDealsThisMonth: newDealsSeries.at(-1) ?? 0,
      newDealsSeries,
      newDealsChangePct: pctChange(newDealsSeries),
      closedSeries,
      closedChangePct: pctChange(closedSeries),
      avgSeries,
      avgChangePct: pctChange(avgSeries),
    };
  }, [deals]);

  // Cumulative deal value per sponsor (deals grouped by name, case/whitespace-insensitive) over
  // the same 6-month window as the KPI cards above — shows which relationships are actually
  // growing, not just total pipeline. Capped to the top sponsors by value so the chart stays
  // legible instead of a rainbow of thin lines.
  const sponsorPerformance = useMemo(() => {
    const months = lastMonthKeys(6);
    const groups = new Map<string, { label: string; deals: Deal[] }>();
    for (const d of deals) {
      const key = d.name.trim().toLowerCase();
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.deals.push(d);
      else groups.set(key, { label: d.name.trim(), deals: [d] });
    }
    const sponsors = [...groups.values()]
      .map((g) => ({
        label: g.label,
        series: cumulativeValueSeries(
          g.deals,
          (d) => d.created_at,
          (d) => d.value,
          months,
        ),
      }))
      .sort((a, b) => (b.series.at(-1) ?? 0) - (a.series.at(-1) ?? 0));
    const shown = sponsors.slice(0, MAX_SPONSOR_LINES);
    const chartData = months.map((m, i) => {
      const row: Record<string, string | number> = { month: monthLabel(m) };
      for (const s of shown) row[s.label] = s.series[i];
      return row;
    });
    return { shown, chartData, totalSponsors: sponsors.length };
  }, [deals]);

  const stagesGrouped = DEAL_STAGES.map((stage) => {
    const items = deals.filter((d) => d.stage === stage);
    return {
      stage,
      label: stageLabel[stage],
      color: stageColor[stage],
      count: items.length,
      total: `$${items.reduce((a, d) => a + d.value, 0).toLocaleString()}`,
      deals: items,
    };
  });

  const createDeal = async (input: {
    name: string;
    contactName: string;
    value: number;
    tag: string;
    stage: DealStage;
    nextAction: string;
    expectedCloseDate: string;
    assignedMemberId: string;
  }) => {
    const response = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        contactName: input.contactName || null,
        value: input.value,
        tag: input.tag || null,
        stage: input.stage,
        nextAction: input.nextAction || null,
        expectedCloseDate: input.expectedCloseDate || null,
        assignedMemberId: input.assignedMemberId || null,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "CREATE_FAILED");
    setDeals((prev) => [body.data, ...prev]);
    toast.success("Deal created");
  };

  const updateDeal = async (
    id: string,
    input: {
      name: string;
      contactName: string;
      value: number;
      tag: string;
      stage: DealStage;
      nextAction: string;
      expectedCloseDate: string;
      assignedMemberId: string;
    },
  ) => {
    const response = await fetch(`/api/deals?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        contactName: input.contactName || null,
        value: input.value,
        tag: input.tag || null,
        stage: input.stage,
        nextAction: input.nextAction || null,
        expectedCloseDate: input.expectedCloseDate || null,
        assignedMemberId: input.assignedMemberId || null,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "UPDATE_FAILED");
    setDeals((prev) => prev.map((d) => (d.id === id ? body.data : d)));
    toast.success("Deal updated");
  };

  const removeDeal = async (deal: Deal) => {
    try {
      const response = await fetch(`/api/deals?id=${deal.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setDeals((prev) => prev.filter((d) => d.id !== deal.id));
      toast.success("Deal deleted");
    } catch {
      toast.error("Couldn't delete that deal. Please try again.");
    }
  };

  return (
    <DashboardLayout title="Brand Deals">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Deal Board</h1>
        </div>
        <button
          onClick={() => setCreating({ open: true })}
          className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Deal
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTrendCard
          title="Pipeline Value"
          accent="var(--brand-blue)"
          value={fmtK(stats.pipeline)}
          deltaLabel={fmtK(stats.pipelineSeries.at(-1) ?? 0)}
          deltaSuffix="all time"
          changePercent={stats.pipelineChangePct}
          periodLabel={stats.periodLabel}
          series={stats.pipelineSeries}
          markerTitle={fmtK(stats.pipelineSeries.at(-1) ?? 0)}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.pipelineChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Active Deals"
          accent="var(--brand-purple)"
          value={String(stats.active)}
          deltaLabel={`${stats.newDealsThisMonth} new`}
          deltaSuffix="this month"
          changePercent={stats.newDealsChangePct}
          periodLabel={stats.periodLabel}
          series={stats.newDealsSeries}
          markerTitle={String(stats.newDealsThisMonth)}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.newDealsChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Closed Revenue"
          accent="var(--brand-green)"
          value={fmtK(stats.closed)}
          deltaLabel={fmtK(stats.closedSeries.at(-1) ?? 0)}
          deltaSuffix="all time"
          changePercent={stats.closedChangePct}
          periodLabel={stats.periodLabel}
          series={stats.closedSeries}
          markerTitle={fmtK(stats.closedSeries.at(-1) ?? 0)}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.closedChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Avg Deal Size"
          accent="var(--brand-amber)"
          value={fmtK(stats.avg)}
          deltaLabel={fmtK(stats.avgSeries.at(-1) ?? 0)}
          deltaSuffix="this month"
          changePercent={stats.avgChangePct}
          periodLabel={stats.periodLabel}
          series={stats.avgSeries}
          markerTitle={fmtK(stats.avgSeries.at(-1) ?? 0)}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.avgChangePct ?? 0) >= 0}
        />
      </div>

      {status === "ready" && deals.length > 0 && (
        <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <TrendingUp className="h-4.5 w-4.5 text-brand-purple" /> Sponsor Performance
              </h3>
              <p className="text-sm text-muted-foreground">
                Cumulative deal value per sponsor, {stats.periodLabel.toLowerCase()}
                {sponsorPerformance.totalSponsors > MAX_SPONSOR_LINES
                  ? ` — top ${MAX_SPONSOR_LINES} of ${sponsorPerformance.totalSponsors} sponsors`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              {sponsorPerformance.shown.map((s, i) => (
                <Legend
                  key={s.label}
                  color={SPONSOR_COLORS[i % SPONSOR_COLORS.length]}
                  label={s.label}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sponsorPerformance.chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => fmtK(v)}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value: number) => fmtK(value)}
                  contentStyle={{
                    background: "color-mix(in srgb, var(--color-popover) 85%, transparent)",
                    border: "1px solid color-mix(in srgb, white 20%, var(--color-border))",
                    borderRadius: 16,
                    fontSize: 12,
                    boxShadow: "0 16px 32px -20px rgba(0,0,0,0.4)",
                    backdropFilter: "blur(12px)",
                  }}
                />
                {sponsorPerformance.shown.map((s, i) => (
                  <Line
                    key={s.label}
                    type="monotone"
                    dataKey={s.label}
                    stroke={SPONSOR_COLORS[i % SPONSOR_COLORS.length]}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {status === "loading" && (
        <p className="mt-6 text-sm text-muted-foreground">Loading your pipeline…</p>
      )}

      {status === "error" && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load your deals.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {stagesGrouped.map((s) => (
            <div key={s.stage} className="min-w-0">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-sm font-semibold">{s.label}</span>
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {s.count}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{s.total}</span>
              </div>

              <div className="space-y-3">
                {s.deals.map((d) => (
                  <div key={d.id} className="relative rounded-xl card-gradient-outline p-4">
                    <GlowingEffect
                      spread={40}
                      glow
                      disabled={false}
                      proximity={64}
                      inactiveZone={0.01}
                    />
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{d.name}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {d.contact_name || "—"}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="shrink-0 text-muted-foreground hover:text-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(d)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDeleting(d)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="flex items-center gap-1 font-bold text-brand-green">
                        <DollarSign className="h-4 w-4" />
                        {d.value.toLocaleString()}
                      </span>
                      {d.tag && <Tag label={d.tag} />}
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span className="font-medium text-foreground">
                          {stageProgress[d.stage]}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${stageProgress[d.stage]}%`,
                            background:
                              d.stage === "completed"
                                ? "var(--color-brand-amber)"
                                : "var(--color-brand-green)",
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground">Next action</p>
                        <p className="truncate text-xs font-medium">{d.next_action || "—"}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {d.expected_close_date
                          ? new Date(d.expected_close_date).toLocaleDateString()
                          : "—"}
                      </span>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => setCreating({ open: true, stage: s.stage })}
                  className="flex w-full items-center justify-center gap-2 rounded-[var(--button-radius)] border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  <Plus className="h-4 w-4" /> Add deal
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DealFormDialog
        open={creating.open}
        defaultStage={creating.stage}
        teamMembers={teamMembers}
        onOpenChange={(v) => setCreating({ open: v })}
        onSubmit={createDeal}
      />
      <DealFormDialog
        open={!!editing}
        deal={editing}
        teamMembers={teamMembers}
        onOpenChange={(v) => !v && setEditing(null)}
        onSubmit={(input) => (editing ? updateDeal(editing.id, input) : Promise.resolve())}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="This removes the deal from the pipeline. This cannot be undone."
        onConfirm={() => {
          if (deleting) void removeDeal(deleting);
          setDeleting(null);
        }}
      />
    </DashboardLayout>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function DealFormDialog({
  open,
  deal,
  defaultStage,
  teamMembers,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  deal?: Deal | null;
  defaultStage?: DealStage;
  teamMembers: TeamMemberOption[];
  onOpenChange: (v: boolean) => void;
  onSubmit: (input: {
    name: string;
    contactName: string;
    value: number;
    tag: string;
    stage: DealStage;
    nextAction: string;
    expectedCloseDate: string;
    assignedMemberId: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [value, setValue] = useState("");
  const [tag, setTag] = useState("");
  const [stage, setStage] = useState<DealStage>("prospect");
  const [nextAction, setNextAction] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [assignedMemberId, setAssignedMemberId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(deal?.name ?? "");
    setContactName(deal?.contact_name ?? "");
    setValue(deal ? String(deal.value) : "");
    setTag(deal?.tag ?? "");
    setStage(deal?.stage ?? defaultStage ?? "prospect");
    setNextAction(deal?.next_action ?? "");
    setExpectedCloseDate(deal?.expected_close_date ?? "");
    setAssignedMemberId(deal?.assigned_member_id ?? "");
  }, [open, deal, defaultStage]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Company / deal name is required");
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0)
      return toast.error("Enter a valid deal value");
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        contactName: contactName.trim(),
        value: numericValue,
        tag: tag.trim(),
        stage,
        nextAction: nextAction.trim(),
        expectedCloseDate,
        assignedMemberId,
      });
      onOpenChange(false);
    } catch {
      toast.error("Couldn't save that deal. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{deal ? "Edit Deal" : "New Deal"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Company / deal name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Co."
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Contact</label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Value (USD)</label>
              <Input
                type="number"
                min={0}
                step="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="5000"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tag (optional)</label>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Sponsorship" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Stage</label>
            <div className="flex flex-wrap gap-2">
              {DEAL_STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStage(s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    stage === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {stageLabel[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Next action</label>
              <Textarea
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                rows={2}
                placeholder="Send contract"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Expected close</label>
              <Input
                type="date"
                value={expectedCloseDate ?? ""}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Assigned to (optional)</label>
            <select
              aria-label="Assigned to"
              value={assignedMemberId}
              onChange={(e) => setAssignedMemberId(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">Unassigned</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Attributes this deal's value to a teammate on the Team page.
            </p>
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
              {submitting ? "Saving…" : deal ? "Save Changes" : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
