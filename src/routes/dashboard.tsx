import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  DollarSign, TrendingUp, Eye, Handshake, RefreshCw,
  Youtube, Users, ExternalLink, Play, CheckCircle2, Circle, X, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard, ChangeCell } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { NotificationRow } from "@/components/NotificationRow";
import { recentPosts, revenueSplit, revenueTrend, topVideos } from "@/lib/data";
import { useChannelSettings } from "@/lib/channel-settings";
import { useNotifications, useOnboarding } from "@/lib/stores";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { settings } = useChannelSettings();
  const [range, setRange] = useState<"3M" | "6M" | "12M">("12M");
  const trend = useMemo(() => {
    const n = range === "3M" ? 3 : range === "6M" ? 6 : 12;
    return revenueTrend.slice(-n);
  }, [range]);
  const [notifs, setNotifs] = useNotifications();
  const visibleNotifs = notifs.filter((n) => !n.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => { setRefreshing(false); toast.success("Alerts refreshed"); }, 700);
  };
  return (
    <DashboardLayout title="Dashboard">
      <GettingStarted />

      {/* Channel banner — with iOS 26 Design on: a premium glass hero card over a deep-red gradient
          wash (the one "always visible" red moment, per the brand-selectively rule). With it off:
          the original navy/primary gradient pill with the animated glow-ring border. Both the
          gradient and the glow ring are switched by .hero-banner-bg/.nav-glow-motion keying off
          .ios26 in styles.css, not by branching here — still always a single row so the visit
          button never forces a stacked layout. */}
      <div className="nav-glow-motion hero-banner-bg relative mb-5 flex items-center justify-between gap-3 overflow-hidden rounded-[var(--hero-radius)] border border-white/10 p-4 shadow-xl backdrop-blur-xl sm:gap-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {settings.showAvatar && (
            <div className="relative shrink-0">
              <img src={settings.avatar} alt={settings.name} className="h-11 w-11 rounded-full object-cover sm:h-14 sm:w-14" />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-red ring-2 ring-card sm:h-6 sm:w-6">
                <Youtube className="h-3 w-3 text-white sm:h-3.5 sm:w-3.5" fill="white" strokeWidth={1.5} />
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight text-white sm:text-lg">{settings.name}</p>
            {settings.showSubscribers && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/60 sm:text-sm">
                <Users className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                <span className="shrink-0 font-medium text-white">{settings.subscribers}</span>
                <span className="hidden sm:inline">subscribers</span>
              </p>
            )}
          </div>
        </div>
        {settings.showVisitButton && (
          <a
            href={settings.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit Channel"
            className="flex h-9 w-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary text-sm font-medium text-white transition-colors hover:bg-primary/90 sm:h-10 sm:w-auto sm:px-4"
          >
            <Youtube className="hidden h-4 w-4 shrink-0 sm:block" fill="white" strokeWidth={1.5} />
            <span className="hidden sm:inline">Visit Channel</span>
            <ExternalLink className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" />
          </a>
        )}
      </div>

      {/* Recently added posts */}
      {settings.showRecentPosts && (
        <div className="card-gradient-outline relative mb-5 p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recently Added Posts</h3>
            <a href={settings.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
              View channel
            </a>
          </div>

          {/* Desktop grid */}
          <div className="mt-4 hidden grid-cols-4 gap-3 sm:grid">
            {recentPosts.map((p) => (
              <PostCard key={p.title} post={p} />
            ))}
          </div>

          {/* Mobile horizontal autoslide carousel */}
          <RecentPostsCarousel />
        </div>
      )}



      {/* Stat cards */}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard glow frost icon={<DollarSign className="h-5 w-5" />} value="$142,800" label="Total Revenue" sub="vs last year" change="18.4%" up />
        <StatCard glow frost icon={<TrendingUp className="h-5 w-5" />} value="$44,300" label="Monthly Revenue" sub="vs last month" change="12.7%" up />
        <StatCard glow frost icon={<Eye className="h-5 w-5" />} value="8.4M" label="Total Views" sub="vs last month" change="9.2%" up />
        <StatCard glow frost icon={<Handshake className="h-5 w-5" />} value="7" label="Active Deals" sub="vs last month" change="1%" up={false} />
      </div>

      {/* Trends + Alerts */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">Revenue Trends</h3>
              <p className="text-sm text-muted-foreground">All revenue streams over time</p>
            </div>
            <div className="glass-pill flex gap-0.5 p-1 text-xs backdrop-blur-lg">
              {(["3M", "6M", "12M"] as const).map((t) => (
                <button key={t} onClick={() => setRange(t)} className={`rounded-full px-3 py-1.5 font-medium transition-all ${t === range ? "glass-segment-active" : "text-muted-foreground hover:text-foreground"}`}>
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
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="gBrand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-purple)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-brand-purple)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${v}k`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "color-mix(in srgb, var(--color-popover) 85%, transparent)", border: "1px solid color-mix(in srgb, white 20%, var(--color-border))", borderRadius: 16, fontSize: 12, boxShadow: "0 16px 32px -20px rgba(0,0,0,0.4)", backdropFilter: "blur(12px)" }} />
                <Area type="monotone" dataKey="brand" stroke="var(--color-brand-purple)" strokeWidth={2.5} fill="url(#gBrand)" />
                <Area type="monotone" dataKey="adsense" stroke="var(--color-brand-blue)" strokeWidth={2.5} fill="transparent" />
                <Area type="monotone" dataKey="memberships" stroke="var(--color-brand-green)" strokeWidth={2.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Alerts */}
        <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex shrink-0 items-center justify-between">
            <h3 className="text-lg font-semibold">Live Alerts</h3>
            <button onClick={refresh} className="text-muted-foreground hover:text-foreground" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="mt-4 flex-1 space-y-2.5">
            {visibleNotifs.slice(0, 3).map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onMarkRead={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))}
                onTogglePin={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x)))}
                onToggleArchive={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, archived: !x.archived } : x)))}
                onDelete={() => setNotifs((prev) => prev.filter((x) => x.id !== n.id))}
              />
            ))}
          </div>
          <Link to="/notifications" className="mt-3 shrink-0 self-start text-sm font-medium text-primary hover:underline">
            View all alerts
          </Link>
        </div>
      </div>

      {/* Top videos + Revenue split */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Top Revenue Videos</h3>
            <Link to="/videos" className="text-sm font-medium text-primary hover:underline">View all</Link>
          </div>
          {/* Mobile: stacked cards */}
          <div className="mt-4 space-y-2.5 sm:hidden">
            {topVideos.slice(0, 5).map((v) => (
              <div key={v.rank} className="card-frost p-3 backdrop-blur-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{v.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.title}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{v.viewsShort} views</span>
                  <span className="font-semibold">{v.revenue}</span>
                  <ChangeCell change={v.change} up={v.up} />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
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
                        <span className="font-medium whitespace-nowrap">{v.title}</span>
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
        </div>

        {/* Revenue split */}
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
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

type Post = (typeof recentPosts)[number];

function PostCard({ post, compact }: { post: Post; compact?: boolean }) {
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`card-frost group block overflow-hidden backdrop-blur-lg transition-transform hover:-translate-y-0.5 ${compact ? "w-40 shrink-0" : ""}`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-brand-red/40 to-brand-purple/40">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-transform group-hover:scale-110">
          <Play className="h-3 w-3 text-white" fill="white" />
        </span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{post.duration}</span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-medium leading-snug">{post.title}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{post.views} views • {post.date}</p>
      </div>
    </a>
  );
}

function RecentPostsCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = window.setInterval(() => {
      if (paused) return;
      const card = el.querySelector<HTMLElement>("[data-card]");
      const step = card ? card.offsetWidth + 12 : 172;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
    }, 2500);
    return () => window.clearInterval(id);
  }, [paused]);

  return (
    <div
      ref={scrollRef}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      className="mt-4 flex gap-3 overflow-x-auto pb-1 sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {recentPosts.map((p) => (
        <div key={p.title} data-card>
          <PostCard post={p} compact />
        </div>
      ))}
    </div>
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

