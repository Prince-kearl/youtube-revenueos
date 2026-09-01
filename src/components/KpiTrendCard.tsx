import { useId } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Centered moving average — softens genuinely noisy/alternating series (e.g. a monthly metric
// that's 0 or 1 every single month) into the gentle single-direction curves the reference design
// uses throughout, without discarding the real endpoints (the marker still reads the raw last
// value, not the smoothed one — see markerTitle callers).
function smoothSeries(values: number[], window = 3): number[] {
  if (values.length <= 2) return values;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}

// Hand-rolled SVG instead of recharts (used everywhere else in the app) — this card's reference
// design needs a fixed, always-visible callout anchored to one exact point on the curve, which
// isn't something recharts' declarative API exposes cleanly. Building the path directly gives
// full control over that point's pixel position, which the floating box below is placed against.
function MiniAreaTrend({
  data,
  positive,
  markerTitle,
  markerSubtitle,
}: {
  data: number[];
  positive: boolean;
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
  const raw = data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [0, 0];
  // Two passes (a wider effective kernel than either alone) — a single window-3 pass halves the
  // amplitude of a strictly alternating series but doesn't touch its frequency, so it still reads
  // as a zigzag just a smaller one; a second pass is what actually collapses that oscillation.
  const safeData = smoothSeries(smoothSeries(raw, 5), 3);
  const dataMin = Math.min(...safeData);
  const dataMax = Math.max(...safeData);
  // Padding the domain rather than fitting it exactly is what keeps low-amplitude/near-binary
  // series (e.g. a metric that's 0 or 1 every month) from being stretched to fill the full card
  // height and reading as a jagged zigzag — the reference's curves are all gentle, so real swings
  // get ~40% of the height instead of 100%, and flat/near-flat data doesn't look like noise.
  const span = dataMax - dataMin || Math.max(Math.abs(dataMax), 1);
  const min = dataMin - span * 0.35;
  const max = dataMax + span * 0.35;
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

  // Marker sits one point before the end, matching the reference (the callout points at a
  // near-final value, not literally the last pixel of the curve).
  const markerIndex = Math.max(0, points.length - 2);
  const marker = points[markerIndex];
  const color = positive ? "var(--success)" : "var(--destructive)";

  return (
    <div className="relative h-32 w-full sm:h-[84px]">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <line x1={marker.x} x2={marker.x} y1={marker.y} y2={height} stroke={color} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="3 4" />
        <circle cx={marker.x} cy={marker.y} r={4.5} fill={color} stroke="var(--card)" strokeWidth={2} />
      </svg>
      <div
        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-lg border border-border bg-card px-1.5 py-0.5 text-[9px] shadow-md sm:-translate-y-[calc(100%+10px)] sm:px-2.5 sm:py-1 sm:text-xs"
        style={{ left: `${(marker.x / width) * 100}%`, top: `${(marker.y / height) * 100}%` }}
      >
        <p className="font-semibold text-foreground">{markerTitle}</p>
        <p className="text-muted-foreground">{markerSubtitle}</p>
      </div>
    </div>
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
      className={cn("relative flex flex-row items-stretch gap-3 rounded-xl border-[3px] border-white bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/15 dark:shadow-none sm:gap-3 sm:rounded-2xl sm:p-4", className)}
      style={{ backgroundImage: `radial-gradient(140% 140% at 0% 0%, color-mix(in srgb, ${accent} 16%, transparent) 0%, transparent 60%)` }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center sm:justify-between">
        <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
          <p className="text-xs font-medium text-foreground/80">{title}</p>
          {changePercent !== null && (
            <div className="hidden items-center gap-1.5 text-xs sm:flex">
              <span className={cn("flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {Math.abs(changePercent).toFixed(1)}%
              </span>
              <span className="hidden text-muted-foreground md:inline">{periodLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          {changePercent !== null && (
            <span className={cn("flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold sm:hidden", positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
              {positive ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
              {Math.abs(changePercent).toFixed(1)}%
            </span>
          )}
        </div>

        <div className="mt-2">
          <p className="text-3xl font-bold leading-tight tracking-tight text-foreground">{value}</p>
          <p className="mt-1.5 text-sm leading-tight sm:text-xs">
            <span className={cn("font-semibold", positive ? "text-success" : "text-destructive")}>{deltaLabel}</span>{" "}
            <span className="text-muted-foreground">{deltaSuffix}</span>
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <MiniAreaTrend data={series} positive={positive} markerTitle={markerTitle} markerSubtitle={markerSubtitle} />
      </div>
    </div>
  );
}
