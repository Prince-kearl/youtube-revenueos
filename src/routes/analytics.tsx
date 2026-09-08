import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Line,
  LineChart,
} from "recharts";
import { RefreshCw, Youtube } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useLocalStore } from "@/lib/local-store";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { TableRowSkeleton, KpiTrendCardSkeleton } from "@/components/skeletons";
import { KpiTrendCard } from "@/components/KpiTrendCard";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
});

type AnalyticsAvailability = "available" | "unavailable" | "disabled" | "forbidden";
type TrendRow = {
  month?: string;
  views?: number;
  estimatedRevenue?: number;
  estimatedAdRevenue?: number;
  estimatedRedPartnerRevenue?: number;
  watchTimeMinutes?: number;
};
type CpmMonth = { month: string; cpm: number };
type TrendData = {
  analytics: TrendRow[];
  revenueStatus: AnalyticsAvailability;
  watchTimeStatus: AnalyticsAvailability;
  cpmByMonth: CpmMonth[];
  cpmStatus: AnalyticsAvailability;
};
type TrendResponse = { status?: string; data?: TrendData | null; error?: string };

// YouTube itself only ever distinguishes these two revenue types plus an unlabeled remainder
// (Shorts fund, Super Chat/Thanks, channel memberships, etc. are all folded into estimatedRevenue
// without their own line item in the public API) — "Other" is that remainder, computed here, not
// a stand-in for brand deals or affiliate income, which YouTube has no visibility into at all.
const REVENUE_SOURCE_COLORS = {
  ads: "var(--color-brand-blue)",
  premium: "var(--color-brand-purple)",
  other: "var(--color-brand-green)",
} as const;

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

