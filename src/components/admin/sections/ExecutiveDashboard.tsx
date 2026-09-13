import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { FlatKpiCard } from "@/components/KpiTrendCard";
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
            <FlatKpiCard title="Total Users" value={String(data.totalUsers)} />
            <FlatKpiCard title="New Users Today" value={String(data.newUsersToday)} />
            <FlatKpiCard
              title="Daily Active Users"
              value={String(data.dau)}
              caption="signed in today"
            />
            <FlatKpiCard
              title="Monthly Active Users"
              value={String(data.mau)}
              caption="last 30 days"
            />
            <FlatKpiCard title="Total Projects" value={String(data.totalProjects)} />
            <FlatKpiCard title="Total Videos" value={String(data.totalVideos)} />
            <FlatKpiCard title="Videos Analyzed" value={String(data.videosAnalyzed)} />
            <FlatKpiCard title="Monthly Recurring Revenue" value={money(data.mrrCents)} />
            <FlatKpiCard title="Annual Recurring Revenue" value={money(data.mrrCents * 12)} />
            <FlatKpiCard title="Active Subscriptions" value={String(data.activeSubscriptions)} />
            <FlatKpiCard
              title="YouTube API Quota"
              value={`${data.youtubeQuotaToday.toLocaleString()}`}
              caption={`of ${data.youtubeQuotaMax.toLocaleString()}/day, all channels`}
            />
            <FlatKpiCard title="Open Support Tickets" value={String(data.openSupportTickets)} />
            <FlatKpiCard title="Total Link Clicks" value={String(data.totalLinkClicks)} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="User Growth (cumulative)">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.userGrowth}>
                  <defs>
                    <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    fill="url(#gUsers)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Subscription Growth (cumulative)">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.subscriptionGrowth}>
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
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="var(--color-brand-green)"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

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
