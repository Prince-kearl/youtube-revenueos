import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Eye,
  RefreshCw,
  Youtube,
  Users,
  ExternalLink,
  Play,
  CheckCircle2,
  Circle,
  X,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useChannelSettings } from "@/lib/channel-settings";
import { useOnboarding } from "@/lib/stores";
import { DEMO_YOUTUBE_DASHBOARD, IS_LOCAL_DEMO } from "@/lib/demo-youtube";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

type DashboardVideo = {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  url: string;
};

type DashboardChannel = {
  channelId: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId: string | null;
  url: string | null;
};

type DashboardAnalyticsRow = {
  month?: string;
  views?: number;
  estimatedRevenue?: number;
  subscribersGained?: number;
  watchTimeMinutes?: number;
};

type DashboardData = {
  channel: DashboardChannel;
  videos: DashboardVideo[];
  videosStatus: "available" | "unavailable" | "disabled";
  analytics: DashboardAnalyticsRow[];
  analyticsStatus: "available" | "unavailable" | "disabled";
  revenueStatus: "available" | "unavailable" | "disabled";
  watchTimeStatus: "available" | "unavailable" | "disabled";
  fetchedAt: string;
};

type DashboardResponse =
  | { status: "not_connected"; data: null }
  | { status: "connected"; data: DashboardData }
  | { error: string };

type RevenueRange = "3M" | "6M" | "12M";

type RevenueTrendPoint = { month: string; monthKey: string; revenue: number };