function formatCpm(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRevenuePerView(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

function monthLabel(monthKey: string | undefined): string {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return "";
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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

type Range = "3M" | "6M" | "12M";
type Tab = "video" | "traffic";
type SourceTab = "revenue" | "cpm";
type BreakdownRow = Record<string, string | number | null>;

type BreakdownData = {
  range: Range;
  startDate: string;
  endDate: string;
  video: { rows: BreakdownRow[]; revenueAvailable: boolean };
  trafficSources: { rows: BreakdownRow[]; revenueAvailable: boolean };
};

type BreakdownResponse = {
  data?: BreakdownData | null;
  error?: string;
};

const ranges: Range[] = ["3M", "6M", "12M"];

function numericValue(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatRevenue(value: string | number | null | undefined, available: boolean): string {
  if (!available || value === null || value === undefined) return "Unavailable";
  return `$${numericValue(value).toFixed(2)}`;
}

function formatWatchTime(value: string | number | null | undefined): string {
  const minutes = numericValue(value);
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)} hrs` : `${Math.round(minutes)} min`;
}

function formatTrafficSource(value: string | number | null | undefined): string {
  return String(value ?? "UNSPECIFIED")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Analytics() {
  const [range, setRange] = useState<Range>("12M");
  const [tab, setTab] = useState<Tab>("video");
  const [sourceTab, setSourceTab] = useState<SourceTab>("revenue");
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    data: BreakdownData | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setIsRefreshing(true);
    setRefreshError(null);
    // A range/tab/channel change with data already on screen keeps that data visible (loading
    // stays false) instead of blanking back to the skeleton — matches the pattern already
    // established in videos.$videoId.tsx for the same "refresh preserves data" requirement.
    setResult((previous) => ({
      ...previous,
      loading: previous.data ? false : true,
      error: previous.data ? previous.error : null,
    }));

    const params = new URLSearchParams({ range });
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/youtube/breakdowns?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as BreakdownResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "YOUTUBE_BREAKDOWN_ERROR");
        }
        return payload.data;
      })
      .then((data) => setResult({ data, loading: false, error: null }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message =
          error instanceof Error && error.message === "YOUTUBE_REAUTH_REQUIRED"
            ? "YOUTUBE_REAUTH_REQUIRED"
            : "Unable to load YouTube breakdowns.";
        setResult((previous) => {
          if (previous.data) {
            setRefreshError(message);
            return { ...previous, loading: false, error: null };
          }
          return { data: null, loading: false, error: message };
        });
      })
      .finally(() => setIsRefreshing(false));

    return () => controller.abort();
  }, [range, activeChannelId, retryNonce]);

  // Backs the KpiTrendCards below, same as the Dashboard page — always a trailing 12-month window
  // (that's what /api/youtube/dashboard reports), independent of the 3M/6M/12M range control above,
  // which only affects the breakdown table. Fetched separately so a failure here doesn't block the
  // breakdown table from rendering.
  const [trend, setTrend] = useState<{
    data: TrendData | null;
    status: "loading" | "ready" | "error";
  }>({ data: null, status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setTrend((previous) => ({ data: previous.data, status: previous.data ? "ready" : "loading" }));
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    const query = params.toString();
    fetch(`/api/youtube/dashboard${query ? `?${query}` : ""}`, {
      cache: "default",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as TrendResponse;
        if (!response.ok || !body.data) throw new Error();
        setTrend({ data: body.data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTrend({ data: null, status: "error" });
      });
    return () => controller.abort();
  }, [activeChannelId, retryNonce]);

  const trendRows = useMemo(
    () =>
      (trend.data?.analytics ?? [])
        .filter((r) => r.month)
        .slice()
        .sort((a, b) => (a.month! > b.month! ? 1 : -1)),
    [trend.data],
  );
  const trendRevenueSeries = trendRows.map((r) => Number(r.estimatedRevenue ?? 0));
  const trendViewsSeries = trendRows.map((r) => Number(r.views ?? 0));
  const trendWatchSeries = trendRows.map((r) => Number(r.watchTimeMinutes ?? 0));
  const trendLatestMonthLabel = monthLabel(trendRows.at(-1)?.month);
  const trendPeriodLabel = trendRows.length ? `Past ${trendRows.length} months` : "";
  const trendRevenueChangePct = pctChange(trendRevenueSeries);
  const trendViewsChangePct = pctChange(trendViewsSeries);
  const trendWatchChangePct = pctChange(trendWatchSeries);
  const trendTotalRevenue = trendRevenueSeries.reduce((sum, v) => sum + v, 0);
  const trendTotalViews = trendViewsSeries.reduce((sum, v) => sum + v, 0);
  const trendTotalWatch = trendWatchSeries.reduce((sum, v) => sum + v, 0);

  // Revenue per view: a real ratio per month (not summed — a "sum of monthly rates" is
  // meaningless), same trailing-12-month window as the cards above.
  const trendRevenuePerViewSeries = trendRows.map((r) => {
    const views = Number(r.views ?? 0);
    return views > 0 ? Number(r.estimatedRevenue ?? 0) / views : 0;
  });
  const trendRevenuePerViewChangePct = pctChange(trendRevenuePerViewSeries);
  const trendAvgRevenuePerView = trendTotalViews > 0 ? trendTotalRevenue / trendTotalViews : 0;

  // cpm is already a monthly average from the server (see averageCpmByMonth in
  // api.youtube.dashboard.ts) — looked up by month key since cpmByMonth only contains months that
  // actually had ad-performance data, which can differ from the revenue/views months above.
  const cpmByMonthMap = new Map((trend.data?.cpmByMonth ?? []).map((row) => [row.month, row.cpm]));
  const trendCpmSeries = trendRows.map((r) => cpmByMonthMap.get(r.month ?? "") ?? 0);
  const trendCpmChangePct = pctChange(trendCpmSeries);
  const cpmValues = [...cpmByMonthMap.values()];
  const trendAvgCpm = cpmValues.length
    ? cpmValues.reduce((sum, v) => sum + v, 0) / cpmValues.length
    : 0;

  const videoRows = useMemo(() => result.data?.video.rows ?? [], [result.data]);
  const trafficRows = useMemo(() => result.data?.trafficSources.rows ?? [], [result.data]);
  const trafficChartData = useMemo(
    () =>
      trafficRows.slice(0, 10).map((row) => ({
        source: formatTrafficSource(row.insightTrafficSourceType),
        views: numericValue(row.views),
        revenue: numericValue(row.estimatedRevenue),
      })),
    [trafficRows],
  );

  // Monthly Ad Revenue / YouTube Premium / Other split for the trailing 12 months, same honest
  // 3-category breakdown as the Dashboard's Revenue Split card, just shown as a trend instead of a
  // single latest-month snapshot.
  const revenueSourceSeries = trendRows.map((row) => {
    const total = Number(row.estimatedRevenue ?? 0);
    const ads = Number(row.estimatedAdRevenue ?? 0);
    const premium = Number(row.estimatedRedPartnerRevenue ?? 0);
    return {
      month: monthLabel(row.month),
      ads,
      premium,
      other: Math.max(0, total - ads - premium),
    };
  });
  const revenueShareTotals = revenueSourceSeries.reduce(
    (acc, row) => ({
      ads: acc.ads + row.ads,
      premium: acc.premium + row.premium,
      other: acc.other + row.other,
    }),
    { ads: 0, premium: 0, other: 0 },
  );
  const revenueShareTotal =
    revenueShareTotals.ads + revenueShareTotals.premium + revenueShareTotals.other;
  const revenueShareData = [
    {
      key: "ads",
      label: "Ad Revenue",
      value: revenueShareTotals.ads,
      color: REVENUE_SOURCE_COLORS.ads,
    },
    {
      key: "premium",
      label: "YouTube Premium",
      value: revenueShareTotals.premium,
      color: REVENUE_SOURCE_COLORS.premium,
    },
    {
      key: "other",
      label: "Other",
      value: revenueShareTotals.other,
      color: REVENUE_SOURCE_COLORS.other,
    },
  ].filter((row) => row.value > 0);

  const cpmChartData = trendRows.map((row) => ({
    month: monthLabel(row.month),
    cpm: cpmByMonthMap.get(row.month ?? "") ?? null,
  }));
  const hasCpmData = cpmChartData.some((row) => row.cpm !== null);

  return (
    <DashboardLayout title="Analytics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">YouTube Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Authenticated channel earnings and audience breakdowns
          </p>
        </div>
        <div className="flex rounded-full bg-accent p-1 text-xs">
          {ranges.map((item) => (
            <button
              key={item}
              onClick={() => setRange(item)}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                item === range
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-amber/30 bg-brand-amber/5 px-4 py-3 text-xs">
        <span className="inline-flex h-2 w-2 rounded-full bg-brand-amber" />
        <span className="font-semibold text-brand-amber">YouTube Analytics</span>
        <span className="text-muted-foreground">
          Data is sourced from the signed-in channel. Revenue may lag and may be unavailable for
          channels without monetized revenue rows.
        </span>
      </div>

      {result.error === "YOUTUBE_REAUTH_REQUIRED" ? (
        <div className="mt-5">
          <YoutubeReauthNotice onRetry={() => setRetryNonce((value) => value + 1)} />
        </div>
      ) : result.error ? (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {result.error} Try refreshing the page or reconnecting YouTube.
        </div>
      ) : (
        <>
          {refreshError && (
            <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              We couldn&apos;t refresh this data just now. What&apos;s shown below is still your
              last successful load.
            </div>
          )}

          <div
            className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3"
            aria-busy={trend.status === "loading"}
            aria-label={trend.status === "loading" ? "Loading key metrics" : undefined}
          >
            {trend.status === "loading" ? (
              <>
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
                <KpiTrendCardSkeleton />
              </>
            ) : (
              <>
                <KpiTrendCard
                  title="Estimated Revenue"
                  accent="var(--brand-green)"
                  value={
                    trend.data?.revenueStatus === "available" ? formatMoney(trendTotalRevenue) : "—"
                  }
                  deltaLabel={
                    trendRevenueSeries.length
                      ? signed(trendRevenueSeries.at(-1) ?? 0, formatMoney)
                      : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={trendRevenueChangePct}
                  periodLabel={trendPeriodLabel}
                  series={trendRevenueSeries}
                  markerTitle={formatMoney(trendRevenueSeries.at(-1) ?? 0)}
                  markerSubtitle={trendLatestMonthLabel}
                  positive={(trendRevenueChangePct ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Views"
                  accent="var(--brand-purple)"
                  value={formatCount(trendTotalViews)}
                  deltaLabel={
                    trendViewsSeries.length
                      ? signed(trendViewsSeries.at(-1) ?? 0, formatCount)
                      : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={trendViewsChangePct}
                  periodLabel={trendPeriodLabel}
                  series={trendViewsSeries}
                  markerTitle={`${formatCount(trendViewsSeries.at(-1) ?? 0)} views`}
                  markerSubtitle={trendLatestMonthLabel}
                  positive={(trendViewsChangePct ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Watch Time"
                  accent="var(--primary)"
                  value={
                    trend.data?.watchTimeStatus === "available"
                      ? `${formatHours(trendTotalWatch)} hrs`
                      : "—"
                  }
                  deltaLabel={
                    trendWatchSeries.length
                      ? signed(trendWatchSeries.at(-1) ?? 0, (n) => `${formatHours(n)} hrs`)
                      : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={trendWatchChangePct}
                  periodLabel={trendPeriodLabel}
                  series={trendWatchSeries}
                  markerTitle={`${formatHours(trendWatchSeries.at(-1) ?? 0)} hrs`}
                  markerSubtitle={trendLatestMonthLabel}
                  positive={(trendWatchChangePct ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Revenue per View"
                  accent="var(--brand-amber)"
                  value={
                    trend.data?.revenueStatus === "available"
                      ? formatRevenuePerView(trendAvgRevenuePerView)
                      : "—"
                  }
                  deltaLabel={
                    trendRevenuePerViewSeries.length
                      ? signed(trendRevenuePerViewSeries.at(-1) ?? 0, formatRevenuePerView)
                      : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={trendRevenuePerViewChangePct}
                  periodLabel={trendPeriodLabel}
                  series={trendRevenuePerViewSeries}
                  markerTitle={formatRevenuePerView(trendRevenuePerViewSeries.at(-1) ?? 0)}
                  markerSubtitle={trendLatestMonthLabel}
                  positive={(trendRevenuePerViewChangePct ?? 0) >= 0}
                />
                <KpiTrendCard
                  title="Avg CPM"
                  accent="var(--brand-red)"
                  value={trend.data?.cpmStatus === "available" ? formatCpm(trendAvgCpm) : "—"}
                  deltaLabel={
                    trendCpmSeries.length ? signed(trendCpmSeries.at(-1) ?? 0, formatCpm) : "—"
                  }
                  deltaSuffix="this month"
                  changePercent={trendCpmChangePct}
                  periodLabel={trendPeriodLabel}
                  series={trendCpmSeries}
                  markerTitle={formatCpm(trendCpmSeries.at(-1) ?? 0)}
                  markerSubtitle={trendLatestMonthLabel}
                  positive={(trendCpmChangePct ?? 0) >= 0}
                />
              </>
            )}
            {isRefreshing && (
              <p className="col-span-full -mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> Refreshing…
              </p>
            )}
          </div>

          <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {sourceTab === "revenue" ? "Revenue by Source" : "CPM Trend"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {trendPeriodLabel || "Trailing months"}
                  {sourceTab === "revenue" ? " · YouTube-reported revenue types only" : ""}
                </p>
              </div>
              <div className="flex rounded-full bg-accent/60 p-1 text-sm">
                <button
                  onClick={() => setSourceTab("revenue")}
                  className={`rounded-full px-4 py-2 font-medium transition-colors ${sourceTab === "revenue" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Revenue Sources
                </button>
                <button
                  onClick={() => setSourceTab("cpm")}
                  className={`rounded-full px-4 py-2 font-medium transition-colors ${sourceTab === "cpm" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  CPM Trend
                </button>
              </div>
            </div>
            {sourceTab === "cpm" ? (
              !hasCpmData ? (
                <p className="mt-4 py-6 text-center text-sm text-muted-foreground">
                  No monthly CPM data available yet.
                </p>
              ) : (
                <>
                  <div className="mt-4 h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={cpmChartData}>
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
                          tickFormatter={(v) => `$${v}`}
                          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value: number) => [formatCpm(value), "Avg CPM"]}
                          contentStyle={{
                            background: "var(--color-popover)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 12,
                            fontSize: 12,
                          }}
                        />
                        <Line
                          dataKey="cpm"
                          name="Avg CPM"
                          stroke="var(--color-brand-red)"
                          strokeWidth={2.5}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-4 text-[11px] text-muted-foreground">
                    Each point is the channel-wide average of YouTube's daily reported CPM for that
                    month — not a guaranteed rate, and it can vary a lot by video, audience, and ad
                    inventory.
                  </p>
                </>
              )
            ) : revenueSourceSeries.length === 0 ? (
              <p className="mt-4 py-6 text-center text-sm text-muted-foreground">
                No monthly revenue data available yet.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
                <div className="h-[280px] lg:col-span-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueSourceSeries}>
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
                        tickFormatter={(v) => `$${v}`}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name]}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="ads"
                        name="Ad Revenue"
                        stackId="rev"
                        fill={REVENUE_SOURCE_COLORS.ads}
                      />
                      <Bar
                        dataKey="premium"
                        name="YouTube Premium"
                        stackId="rev"
                        fill={REVENUE_SOURCE_COLORS.premium}
                      />
                      <Bar
                        dataKey="other"
                        name="Other"
                        stackId="rev"
                        fill={REVENUE_SOURCE_COLORS.other}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div className="h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={revenueShareData}
                          dataKey="value"
                          innerRadius={45}
                          outerRadius={70}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {revenueShareData.map((row) => (
                            <Cell key={row.key} fill={row.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    {revenueShareData.map((row) => (
                      <div key={row.key} className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: row.color }}
                          />
                          {row.label}
                        </span>
                        <span className="font-semibold">
                          {revenueShareTotal
                            ? `${((row.value / revenueShareTotal) * 100).toFixed(0)}%`
                            : "0%"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {sourceTab === "revenue" && (
              <p className="mt-4 text-[11px] text-muted-foreground">
                YouTube only reports Ad Revenue and YouTube Premium as distinct categories — "Other"
                covers everything else it doesn't break out separately (Shorts fund, Super
                Chat/Thanks, channel memberships). Brand deals and affiliate income aren't shown
                here because YouTube has no visibility into off-platform revenue.
              </p>
            )}
          </div>

          <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Channel breakdown</h2>
                <p className="text-sm text-muted-foreground">
                  {result.data
                    ? `${result.data.startDate} through ${result.data.endDate}`
                    : "Loading authenticated data"}
                </p>
              </div>
              <div className="flex rounded-full bg-accent/60 p-1 text-sm">
                <button
                  onClick={() => setTab("video")}
                  className={`rounded-full px-4 py-2 font-medium transition-colors ${tab === "video" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Earnings by video
                </button>
                <button
                  onClick={() => setTab("traffic")}
                  className={`rounded-full px-4 py-2 font-medium transition-colors ${tab === "traffic" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Traffic sources
                </button>
              </div>
            </div>

            {tab === "video" ? (
              <div
                className="mt-5 overflow-x-auto"
                aria-busy={result.loading}
                aria-label={result.loading ? "Loading video earnings" : undefined}
              >
                {result.loading ? (
                  <div className="rounded-xl border border-border">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <TableRowSkeleton key={i} columns={4} />
                    ))}
                  </div>
                ) : videoRows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No video activity was returned for this period.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-3 font-medium">Video</th>
                        <th className="px-3 py-3 font-medium">Views</th>
                        <th className="px-3 py-3 font-medium">Watch time</th>
                        <th className="px-3 py-3 font-medium">Estimated earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {videoRows.map((row, index) => (
                        <tr
                          key={`${String(row.video ?? "video")}-${index}`}
                          className="border-b border-border last:border-0"
                        >
                          <td className="max-w-[360px] px-3 py-4">
                            <div className="flex items-center gap-3">
                              {row.thumbnail ? (
                                <img
                                  src={String(row.thumbnail)}
                                  alt=""
                                  className="h-12 w-20 rounded-md object-cover"
                                />
                              ) : (
                                <div className="flex h-12 w-20 items-center justify-center rounded-md bg-accent">
                                  <Youtube className="h-4 w-4" />
                                </div>
                              )}
                              <div className="min-w-0">
                                {row.url ? (
                                  <a
                                    href={String(row.url)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block truncate font-medium hover:text-primary"
                                  >
                                    {String(row.title ?? row.video ?? "Unknown video")}
                                  </a>
                                ) : (
                                  <span className="block truncate font-medium">
                                    {String(row.title ?? row.video ?? "Unknown video")}
                                  </span>
                                )}
                                {row.publishedAt && (
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(String(row.publishedAt)).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4 font-semibold">
                            {formatCount(numericValue(row.views))}
                          </td>
                          <td className="px-3 py-4 text-muted-foreground">
                            {formatWatchTime(row.estimatedMinutesWatched)}
                          </td>
                          <td className="px-3 py-4 font-semibold">
                            {formatRevenue(
                              row.estimatedRevenue,
                              result.data?.video.revenueAvailable ?? false,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!result.loading &&
                  !result.data?.video.revenueAvailable &&
                  videoRows.length > 0 && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      YouTube returned video activity but no estimated revenue rows for this period.
                      Earnings remain unavailable without inventing values.
                    </p>
                  )}
              </div>
            ) : (
              <div
                className="mt-5"
                aria-busy={result.loading}
                aria-label={result.loading ? "Loading traffic sources" : undefined}
              >
                {result.loading ? (
                  <div className="rounded-xl border border-border">
                    {[1, 2, 3, 4].map((i) => (
                      <TableRowSkeleton key={i} columns={3} />
                    ))}
                  </div>
                ) : trafficRows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No traffic-source activity was returned for this period.
                  </p>
                ) : (
                  <>
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={trafficChartData}
                          layout="vertical"
                          margin={{ left: 24, right: 20 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--color-border)"
                            horizontal={false}
                          />
                          <XAxis
                            type="number"
                            tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="source"
                            width={120}
                            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
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
                          <Bar
                            dataKey="views"
                            fill="var(--color-brand-blue)"
                            radius={[0, 5, 5, 0]}
                            name="Views"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {trafficRows.map((row, index) => (
                        <div
                          key={`${String(row.insightTrafficSourceType ?? "source")}-${index}`}
                          className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm"
                        >
                          <span className="font-medium">
                            {formatTrafficSource(row.insightTrafficSourceType)}
                          </span>
                          <span className="text-right">
                            <span className="block font-semibold">
                              {formatCount(numericValue(row.views))} views
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {formatRevenue(
                                row.estimatedRevenue,
                                result.data?.trafficSources.revenueAvailable ?? false,
                              )}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {!result.data?.trafficSources.revenueAvailable && (
                      <p className="mt-4 text-xs text-muted-foreground">
                        Traffic-source activity is available, but YouTube returned no estimated
                        revenue rows for this period.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5" />
        Changing 3M, 6M, or 12M requests the selected period from YouTube Analytics; it does not
        slice static mock data.
      </div>
    </DashboardLayout>
  );
}
