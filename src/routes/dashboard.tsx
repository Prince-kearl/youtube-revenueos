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
  RefreshCw,
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
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { KpiTrendCardSkeleton, SkeletonCircle } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useChannelSettings } from "@/lib/channel-settings";
import { useOnboarding } from "@/lib/stores";
import { DEMO_YOUTUBE_DASHBOARD, IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import { useLocalStore } from "@/lib/local-store";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";

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

// "forbidden" = YouTube rejected the request for auth/permission reasons (401/403) — most often a
// token that predates a scope being added, fixable by reconnecting. Distinct from "unavailable",
// which means the request succeeded but there's genuinely nothing to report for the period.
type AnalyticsAvailability = "available" | "unavailable" | "disabled" | "forbidden";

type DashboardData = {
  channel: DashboardChannel;
  videos: DashboardVideo[];
  videosStatus: "available" | "unavailable" | "disabled";
  analytics: DashboardAnalyticsRow[];
  analyticsStatus: AnalyticsAvailability;
  revenueStatus: AnalyticsAvailability;
  watchTimeStatus: AnalyticsAvailability;
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
    if (!row.month || !/^\d{4}-\d{2}$/.test(row.month)) continue;
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

function monthLabel(monthKey: string | undefined): string {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return "";
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

// Month-over-month % change between the last two points of a raw (non-cumulative) series — null
// when there isn't enough data or the baseline is zero (percent change is undefined there).
function pctChange(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series.at(-2)!;
  const curr = series.at(-1)!;
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function signed(value: number, formatter: (n: number) => string): string {
  return `${value >= 0 ? "+" : "-"}${formatter(Math.abs(value))}`;
}

function Dashboard() {
  const { settings } = useChannelSettings();
  const [range, setRange] = useState<"3M" | "6M" | "12M">("12M");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [youtubeStatus, setYoutubeStatus] = useState<
    "loading" | "connected" | "not_connected" | "error" | "reauth"
  >("loading");
  const [youtubeRefreshing, setYoutubeRefreshing] = useState(false);
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const youtubeAbortRef = useRef<AbortController | null>(null);
  const youtubeRequestRef = useRef(0);
  const loadYoutubeData = async (
    forceRefresh = false,
  ): Promise<"connected" | "not_connected" | "reauth" | "error" | null> => {
    const requestId = ++youtubeRequestRef.current;
    youtubeAbortRef.current?.abort();
    const controller = new AbortController();
    youtubeAbortRef.current = controller;
    setYoutubeRefreshing(true);
    if (IS_LOCAL_DEMO) {
      setDashboardData(DEMO_YOUTUBE_DASHBOARD as unknown as DashboardData);
      setYoutubeStatus("connected");
      setYoutubeRefreshing(false);
      return "connected";
    }
    try {
      const params = new URLSearchParams();
      if (activeChannelId) params.set("channelId", activeChannelId);
      if (forceRefresh) params.set("refresh", "1");
      const query = params.toString();
      const response = await fetch(`/api/youtube/dashboard${query ? `?${query}` : ""}`, {
        cache: forceRefresh ? "no-store" : "default",
        signal: controller.signal,
      });
      const body = (await response.json()) as DashboardResponse;
      if (requestId !== youtubeRequestRef.current) return null;
      if (response.status === 401 && "error" in body && body.error === "YOUTUBE_REAUTH_REQUIRED") {
        setDashboardData(null);
        setYoutubeStatus("reauth");
        return "reauth";
      } else if (!response.ok || !("data" in body)) {
        setDashboardData(null);
        setYoutubeStatus("error");
        return "error";
      } else if (body.status === "not_connected") {
        setDashboardData(null);
        setYoutubeStatus("not_connected");
        return "not_connected";
      } else {
        setDashboardData(body.data);
        setYoutubeStatus("connected");
        return "connected";
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      if (requestId !== youtubeRequestRef.current) return null;
      setDashboardData(null);
      setYoutubeStatus("error");
      return "error";
    } finally {
      if (requestId === youtubeRequestRef.current) {
        setYoutubeRefreshing(false);
        youtubeAbortRef.current = null;
      }
    }
  };
  useEffect(() => {
    void loadYoutubeData();
    return () => youtubeAbortRef.current?.abort();
  }, [activeChannelId]);

  const trend = useMemo(() => {
    if (
      dashboardData?.analyticsStatus !== "available" ||
      dashboardData.revenueStatus !== "available"
    )
      return [];
    return buildRevenueTrend(dashboardData.analytics ?? [], range);
  }, [dashboardData, range]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void loadYoutubeData(true)
      .then((status) => {
        if (status === "connected") toast.success("Dashboard refreshed");
        else if (status === "error") toast.error("Dashboard refresh failed");
      })
      .finally(() => setRefreshing(false));
  };
  const videos = dashboardData?.videos ?? [];
  const videoEmptyMessage =
    dashboardData?.videosStatus === "unavailable"
      ? "Recent YouTube videos are temporarily unavailable."
      : dashboardData?.videosStatus === "disabled"
        ? "Recent video sync is disabled in YouTube Integration settings."
        : "No published videos are available.";
  const revenueEmptyContent =
    youtubeStatus !== "connected" ? (
      "Connect YouTube to view revenue trends."
    ) : dashboardData?.revenueStatus === "disabled" ? (
      "YouTube Analytics import is disabled in Integration settings."
    ) : dashboardData?.revenueStatus === "forbidden" ? (
      <>
        Revenue access needs to be reconnected —{" "}
        <Link to="/settings" className="font-medium text-primary underline">
          reconnect YouTube
        </Link>{" "}
        to fix it.
      </>
    ) : dashboardData?.analyticsStatus === "available" ? (
      "No estimated revenue was reported for this period."
    ) : (
      "YouTube Analytics revenue data isn't available yet."
    );
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

  // Per-metric monthly series (raw, not cumulative — shows real month-to-month shape rather than
  // a curve that only ever trends up) backing the KPI trend cards below. Video counts aren't in
  // the analytics rows, so that one is bucketed directly from each video's publish date instead.
  const analyticsRows = useMemo(
    () => (dashboardData?.analytics ?? []).filter((r) => r.month).slice().sort((a, b) => (a.month! > b.month! ? 1 : -1)),
    [dashboardData],
  );
  const revenueSeries = analyticsRows.map((r) => Number(r.estimatedRevenue ?? 0));
  const viewsSeries = analyticsRows.map((r) => Number(r.views ?? 0));
  const subsSeries = analyticsRows.map((r) => Number(r.subscribersGained ?? 0));
  const watchSeries = analyticsRows.map((r) => Number(r.watchTimeMinutes ?? 0));
  const latestMonthLabel = monthLabel(analyticsRows.at(-1)?.month);
  const trendPeriodLabel = analyticsRows.length ? `Past ${analyticsRows.length} months` : "";

  const videosByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of dashboardData?.videos ?? []) {
      if (!v.publishedAt) continue;
      const key = v.publishedAt.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.keys())
      .sort()
      .map((month) => ({ month, count: map.get(month)! }));
  }, [dashboardData]);
  const videosSeries = videosByMonth.map((m) => m.count);
  const latestVideoMonthLabel = monthLabel(videosByMonth.at(-1)?.month);

  const revenueChangePct = pctChange(revenueSeries);
  const viewsChangePct = pctChange(viewsSeries);
  const subsChangePct = pctChange(subsSeries);
  const watchChangePct = pctChange(watchSeries);
  const videosChangePct = pctChange(videosSeries);
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
        <p className="mb-1 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading your YouTube data…
        </p>
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
      {youtubeStatus === "reauth" && (
        <YoutubeReauthNotice
          channelName={dashboardData?.channel.title}
          onRetry={() => void loadYoutubeData()}
        />
      )}
      {youtubeStatus === "error" && (
        <div className="card-gradient-outline flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">We couldn't load your YouTube data</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The YouTube API is temporarily unavailable.
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
              Open Settings
            </Link>
          </div>
        </div>
      )}

      {/* Stat cards */}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading key metrics" : undefined}>
      {youtubeStatus === "loading" ? (
        Array.from({ length: 6 }).map((_, i) => <KpiTrendCardSkeleton key={i} />)
      ) : (
        <>
        <KpiTrendCard
          title="Estimated Revenue"
          value={dashboardData?.revenueStatus === "available" ? formatMoney(totalRevenue) : "—"}
          deltaLabel={revenueSeries.length ? signed(revenueSeries.at(-1) ?? 0, formatMoney) : "—"}
          deltaSuffix="this month"
          changePercent={revenueChangePct}
          periodLabel={trendPeriodLabel}
          series={revenueSeries}
          markerTitle={formatMoney(revenueSeries.at(-1) ?? 0)}
          markerSubtitle={latestMonthLabel}
          positive={(revenueChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Latest Revenue"
          value={dashboardData?.revenueStatus === "available" ? formatMoney(latestRevenue) : "—"}
          deltaLabel={signed(recentRevenueChange, formatMoney)}
          deltaSuffix="vs last month"
          changePercent={revenueChangePct}
          periodLabel={trendPeriodLabel}
          series={revenueSeries}
          markerTitle={formatMoney(revenueSeries.at(-1) ?? 0)}
          markerSubtitle={latestMonthLabel}
          positive={recentRevenueChange >= 0}
        />
        <KpiTrendCard
          title="Total Views"
          value={dashboardData ? formatCount(dashboardData.channel.viewCount) : "—"}
          deltaLabel={viewsSeries.length ? signed(viewsSeries.at(-1) ?? 0, formatCount) : "—"}
          deltaSuffix="this month"
          changePercent={viewsChangePct}
          periodLabel={trendPeriodLabel}
          series={viewsSeries}
          markerTitle={`${formatCount(viewsSeries.at(-1) ?? 0)} views`}
          markerSubtitle={latestMonthLabel}
          positive={(viewsChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Videos"
          value={dashboardData ? formatCount(dashboardData.channel.videoCount) : "—"}
          deltaLabel={videosSeries.length ? signed(videosSeries.at(-1) ?? 0, (n) => String(n)) : "—"}
          deltaSuffix="published this month"
          changePercent={videosChangePct}
          periodLabel={trendPeriodLabel}
          series={videosSeries}
          markerTitle={`${videosSeries.at(-1) ?? 0} published`}
          markerSubtitle={latestVideoMonthLabel}
          positive={(videosChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Subscribers"
          value={dashboardData ? formatCount(dashboardData.channel.subscriberCount) : "—"}
          deltaLabel={subsSeries.length ? signed(subsSeries.at(-1) ?? 0, (n) => String(n)) : "—"}
          deltaSuffix="gained this month"
          changePercent={subsChangePct}
          periodLabel={trendPeriodLabel}
          series={subsSeries}
          markerTitle={`+${subsSeries.at(-1) ?? 0} subs`}
          markerSubtitle={latestMonthLabel}
          positive={(subsChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Watch Time"
          value={
            dashboardData?.watchTimeStatus === "available"
              ? `${formatHours(totalWatchTime)} hrs`
              : "—"
          }
          deltaLabel={watchSeries.length ? signed(watchSeries.at(-1) ?? 0, (n) => `${formatHours(n)} hrs`) : "—"}
          deltaSuffix="this month"
          changePercent={watchChangePct}
          periodLabel={trendPeriodLabel}
          series={watchSeries}
          markerTitle={`${formatHours(watchSeries.at(-1) ?? 0)} hrs`}
          markerSubtitle={latestMonthLabel}
          positive={(watchChangePct ?? 0) >= 0}
        />
        </>
      )}
      </div>

      {dashboardData?.analyticsStatus === "unavailable" && (
        <p className="text-xs text-warning">
          YouTube Analytics is temporarily unavailable. Channel and video metrics are current;
          analytics data was not substituted.
        </p>
      )}
      {dashboardData?.analyticsStatus === "forbidden" && (
        <p className="text-xs text-warning">
          YouTube declined this request — your connection may predate a required permission.{" "}
          <Link to="/settings" className="font-medium underline">
            Reconnect YouTube
          </Link>{" "}
          to fix it.
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
                  type="button"
                  onClick={() => setRange(t)}
                  aria-pressed={t === range}
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
          {dashboardData?.revenueStatus === "forbidden" && (
            <p className="mt-2 text-xs text-warning">{revenueEmptyContent}</p>
          )}

          <div className="mt-4 h-[300px]">
            {youtubeStatus === "loading" ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : trend.length ? (
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
                {revenueEmptyContent}
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
          <div className="mt-4 space-y-2.5 sm:hidden" aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading recent videos" : undefined}>
            {youtubeStatus === "loading" &&
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            {youtubeStatus !== "loading" && videos.slice(0, 5).map((video, index) => (
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
            {youtubeStatus !== "loading" && !videos.length && (
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
              <tbody aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading recent videos" : undefined}>
                {youtubeStatus === "loading" &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-3" colSpan={4}>
                        <Skeleton className="h-4 w-full max-w-md" />
                      </td>
                    </tr>
                  ))}
                {youtubeStatus !== "loading" && videos.slice(0, 5).map((video, index) => (
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
                {youtubeStatus !== "loading" && !videos.length && (
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
          <div className="mt-6 border-t border-border pt-4" aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading revenue total" : undefined}>
            <p className="text-sm text-muted-foreground">Available period total</p>
            {youtubeStatus === "loading" ? (
              <>
                <Skeleton className="mt-2 h-7 w-24" />
                <Skeleton className="mt-2 h-3 w-40" />
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold">
                  {dashboardData?.revenueStatus === "available" ? formatMoney(totalRevenue) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dashboardData?.revenueStatus === "available"
                    ? "Platform attribution is not included"
                    : "No current analytics value available"}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Channel banner — kept below the dashboard's analytics and revenue content. */}
      {youtubeStatus === "loading" ? (
        <div
          className="relative mb-5 min-h-[112px] overflow-hidden rounded-2xl border border-border bg-card p-5 sm:min-h-[128px] sm:p-6"
          aria-busy="true"
          aria-label="Loading connected channel"
        >
          <div className="flex h-full items-center gap-4">
            <SkeletonCircle className="h-11 w-11 sm:h-14 sm:w-14" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-2.5 w-32" />
              <Skeleton className="h-5 w-48" />
            </div>
            <Skeleton className="hidden h-10 w-32 shrink-0 rounded-lg sm:block" />
          </div>
        </div>
      ) : (
      <div className="nav-glow-motion hero-banner-bg relative mb-5 min-h-[112px] overflow-hidden rounded-2xl border border-white/15 p-5 shadow-xl shadow-black/10 backdrop-blur-xl sm:min-h-[128px] sm:p-6">
        <div className="relative z-10 flex min-w-0 flex-col justify-between gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {settings.showAvatar && dashboardData?.channel.thumbnail && (
              <div className="relative shrink-0">
                <div className="rounded-full bg-white/10 p-1 ring-1 ring-white/20">
                  <img
                    src={dashboardData.channel.thumbnail}
                    alt={dashboardData.channel.title}
                    className="h-11 w-11 rounded-full object-cover sm:h-14 sm:w-14"
                  />
                </div>
                <span
                  aria-hidden="true"
                  className="absolute -bottom-0.5 -right-1 flex h-5 w-7 items-center justify-center rounded-[5px] bg-[#ff0000] ring-2 ring-[#081522] sm:h-6 sm:w-8"
                >
                  <svg viewBox="0 0 24 18" className="h-3 w-4 sm:h-3.5 sm:w-5" fill="none">
                    <path
                      d="M23.5 3.1a3 3 0 0 0-2.1-2.1C19.6.5 12 .5 12 .5s-7.6 0-9.4.5A3 3 0 0 0 .5 3.1 31.7 31.7 0 0 0 0 9s0 2.9.5 5.9a3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-3 .5-5.9.5-5.9s0-2.9-.5-5.9Z"
                      fill="currentColor"
                      className="text-white"
                    />
                    <path d="m9.6 12.8 5.2-3.8-5.2-3.8v7.6Z" fill="#ff0000" />
                  </svg>
                </span>
              </div>
            )}
            <div className="min-w-0">
              {settings.showName && (
                <p className="truncate text-base font-semibold leading-tight text-white sm:text-lg">
                  {dashboardData?.channel.title ?? "YouTube channel"}
                </p>
              )}
              <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-white/65 sm:text-sm">
                {dashboardData?.channel.handle && (
                  <span className="truncate">{dashboardData.channel.handle}</span>
                )}
                {settings.showSubscribers && dashboardData && (
                  <>
                    {dashboardData.channel.handle && (
                      <span aria-hidden="true" className="text-white/35">
                        •
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span className="font-medium text-white">
                        {formatCount(dashboardData.channel.subscriberCount)}
                      </span>
                      <span className="hidden sm:inline">subscribers</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          {settings.showVisitButton && (
            <a
              href={dashboardData?.channel.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!dashboardData?.channel.url}
              aria-label="Visit Channel"
              className={`flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-primary/30 sm:w-auto sm:px-4 ${!dashboardData?.channel.url ? "pointer-events-none opacity-50" : ""}`}
            >
              <span className="hidden sm:inline">Visit channel</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}
        </div>
      </div>
      )}

      {/* Recent videos */}
      {youtubeStatus === "loading" && settings.showRecentPosts && (
        <div className="card-gradient-outline relative mb-5 p-5 backdrop-blur-xl" aria-busy="true" aria-label="Loading recent videos">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}
      {youtubeStatus !== "loading" && settings.showRecentPosts && (
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
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = window.setInterval(() => {
      if (paused || reducedMotion) return;
      const card = el.querySelector<HTMLElement>("[data-card]");
      const step = card ? card.offsetWidth + 12 : 172;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
    }, 2500);
    return () => window.clearInterval(id);
  }, [paused, reducedMotion]);

  return (
    <div
      ref={scrollRef}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
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