function buildRevenueTrend(
  analytics: DashboardAnalyticsRow[],
  range: RevenueRange,
): RevenueTrendPoint[] {
  const count = range === "3M" ? 3 : range === "6M" ? 6 : 12;
  const validMonths = analytics
    .map((row) => row.month)
    .filter((month): month is string => Boolean(month && /^\d{4}-\d{2}$/.test(month)))
    .sort();
  const endMonth = validMonths.at(-1) ?? new Date().toISOString().slice(0, 7);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const revenueByMonth = new Map<string, number>();

  for (const row of analytics) {
    if (!row.month || /^\d{4}-\d{2}$/.test(row.month)) continue;
    revenueByMonth.set(
      row.month,
      (revenueByMonth.get(row.month) ?? 0) + Number(row.estimatedRevenue ?? 0),
    );
  }

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(endYear, endMonthNumber - count + index, 1));
    const monthKey = date.toISOString().slice(0, 7);
    return {
      month: date.toLocaleDateString("en", { month: "short", timeZone: "UTC" }),
      monthKey,
      revenue: (revenueByMonth.get(monthKey) ?? 0) / 1000,
    };
  });
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value / 60,
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function Dashboard() {
  const { settings } = useChannelSettings();
  const [range, setRange] = useState<"3M" | "6M" | "12M">("12M");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [youtubeStatus, setYoutubeStatus] = useState<
    "loading" | "connected" | "not_connected" | "error" | "reauth"
  >("loading");
  const [youtubeRefreshing, setYoutubeRefreshing] = useState(false);
  const loadYoutubeData = async (forceRefresh = false) => {
    setYoutubeRefreshing(true);
    if (IS_LOCAL_DEMO) {
      setDashboardData(DEMO_YOUTUBE_DASHBOARD as unknown as DashboardData);
      setYoutubeStatus("connected");
      setYoutubeRefreshing(false);
      return;
    }
    try {
      const response = await fetch(`/api/youtube/dashboard${forceRefresh ? "?refresh=1" : ""}`, {
        cache: forceRefresh ? "no-store" : "default",
      });
      const body = (await response.json()) as DashboardResponse;
      if (response.status === 401 && "error" in body && body.error === "YOUTUBE_REAUTH_REQUIRED") {
        setYoutubeStatus("reauth");
      } else if (!response.ok || !("data" in body)) {
        setYoutubeStatus("error");
      } else if (body.status === "not_connected") {
        setDashboardData(null);
        setYoutubeStatus("not_connected");
      } else {
        setDashboardData(body.data);
        setYoutubeStatus("connected");
      }
    } catch {
      setYoutubeStatus("error");
    } finally {
      setYoutubeRefreshing(false);
    }
  };
  useEffect(() => {
    void loadYoutubeData();
  }, []);

  const trend = useMemo(() => {
    if (dashboardData?.analyticsStatus !== "available") return [];
    return buildRevenueTrend(dashboardData.analytics ?? [], range);
  }, [dashboardData, range]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void loadYoutubeData(true)
      .then(() => {
        if (youtubeStatus === "connected") toast.success("Dashboard refreshed");
      })
      .catch(() => toast.error("Dashboard refresh failed"))
      .finally(() => setRefreshing(false));
  };
  const videos = dashboardData?.videos ?? [];
  const videoEmptyMessage =
    dashboardData?.videosStatus === "unavailable"
      ? "Recent YouTube videos are temporarily unavailable."
      : dashboardData?.videosStatus === "disabled"
        ? "Recent video sync is disabled in YouTube Integration settings."
        : "No published videos are available.";
  const totalRevenue =
    dashboardData?.revenueStatus === "available"
      ? dashboardData.analytics.reduce((sum, row) => sum + Number(row.estimatedRevenue ?? 0), 0)
      : 0;
  const latestRevenue =
    dashboardData?.revenueStatus === "available"
      ? (dashboardData.analytics.at(-1)?.estimatedRevenue ?? 0)
      : 0;
  const totalWatchTime =
    dashboardData?.watchTimeStatus === "available"
      ? dashboardData.analytics.reduce((sum, row) => sum + Number(row.watchTimeMinutes ?? 0), 0)
      : 0;
  const recentRevenueChange =
    dashboardData?.analytics.length && dashboardData.analytics.length > 1
      ? Number(dashboardData.analytics.at(-1)?.estimatedRevenue ?? 0) -
        Number(dashboardData.analytics.at(-2)?.estimatedRevenue ?? 0)
      : 0;
  return (
    <DashboardLayout title="Dashboard">
      <GettingStarted />

      {IS_LOCAL_DEMO && (
        <div className="mb-5 rounded-xl border border-brand-amber/30 bg-brand-amber/10 px-4 py-3 text-sm text-brand-amber">
          <span className="font-semibold">Local demo preview:</span> YouTube metrics below are mock
          data and are not connected to Supabase or YouTube.
        </div>
      )}

      {youtubeStatus === "loading" && (
        <div className="card-gradient-outline space-y-3 p-5" aria-label="Loading YouTube data">
          <h3 className="font-semibold">Loading your YouTube data...</h3>
          <div className="h-5 w-48 animate-pulse rounded bg-accent" />
          <div className="h-4 w-72 animate-pulse rounded bg-accent" />
        </div>
      )}
      {youtubeStatus === "not_connected" && (
        <div className="card-gradient-outline flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Connect your YouTube channel</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect YouTube in Settings to load your channel metrics here.
            </p>
          </div>
          <Link
            to="/settings"
            className="rounded-[var(--button-radius)] bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Open Settings
          </Link>
        </div>
      )}
      {(youtubeStatus === "error" || youtubeStatus === "reauth") && (
        <div className="card-gradient-outline flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">We couldn't load your YouTube data</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {youtubeStatus === "reauth"
                ? "Your YouTube authorization needs to be renewed."
                : "The YouTube API is temporarily unavailable."}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void loadYoutubeData()}
              className="rounded-[var(--button-radius)] border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
            >
              Retry
            </button>
            <Link
              to="/settings"
              className="rounded-[var(--button-radius)] bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Reconnect
            </Link>
          </div>
        </div>
      )}

      {/* Stat cards */}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <StatCard
          glow
          frost
          icon={<DollarSign className="h-5 w-5" />}
          value={dashboardData?.revenueStatus === "available" ? formatMoney(totalRevenue) : "—"}
          label="Estimated Revenue"
          sub={
            dashboardData?.revenueStatus === "unavailable"
              ? "Revenue unavailable"
              : "YouTube Analytics"
          }
        />
        <StatCard
          glow
          frost
          icon={<TrendingUp className="h-5 w-5" />}
          value={dashboardData?.revenueStatus === "available" ? formatMoney(latestRevenue) : "—"}
          label="Latest Revenue"
          sub={
            dashboardData?.revenueStatus === "unavailable"
              ? "Revenue unavailable"
              : "Latest available month"
          }
          change={
            dashboardData?.revenueStatus === "available" && recentRevenueChange
              ? formatMoney(Math.abs(recentRevenueChange))
              : undefined
          }
          up={recentRevenueChange >= 0}
        />
        <StatCard
          glow
          frost
          icon={<Eye className="h-5 w-5" />}
          value={dashboardData ? formatCount(dashboardData.channel.viewCount) : "—"}
          label="Total Views"
          sub="YouTube channel total"
        />
        <StatCard
          glow
          frost
          icon={<Youtube className="h-5 w-5" />}
          value={dashboardData ? formatCount(dashboardData.channel.videoCount) : "—"}
          label="Videos"
          sub="Published on channel"
        />
        <StatCard
          glow
          frost
          icon={<Users className="h-5 w-5" />}
          value={dashboardData ? formatCount(dashboardData.channel.subscriberCount) : "—"}
          label="Subscribers"
          sub="YouTube channel total"
        />
        <StatCard
          glow
          frost
          icon={<Eye className="h-5 w-5" />}
          value={
            dashboardData?.watchTimeStatus === "available"
              ? `${formatHours(totalWatchTime)} hrs`
              : "—"
          }
          label="Watch Time"
          sub={
            dashboardData?.watchTimeStatus === "unavailable"
              ? "Watch time unavailable"
              : "Latest available data"
          }
        />
      </div>

      {dashboardData?.analyticsStatus === "unavailable" && (
        <p className="text-xs text-warning">
          YouTube Analytics is temporarily unavailable. Channel and video metrics are current;
          analytics data was not substituted.
        </p>
      )}
      {dashboardData?.analyticsStatus === "disabled" && (
        <p className="text-xs text-muted-foreground">
          YouTube Analytics import is disabled in YouTube Integration settings.
        </p>
      )}
      {dashboardData && (
        <p className="text-xs text-muted-foreground">
          Last updated {new Date(dashboardData.fetchedAt).toLocaleString()}
        </p>
      )}

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
                <button
                  key={t}
                  onClick={() => setRange(t)}
                  className={`rounded-full px-3 py-1.5 font-medium transition-all ${t === range ? "glass-segment-active" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-5 text-xs">
            <Legend color="var(--color-brand-blue)" label="Estimated YouTube revenue" />
          </div>
          {dashboardData?.revenueStatus === "unavailable" &&
            dashboardData.analyticsStatus === "available" && (
              <p className="mt-2 text-xs text-muted-foreground">
                YouTube returned no estimated revenue rows for this period; available months are
                shown at $0.
              </p>
            )}

          <div className="mt-4 h-[300px]">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="gBrand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand-purple)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-brand-purple)" stopOpacity={0} />
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
                    tickFormatter={(v) => `$${v}k`}
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "color-mix(in srgb, var(--color-popover) 85%, transparent)",
                      border: "1px solid color-mix(in srgb, white 20%, var(--color-border))",
                      borderRadius: 16,
                      fontSize: 12,
                      boxShadow: "0 16px 32px -20px rgba(0,0,0,0.4)",
                      backdropFilter: "blur(12px)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--color-brand-blue)"
                    strokeWidth={2.5}
                    fill="url(#gBrand)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                {youtubeStatus === "connected"
                  ? dashboardData?.revenueStatus === "disabled"
                    ? "YouTube Analytics import is disabled in Integration settings."
                    : dashboardData?.analyticsStatus === "available"
                      ? "No estimated revenue was reported for this period."
                      : "YouTube Analytics revenue data isn't available yet."
                  : "Connect YouTube to view revenue trends."}
              </div>
            )}
          </div>
        </div>

        {/* Live Alerts */}
        <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex shrink-0 items-center justify-between">
            <h3 className="text-lg font-semibold">Live Alerts</h3>
            <button
              onClick={refresh}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing || youtubeRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          <div className="mt-4 flex-1 space-y-2.5">
            <p className="py-4 text-sm text-muted-foreground">No new alerts</p>
          </div>
          <Link
            to="/notifications"
            className="mt-3 shrink-0 self-start text-sm font-medium text-primary hover:underline"
          >
            View all alerts
          </Link>
        </div>
      </div>

      {/* Top videos + Revenue split */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recent YouTube Videos</h3>
            <Link to="/videos" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {/* Mobile: stacked cards */}
          <div className="mt-4 space-y-2.5 sm:hidden">
            {videos.slice(0, 5).map((video, index) => (
              <a
                key={video.id}
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card-frost block p-3 backdrop-blur-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{video.title}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{formatCount(video.views)} views</span>
                  <span className="text-muted-foreground">
                    {video.likes === null
                      ? "Likes unavailable"
                      : `${formatCount(video.likes)} likes`}
                  </span>
                  <span className="text-muted-foreground">
                    {video.comments === null
                      ? "Comments unavailable"
                      : `${formatCount(video.comments)} comments`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(video.publishedAt)}
                </p>
              </a>
            ))}
            {!videos.length && (
              <p className="py-6 text-sm text-muted-foreground">{videoEmptyMessage}</p>
            )}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-3 font-medium">Video</th>
                  <th className="pb-3 font-medium">Views</th>
                  <th className="pb-3 font-medium">Likes</th>
                  <th className="pb-3 text-right font-medium">Comments</th>
                </tr>
              </thead>
              <tbody>
                {videos.slice(0, 5).map((video, index) => (
                  <tr key={video.id} className="border-t border-border">
                    <td className="py-3">
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3"
                      >
                        <span className="text-muted-foreground">{index + 1}</span>
                        {video.thumbnail && (
                          <img
                            src={video.thumbnail}
                            alt=""
                            className="h-10 w-16 shrink-0 rounded object-cover"
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block max-w-[26rem] truncate font-medium">
                            {video.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(video.publishedAt)}
                          </span>
                        </span>
                      </a>
                    </td>
                    <td className="py-3 text-muted-foreground">{formatCount(video.views)}</td>
                    <td className="py-3 text-muted-foreground">
                      {video.likes === null ? "—" : formatCount(video.likes)}
                    </td>
                    <td className="py-3 text-right text-muted-foreground">
                      {video.comments === null ? "—" : formatCount(video.comments)}
                    </td>
                  </tr>
                ))}
                {!videos.length && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      {videoEmptyMessage}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* YouTube revenue summary */}
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">YouTube Revenue</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Directly measured from YouTube Analytics
          </p>
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">Available period total</p>
            <p className="mt-1 text-2xl font-bold">
              {dashboardData?.analyticsStatus === "available" ? formatMoney(totalRevenue) : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dashboardData?.analyticsStatus === "available"
                ? "Platform attribution is not included"
                : "No current analytics value available"}
            </p>
          </div>
        </div>
      </div>

      {/* Channel banner — kept below the dashboard's analytics and revenue content. */}
      <div className="nav-glow-motion hero-banner-bg relative mb-5 flex items-center justify-between gap-3 overflow-hidden rounded-[var(--hero-radius)] border border-white/10 p-4 shadow-xl backdrop-blur-xl sm:gap-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {settings.showAvatar && dashboardData?.channel.thumbnail && (
            <div className="relative shrink-0">
              <img
                src={dashboardData.channel.thumbnail}
                alt={dashboardData.channel.title}
                className="h-11 w-11 rounded-full object-cover sm:h-14 sm:w-14"
              />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-red ring-2 ring-card sm:h-6 sm:w-6">
                <Youtube
                  className="h-3 w-3 text-white sm:h-3.5 sm:w-3.5"
                  fill="white"
                  strokeWidth={1.5}
                />
              </span>
            </div>
          )}
          <div className="min-w-0">
            {settings.showName && (
              <p className="truncate text-base font-semibold leading-tight text-white sm:text-lg">
                {dashboardData?.channel.title ?? "YouTube channel"}
              </p>
            )}
            {settings.showSubscribers && dashboardData && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/60 sm:text-sm">
                <Users className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                <span className="shrink-0 font-medium text-white">
                  {formatCount(dashboardData.channel.subscriberCount)}
                </span>
                <span className="hidden sm:inline">subscribers</span>
              </p>
            )}
          </div>
        </div>
        {settings.showVisitButton && (
          <a
            href={dashboardData?.channel.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!dashboardData?.channel.url}
            aria-label="Visit Channel"
            className={`flex h-9 w-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary text-sm font-medium text-white transition-colors hover:bg-primary/90 sm:h-10 sm:w-auto sm:px-4 ${!dashboardData?.channel.url ? "pointer-events-none opacity-50" : ""}`}
          >
            <Youtube className="hidden h-4 w-4 shrink-0 sm:block" fill="white" strokeWidth={1.5} />
            <span className="hidden sm:inline">Visit Channel</span>
            <ExternalLink className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" />
          </a>
        )}
      </div>

      {/* Recent videos */}
      {settings.showRecentPosts && (
        <div className="card-gradient-outline relative mb-5 p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recent videos</h3>
            <a
              href={dashboardData?.channel.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary hover:underline"
            >
              View channel
            </a>
          </div>

          {/* Desktop grid */}
          <div className="mt-4 hidden grid-cols-4 gap-3 sm:grid">
            {videos.slice(0, 4).map((video) => (
              <PostCard key={video.id} post={video} />
            ))}
            {!videos.length && (
              <p className="col-span-4 py-6 text-sm text-muted-foreground">{videoEmptyMessage}</p>
            )}
          </div>

          {/* Mobile horizontal autoslide carousel */}
          <RecentPostsCarousel videos={videos} />
        </div>
      )}
    </DashboardLayout>
  );
}

type Post = DashboardVideo;

function PostCard({ post, compact }: { post: Post; compact?: boolean }) {
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`card-frost group block overflow-hidden backdrop-blur-lg transition-transform hover:-translate-y-0.5 ${compact ? "w-40 shrink-0" : ""}`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-brand-red/40 to-brand-purple/40">
        {post.thumbnail && (
          <img
            src={post.thumbnail}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-transform group-hover:scale-110">
          <Play className="h-3 w-3 text-white" fill="white" />
        </span>
        {post.duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {post.duration}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-medium leading-snug">{post.title}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatCount(post.views)} views • {formatDate(post.publishedAt)}
        </p>
      </div>
    </a>
  );
}

function RecentPostsCarousel({ videos }: { videos: DashboardVideo[] }) {
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
      {videos.slice(0, 8).map((video) => (
        <div key={video.id} data-card>
          <PostCard post={video} compact />
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
  {
    id: "banner",
    label: "Set up your dashboard banner",
    desc: "Connect YouTube to sync your channel name, avatar, and subscriber count.",
    to: "/settings",
  },
  {
    id: "video",
    label: "Add your first video",
    desc: "Paste a YouTube URL to auto-generate an AI description.",
    to: "/add-video",
  },
  {
    id: "comments",
    label: "Create a comment automation rule",
    desc: "Auto-reply to comments asking for links or info.",
    to: "/comments",
  },
  {
    id: "link",
    label: "Create a tracked link",
    desc: "Track clicks and revenue from your video descriptions.",
    to: "/link-tracking",
  },
  {
    id: "channel",
    label: "Connect your YouTube channel",
    desc: "Sync real analytics and revenue data.",
    to: "/settings",
  },
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
            <p className="text-xs text-muted-foreground">
              {doneCount} of {onboardingSteps.length} steps complete
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss getting started checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(doneCount / onboardingSteps.length) * 100}%` }}
        />
      </div>

      <div className="mt-4 space-y-1">
        {onboardingSteps.map((step) => {
          const done = onboarding.completedSteps.includes(step.id);
          return (
            <div
              key={step.id}
              className="flex items-center gap-3 rounded-lg p-2 hover:bg-accent/40"
            >
              <button
                onClick={() => toggleStep(step.id)}
                aria-label={done ? "Mark as not done" : "Mark as done"}
                className="shrink-0"
              >
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
              <Link to={step.to} className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
