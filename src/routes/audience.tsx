import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { KpiTrendCardSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/audience")({
  component: Audience,
});

type Range = "3M" | "6M" | "12M";
const ranges: Range[] = ["3M", "6M", "12M"];

type Availability = "available" | "unavailable" | "disabled" | "forbidden";
type CountryRow = { country: string; views: number };
type AgeRow = { ageGroup: string; viewerPercentage: number };
type GenderRow = { gender: string; viewerPercentage: number };
type AudienceData = {
  range: Range;
  availability: Availability;
  topCountries: CountryRow[];
  ageGroups: AgeRow[];
  genders: GenderRow[];
  previous: {
    topCountries: CountryRow[];
    ageGroups: AgeRow[];
    genders: GenderRow[];
    available: boolean;
  };
};
type AudienceResponse =
  | { status: "not_connected"; data: null }
  | { status: "connected"; data: AudienceData }
  | { error: string };

// Relative % change, not a raw percentage-point difference — matches the convention every other
// KpiTrendCard on Dashboard/Analytics uses for its badge, even though the underlying metrics here
// (viewerPercentage, view share) are themselves already percentages.
function changePct(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function formatPoints(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp`;
}

const AGE_ORDER = [
  "age13-17",
  "age18-24",
  "age25-34",
  "age35-44",
  "age45-54",
  "age55-64",
  "age65-",
];

function formatAgeGroup(code: string): string {
  const match = code.match(/^age(\d+)-?(\d+)?/);
  if (!match) return code;
  return match[2] ? `${match[1]}–${match[2]}` : `${match[1]}+`;
}

function formatGender(code: string): string {
  if (code === "male") return "Male";
  if (code === "female") return "Female";
  if (code === "user_specified") return "Self-described";
  return code ? code.charAt(0).toUpperCase() + code.slice(1) : "Unknown";
}

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

const GENDER_COLORS: Record<string, string> = {
  male: "var(--color-brand-blue)",
  female: "var(--color-brand-purple)",
  user_specified: "var(--color-brand-amber)",
};

function LoadingState() {
  return (
    <div className="mt-6 space-y-5" aria-label="Loading audience data" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <KpiTrendCardSkeleton key={i} />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function MessageState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: string;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action && (
        <Link
          to="/settings"
          className="rounded-full bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {action}
        </Link>
      )}
    </div>
  );
}

function Audience() {
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [range, setRange] = useState<Range>("12M");
  const [status, setStatus] = useState<"loading" | "ready" | "not_connected" | "reauth" | "error">(
    "loading",
  );
  const [data, setData] = useState<AudienceData | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    const params = new URLSearchParams({ range });
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/youtube/audience?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as AudienceResponse;
        if (response.status === 401) {
          setStatus("reauth");
          return;
        }
        if ("status" in body && body.status === "not_connected") {
          setStatus("not_connected");
          return;
        }
        if (!response.ok || !("data" in body) || !body.data) throw new Error();
        setData(body.data);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [activeChannelId, range, retryNonce]);

  const sortedAgeGroups = useMemo(
    () =>
      [...(data?.ageGroups ?? [])].sort(
        (a, b) => AGE_ORDER.indexOf(a.ageGroup) - AGE_ORDER.indexOf(b.ageGroup),
      ),
    [data],
  );
  const sortedGenders = useMemo(
    () => [...(data?.genders ?? [])].sort((a, b) => b.viewerPercentage - a.viewerPercentage),
    [data],
  );
  const sortedCountries = useMemo(
    () => [...(data?.topCountries ?? [])].sort((a, b) => b.views - a.views),
    [data],
  );
  const totalCountryViews = sortedCountries.reduce((sum, c) => sum + c.views, 0);

  const topAgeGroup = [...sortedAgeGroups].sort(
    (a, b) => b.viewerPercentage - a.viewerPercentage,
  )[0];
  const topGender = sortedGenders[0];
  const topCountry = sortedCountries[0];

  // Prior-period comparisons for the KPI cards below — tracking the SAME category across both
  // periods (not "this period's top vs whatever was top last period"), since a raw ranking swap
  // isn't a meaningful trend. Top Country compares view SHARE, not raw views, since total views
  // legitimately differ between the two periods.
  const prevAgeGroups = data?.previous.ageGroups ?? [];
  const prevGenders = data?.previous.genders ?? [];
  const prevCountries = data?.previous.topCountries ?? [];
  const prevTotalCountryViews = prevCountries.reduce((sum, c) => sum + c.views, 0);

  const prevTopAgeValue = topAgeGroup
    ? (prevAgeGroups.find((a) => a.ageGroup === topAgeGroup.ageGroup)?.viewerPercentage ?? 0)
    : 0;
  const ageChangePct = topAgeGroup
    ? changePct(topAgeGroup.viewerPercentage, prevTopAgeValue)
    : null;

  const prevTopGenderValue = topGender
    ? (prevGenders.find((g) => g.gender === topGender.gender)?.viewerPercentage ?? 0)
    : 0;
  const genderChangePct = topGender
    ? changePct(topGender.viewerPercentage, prevTopGenderValue)
    : null;

  const currentCountryShare =
    topCountry && totalCountryViews ? (topCountry.views / totalCountryViews) * 100 : 0;
  const prevTopCountryViews = topCountry
    ? (prevCountries.find((c) => c.country === topCountry.country)?.views ?? 0)
    : 0;
  const prevCountryShare =
    topCountry && prevTotalCountryViews ? (prevTopCountryViews / prevTotalCountryViews) * 100 : 0;
  const countryChangePct = topCountry ? changePct(currentCountryShare, prevCountryShare) : null;

  const countriesChangePct = changePct(sortedCountries.length, prevCountries.length);

  return (
    <DashboardLayout title="Audience">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audience Demographics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real age, gender, and location breakdown of your viewers, from YouTube Analytics.
          </p>
        </div>
        {status === "ready" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <div className="flex rounded-full bg-accent p-1 text-xs">
              {ranges.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRange(item)}
                  className={`rounded-full px-3 py-1.5 font-medium transition-colors ${item === range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {status === "loading" && <LoadingState />}

      {status === "not_connected" && (
        <MessageState
          title="Connect your YouTube channel"
          description="Audience demographics come from your channel's real YouTube Analytics data."
          action="Go to Settings"
        />
      )}

      {status === "reauth" && (
        <div className="mt-6">
          <YoutubeReauthNotice onRetry={() => setRetryNonce((n) => n + 1)} />
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t load your audience data.</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && data?.availability === "disabled" && (
        <MessageState
          title="Analytics import is turned off"
          description="Turn on analytics import in Settings to see audience demographics for your channel."
          action="Go to Settings"
        />
      )}

      {status === "ready" && data?.availability === "forbidden" && (
        <MessageState
          title="Analytics access needs to be renewed"
          description="Reconnect your YouTube channel to restore access to analytics data."
          action="Go to Settings"
        />
      )}

      {status === "ready" && data?.availability === "unavailable" && (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No audience data available for this period yet. YouTube withholds demographic data until a
          channel has enough views, or it may need more time to process.
        </div>
      )}

      {status === "ready" && data && data.availability === "available" && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTrendCard
              title="Top Age Group"
              accent="var(--brand-blue)"
              value={topAgeGroup ? formatAgeGroup(topAgeGroup.ageGroup) : "—"}
              deltaLabel={
                ageChangePct !== null
                  ? formatPoints(topAgeGroup.viewerPercentage - prevTopAgeValue)
                  : "—"
              }
              deltaSuffix="vs prior period"
              changePercent={ageChangePct}
              periodLabel="vs prior period"
              series={
                data?.previous.available
                  ? [prevTopAgeValue, topAgeGroup?.viewerPercentage ?? 0]
                  : []
              }
              markerTitle={topAgeGroup ? `${topAgeGroup.viewerPercentage.toFixed(1)}%` : "—"}
              markerSubtitle="of viewers"
              positive={(ageChangePct ?? 0) >= 0}
            />
            <KpiTrendCard
              title="Gender Split"
              accent="var(--brand-purple)"
              value={
                topGender
                  ? `${topGender.viewerPercentage.toFixed(0)}% ${formatGender(topGender.gender)}`
                  : "—"
              }
              deltaLabel={
                genderChangePct !== null
                  ? formatPoints(topGender.viewerPercentage - prevTopGenderValue)
                  : "—"
              }
              deltaSuffix="vs prior period"
              changePercent={genderChangePct}
              periodLabel="vs prior period"
              series={
                data?.previous.available
                  ? [prevTopGenderValue, topGender?.viewerPercentage ?? 0]
                  : []
              }
              markerTitle={topGender ? `${topGender.viewerPercentage.toFixed(1)}%` : "—"}
              markerSubtitle={topGender ? formatGender(topGender.gender) : ""}
              positive={(genderChangePct ?? 0) >= 0}
            />
            <KpiTrendCard
              title="Top Country"
              accent="var(--brand-green)"
              value={topCountry ? formatCountry(topCountry.country) : "—"}
              deltaLabel={
                countryChangePct !== null
                  ? formatPoints(currentCountryShare - prevCountryShare)
                  : "—"
              }
              deltaSuffix="vs prior period"
              changePercent={countryChangePct}
              periodLabel="vs prior period"
              series={data?.previous.available ? [prevCountryShare, currentCountryShare] : []}
              markerTitle={topCountry ? `${currentCountryShare.toFixed(0)}%` : "—"}
              markerSubtitle="of views"
              positive={(countryChangePct ?? 0) >= 0}
            />
            <KpiTrendCard
              title="Countries Reached"
              accent="var(--brand-amber)"
              value={String(sortedCountries.length)}
              deltaLabel={
                countriesChangePct !== null
                  ? `${sortedCountries.length - prevCountries.length >= 0 ? "+" : ""}${sortedCountries.length - prevCountries.length}`
                  : "—"
              }
              deltaSuffix="vs prior period"
              changePercent={countriesChangePct}
              periodLabel="vs prior period"
              series={
                data?.previous.available ? [prevCountries.length, sortedCountries.length] : []
              }
              markerTitle={`${sortedCountries.length} countries`}
              markerSubtitle="this period"
              positive={(countriesChangePct ?? 0) >= 0}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h3 className="text-lg font-semibold">Age Groups — Share of Viewers</h3>
              {sortedAgeGroups.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No age data available for this period.
                </p>
              ) : (
                <div className="mt-4 h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={sortedAgeGroups.map((a) => ({
                        age: formatAgeGroup(a.ageGroup),
                        pct: a.viewerPercentage,
                      }))}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="age"
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--color-accent)" }}
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Viewers"]}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="pct"
                        name="Viewers %"
                        fill="var(--color-brand-blue)"
                        radius={[4, 4, 0, 0]}
                        barSize={32}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h3 className="text-lg font-semibold">Gender Split</h3>
              {sortedGenders.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No gender data available for this period.
                </p>
              ) : (
                <>
                  <div className="mt-4 h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sortedGenders}
                          dataKey="viewerPercentage"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {sortedGenders.map((g, i) => (
                            <Cell
                              key={i}
                              fill={GENDER_COLORS[g.gender] ?? "var(--color-muted-foreground)"}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    {sortedGenders.map((g) => (
                      <div key={g.gender} className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              background:
                                GENDER_COLORS[g.gender] ?? "var(--color-muted-foreground)",
                            }}
                          />
                          {formatGender(g.gender)}
                        </span>
                        <span className="font-semibold">{g.viewerPercentage.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h3 className="text-lg font-semibold">Geography</h3>
            {sortedCountries.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No geography data available for this period.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {sortedCountries.slice(0, 10).map((g) => {
                  const pct = totalCountryViews ? (g.views / totalCountryViews) * 100 : 0;
                  return (
                    <div key={g.country} className="flex items-center gap-4">
                      <span className="w-36 shrink-0 truncate text-sm text-muted-foreground">
                        {formatCountry(g.country)}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-accent">
                        <div
                          className="h-full rounded-full bg-brand-blue"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-sm font-semibold">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground">
              Demographic and geography data via the YouTube Analytics API (ageGroup, gender,
              country dimensions).
            </p>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
