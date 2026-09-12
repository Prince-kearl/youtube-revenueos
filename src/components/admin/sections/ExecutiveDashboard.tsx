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
import { FlatKpiCard } from "@/components/KpiTrendCard";
import { useTenants } from "@/lib/stores";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const userGrowth = [
  { month: "Feb", users: 2180 },
  { month: "Mar", users: 2410 },
  { month: "Apr", users: 2650 },
  { month: "May", users: 2890 },
  { month: "Jun", users: 3180 },
  { month: "Jul", users: 3482 },
];
const revenueTrend = [
  { month: "Feb", mrr: 8400 },
  { month: "Mar", mrr: 9200 },
  { month: "Apr", mrr: 10100 },
  { month: "May", mrr: 11400 },
  { month: "Jun", mrr: 12600 },
  { month: "Jul", mrr: 13900 },
];
const aiUsage = [
  { month: "Feb", generations: 24800 },
  { month: "Mar", generations: 29100 },
  { month: "Apr", generations: 33600 },
  { month: "May", generations: 38200 },
  { month: "Jun", generations: 44900 },
  { month: "Jul", generations: 51300 },
];
const subGrowth = [
  { month: "Feb", subs: 210 },
  { month: "Mar", subs: 238 },
  { month: "Apr", subs: 261 },
  { month: "May", subs: 289 },
  { month: "Jun", subs: 318 },
  { month: "Jul", subs: 349 },
];
const geo = [
  { label: "United States", pct: 42 },
  { label: "United Kingdom", pct: 18 },
  { label: "Canada", pct: 12 },
  { label: "Germany", pct: 9 },
  { label: "Other", pct: 19 },
];
const devices = [
  { label: "Desktop", pct: 61 },
  { label: "Mobile", pct: 31 },
  { label: "Tablet", pct: 8 },
];

export function ExecutiveDashboard() {
  const [tenants] = useTenants();
  const mrr = tenants
    .filter((t) => t.status === "Active" || t.status === "Past Due")
    .reduce((a, t) => a + t.mrr, 0);
  const activeSubs = tenants.filter((t) => t.status === "Active").length;
  const storageUsed = tenants.reduce((a, t) => a + t.storageUsedGb, 0);
  const storageQuota = tenants.reduce((a, t) => a + t.storageQuotaGb, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Real-time overview of platform health.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <FlatKpiCard title="Total Users" value="3,482" />
        <FlatKpiCard title="New Users Today" value="18" />
        <FlatKpiCard title="Daily Active Users" value="941" />
        <FlatKpiCard title="Monthly Active Users" value="3,102" />
        <FlatKpiCard title="Total Projects" value="8,340" />
        <FlatKpiCard title="Total AI Generations" value="214.6K" />
        <FlatKpiCard title="Videos Analyzed" value="12,400" />
        <FlatKpiCard
          title="Revenue Tracked"
          value="$48.2M"
          caption="Creator earnings, platform-wide"
        />
        <FlatKpiCard title="Monthly Recurring Revenue" value={`$${mrr.toLocaleString()}`} />
        <FlatKpiCard title="Annual Recurring Revenue" value={`$${(mrr * 12).toLocaleString()}`} />
        <FlatKpiCard title="Active Subscriptions" value={String(activeSubs)} />
        <FlatKpiCard title="API Usage" value="4.2M/mo" caption="82% of quota" />
        <FlatKpiCard
          title="Storage Usage"
          value={`${storageUsed} GB`}
          caption={`of ${storageQuota} GB provisioned`}
        />
        <FlatKpiCard title="Server Status" value="Operational" />
        <FlatKpiCard title="Error Rate" value="0.04%" />
        <FlatKpiCard title="Active Sessions" value="428" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="User Growth">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={userGrowth}>
              <defs>
                <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
                dataKey="users"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                fill="url(#gUsers)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue Trends (MRR)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `$${v / 1000}k`}
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
              <Line
                type="monotone"
                dataKey="mrr"
                stroke="var(--color-brand-green)"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="AI Usage (generations/mo)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aiUsage} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="generations" fill="var(--color-brand-purple)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Subscription Growth">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={subGrowth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
                dataKey="subs"
                stroke="var(--color-brand-blue)"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BreakdownCard title="Geographic Distribution" rows={geo} />
        <BreakdownCard title="Device Analytics" rows={devices} />
      </div>
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