const onboardingSteps = [
  { id: "banner", label: "Set up your dashboard banner", desc: "Add your channel name, avatar, and subscriber count.", to: "/settings" },
  { id: "video", label: "Add your first video", desc: "Paste a YouTube URL to auto-generate an AI description.", to: "/add-video" },
  { id: "comments", label: "Create a comment automation rule", desc: "Auto-reply to comments asking for links or info.", to: "/comments" },
  { id: "link", label: "Create a tracked link", desc: "Track clicks and revenue from your video descriptions.", to: "/link-tracking" },
  { id: "channel", label: "Connect your YouTube channel", desc: "Sync real analytics and revenue data.", to: "/settings" },
] as const;

function GettingStarted() {
  const [onboarding, setOnboarding] = useOnboarding();

  if (onboarding.dismissed) return null;

  const doneCount = onboarding.completedSteps.length;
  const allDone = doneCount === onboardingSteps.length;

  const toggleStep = (id: string) => {
    setOnboarding((prev) => ({
      ...prev,
      completedSteps: prev.completedSteps.includes(id)
        ? prev.completedSteps.filter((s) => s !== id)
        : [...prev.completedSteps, id],
    }));
  };
  const dismiss = () => setOnboarding((prev) => ({ ...prev, dismissed: true }));

  return (
    <div className="card-gradient-outline relative mb-5 p-4 backdrop-blur-xl sm:p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold">{allDone ? "You're all set! 🎉" : "Getting started"}</h3>
            <p className="text-xs text-muted-foreground">{doneCount} of {onboardingSteps.length} steps complete</p>
          </div>
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss getting started checklist">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / onboardingSteps.length) * 100}%` }} />
      </div>

      <div className="mt-4 space-y-1">
        {onboardingSteps.map((step) => {
          const done = onboarding.completedSteps.includes(step.id);
          return (
            <div key={step.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-accent/40">
              <button onClick={() => toggleStep(step.id)} aria-label={done ? "Mark as not done" : "Mark as done"} className="shrink-0">
                {done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              </button>
              <Link to={step.to} className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
