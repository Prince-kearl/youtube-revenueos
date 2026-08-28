import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Clock3,
  DollarSign,
  Eye,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Share2,
  ThumbsUp,
  TrendingUp,
  Users,
  Youtube,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";

export const Route = createFileRoute("/videos/$videoId")({
  component: VideoDetail,
});

type Range = "3M" | "6M" | "12M";
type Video = {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  privacyStatus: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  url: string;
};
type Summary = {
  available: boolean;
  views: number | null;
  watchTimeMinutes: number | null;
  averageViewDurationSeconds: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  estimatedRevenue: number | null;
  cpm: number | null;
  playbackBasedCpm: number | null;
  revenueAvailable: boolean;
};
type TimelineRow = {
  date: string;
  views: number | null;
  watchTimeMinutes: number | null;
  averageViewDurationSeconds: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  estimatedRevenue: number | null;
};
type TrafficRow = {
  source: string;
  views: number | null;
  watchTimeMinutes: number | null;
  estimatedRevenue: number | null;
};
type DemographicRow = {
  ageGroup: string;
  gender: string;
  viewerPercentage: number | null;
};
type RetentionRow = {
  elapsedVideoTimeRatio: number | null;
  audienceWatchRatio: number | null;
  relativeRetentionPerformance: number | null;
};
type DetailData = {
  range: Range;
  startDate: string;
  endDate: string;
  channel: { id: string; title: string | null; handle: string | null };
  video: Video;
  summary: Summary;
  timeline: { available: boolean; rows: TimelineRow[]; revenueAvailable: boolean };
  trafficSources: { available: boolean; rows: TrafficRow[]; revenueAvailable: boolean };
  demographics: { available: boolean; rows: DemographicRow[] };
  retention: { available: boolean; rows: RetentionRow[] };
};
type DetailResponse = { data?: DetailData; error?: string };

const ranges: Range[] = ["3M", "6M", "12M"];

function numericValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  return value >= 60 ? `${(value / 60).toFixed(1)} hrs` : `${Math.round(value)} min`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCurrency(value: number | null | undefined, available: boolean): string {
  if (!available || value === null || value === undefined) return "Unavailable";
  return `$${value.toFixed(2)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        date,
      );
}

function formatSource(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function friendlyError(code: string): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "This video link or date range is not valid.",
    CHANNEL_NOT_FOUND:
      "We couldn’t find the selected YouTube channel. Choose another channel and try again.",
    YOUTUBE_VIDEO_NOT_FOUND: "We couldn’t find that video. Check that the link is correct.",
    YOUTUBE_VIDEO_CHANNEL_MISMATCH:
      "That video belongs to a different YouTube channel. Switch channels and try again.",
    YOUTUBE_ANALYTICS_ERROR:
      "We couldn’t load the analytics for this video. Please try again in a moment.",
    SERVER_ERROR: "Something went wrong. Please try again in a moment.",
  };
  return messages[code] ?? "We couldn’t load this video’s analytics. Please try again in a moment.";
}

function VideoDetail() {
  const { videoId } = Route.useParams();
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [range, setRange] = useState<Range>("12M");
  const [retryNonce, setRetryNonce] = useState(0);
  const [result, setResult] = useState<{
    data: DetailData | null;
    status: "loading" | "connected" | "reauth" | "error";
    error: string | null;
  }>({ data: null, status: "loading", error: null });

  useEffect(() => {
    const controller = new AbortController();
    setResult((previous) => ({ ...previous, status: "loading", error: null }));
    const params = new URLSearchParams({ videoId, range });
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/youtube/video?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as DetailResponse;
        if (response.status === 401 && body.error === "YOUTUBE_REAUTH_REQUIRED") {
          throw new Error("YOUTUBE_REAUTH_REQUIRED");
        }
        if (!response.ok || !body.data) throw new Error(body.error ?? "SERVER_ERROR");
        return body.data;
      })
      .then((data) => setResult({ data, status: "connected", error: null }))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        const code = reason instanceof Error ? reason.message : "SERVER_ERROR";
        setResult({
          data: null,
          status: code === "YOUTUBE_REAUTH_REQUIRED" ? "reauth" : "error",
          error: code,
        });
      });
    return () => controller.abort();
  }, [activeChannelId, range, retryNonce, videoId]);

  const timelineChart = useMemo(
    () =>
      (result.data?.timeline.rows ?? []).map((row) => ({
        date: row.date.slice(5),
        views: numericValue(row.views) ?? 0,
        watchTime: numericValue(row.watchTimeMinutes) ?? 0,
      })),
    [result.data?.timeline.rows],
  );

  const demographicChart = useMemo(
    () =>
      (result.data?.demographics.rows ?? []).map((row) => ({
        label: `${row.ageGroup} · ${row.gender}`,
        percentage: numericValue(row.viewerPercentage) ?? 0,
      })),
    [result.data?.demographics.rows],
  );
  const retentionChart = useMemo(
    () =>
      (result.data?.retention.rows ?? []).map((row) => ({
        position: Math.round((numericValue(row.elapsedVideoTimeRatio) ?? 0) * 100),
        audience: Math.round((numericValue(row.audienceWatchRatio) ?? 0) * 100),
        relative:
          numericValue(row.relativeRetentionPerformance) === null
            ? null
            : Math.round((numericValue(row.relativeRetentionPerformance) ?? 0) * 100),
      })),
    [result.data?.retention.rows],
  );

  const data = result.data;
  return (
    <DashboardLayout title="Video analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/videos"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Videos
        </Link>
        <div className="flex rounded-lg bg-accent p-1 text-xs">
          {ranges.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setRange(item)}
              className={`rounded-[var(--button-radius)] px-3 py-1.5 font-medium transition-colors ${item === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {result.status === "loading" && <DetailLoading />}
      {result.status === "reauth" && (
        <div className="mt-6">
          <YoutubeReauthNotice onRetry={() => setRetryNonce((value) => value + 1)} />
        </div>
      )}
      {result.status === "error" && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <p className="font-semibold">We couldn’t load this video’s analytics</p>
          <p className="mt-1">{friendlyError(result.error ?? "SERVER_ERROR")}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((value) => value + 1)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--button-radius)] border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {data && result.status === "connected" && (
        <>
          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center">
            {data.video.thumbnail ? (
              <img
                src={data.video.thumbnail}
                alt=""
                className="aspect-video w-full rounded-lg object-cover sm:h-28 sm:w-48"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-accent sm:h-28 sm:w-48">
                <Youtube className="h-7 w-7" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight">{data.video.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(data.video.publishedAt)} ·{" "}
                {data.video.duration ?? "Duration unavailable"} ·{" "}
                {data.video.privacyStatus ?? "Status unavailable"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.channel.title ?? "Connected channel"}
                {data.channel.handle ? ` · ${data.channel.handle}` : ""}
              </p>
            </div>
            <a
              href={data.video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Open on YouTube <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Eye className="h-5 w-5" />}
              value={formatCount(data.summary.views)}
              label="Views in period"
              change={`${data.startDate} to ${data.endDate}`}
            />
            <StatCard
              icon={<Clock3 className="h-5 w-5" />}
              value={formatMinutes(data.summary.watchTimeMinutes)}
              label="Watch time"
              change="YouTube Analytics"
            />
            <StatCard
              icon={<TrendingUp className="h-5 w-5" />}
              value={formatDuration(data.summary.averageViewDurationSeconds)}
              label="Average view duration"
              change="Per playback"
            />
            <StatCard
              icon={<DollarSign className="h-5 w-5" />}
              value={formatCurrency(data.summary.estimatedRevenue, data.summary.revenueAvailable)}
              label="Estimated revenue"
              change={
                data.summary.revenueAvailable ? "YouTube reported" : "Unavailable for this period"
              }
            />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              icon={<ThumbsUp className="h-4 w-4" />}
              label="Likes"
              value={formatCount(data.summary.likes ?? data.video.likes)}
            />
            <MetricCard
              icon={<MessageCircle className="h-4 w-4" />}
              label="Comments"
              value={formatCount(data.summary.comments ?? data.video.comments)}
            />
            <MetricCard
              icon={<Share2 className="h-4 w-4" />}
              label="Shares"
              value={formatCount(data.summary.shares)}
            />
            <MetricCard
              icon={<Users className="h-4 w-4" />}
              label="Subscribers gained"
              value={formatCount(data.summary.subscribersGained)}
            />
          </div>

          <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <BarChart3 className="h-5 w-5 text-brand-blue" /> Performance over time
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Daily activity reported by YouTube for the selected period.
                </p>
              </div>
              {!data.timeline.available && (
                <span className="text-xs text-muted-foreground">No daily data available</span>
              )}
            </div>
            {data.timeline.available ? (
              <div className="mt-5 h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineChart} margin={{ left: 0, right: 12, top: 10 }}>
                    <defs>
                      <linearGradient id="videoViewsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-brand-blue)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--color-brand-blue)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={formatCount}
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
                      dataKey="views"
                      stroke="var(--color-brand-blue)"
                      fill="url(#videoViewsGradient)"
                      strokeWidth={2}
                      name="Views"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <UnavailablePanel text="YouTube has not returned daily activity for this video and period." />
            )}
          </div>

          <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div>
              <h2 className="text-lg font-semibold">Traffic sources</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Where viewers found this video during the selected period.
              </p>
            </div>
            {data.trafficSources.available ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {data.trafficSources.rows.map((row) => (
                  <div
                    key={row.source}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm"
                  >
                    <span className="font-medium">{formatSource(row.source)}</span>
                    <span className="text-right">
                      <span className="block font-semibold">{formatCount(row.views)} views</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatMinutes(row.watchTimeMinutes)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <UnavailablePanel text="Traffic-source data is not available for this video and period." />
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div>
                <h2 className="text-lg font-semibold">Audience demographics</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Viewer age and gender distribution reported by YouTube.
                </p>
              </div>
              {data.demographics.available ? (
                <div className="mt-4 h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={demographicChart}
                      layout="vertical"
                      margin={{ left: 12, right: 20, top: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={132}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value) => [`${Number(value).toFixed(1)}%`, "Viewers"]}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="percentage"
                        fill="var(--color-brand-purple)"
                        radius={[0, 5, 5, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <UnavailablePanel text="Audience demographics are not available for this video and period." />
              )}
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div>
                <h2 className="text-lg font-semibold">Audience retention</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  How much of the video viewers watched at each point.
                </p>
              </div>
              {data.retention.available ? (
                <div className="mt-4 h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={retentionChart} margin={{ left: 0, right: 12, top: 12 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="position"
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          value === null ? "Unavailable" : `${Number(value).toFixed(1)}%`,
                          name === "audience" ? "Viewers still watching" : "Relative performance",
                        ]}
                        labelFormatter={(value) => `${value}% of video`}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "audience" ? "Viewers still watching" : "Relative performance"
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="audience"
                        stroke="var(--color-brand-blue)"
                        strokeWidth={2}
                        dot={false}
                        name="audience"
                      />
                      <Line
                        type="monotone"
                        dataKey="relative"
                        stroke="var(--color-brand-purple)"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        name="relative"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <UnavailablePanel text="Audience-retention data is not available for this video and period." />
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Analytics are fetched from the selected authenticated YouTube channel for each date
            range.
          </div>
        </>
      )}
    </DashboardLayout>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function UnavailablePanel({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function DetailLoading() {
  return (
    <div className="mt-6 space-y-4" aria-busy="true" aria-label="Loading video analytics">
      <div className="h-32 animate-pulse rounded-xl bg-accent/50" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-xl bg-accent/50" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-accent/50" />
    </div>
  );
}
