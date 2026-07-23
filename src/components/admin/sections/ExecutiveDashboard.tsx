import {
  Users, UserPlus, Activity, Radio, FolderKanban, Sparkles, Video, DollarSign,
  TrendingUp, CreditCard, Cloud, HardDrive, Server, AlertTriangle, Wifi,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { StatCard } from "@/components/ui-bits";
import { useTenants } from "@/lib/stores";

const userGrowth = [
  { month: "Feb", users: 2180 }, { month: "Mar", users: 2410 }, { month: "Apr", users: 2650 },
  { month: "May", users: 2890 }, { month: "Jun", users: 3180 }, { month: "Jul", users: 3482 },
];
const revenueTrend = [
  { month: "Feb", mrr: 8400 }, { month: "Mar", mrr: 9200 }, { month: "Apr", mrr: 10100 },
  { month: "May", mrr: 11400 }, { month: "Jun", mrr: 12600 }, { month: "Jul", mrr: 13900 },
];
const aiUsage = [
  { month: "Feb", generations: 24800 }, { month: "Mar", generations: 29100 }, { month: "Apr", generations: 33600 },
  { month: "May", generations: 38200 }, { month: "Jun", generations: 44900 }, { month: "Jul", generations: 51300 },
];
const subGrowth = [
  { month: "Feb", subs: 210 }, { month: "Mar", subs: 238 }, { month: "Apr", subs: 261 },
  { month: "May", subs: 289 }, { month: "Jun", subs: 318 }, { month: "Jul", subs: 349 },
];
const geo = [
  { label: "United States", pct: 42 }, { label: "United Kingdom", pct: 18 },
  { label: "Canada", pct: 12 }, { label: "Germany", pct: 9 }, { label: "Other", pct: 19 },
];
const devices = [
  { label: "Desktop", pct: 61 }, { label: "Mobile", pct: 31 }, { label: "Tablet", pct: 8 },
];

export function ExecutiveDashboard() {
  const [tenants] = useTenants();
  const mrr = tenants.filter((t) => t.status === "Active" || t.status === "Past Due").reduce((a, t) => a + t.mrr, 0);
  const activeSubs = tenants.filter((t) => t.status === "Active").length;
  const storageUsed = tenants.reduce((a, t) => a + t.storageUsedGb, 0);
  const storageQuota = tenants.reduce((a, t) => a + t.storageQuotaGb, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Real-time overview of platform health.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />} value="3,482" label="Total Users" change="8.2%" up />
        <StatCard icon={<UserPlus className="h-5 w-5" />} value="18" label="New Users Today" />
        <StatCard icon={<Radio className="h-5 w-5" />} value="941" label="Daily Active Users" change="4.1%" up />
        <StatCard icon={<Activity className="h-5 w-5" />} value="3,102" label="Monthly Active Users" change="11.6%" up />
        <StatCard icon={<FolderKanban className="h-5 w-5" />} value="8,340" label="Total Projects" />
        <StatCard icon={<Sparkles className="h-5 w-5" />} value="214.6K" label="Total AI Generations" change="14.9%" up />
        <StatCard icon={<Video className="h-5 w-5" />} value="12,400" label="Videos Analyzed" />
        <StatCard icon={<DollarSign className="h-5 w-5" />} value="$48.2M" label="Revenue Tracked" sub="Creator earnings, platform-wide" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value={`$${mrr.toLocaleString()}`} label="Monthly Recurring Revenue" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value={`$${(mrr * 12).toLocaleString()}`} label="Annual Recurring Revenue" />
        <StatCard icon={<CreditCard className="h-5 w-5" />} value={String(activeSubs)} label="Active Subscriptions" />
        <StatCard icon={<Wifi className="h-5 w-5" />} value="4.2M/mo" label="API Usage" sub="82% of quota" />
        <StatCard icon={<HardDrive className="h-5 w-5" />} value={`${storageUsed} GB`} label="Storage Usage" sub={`of ${storageQuota} GB provisioned`} />
        <StatCard icon={<Server className="h-5 w-5" />} value="Operational" label="Server Status" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} value="0.04%" label="Error Rate" change="0.01%" up={false} />
        <StatCard icon={<Cloud className="h-5 w-5" />} value="428" label="Active Sessions" />
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
              <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
              <Area type="monotone" dataKey="users" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#gUsers)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue Trends (MRR)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `$${v / 1000}k`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="mrr" stroke="var(--color-brand-green)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="AI Usage (generations/mo)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aiUsage} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="generations" fill="var(--color-brand-purple)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Subscription Growth">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={subGrowth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="subs" stroke="var(--color-brand-blue)" strokeWidth={2.5} dot={false} />
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
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 h-56">{children}</div>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: { label: string; pct: number }[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-xs text-muted-foreground"><span>{r.label}</span><span>{r.pct}%</span></div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent">
              <div className="h-full rounded-full bg-primary" style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
