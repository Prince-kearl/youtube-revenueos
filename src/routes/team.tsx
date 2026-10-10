import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  UserPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Mail,
  TrendingUp,
  Info,
  Sparkles,
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
import { DashboardLayout } from "@/components/DashboardLayout";
import { FlatKpiCard } from "@/components/KpiTrendCard";
import { ConfirmDialog } from "@/components/modals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { ErrorState, ListLoadingState } from "@/components/ui-bits";
import {
  canManageMembers,
  canManageRole,
  teamInviteState,
  type TeamEntitlement,
  type WorkspaceRole,
} from "@/lib/team-policy";

export const Route = createFileRoute("/team")({
  component: Team,
});

// Access level — the 4-tier permission system (unchanged, controls real page/feature access via
// role_feature_access). Deliberately separate from job title below: "Script Writer" or "Sales"
// aren't permission levels, they're what someone actually does, and mixing the two would force
// e.g. every editor-access person into a literal "Editor" job title.
// The rules for who may do what live in lib/team-policy.ts — the same functions the server
// enforces. This page only uses them to decide which controls to OFFER; every request is
// authorised again on the server.
type MemberStatus = "invited" | "active";

// Curated job titles a creator can pick for a teammate — purely a label (never checked for
// permissions). "Custom" in the UI reveals a free-text input instead of one of these.
const JOB_TITLE_PRESETS = [
  "Manager",
  "Setter",
  "Editor",
  "Creative Strategist",
  "Thumbnail/Title Artist",
  "Sales",
  "Script Writer",
] as const;

type Deal = {
  id: string;
  value: number;
  stage: string;
  closed_at: string | null;
  created_at: string;
  assigned_member_id: string | null;
};
type DealsResponse = { data?: Deal[]; error?: string };

type WorkspaceMember = {
  id: string;
  user_id: string | null;
  invited_email: string;
  role: WorkspaceRole;
  status: MemberStatus;
  // Null when the server withheld them from this viewer (compensation_visible is then false).
  lead_share: number | null;
  commission: number | null;
  job_title: string | null;
  cost_amount: number | null;
  compensation_visible: boolean;
  invited_at: string;
  joined_at: string | null;
  member: { name: string | null; email: string | null; avatar: string | null } | null;
};
type MembersResponse = {
  data?: WorkspaceMember[];
  meta?: { role: WorkspaceRole; memberId: string | null; teamManagement: TeamEntitlement };
  error?: string;
};

// What the signed-in member may do to one teammate, by the same rules the server applies.
type Viewer = {
  role: WorkspaceRole | undefined;
  memberId: string | null;
  entitlement: TeamEntitlement | null;
};
function memberControls(viewer: Viewer, m: WorkspaceMember) {
  const isSelf = viewer.memberId !== null && m.id === viewer.memberId;
  const manages = canManageMembers(viewer.role) && canManageRole(viewer.role, m.role);
  const canChangeRoleByRole = !isSelf && manages;
  return {
    isSelf,
    // Changing a role also needs the workspace's plan; the other edits do not.
    canChangeRole: canChangeRoleByRole && viewer.entitlement?.allowed === true,
    roleNeedsPlan:
      canChangeRoleByRole && !!viewer.entitlement && viewer.entitlement.reason === "plan_required",
    canEditCompensation: manages,
    canEditJobTitle: isSelf || manages,
    canRemove: !isSelf && manages,
  };
}

const roleLabel: Record<WorkspaceRole, string> = {
  owner: "Owner",
  manager: "Manager",
  setter: "Setter",
  editor: "Editor",
};
const roleColor: Record<WorkspaceRole, string> = {
  owner: "bg-brand-purple/15 text-brand-purple",
  manager: "bg-brand-blue/15 text-brand-blue",
  setter: "bg-brand-green/15 text-brand-green",
  editor: "bg-brand-amber/15 text-brand-amber",
};
const ROLE_OPTIONS: WorkspaceRole[] = ["owner", "manager", "setter", "editor"];

