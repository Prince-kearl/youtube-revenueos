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
  Eye,
  ThumbsUp,
  MessageCircle,
  ChevronDown,
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
  estimatedAdRevenue?: number;
  estimatedRedPartnerRevenue?: number;
  subscribersGained?: number;
  watchTimeMinutes?: number;
};

// "forbidden" = YouTube rejected the request for auth/permission reasons (401/403) — most often a
// token that predates a scope being added, fixable by reconnecting. Distinct from "unavailable",
// which means the request succeeded but there's genuinely nothing to report for the period.
type AnalyticsAvailability = "available" | "unavailable" | "disabled" | "forbidden";

type AudienceCountryRow = { country: string; views: number };
type AudienceAgeRow = { ageGroup: string; viewerPercentage: number };
type AudienceGenderRow = { gender: string; viewerPercentage: number };

type DashboardData = {
  channel: DashboardChannel;
  videos: DashboardVideo[];
  videosStatus: "available" | "unavailable" | "disabled";
  analytics: DashboardAnalyticsRow[];
  analyticsStatus: AnalyticsAvailability;
  revenueStatus: AnalyticsAvailability;
  watchTimeStatus: AnalyticsAvailability;
  audience: {
    topCountries: AudienceCountryRow[];
    ageGroups: AudienceAgeRow[];
    genders: AudienceGenderRow[];
  };
  audienceStatus: AnalyticsAvailability;
  videoInsights: {
    subscribersGained: number;
    devices: { desktop: number; mobile: number; tablet: number };
  };
  videoInsightsStatus: AnalyticsAvailability;
  engagementHeatmap: Array<{ date: string; views: number }>;
  engagementHeatmapStatus: AnalyticsAvailability;
  topRevenueVideos: Array<{
    videoId: string;
    views: number;
    revenue: number;
    changePercent: number | null;
  }>;
  topRevenueVideosStatus: AnalyticsAvailability;
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

// Mobile carousel: exactly 1 KPI card visible per "page". sm+ resets back to a normal grid item.
const kpiCardClassName = "w-full shrink-0 snap-start sm:w-auto sm:shrink sm:snap-align-none";
// Clone of the first real card, appended after the last one so autoplay can scroll straight past
// the end into a visually-identical duplicate, then jump back to the real first card the instant
// that scroll finishes — the loop reads as continuous forward motion, never a snap-back. sm+ hides
// it since the grid layout there has no scrolling to loop.
const kpiCloneClassName = `${kpiCardClassName} sm:hidden`;

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
  const kpiScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeKpiIndex, setActiveKpiIndex] = useState(0);
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

  // Mobile-only KPI carousel autoplay — no-ops on sm+ since the grid layout there never overflows
  // (children.length < 2 there in practice). Stops permanently once the visitor swipes manually,
  // so it never fights them. The real cards are followed by one clone of the first card (see
  // kpiCloneClassName above); scrolling onto that clone and then instantly (behavior: "auto")
  // resetting to the real first card the moment the smooth scroll lands is what makes the loop
  // read as continuous forward motion instead of a visible snap-back to card 1.
  useEffect(() => {
    const el = kpiScrollRef.current;
    if (!el) return;
    let paused = false;
    const pause = () => {
      paused = true;
    };
    el.addEventListener("pointerdown", pause);
    el.addEventListener("touchstart", pause, { passive: true });
    const interval = setInterval(() => {
      if (paused) return;
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length < 2) return;
      let currentIndex = 0;
      let smallestDiff = Infinity;
      children.forEach((child, i) => {
        const diff = Math.abs(child.offsetLeft - el.scrollLeft);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          currentIndex = i;
        }
      });
      const nextIndex = currentIndex + 1;
      if (nextIndex >= children.length) return;
      el.scrollTo({ left: children[nextIndex].offsetLeft, behavior: "smooth" });
      if (nextIndex === children.length - 1) {
        window.setTimeout(() => {
          if (!paused) el.scrollTo({ left: children[0].offsetLeft, behavior: "auto" });
        }, 500);
      }
    }, 3000);
    return () => {
      clearInterval(interval);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("touchstart", pause);
    };
  }, [youtubeStatus]);

  // Drives the pagination dots below the carousel — the clone (last child) maps back to dot 0
  // since it's a visual stand-in for the real first card.
  useEffect(() => {
    const el = kpiScrollRef.current;
    if (!el) return;
    const updateActiveIndex = () => {
      const children = Array.from(el.children) as HTMLElement[];
      const realCount = children.length - 1;
      if (realCount < 1) return;
      let nearest = 0;
      let smallestDiff = Infinity;
      children.forEach((child, i) => {
        const diff = Math.abs(child.offsetLeft - el.scrollLeft);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          nearest = i;
        }
      });
      setActiveKpiIndex(nearest % realCount);
    };
    updateActiveIndex();
    el.addEventListener("scroll", updateActiveIndex, { passive: true });
    return () => el.removeEventListener("scroll", updateActiveIndex);
  }, [youtubeStatus]);

  const trend = useMemo(() => {
    if (
      dashboardData?.analyticsStatus !== "available" ||
      dashboardData.revenueStatus !== "available"
    )
      return [];
    return buildRevenueTrend(dashboardData.analytics ?? [], range);
  }, [dashboardData, range]);
  // Zero-value axis shape shown in place of `trend` when analytics are unavailable/disabled — the
  // chart frame (axes, gridlines) still renders instead of collapsing to a bare text message, per
  // "show the chart at least even if there is no data". The empty-state message overlays on top.
  const trendFallback = useMemo(() => buildRevenueTrend([], range), [range]);
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
  // Joined client-side against the already-fetched recent-videos list for title/thumbnail/url —
  // the analytics "video" dimension only returns IDs. A top-revenue video outside the recent-sync
  // window (rare for a small channel) has no metadata to show, so it's dropped rather than shown
  // with a fabricated title.
  const topRevenueVideos = useMemo(() => {
    const byId = new Map(videos.map((video) => [video.id, video]));
    return (dashboardData?.topRevenueVideos ?? [])
      .map((row) => ({ ...row, video: byId.get(row.videoId) }))
      .filter((row): row is typeof row & { video: DashboardVideo } => Boolean(row.video));
  }, [dashboardData?.topRevenueVideos, videos]);
  const topRevenueVideosEmptyMessage =
    dashboardData?.topRevenueVideosStatus === "forbidden"
      ? "Reconnect YouTube to view top revenue videos."
      : dashboardData?.topRevenueVideosStatus === "disabled"
        ? "Analytics import is disabled in YouTube Integration settings."
        : "No video revenue was reported for this period.";
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
  // Revenue Split — YouTube's own reported revenue types for the latest month. "Other" is the
  // remainder against estimatedRevenue (Shorts fund, Super Chat/Thanks, etc.), not a fabricated
  // category — YouTube doesn't track off-platform sources like brand deals or affiliate links.
  const latestAdRevenue = analyticsRows.at(-1)?.estimatedAdRevenue ?? 0;
  const latestPremiumRevenue = analyticsRows.at(-1)?.estimatedRedPartnerRevenue ?? 0;
  const latestOtherRevenue = Math.max(0, latestRevenue - latestAdRevenue - latestPremiumRevenue);
  const revenueSplitRows = [
    { key: "ads", label: "Ad Revenue", value: latestAdRevenue, color: "var(--brand-blue)" },
    { key: "premium", label: "YouTube Premium", value: latestPremiumRevenue, color: "var(--brand-purple)" },
    { key: "other", label: "Other", value: latestOtherRevenue, color: "var(--brand-green)" },
  ].filter((row) => row.value > 0);
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

      <div
        ref={kpiScrollRef}
        className="flex shrink-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-1 pt-9 [scrollbar-width:none] sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:pb-0 sm:pt-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden"
        aria-busy={youtubeStatus === "loading"}
        aria-label={youtubeStatus === "loading" ? "Loading key metrics" : undefined}
      >
      {youtubeStatus === "loading" ? (
        Array.from({ length: 6 }).map((_, i) => <KpiTrendCardSkeleton key={i} className={kpiCardClassName} />)
      ) : (
        <>
        <KpiTrendCard
          className={kpiCardClassName}
          title="Estimated Revenue"
          accent="var(--brand-green)"
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
          className={kpiCardClassName}
          title="Latest Revenue"
          accent="var(--brand-blue)"
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
          className={kpiCardClassName}
          title="Total Views"
          accent="var(--brand-purple)"
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
          className={kpiCardClassName}
          title="Videos"
          accent="var(--brand-red)"
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
          className={kpiCardClassName}
          title="Subscribers"
          accent="var(--brand-amber)"
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
          className={kpiCardClassName}
          title="Watch Time"
          accent="var(--primary)"
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
        <div aria-hidden="true" className={kpiCloneClassName}>
          <KpiTrendCard
            title="Estimated Revenue"
            accent="var(--brand-green)"
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
        </div>
        </>
      )}
      </div>

      {youtubeStatus !== "loading" && (
        <div className="mt-3 flex items-center justify-center gap-1.5 sm:hidden" role="tablist" aria-label="KPI card pagination">
          {Array.from({ length: 6 }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={activeKpiIndex === i}
              aria-label={`Go to KPI card ${i + 1}`}
              onClick={() => {
                const el = kpiScrollRef.current;
                const child = el?.children[i] as HTMLElement | undefined;
                if (child) el?.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
              }}
              className={`h-1.5 rounded-full transition-all ${activeKpiIndex === i ? "w-6 bg-foreground" : "w-1.5 bg-foreground/25"}`}
            />
          ))}
        </div>
      )}

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
        <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex shrink-0 items-start justify-between">
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

          <div className="mt-4 flex shrink-0 items-center gap-5 text-xs">
            <Legend color="var(--color-brand-blue)" label="Estimated YouTube revenue" />
          </div>
          {dashboardData?.revenueStatus === "forbidden" && (
            <p className="mt-2 shrink-0 text-xs text-warning">{revenueEmptyContent}</p>
          )}

          <div className="relative mt-4 min-h-[300px] flex-1">
            {youtubeStatus === "loading" ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend.length ? trend : trendFallback}>
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
                    {trend.length > 0 && (
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
                    )}
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-brand-blue)"
                      strokeWidth={2.5}
                      fill="url(#gBrand)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
                {!trend.length && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <p className="rounded-lg bg-card/90 px-3 py-1.5 text-center text-sm text-muted-foreground shadow-sm">
                      {revenueEmptyContent}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Audience breakdown + Live Alerts */}
        <div className="flex h-full flex-col gap-5">
          {youtubeStatus === "loading" ? (
            <AudienceBreakdownCardSkeleton />
          ) : (
            <AudienceBreakdownCard
              subscriberCount={dashboardData?.channel.subscriberCount ?? 0}
              audience={dashboardData?.audience ?? { topCountries: [], ageGroups: [], genders: [] }}
              status={dashboardData?.audienceStatus ?? "unavailable"}
            />
          )}

          <div className="card-gradient-outline relative flex flex-1 flex-col p-5 backdrop-blur-xl">
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
      </div>

      {/* Top videos + Revenue split */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Top Revenue Videos</h3>
            <Link to="/videos" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {/* Mobile: stacked cards */}
          <div className="mt-4 space-y-2.5 sm:hidden" aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading top revenue videos" : undefined}>
            {youtubeStatus === "loading" &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card-frost flex items-start gap-3 p-3 backdrop-blur-lg">
                  <Skeleton className="h-14 w-24 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            {youtubeStatus !== "loading" && topRevenueVideos.slice(0, 5).map((row, index) => (
              <a
                key={row.videoId}
                href={row.video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card-frost flex items-start gap-3 p-3 backdrop-blur-lg"
              >
                <div className="relative shrink-0">
                  {row.video.thumbnail ? (
                    <img
                      src={row.video.thumbnail}
                      alt=""
                      className="h-14 w-24 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-24 items-center justify-center rounded-lg bg-accent">
                      <Play className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                    {index + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.video.title}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1" title="Views">
                      <Eye className="h-3.5 w-3.5" />
                      {formatCount(row.views)}
                    </span>
                    <span className="font-medium text-foreground">{formatMoney(row.revenue)}</span>
                    {row.changePercent !== null ? (
                      <span className={row.changePercent >= 0 ? "font-medium text-success" : "font-medium text-destructive"}>
                        {row.changePercent >= 0 ? "+" : ""}
                        {row.changePercent.toFixed(1)}%
                      </span>
                    ) : (
                      <span>New</span>
                    )}
                  </div>
                </div>
              </a>
            ))}
            {youtubeStatus !== "loading" && !topRevenueVideos.length && (
              <p className="py-6 text-sm text-muted-foreground">{topRevenueVideosEmptyMessage}</p>
            )}
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
              <tbody aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading top revenue videos" : undefined}>
                {youtubeStatus === "loading" &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-3" colSpan={4}>
                        <Skeleton className="h-4 w-full max-w-md" />
                      </td>
                    </tr>
                  ))}
                {youtubeStatus !== "loading" && topRevenueVideos.slice(0, 5).map((row, index) => (
                  <tr key={row.videoId} className="border-t border-border">
                    <td className="py-3">
                      <a
                        href={row.video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3"
                      >
                        <span className="text-muted-foreground">{index + 1}</span>
                        {row.video.thumbnail && (
                          <img
                            src={row.video.thumbnail}
                            alt=""
                            className="h-10 w-16 shrink-0 rounded object-cover"
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block max-w-[26rem] truncate font-medium">
                            {row.video.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(row.video.publishedAt)}
                          </span>
                        </span>
                      </a>
                    </td>
                    <td className="py-3 text-muted-foreground">{formatCount(row.views)}</td>
                    <td className="py-3 font-medium text-foreground">{formatMoney(row.revenue)}</td>
                    <td className="py-3 text-right">
                      {row.changePercent !== null ? (
                        <span className={row.changePercent >= 0 ? "font-medium text-success" : "font-medium text-destructive"}>
                          {row.changePercent >= 0 ? "+" : ""}
                          {row.changePercent.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">New</span>
                      )}
                    </td>
                  </tr>
                ))}
                {youtubeStatus !== "loading" && !topRevenueVideos.length && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      {topRevenueVideosEmptyMessage}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue Split */}
        <div className="card-gradient-outline relative p-5 backdrop-blur-xl">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">Revenue Split</h3>

          <div className="mt-4 space-y-3.5" aria-busy={youtubeStatus === "loading"} aria-label={youtubeStatus === "loading" ? "Loading revenue split" : undefined}>
            {youtubeStatus === "loading" ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-16" />
                  </div>
                  <Skeleton className="mt-1.5 h-1.5 w-full rounded-full" />
                </div>
              ))
            ) : dashboardData?.revenueStatus === "available" && revenueSplitRows.length ? (
              revenueSplitRows.map((row) => (
                <div key={row.key}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden="true" />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatMoney(row.value)}{" "}
                      <span className="text-xs">{latestRevenue > 0 ? Math.round((row.value / latestRevenue) * 100) : 0}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${latestRevenue > 0 ? Math.max((row.value / latestRevenue) * 100, 4) : 0}%`, backgroundColor: row.color }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                {dashboardData?.revenueStatus === "forbidden"
                  ? "Reconnect YouTube to view your revenue split."
                  : "No estimated revenue was reported for this period."}
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">This month total</p>
            {youtubeStatus === "loading" ? (
              <>
                <Skeleton className="mt-2 h-7 w-24" />
                <Skeleton className="mt-2 h-3 w-32" />
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold">
                  {dashboardData?.revenueStatus === "available" ? formatMoney(latestRevenue) : "—"}
                </p>
                {dashboardData?.revenueStatus === "available" && revenueChangePct !== null ? (
                  <p className={`mt-1 text-xs font-medium ${revenueChangePct >= 0 ? "text-success" : "text-destructive"}`}>
                    {revenueChangePct >= 0 ? "▲" : "▼"} {Math.abs(revenueChangePct).toFixed(1)}% vs last month
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Platform attribution is not included</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Weekly Engagement + Video Insights */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {youtubeStatus === "loading" ? (
            <EngagementHeatmapSkeleton />
          ) : (
            <EngagementHeatmap
              rows={dashboardData?.engagementHeatmap ?? []}
              status={dashboardData?.engagementHeatmapStatus ?? "unavailable"}
              onRefresh={refresh}
              refreshing={refreshing || youtubeRefreshing}
            />
          )}
        </div>
        {youtubeStatus === "loading" ? (
          <VideoInsightsCardSkeleton />
        ) : (
          <VideoInsightsCard
            latestVideo={videos[0] ?? null}
            videos={videos}
            videoInsights={dashboardData?.videoInsights ?? { subscribersGained: 0, devices: { desktop: 0, mobile: 0, tablet: 0 } }}
            status={dashboardData?.videoInsightsStatus ?? "unavailable"}
          />
        )}
      </div>

      {/* Channel banner — kept below the dashboard's analytics and revenue content. */}
      {youtubeStatus === "loading" ? (
        <div
          className="relative mb-5 min-h-[112px] shrink-0 overflow-hidden rounded-2xl border border-border bg-card p-5 sm:min-h-[128px] sm:p-6"
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
      <div className="nav-glow-motion hero-banner-bg relative mb-5 min-h-[112px] shrink-0 overflow-hidden rounded-2xl border border-white/15 p-5 shadow-xl shadow-black/10 backdrop-blur-xl sm:min-h-[128px] sm:p-6">
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
                      <span>subscribers</span>
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
              className={`flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-primary/30 sm:w-auto sm:px-4 ${!dashboardData?.channel.url ? "pointer-events-none opacity-50" : ""}`}
            >
              <span>Visit channel</span>
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

const AUDIENCE_TABS = [
  { key: "location", label: "Top Location" },
  { key: "age", label: "Age Range" },
  { key: "gender", label: "Gender" },
] as const;
type AudienceTab = (typeof AUDIENCE_TABS)[number]["key"];

const AUDIENCE_BAR_COLORS = ["#6366f1", "#38bdf8", "#a855f7", "#f97316", "#22c55e", "#ec4899"];

const countryDisplayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function formatCountry(code: string): string {
  if (!code) return "Unknown";
  try {
    return countryDisplayNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function formatAgeGroup(raw: string): string {
  const match = raw.match(/^age(\d+)-(\d+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  if (/^age\d+-$/.test(raw)) return `${raw.replace(/^age/, "").replace("-", "")}+`;
  return raw.replace(/^age/, "") || "Unknown";
}

function formatGender(raw: string): string {
  if (raw === "male") return "Male";
  if (raw === "female") return "Female";
  if (raw === "user_specified" || raw === "OTHER") return "Other";
  return raw || "Unknown";
}

const AUDIENCE_UNAVAILABLE_MESSAGE: Record<AnalyticsAvailability, string> = {
  available: "",
  disabled: "Analytics import is turned off in settings.",
  forbidden: "Reconnect YouTube to view your audience breakdown.",
  unavailable: "Audience data isn't available for this period yet.",
};

function AudienceBreakdownCard({
  subscriberCount,
  audience,
  status,
}: {
  subscriberCount: number;
  audience: DashboardData["audience"];
  status: AnalyticsAvailability;
}) {
  const [tab, setTab] = useState<AudienceTab>("location");

  const rows = useMemo(() => {
    if (tab === "location") {
      return audience.topCountries.map((row) => ({
        key: row.country,
        label: formatCountry(row.country),
        valueLabel: formatCount(row.views),
        weight: row.views,
      }));
    }
    if (tab === "age") {
      return [...audience.ageGroups]
        .sort((a, b) => b.viewerPercentage - a.viewerPercentage)
        .map((row) => ({
          key: row.ageGroup,
          label: formatAgeGroup(row.ageGroup),
          valueLabel: `${row.viewerPercentage.toFixed(1)}%`,
          weight: row.viewerPercentage,
        }));
    }
    return [...audience.genders]
      .sort((a, b) => b.viewerPercentage - a.viewerPercentage)
      .map((row) => ({
        key: row.gender,
        label: formatGender(row.gender),
        valueLabel: `${row.viewerPercentage.toFixed(1)}%`,
        weight: row.viewerPercentage,
      }));
  }, [tab, audience]);

  const maxWeight = Math.max(...rows.map((row) => row.weight), 1);
  const unavailableMessage = AUDIENCE_UNAVAILABLE_MESSAGE[status];
  const visibleRows = rows.slice(0, 5);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">Subscribers</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{formatCount(subscriberCount)}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-accent/40 px-2.5 py-1.5 text-xs font-medium">
          YouTube
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </span>
      </div>

      <div className="mt-4 flex shrink-0 gap-1 rounded-full bg-accent/40 p-1 text-xs">
        {AUDIENCE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`flex-1 rounded-full px-2 py-1.5 font-medium transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1 space-y-3.5">
        {unavailableMessage ? (
          <p className="py-4 text-sm text-muted-foreground">{unavailableMessage}</p>
        ) : rows.length ? (
          <>
            {visibleRows.map((row, i) => (
              <div key={row.key}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{row.label}</span>
                  <span className="shrink-0 text-muted-foreground">{row.valueLabel}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max((row.weight / maxWeight) * 100, 4)}%`,
                      backgroundColor: AUDIENCE_BAR_COLORS[i % AUDIENCE_BAR_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))}
            {hiddenCount > 0 && (
              <Link to="/audience" className="text-sm font-medium text-primary hover:underline">
                View {hiddenCount} more
              </Link>
            )}
          </>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">No data for this period yet.</p>
        )}
      </div>
    </div>
  );
}

function AudienceBreakdownCardSkeleton() {
  return (
    <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl" aria-hidden="true">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2 h-7 w-16" />
        </div>
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-9 w-full rounded-full" />
      <div className="mt-4 flex-1 space-y-3.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className="mt-1.5 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

const VIDEO_INSIGHTS_UNAVAILABLE_MESSAGE: Record<AnalyticsAvailability, string> = {
  available: "",
  disabled: "Video sync or analytics import is turned off in settings.",
  forbidden: "Reconnect YouTube to view video insights.",
  unavailable: "Video insights aren't available for your latest video yet.",
};

// Average across the already-fetched recent-videos list — a real computed baseline, not a
// fabricated number, so "vs avg" deltas below are honest even though there's no dedicated
// channel-average endpoint.
function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function VideoInsightsCard({
  latestVideo,
  videos,
  videoInsights,
  status,
}: {
  latestVideo: DashboardVideo | null;
  videos: DashboardVideo[];
  videoInsights: DashboardData["videoInsights"];
  status: AnalyticsAvailability;
}) {
  const unavailableMessage = !latestVideo
    ? VIDEO_INSIGHTS_UNAVAILABLE_MESSAGE.unavailable
    : VIDEO_INSIGHTS_UNAVAILABLE_MESSAGE[status];

  const thisViews = latestVideo?.views ?? 0;
  const thisEngagement = (latestVideo?.likes ?? 0) + (latestVideo?.comments ?? 0);
  const avgViews = average(videos.map((v) => v.views));
  const avgEngagement = average(videos.map((v) => (v.likes ?? 0) + (v.comments ?? 0)));
  const viewsDelta = avgViews > 0 ? ((thisViews - avgViews) / avgViews) * 100 : null;
  const engagementDelta = avgEngagement > 0 ? ((thisEngagement - avgEngagement) / avgEngagement) * 100 : null;

  const { desktop, mobile, tablet } = videoInsights.devices;
  const deviceTotal = desktop + mobile + tablet;
  const devices = [
    { key: "desktop", label: "Desktop", pct: deviceTotal ? (desktop / deviceTotal) * 100 : 0, color: "#f59e0b" },
    { key: "tablet", label: "Tablet", pct: deviceTotal ? (tablet / deviceTotal) * 100 : 0, color: "#3b82f6" },
    { key: "mobile", label: "Mobile", pct: deviceTotal ? (mobile / deviceTotal) * 100 : 0, color: "#8b5cf6" },
  ];

  return (
    <div className="card-gradient-outline relative p-5 backdrop-blur-xl">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex items-start gap-3">
        {latestVideo?.thumbnail ? (
          <img src={latestVideo.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-accent">
            <Play className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Video Insights</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {latestVideo?.title ?? "No recent video"}
          </p>
          {latestVideo?.publishedAt && (
            <p className="text-xs text-muted-foreground">Published {formatDate(latestVideo.publishedAt)}</p>
          )}
        </div>
      </div>

      {unavailableMessage ? (
        <p className="mt-4 border-t border-border py-6 text-center text-sm text-muted-foreground">
          {unavailableMessage}
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Views</p>
                <p className="mt-0.5 text-xl font-bold tracking-tight">{formatCount(thisViews)}</p>
              </div>
              <div className="text-right text-xs">
                <p className="text-muted-foreground">Avg {formatCount(Math.round(avgViews))}</p>
                {viewsDelta !== null && (
                  <p className={viewsDelta >= 0 ? "font-medium text-success" : "font-medium text-destructive"}>
                    {viewsDelta >= 0 ? "+" : ""}
                    {viewsDelta.toFixed(1)}% vs avg
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Engagement</p>
                <p className="mt-0.5 text-xl font-bold tracking-tight">{formatCount(thisEngagement)}</p>
              </div>
              <div className="text-right text-xs">
                <p className="text-muted-foreground">Avg {formatCount(Math.round(avgEngagement))}</p>
                {engagementDelta !== null && (
                  <p className={engagementDelta >= 0 ? "font-medium text-success" : "font-medium text-destructive"}>
                    {engagementDelta >= 0 ? "+" : ""}
                    {engagementDelta.toFixed(1)}% vs avg
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Subscribers gained</p>
                <p className="mt-0.5 text-xl font-bold tracking-tight">
                  {videoInsights.subscribersGained >= 0 ? "+" : ""}
                  {formatCount(videoInsights.subscribersGained)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">from this video</p>
            </div>
          </div>

          {deviceTotal > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
              {devices.map((device) => (
                <div key={device.key}>
                  <p className="text-xs text-muted-foreground">{device.label}</p>
                  <p className="mt-0.5 text-lg font-bold">{Math.round(device.pct)}%</p>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-accent">
                    <div className="h-full rounded-full" style={{ width: `${device.pct}%`, backgroundColor: device.color }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VideoInsightsCardSkeleton() {
  return (
    <div className="card-gradient-outline relative p-5 backdrop-blur-xl" aria-hidden="true">
      <div className="flex items-start gap-3">
        <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 space-y-4 border-t border-border pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-1.5 h-6 w-14" />
            </div>
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-1.5 h-5 w-10" />
            <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

const HEATMAP_LEVELS = [
  { key: "low", label: "Low", color: "color-mix(in srgb, var(--brand-purple) 18%, var(--accent))" },
  { key: "medium", label: "Medium", color: "color-mix(in srgb, var(--brand-purple) 42%, var(--accent))" },
  { key: "high", label: "High", color: "color-mix(in srgb, var(--brand-purple) 68%, var(--accent))" },
  { key: "best", label: "Best", color: "var(--brand-purple)" },
];

function levelIndexForValue(value: number, max: number): number {
  if (max <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.5) return 2;
  if (ratio >= 0.25) return 1;
  return 0;
}

function formatShortDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(dateStr));
}

const ENGAGEMENT_HEATMAP_UNAVAILABLE_MESSAGE: Record<AnalyticsAvailability, string> = {
  available: "",
  disabled: "Analytics import is turned off in settings.",
  forbidden: "Reconnect YouTube to view daily engagement.",
  unavailable: "Daily engagement data isn't available yet.",
};

function EngagementHeatmap({
  rows,
  status,
  onRefresh,
  refreshing,
}: {
  rows: Array<{ date: string; views: number }>;
  status: AnalyticsAvailability;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const weeks = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const chunks: Array<typeof sorted> = [];
    for (let i = 0; i < sorted.length; i += 7) chunks.push(sorted.slice(i, i + 7));
    return chunks;
  }, [rows]);
  const max = Math.max(...rows.map((r) => r.views), 1);
  const unavailableMessage = ENGAGEMENT_HEATMAP_UNAVAILABLE_MESSAGE[status];

  return (
    <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Weekly Engagement</h3>
        <div className="flex shrink-0 items-center gap-3">
          <Link to="/analytics" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
          <button
            type="button"
            onClick={onRefresh}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh engagement data"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {HEATMAP_LEVELS.map((level) => (
          <span key={level.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: level.color }} aria-hidden="true" />
            {level.label}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-1 flex-col justify-center">
        {unavailableMessage ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{unavailableMessage}</p>
        ) : weeks.length ? (
          <div className="space-y-1.5 overflow-x-auto pb-1">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex items-center gap-1.5">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  {formatShortDate(week[0]?.date)}
                </span>
                <div className="flex gap-1.5">
                  {week.map((day) => (
                    <div
                      key={day.date}
                      title={`${formatShortDate(day.date)}: ${formatCount(day.views)} views`}
                      className="h-6 w-6 shrink-0 rounded-md sm:h-7 sm:w-7"
                      style={{ background: HEATMAP_LEVELS[levelIndexForValue(day.views, max)].color }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No data for this period yet.</p>
        )}
      </div>
    </div>
  );
}

function EngagementHeatmapSkeleton() {
  return (
    <div className="card-gradient-outline relative flex h-full flex-col p-5 backdrop-blur-xl" aria-hidden="true">
      <div className="flex shrink-0 items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="mt-3 h-3 w-56 shrink-0" />
      <div className="mt-4 flex flex-1 flex-col justify-center space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Skeleton className="h-3 w-12 shrink-0" />
            <div className="flex gap-1.5">
              {Array.from({ length: 7 }).map((_, j) => (
                <Skeleton key={j} className="h-6 w-6 shrink-0 rounded-md sm:h-7 sm:w-7" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
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
