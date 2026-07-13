import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  DollarSign, TrendingUp, Eye, Handshake, RefreshCw, MessageSquare,
  CheckCircle2, AlertTriangle, Zap, Clock, Youtube, Users, ExternalLink, Play,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard, ChangeCell } from "@/components/ui-bits";
import { alerts, recentPosts, revenueSplit, revenueTrend, topVideos } from "@/lib/data";
import { useChannelSettings } from "@/lib/channel-settings";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});


const alertIcons = { message: MessageSquare, check: CheckCircle2, dollar: DollarSign, alert: AlertTriangle, zap: Zap, clock: Clock };
const alertColor: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  green: "bg-brand-green/15 text-brand-green",
  amber: "bg-brand-amber/15 text-brand-amber",
  red: "bg-brand-red/15 text-brand-red",
  blue: "bg-brand-blue/15 text-brand-blue",
};

function Dashboard() {
  const { settings } = useChannelSettings();
  return (
    <DashboardLayout title="Dashboard">
      {/* Channel banner */}
      <div className="mb-5 flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4">
          {settings.showAvatar && (
            <div className="relative shrink-0">
              <img src={settings.avatar} alt={settings.name} className="h-14 w-14 rounded-full object-cover" />
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-red ring-2 ring-card">
                <Youtube className="h-3.5 w-3.5 text-white" fill="white" strokeWidth={1.5} />
              </span>
            </div>
          )}
          <div>
            <p className="text-lg font-semibold leading-tight">{settings.name}</p>
            {settings.showSubscribers && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span className="font-medium text-foreground">{settings.subscribers}</span> subscribers
              </p>
            )}
          </div>
        </div>
        {settings.showVisitButton && (
          <a
            href={settings.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-red px-4 text-sm font-medium text-white transition-colors hover:bg-brand-red/90"
          >
            <Youtube className="h-4 w-4" fill="white" strokeWidth={1.5} />
            Visit Channel
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Recently added posts */}
      {settings.showRecentPosts && (
        <div className="mb-5 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recently Added Posts</h3>
            <a href={settings.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
              View channel
            </a>
          </div>

          {/* Desktop grid */}
          <div className="mt-4 hidden grid-cols-1 gap-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
            {recentPosts.map((p) => (
              <PostCard key={p.title} post={p} />
            ))}
          </div>

          {/* Mobile horizontal autoslide carousel */}
          <RecentPostsCarousel />
        </div>
      )}



      {/* Stat cards */}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<DollarSign className="h-5 w-5" />} value="$142,800" label="Total Revenue" sub="vs last year" change="18.4%" up />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value="$44,300" label="Monthly Revenue" sub="vs last month" change="12.7%" up />
        <StatCard icon={<Eye className="h-5 w-5" />} value="8.4M" label="Total Views" sub="vs last month" change="9.2%" up />
        <StatCard icon={<Handshake className="h-5 w-5" />} value="7" label="Active Deals" sub="vs last month" change="1%" up={false} />
      </div>

      {/* Trends + Alerts */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">Revenue Trends</h3>
              <p className="text-sm text-muted-foreground">All revenue streams over time</p>
            </div>
            <div className="flex rounded-lg bg-accent p-1 text-xs">
              {["3M", "6M", "12M"].map((t) => (
                <button key={t} className={`rounded-md px-3 py-1 font-medium ${t === "12M" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-5 text-xs">
            <Legend color="var(--color-brand-blue)" label="AdSense" />
            <Legend color="var(--color-brand-purple)" label="Brand Deals" />
            <Legend color="var(--color-brand-green)" label="Memberships" />
          </div>

          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend}>
                <defs>
                  <linearGradient id="gBrand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-purple)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-brand-purple)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${v}k`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
                <Area type="monotone" dataKey="brand" stroke="var(--color-brand-purple)" strokeWidth={2.5} fill="url(#gBrand)" />
                <Area type="monotone" dataKey="adsense" stroke="var(--color-brand-blue)" strokeWidth={2.5} fill="transparent" />
                <Area type="monotone" dataKey="memberships" stroke="var(--color-brand-green)" strokeWidth={2.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Alerts */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Live Alerts</h3>
            <button className="text-muted-foreground hover:text-foreground">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 space-y-2.5">
            {alerts.map((a, i) => {
              const Icon = alertIcons[a.icon as keyof typeof alertIcons];
              return (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-accent/30 p-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${alertColor[a.color]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.time}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top videos + Revenue split */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Top Revenue Videos</h3>
            <button className="text-sm font-medium text-primary hover:underline">View all</button>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-3 font-medium">Video</th>
                <th className="pb-3 font-medium">Views</th>
                <th className="pb-3 font-medium">Revenue</th>
                <th className="pb-3 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {topVideos.slice(0, 5).map((v) => (
                <tr key={v.rank} className="border-t border-border">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{v.rank}</span>
                      <span className="font-medium">{v.title}</span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{v.viewsShort}</td>
                  <td className="py-3 font-semibold">{v.revenue}</td>
                  <td className="py-3">
                    <div className="flex justify-end">
                      <ChangeCell change={v.change} up={v.up} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Revenue split */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-lg font-semibold">Revenue Split</h3>
          <div className="mt-5 space-y-4">
            {revenueSplit.map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                    {r.label}
                  </span>
                  <span className="font-semibold">
                    {r.amount} <span className="ml-1 text-xs font-normal text-muted-foreground">{r.pct}%</span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                  <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">This month total</p>
            <p className="mt-1 text-2xl font-bold">$44,300</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-success">▲ +12.7% vs last month</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