const shareColors = [
  "var(--color-brand-purple)",
  "var(--color-brand-blue)",
  "var(--color-brand-green)",
  "var(--color-brand-amber)",
  "var(--color-brand-red)",
];
const MEMBER_CHART_COLORS = [
  "var(--brand-blue)",
  "var(--brand-purple)",
  "var(--brand-green)",
  "var(--brand-amber)",
  "var(--brand-red)",
];
const MAX_MEMBER_LINES = 5;
const PERFORMANCE_WINDOW_MONTHS = 6;

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
// Cumulative running total of `valueOf(entries)` bucketed by month(dateOf) across `months`,
// seeded with whatever predates the window — same recipe as Brand Deals' sponsor chart.
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
function fmtK(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(1)}K` : `${sign}$${abs.toFixed(0)}`;
}

function displayName(m: WorkspaceMember): string {
  return m.member?.name || m.invited_email;
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

// Preset job-title pills + a "Custom" pill that reveals a free-text input — pass a `key` at the
// call site tied to whatever identifies the current target (open state / member id) so this
// remounts (and re-derives whether "Custom" should start selected) each time the dialog is
// reopened for a different member, instead of carrying over stale local state.
function JobTitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isPreset = (JOB_TITLE_PRESETS as readonly string[]).includes(value);
  const [useCustom, setUseCustom] = useState(value !== "" && !isPreset);

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Job title (optional)</label>
      <div className="flex flex-wrap gap-2">
        {JOB_TITLE_PRESETS.map((title) => (
          <button
            key={title}
            type="button"
            onClick={() => {
              setUseCustom(false);
              onChange(title);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              !useCustom && value === title
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            {title}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setUseCustom(true);
            onChange("");
          }}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            useCustom
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40"
          }`}
        >
          Custom
        </button>
      </div>
      {useCustom && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Video Producer"
          maxLength={80}
          className="mt-1.5"
        />
      )}
    </div>
  );
}

function errorMessage(error: string | undefined): string {
  const messages: Record<string, string> = {
    PLAN_REQUIRED: "Team management is available on Scale.",
    ENTITLEMENT_UNAVAILABLE: "We couldn't check your plan just now. Please try again.",
    CANNOT_MANAGE_MEMBERS: "You don't have permission to manage team members.",
    CANNOT_EDIT_COMPENSATION: "You don't have permission to change lead share, commission or cost.",
    CANNOT_EDIT_MEMBER: "You don't have permission to edit that team member.",
    CANNOT_REMOVE_MEMBER: "You don't have permission to remove that team member.",
    NO_CHANGES: "There's nothing to save.",
    CANNOT_ASSIGN_ROLE: "You can't assign that role.",
    ALREADY_A_MEMBER: "That person is already on your team.",
    ALREADY_HAS_WORKSPACE:
      "That person already owns their own Tubify workspace — one account can't belong to two workspaces yet.",
    ALREADY_INVITED: "You've already invited that email.",
    EMAIL_NOT_CONFIGURED: "Invite emails aren't set up in this environment yet.",
    INVITE_EMAIL_FAILED: "Couldn't send the invite email. Please try again.",
    CANNOT_CHANGE_OWN_ROLE: "You can't change your own role.",
    LAST_OWNER: "A workspace needs at least one owner.",
    MEMBER_NOT_FOUND: "That member couldn't be found.",
    VALIDATION_ERROR: "Check the invite details and try again.",
  };
  return messages[error ?? ""] ?? "Something went wrong. Please try again.";
}

