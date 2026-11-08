import { useId } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

function formatKpiText(text: string): string {
  return text.replace(/\$/g, "USD ");
}

// Hand-rolled SVG instead of recharts (used everywhere else in the app) — this card's reference
// design needs a fixed, always-visible callout anchored to one exact point on the curve, which
// isn't something recharts' declarative API exposes cleanly. Building the path directly gives
// full control over that point's pixel position, which the floating box below is placed against.
function MiniAreaTrend({
  data,
  accent,
  markerTitle,
  markerSubtitle,
}: {
  data: number[];
  accent: string;
  markerTitle: string;
  markerSubtitle: string;
}) {
  const gradientId = useId();
  const width = 280;
  const height = 160;
  const padX = 0;
  const padY = 10;

  // A single real point still needs two to draw a line — repeat it flat rather than collapsing
  // to [0,0], which would pin an otherwise-real value to an empty baseline.
  const safeData = data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [0, 0];
  // The real values, not a smoothed version (smoothing moved peaks and drew the latest month at a
  // different height from the figure in the callout). The scale starts at zero (or at the lowest
  // value when it is negative) so heights compare honestly, with a little headroom on top.
  const dataMin = Math.min(...safeData);
  const dataMax = Math.max(...safeData);
  const min = Math.min(0, dataMin);
  const top = dataMax > min ? dataMax : min + 1;
  const max = top + (top - min) * 0.15;
  const range = max - min || 1;

  const points = safeData.map((v, i) => ({
    x: padX + (i / (safeData.length - 1)) * (width - padX * 2),
    y: height - padY - ((v - min) / range) * (height - padY * 2),
  }));

  // Smooth curve: cubic Bezier per segment with control points at the horizontal midpoint —
  // a standard trick that reads as a smooth monotone curve without a full spline implementation.
  const linePath = points.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = points[i - 1];
    const midX = (prev.x + p.x) / 2;
    return `${d} C${midX},${prev.y} ${midX},${p.y} ${p.x},${p.y}`;
  }, "");
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath = `${linePath} L${last.x},${height} L${first.x},${height} Z`;

  // The marker sits on the latest point: the month the callout names and whose value it shows.
  const marker = points[points.length - 1];
  const color = accent;

  return (
    <div className="relative h-[112px] w-full sm:h-[112px]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={marker.x}
          x2={marker.x}
          y1={marker.y}
          y2={height}
          stroke={color}
          strokeOpacity={0.35}
          strokeWidth={1.5}
          strokeDasharray="3 4"
        />
        <circle
          cx={marker.x}
          cy={marker.y}
          r={4.5}
          fill={color}
          stroke="var(--card)"
          strokeWidth={2}
        />
      </svg>
      <div
        className="pointer-events-none absolute z-10 -translate-x-full -translate-y-[calc(100%+4px)] whitespace-nowrap rounded-none border border-border bg-card px-1.5 py-0.5 text-[8px] leading-tight shadow-none sm:-translate-y-[calc(100%+5px)] sm:px-2 sm:py-1 sm:text-[9px]"
        style={{ left: `${(marker.x / width) * 100}%`, top: `${(marker.y / height) * 100}%` }}
      >
        <p className="font-semibold text-foreground">{markerTitle}</p>
        <p className="text-muted-foreground">{markerSubtitle}</p>
      </div>
    </div>
  );
}

// For pages backed by mock/localStorage data with no real history to trend (admin console demo
// sections, Team, Support) — same visual shell as KpiTrendCard, but never claims a trend that
// doesn't exist: a flat line at the current value, no change%/delta badge. Converts a plain
// StatCard-shaped call (title/value/caption) into KpiTrendCard's fuller prop set so those pages
// don't each have to hand-roll the "no real trend" convention.
export function FlatKpiCard({
  title,
  value,
  caption = "",
  accent,
  className,
}: {
  title: string;
  value: string;
  caption?: string;
  accent?: string;
  className?: string;
}) {
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ""));
  const flat = Number.isFinite(numeric) ? numeric : 0;
  return (
    <KpiTrendCard
      title={title}
      value={value}
      deltaLabel=""
      deltaSuffix={caption}
      changePercent={null}
      periodLabel=""
      series={[flat, flat]}
      markerTitle={value}
      markerSubtitle={title}
      positive
      accent={accent}
      className={className}
    />
  );
}

export function KpiTrendCard({
  title,
  value,
  deltaLabel,
  deltaSuffix,
  changePercent,
  periodLabel,
  series,
  markerTitle,
  markerSubtitle,
  positive,
  accent = "var(--primary)",
  className,
}: {
  title: string;
  value: string;
  deltaLabel: string;
  deltaSuffix: string;
  changePercent: number | null;
  periodLabel: string;
  series: number[];
  markerTitle: string;
  markerSubtitle: string;
  positive: boolean;
  accent?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "kpi-trend-card relative flex min-h-[132px] flex-row items-stretch gap-2 rounded-[var(--kpi-card-radius)] border px-4 py-3.5 shadow-none sm:gap-3 sm:px-5 sm:py-3.5",
        className,
      )}
      style={{
        backgroundColor: "var(--card)",
        backgroundImage:
          "radial-gradient(115% 170% at 0% 0%, color-mix(in srgb, var(--kpi-accent) 12%, var(--card)) 0%, color-mix(in srgb, var(--card) 88%, transparent) 66%, var(--card) 100%)",
        borderColor: "color-mix(in srgb, var(--kpi-accent) 30%, var(--card))",
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center sm:justify-between">
        <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
          <p className="text-[10px] font-normal leading-none text-muted-foreground">{title}</p>
          {changePercent !== null && (
            <div className="hidden items-center gap-1.5 text-xs sm:flex">
              <span
                className={cn(
                  "flex items-center gap-0.5 font-medium",
                  positive ? "text-success" : "text-destructive",
                )}
              >
                {positive ? (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" />
                )}
                {Math.abs(changePercent).toFixed(1)}%
              </span>
              <span className="hidden text-[10px] font-normal text-muted-foreground md:inline">
                {periodLabel}
              </span>
            </div>
          )}
          {changePercent !== null && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-[10px] font-medium sm:hidden",
                positive ? "text-success" : "text-destructive",
              )}
            >
              {positive ? (
                <ArrowUpRight className="h-2.5 w-2.5" />
              ) : (
                <ArrowDownRight className="h-2.5 w-2.5" />
              )}
              {Math.abs(changePercent).toFixed(1)}%
            </span>
          )}
        </div>

        <div className="mt-2">
          <p className="text-[21px] font-bold leading-none tracking-tight text-foreground">
            {formatKpiText(value)}
          </p>
          <p className="mt-1.5 text-[10px] leading-tight sm:text-[10px]">
            <span className={cn("font-semibold", positive ? "text-success" : "text-destructive")}>
              {formatKpiText(deltaLabel)}
            </span>{" "}
            <span className="text-muted-foreground">{formatKpiText(deltaSuffix)}</span>
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <MiniAreaTrend
          data={series}
          accent={positive ? "var(--success)" : "var(--destructive)"}
          markerTitle={formatKpiText(markerTitle)}
          markerSubtitle={formatKpiText(markerSubtitle)}
        />
      </div>
    </div>
  );
}
