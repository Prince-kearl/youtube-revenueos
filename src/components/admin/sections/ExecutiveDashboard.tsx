import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  RefreshCw,
  Users,
  UserPlus,
  Activity,
  CalendarDays,
  FolderKanban,
  Video,
  ScanSearch,
  DollarSign,
  TrendingUp,
  CreditCard,
  Gauge,
  LifeBuoy,
  MousePointerClick,
} from "lucide-react";
import { AdminKpiCard } from "@/components/admin/AdminKpiCard";
import { GlowingEffect } from "@/components/ui/glowing-effect";

type DashboardData = {
  totalUsers: number;
  newUsersToday: number;
  dau: number;
  mau: number;
  totalProjects: number;
  totalVideos: number;
  videosAnalyzed: number;
  mrrCents: number;
  activeSubscriptions: number;
  youtubeQuotaToday: number;
  youtubeQuotaMax: number;
  openSupportTickets: number;
  totalLinkClicks: number;
  userGrowth: { month: string; count: number }[];
  subscriptionGrowth: { month: string; count: number }[];
  quotaByDay: { day: string; units: number }[];
  roleDistribution: { label: string; pct: number }[];
  topLocations: { label: string; pct: number }[];
};

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function ExecutiveDashboard() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<DashboardData | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/admin/dashboard", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: DashboardData };
        if (!response.ok || !body.data) throw new Error();
        setData(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [retryNonce]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Real, live totals across the platform — no simulated data.
      </p>

      {status === "loading" && <p className="mt-5 text-sm text-muted-foreground">Loading…</p>}

      {status === "error" && (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load the dashboard.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && data && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <AdminKpiCard
              icon={Users}
              tone="blue"
              title="Total Users"
              value={String(data.totalUsers)}
            />
            <AdminKpiCard
              icon={UserPlus}
              tone="green"
              title="New Users Today"
              value={String(data.newUsersToday)}
            />
            <AdminKpiCard
              icon={Activity}
              tone="amber"
              title="Daily Active Users"
              value={String(data.dau)}
              caption="signed in today"
            />
            <AdminKpiCard
              icon={CalendarDays}
              tone="purple"
              title="Monthly Active Users"
              value={String(data.mau)}
              caption="last 30 days"
            />
            <AdminKpiCard
              icon={FolderKanban}
              tone="blue"
              title="Total Projects"
              value={String(data.totalProjects)}
            />
            <AdminKpiCard
              icon={Video}
              tone="red"
              title="Total Videos"
              value={String(data.totalVideos)}
            />
            <AdminKpiCard
              icon={ScanSearch}
              tone="purple"
              title="Videos Analyzed"
              value={String(data.videosAnalyzed)}
            />
            <AdminKpiCard
              icon={DollarSign}
              tone="green"
              title="Monthly Recurring Revenue"
              value={money(data.mrrCents)}
            />
            <AdminKpiCard
              icon={TrendingUp}
              tone="green"
              title="Annual Recurring Revenue"
              value={money(data.mrrCents * 12)}
            />
            <AdminKpiCard
              icon={CreditCard}
              tone="blue"
              title="Active Subscriptions"
              value={String(data.activeSubscriptions)}
            />
            <AdminKpiCard
              icon={Gauge}
              tone="amber"
              title="YouTube API Quota"
              value={`${data.youtubeQuotaToday.toLocaleString()}`}
              caption={`of ${data.youtubeQuotaMax.toLocaleString()}/day, all channels`}
            />
            <AdminKpiCard
              icon={LifeBuoy}
              tone="red"
              title="Open Support Tickets"
              value={String(data.openSupportTickets)}
            />
            <AdminKpiCard
              icon={MousePointerClick}
              tone="blue"
              title="Total Link Clicks"
              value={String(data.totalLinkClicks)}
            />
          </div>

          <div className="mt-6 space-y-4">
            <GrowthCard metric="users" title="User Growth" color="var(--color-primary)" />
            <GrowthCard
              metric="subscriptions"
              title="Subscription Growth"
              color="var(--color-brand-green)"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="YouTube API Quota (units/day, all channels)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.quotaByDay} barCategoryGap="30%">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="units" fill="var(--color-brand-purple)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <BreakdownCard title="Users by Role" rows={data.roleDistribution} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BreakdownCard title="Top Locations (self-reported)" rows={data.topLocations} />
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 h-56">{children}</div>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: { label: string; pct: number }[] }) {
  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">No data yet.</p>}
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{r.label}</span>
              <span>{r.pct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent">
              <div className="h-full rounded-full bg-primary" style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type GrowthRange = "30d" | "90d" | "6m" | "12m" | "all";
type GrowthView = "total" | "added";
type GrowthSeries = {
  startTotal: number;
  points: { label: string; total: number; added: number }[];
};

const GROWTH_RANGES: { value: GrowthRange; label: string; period: string }[] = [
  { value: "30d", label: "30D", period: "day" },
  { value: "90d", label: "90D", period: "week" },
  { value: "6m", label: "6M", period: "month" },
  { value: "12m", label: "12M", period: "month" },
  { value: "all", label: "All", period: "period" },
];

const GROWTH_TOOLTIP = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  fontSize: 12,
};

// A growth chart with its own filters, a full row wide: the range (fetched from the server for
// that range — /api/admin/dashboard/growth, Superadmin/Owner only) and the view (running total,
// or how many were added in each day/week/month), with headline figures for the range.
function GrowthCard({
  metric,
  title,
  color,
}: {
  metric: "users" | "subscriptions";
  title: string;
  color: string;
}) {
  const [range, setRange] = useState<GrowthRange>("6m");
  const [view, setView] = useState<GrowthView>("total");
  const [series, setSeries] = useState<GrowthSeries | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    fetch(`/api/admin/dashboard/growth?metric=${metric}&range=${range}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { data?: GrowthSeries };
        if (!response.ok || !body.data) throw new Error();
        setSeries(body.data);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [metric, range]);

  const points = series?.points ?? [];
  const total = points.length ? points[points.length - 1].total : 0;
  const added = series ? total - series.startTotal : 0;
  const growth =
    series && series.startTotal > 0 ? Math.round((added / series.startTotal) * 1000) / 10 : null;
  const period = GROWTH_RANGES.find((r) => r.value === range)?.period ?? "period";
  const gradientId = `growth-${metric}`;
  const pill = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
    }`;
  const axisTick = { fill: "var(--color-muted-foreground)", fontSize: 12 };

  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums">
              {series ? total.toLocaleString() : "—"}
            </span>
            {series && (
              <span className="text-xs text-muted-foreground">
                <span className={added > 0 ? "font-semibold text-success" : "font-semibold"}>
                  +{added.toLocaleString()}
                </span>{" "}
                in range
                {growth !== null && ` · ${growth > 0 ? "+" : ""}${growth}%`}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={`${title} view`}
            className="flex rounded-full border border-border p-0.5"
          >
            <button
              type="button"
              aria-pressed={view === "total"}
              onClick={() => setView("total")}
              className={pill(view === "total")}
            >
              Running total
            </button>
            <button
              type="button"
              aria-pressed={view === "added"}
              onClick={() => setView("added")}
              className={pill(view === "added")}
            >
              New per {period}
            </button>
          </div>
          <div
            role="group"
            aria-label={`${title} range`}
            className="flex rounded-full border border-border p-0.5"
          >
            {GROWTH_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => setRange(r.value)}
                className={pill(range === r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mt-4 h-72">
        {status === "error" && (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Couldn&apos;t load this chart.
          </p>
        )}
        {status !== "error" && series && (
          <ResponsiveContainer width="100%" height="100%">
            {view === "total" ? (
              <AreaChart data={points}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={GROWTH_TOOLTIP} />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke={color}
                  strokeWidth={2.5}
                  fill={`url(#${gradientId})`}
                />
              </AreaChart>
            ) : (
              <BarChart data={points} barCategoryGap="25%">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={GROWTH_TOOLTIP} cursor={{ fill: "var(--color-accent)" }} />
                <Bar dataKey="added" name="New" fill={color} radius={[6, 6, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