function Team() {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [myRole, setMyRole] = useState<WorkspaceRole | undefined>(undefined);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  // Null until the server has answered: nothing that depends on the plan is offered before then.
  const [entitlement, setEntitlement] = useState<TeamEntitlement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<WorkspaceMember | null>(null);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [profitableOnly, setProfitableOnly] = useState(false);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/workspace/members", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as MembersResponse;
        if (!response.ok || !body.data) throw new Error();
        setMembers(body.data);
        setMyRole(body.meta?.role);
        setMyMemberId(body.meta?.memberId ?? null);
        setEntitlement(body.meta?.teamManagement ?? null);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  // Deals carry `assigned_member_id` (see api.deals.ts / Brand Deals' "Assigned to" field) — this
  // is what turns "performance" and "profit" from a guess into a real computation instead of
  // fabricating numbers with no data behind them.
  useEffect(() => {
    fetch("/api/deals", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as DealsResponse;
        if (response.ok && body.data) setDeals(body.data);
      })
      .catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "active").length;
    const invited = members.filter((m) => m.status === "invited").length;
    // An average over a roster this viewer can only partly see would be a wrong number.
    const allVisible = members.every((m) => m.compensation_visible);
    const withCommission = members.filter((m) => (m.commission ?? 0) > 0);
    const avgCommission = withCommission.length
      ? Math.round(
          withCommission.reduce((a, m) => a + (m.commission ?? 0), 0) / withCommission.length,
        )
      : 0;
    return { active, invited, avgCommission: allVisible ? `${avgCommission}%` : "—" };
  }, [members]);

  // Per-member revenue/cost/profit and cumulative performance series, all scoped to the same
  // 6-month window as the chart — comparing "revenue this teammate's deals closed in the last 6
  // months" against "6 months of their monthly cost" is the only apples-to-apples profit figure
  // available from real data (there's no per-member revenue anywhere else in the app).
  const memberPerformance = useMemo(() => {
    const months = lastMonthKeys(PERFORMANCE_WINDOW_MONTHS);
    const windowStart = months[0];
    const closedDeals = deals.filter((d) => d.stage === "completed" && d.assigned_member_id);

    const byMember = new Map<
      string,
      { label: string; revenue: number; profit: number; series: number[] }
    >();
    for (const m of members) {
      const memberDeals = closedDeals.filter((d) => d.assigned_member_id === m.id);
      const revenueInWindow = memberDeals
        .filter((d) => monthKey(d.closed_at ?? d.created_at) >= windowStart)
        .reduce((a, d) => a + d.value, 0);
      const costInWindow = (m.cost_amount ?? 0) * PERFORMANCE_WINDOW_MONTHS;
      byMember.set(m.id, {
        label: displayName(m),
        revenue: revenueInWindow,
        profit: revenueInWindow - costInWindow,
        series: cumulativeValueSeries(
          memberDeals,
          (d) => d.closed_at ?? d.created_at,
          (d) => d.value,
          months,
        ),
      });
    }

    const ranked = [...byMember.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (b.series.at(-1) ?? 0) - (a.series.at(-1) ?? 0));
    const shown = ranked.filter((m) => (m.series.at(-1) ?? 0) > 0).slice(0, MAX_MEMBER_LINES);
    const chartData = months.map((mk, i) => {
      const row: Record<string, string | number> = { month: monthLabel(mk) };
      for (const m of shown) row[m.label] = m.series[i];
      return row;
    });

    return { byId: byMember, shown, chartData };
  }, [deals, members]);

  const distributed = members.filter((m) => m.status === "active" && (m.lead_share ?? 0) > 0);
  const viewer: Viewer = { role: myRole, memberId: myMemberId, entitlement };
  // "hidden" while loading or when the lookup failed, so Invite never flashes or enables itself.
  const inviteState =
    status === "ready" ? teamInviteState({ role: myRole, entitlement }) : ("hidden" as const);
  // A profit figure needs the member's cost, which this viewer may not be shown for everyone.
  const canFilterByProfit = members.every((m) => m.compensation_visible);
  const visibleMembers =
    profitableOnly && canFilterByProfit
      ? members.filter((m) => (memberPerformance.byId.get(m.id)?.profit ?? 0) >= 0)
      : members;

  const removeMember = async (member: WorkspaceMember) => {
    try {
      const response = await fetch(`/api/workspace/members?id=${member.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "REMOVE_FAILED");
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.success(
        member.status === "invited"
          ? `Invite to ${displayName(member)} cancelled`
          : `${displayName(member)} removed from the team`,
      );
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : undefined));
    }
  };

  return (
    <DashboardLayout title="Team">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage roles, lead distribution, and commission splits.
          </p>
        </div>
        {inviteState === "invite" && (
          <button
            onClick={() => setInviting(true)}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" /> Invite Member
          </button>
        )}
      </div>

      {inviteState === "upgrade" && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">Manage your team with Scale</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Invite collaborators, assign roles, and manage your growing creator operation with
                Tubify Scale.
              </p>
            </div>
          </div>
          <Link
            to="/billing"
            className="flex h-9 shrink-0 items-center rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Upgrade to Scale
          </Link>
        </div>
      )}
      {inviteState === "role_restricted" && (
        <p className="mt-6 rounded-xl border border-border bg-accent/30 px-4 py-3 text-sm text-muted-foreground">
          You don't have permission to manage team members.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <FlatKpiCard title="Total Members" value={String(members.length)} />
        <FlatKpiCard title="Active" value={String(stats.active)} />
        <FlatKpiCard title="Pending Invites" value={String(stats.invited)} />
        <FlatKpiCard title="Avg Commission" value={stats.avgCommission} />
      </div>

      {status === "loading" && <ListLoadingState label="Loading your team" className="mt-6" />}

      {status === "error" && (
        <ErrorState
          className="mt-6"
          title="We couldn't load your team"
          description="Nothing was changed. Please try again."
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      )}

      {status === "ready" && (
        <>
          {memberPerformance.shown.length > 0 && (
            <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <TrendingUp className="h-4.5 w-4.5 text-brand-purple" /> Team Performance
                    <span title="Only counts deals with an “Assigned to” teammate set on Brand Deals — assign deals there to see them reflected here.">
                      <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </span>
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Cumulative closed-deal value attributed per teammate, past{" "}
                    {PERFORMANCE_WINDOW_MONTHS} months
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  {memberPerformance.shown.map((m, i) => (
                    <Legend
                      key={m.id}
                      color={MEMBER_CHART_COLORS[i % MEMBER_CHART_COLORS.length]}
                      label={m.label}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-4 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={memberPerformance.chartData}>
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
                    {memberPerformance.shown.map((m, i) => (
                      <Line
                        key={m.id}
                        type="monotone"
                        dataKey={m.label}
                        stroke={MEMBER_CHART_COLORS[i % MEMBER_CHART_COLORS.length]}
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

          {distributed.length > 0 && (
            <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h3 className="font-semibold">Lead Distribution</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Percentage of new leads auto-assigned to each teammate.
              </p>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-accent">
                {distributed.map((m, i) => (
                  <div
                    key={m.id}
                    style={{
                      width: `${m.lead_share ?? 0}%`,
                      background: shareColors[i % shareColors.length],
                    }}
                    title={`${displayName(m)} — ${m.lead_share}%`}
                  />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {distributed.map((m, i) => (
                  <span key={m.id} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: shareColors[i % shareColors.length] }}
                    />
                    {displayName(m)} · {m.lead_share}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <h3 className="font-semibold">Everyone</h3>
            {canFilterByProfit && (
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  checked={profitableOnly}
                  onChange={(e) => setProfitableOnly(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Show only profitable
              </label>
            )}
          </div>

          {members.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No team yet.
            </div>
          ) : visibleMembers.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No teammates are profitable in the past {PERFORMANCE_WINDOW_MONTHS} months. Try
              turning off the filter.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleMembers.map((m) => {
                const perf = memberPerformance.byId.get(m.id);
                const hasCost = m.compensation_visible && (m.cost_amount ?? 0) > 0;
                const controls = memberControls(viewer, m);
                const canEdit =
                  controls.canChangeRole ||
                  controls.canEditCompensation ||
                  controls.canEditJobTitle;
                return (
                  <div key={m.id} className="relative rounded-xl card-gradient-outline p-5">
                    <GlowingEffect
                      spread={40}
                      glow
                      disabled={false}
                      proximity={64}
                      inactiveZone={0.01}
                    />
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {m.member?.avatar ? (
                          <img
                            referrerPolicy="no-referrer"
                            src={m.member.avatar}
                            alt={displayName(m)}
                            className="h-11 w-11 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-muted-foreground">
                            {m.status === "invited" ? (
                              <Mail className="h-4 w-4" />
                            ) : (
                              displayName(m).charAt(0).toUpperCase()
                            )}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{displayName(m)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.invited_email}
                          </p>
                        </div>
                      </div>
                      {(canEdit || controls.canRemove) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-foreground"
                              aria-label="Member actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit && (
                              <DropdownMenuItem onSelect={() => setEditing(m)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                            )}
                            {controls.canRemove && (
                              <DropdownMenuItem
                                onSelect={() => setRemoving(m)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />{" "}
                                {m.status === "invited" ? "Cancel invite" : "Remove"}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-medium">
                        {m.job_title?.trim() || roleLabel[m.role]}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-medium ${roleColor[m.role]}`}
                      >
                        {roleLabel[m.role]} access
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-medium ${m.status === "active" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                      >
                        {m.status === "active" ? "Active" : "Invited"}
                      </span>
                    </div>

                    {m.compensation_visible && (
                      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-accent/30 p-3 text-center text-xs">
                        <div>
                          <p className="text-muted-foreground">Lead Share</p>
                          <p className="mt-0.5 font-semibold">{m.lead_share ?? 0}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Commission</p>
                          <p className="mt-0.5 font-semibold">{m.commission ?? 0}%</p>
                        </div>
                      </div>
                    )}

                    {hasCost && (
                      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-accent/30 p-3 text-center text-xs">
                        <div>
                          <p className="text-muted-foreground">Cost/mo</p>
                          <p className="mt-0.5 font-semibold">{fmtK(m.cost_amount ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Revenue (6mo)</p>
                          <p className="mt-0.5 font-semibold">{fmtK(perf?.revenue ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Profit (6mo)</p>
                          <p
                            className={`mt-0.5 font-semibold ${(perf?.profit ?? 0) >= 0 ? "text-success" : "text-destructive"}`}
                          >
                            {fmtK(perf?.profit ?? 0)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <InviteDialog
        open={inviting && inviteState === "invite"}
        onOpenChange={setInviting}
        myRole={myRole}
        onInvited={load}
      />
      <EditMemberDialog
        member={editing}
        myRole={myRole}
        controls={editing ? memberControls(viewer, editing) : null}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={load}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Remove ${removing ? displayName(removing) : ""}?`}
        description={
          removing?.status === "invited"
            ? "Their invitation will be cancelled."
            : "They'll lose access to this workspace. This cannot be undone."
        }
        onConfirm={() => {
          if (removing) void removeMember(removing);
          setRemoving(null);
        }}
      />
    </DashboardLayout>
  );
}

function InviteDialog({
  open,
  myRole,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  myRole: WorkspaceRole | undefined;
  onOpenChange: (v: boolean) => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [jobTitle, setJobTitle] = useState("");
  const [leadShare, setLeadShare] = useState("0");
  const [commission, setCommission] = useState("0");
  const [costAmount, setCostAmount] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRole("editor");
    setJobTitle("");
    setLeadShare("0");
    setCommission("0");
    setCostAmount("0");
  }, [open]);

  const assignableRoles = ROLE_OPTIONS.filter((r) => canManageRole(myRole, r));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Enter an email address");
    setSubmitting(true);
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          jobTitle: jobTitle.trim() || null,
          leadShare: Number(leadShare) || 0,
          commission: Number(commission) || 0,
          costAmount: Number(costAmount) || 0,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "INVITE_FAILED");
      toast.success(`Invite sent to ${email.trim()}`);
      onOpenChange(false);
      onInvited();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They'll receive an invite email. Existing Tubify users are added immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jamie@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Access level</label>
            <p className="text-[11px] text-muted-foreground">
              Controls which pages and data they can see — separate from their job title below.
            </p>
            <div className="flex flex-wrap gap-2">
              {assignableRoles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {roleLabel[r]}
                </button>
              ))}
            </div>
          </div>
          <JobTitleField key={String(open)} value={jobTitle} onChange={setJobTitle} />
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Lead share %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={leadShare}
                onChange={(e) => setLeadShare(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Commission %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cost $/mo</label>
              <Input
                type="number"
                min={0}
                step="1"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
              />
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
              {submitting ? "Sending…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  myRole,
  controls,
  onOpenChange,
  onSaved,
}: {
  member: WorkspaceMember | null;
  myRole: WorkspaceRole | undefined;
  controls: ReturnType<typeof memberControls> | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [jobTitle, setJobTitle] = useState("");
  const [leadShare, setLeadShare] = useState("0");
  const [commission, setCommission] = useState("0");
  const [costAmount, setCostAmount] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!member) return;
    setRole(member.role);
    setJobTitle(member.job_title ?? "");
    setLeadShare(String(member.lead_share ?? 0));
    setCommission(String(member.commission ?? 0));
    setCostAmount(String(member.cost_amount ?? 0));
  }, [member]);

  if (!member || !controls) return null;
  const assignableRoles = ROLE_OPTIONS.filter((r) => r === member.role || canManageRole(myRole, r));

  // Only what actually changed, and only what this viewer may change, is sent. The server
  // authorises each field it receives, so sending an untouched field the viewer may not edit
  // (their own commission, say) would have the whole request refused.
  const changes: Record<string, unknown> = {};
  if (controls.canChangeRole && role !== member.role) changes.role = role;
  if (controls.canEditJobTitle && (jobTitle.trim() || null) !== (member.job_title?.trim() || null))
    changes.jobTitle = jobTitle.trim() || null;
  if (controls.canEditCompensation) {
    if ((Number(leadShare) || 0) !== (member.lead_share ?? 0))
      changes.leadShare = Number(leadShare) || 0;
    if ((Number(commission) || 0) !== (member.commission ?? 0))
      changes.commission = Number(commission) || 0;
    if ((Number(costAmount) || 0) !== (member.cost_amount ?? 0))
      changes.costAmount = Number(costAmount) || 0;
  }
  const hasChanges = Object.keys(changes).length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return onOpenChange(false);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/workspace/members?id=${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "UPDATE_FAILED");
      toast.success("Team member updated");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {displayName(member)}</DialogTitle>
          <DialogDescription>
            {controls.isSelf ? "Update your own details." : "Update this team member's details."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {controls.canChangeRole && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Access level</label>
              <p className="text-[11px] text-muted-foreground">
                Controls which pages and data they can see — separate from their job title below.
              </p>
              <div className="flex flex-wrap gap-2">
                {assignableRoles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      role === r
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {roleLabel[r]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {controls.roleNeedsPlan && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Changing access levels is available on Scale.{" "}
              <Link to="/billing" className="font-medium text-primary hover:underline">
                Upgrade to Scale
              </Link>
            </p>
          )}
          {controls.canEditJobTitle && (
            <JobTitleField key={member.id} value={jobTitle} onChange={setJobTitle} />
          )}
          {controls.canEditCompensation && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Lead share %</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={leadShare}
                  onChange={(e) => setLeadShare(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Commission %</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Cost $/mo</label>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={costAmount}
                  onChange={(e) => setCostAmount(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={submitting || !hasChanges}>
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
