import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DollarSign, Eye, RefreshCw, TrendingUp, Youtube } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useLocalStore } from "@/lib/local-store";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { StatCardSkeleton, TableRowSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
});

type Range = "3M" | "6M" | "12M";
type Tab = "video" | "traffic";
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

  const videoRows = useMemo(() => result.data?.video.rows ?? [], [result.data]);
  const trafficRows = useMemo(() => result.data?.trafficSources.rows ?? [], [result.data]);
  const revenueAvailable = Boolean(
    result.data?.video.revenueAvailable || result.data?.trafficSources.revenueAvailable,
  );
  const totalViews = useMemo(
    () => videoRows.reduce((total, row) => total + numericValue(row.views), 0),
    [videoRows],
  );
  const totalRevenue = useMemo(
    () => videoRows.reduce((total, row) => total + numericValue(row.estimatedRevenue), 0),
    [videoRows],
  );
  const trafficChartData = useMemo(
    () =>
      trafficRows.slice(0, 10).map((row) => ({
        source: formatTrafficSource(row.insightTrafficSourceType),
        views: numericValue(row.views),
        revenue: numericValue(row.estimatedRevenue),
      })),
    [trafficRows],
  );

  return (
    <DashboardLayout title="Analytics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">YouTube Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Authenticated channel earnings and audience breakdowns
          </p>
        </div>
        <div className="flex rounded-lg bg-accent p-1 text-xs">
          {ranges.map((item) => (
            <button
              key={item}
              onClick={() => setRange(item)}
              className={`rounded-[var(--button-radius)] px-3 py-1.5 font-medium transition-colors ${
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

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy={result.loading} aria-label={result.loading ? "Loading analytics" : undefined}>
            {result.loading ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : (
              <>
                <StatCard
                  icon={<DollarSign className="h-5 w-5" />}
                  value={revenueAvailable ? `$${totalRevenue.toFixed(2)}` : "—"}
                  label="Estimated earnings"
                  change={revenueAvailable ? "YouTube reported" : "Revenue unavailable"}
                />
                <StatCard
                  icon={<Eye className="h-5 w-5" />}
                  value={formatCount(totalViews)}
                  label="Views in period"
                  change="YouTube Analytics"
                />
                <StatCard
                  icon={<TrendingUp className="h-5 w-5" />}
                  value={String(videoRows.length)}
                  label="Video rows"
                  change="Selected range"
                />
                {isRefreshing && (
                  <p className="col-span-full -mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Refreshing…
                  </p>
                )}
              </>
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
              <div className="flex rounded-lg bg-accent/60 p-1 text-sm">
                <button
                  onClick={() => setTab("video")}
                  className={`rounded-md px-4 py-2 font-medium transition-colors ${tab === "video" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Earnings by video
                </button>
                <button
                  onClick={() => setTab("traffic")}
                  className={`rounded-md px-4 py-2 font-medium transition-colors ${tab === "traffic" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Traffic sources
                </button>
              </div>
            </div>

            {tab === "video" ? (
              <div className="mt-5 overflow-x-auto" aria-busy={result.loading} aria-label={result.loading ? "Loading video earnings" : undefined}>
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
              <div className="mt-5" aria-busy={result.loading} aria-label={result.loading ? "Loading traffic sources" : undefined}>
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
