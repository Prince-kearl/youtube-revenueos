import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// The Dashboard's KPI cards: dark panels with a numbered dot-matrix label ("01  ESTIMATED
// REVENUE"), the value in the dot-matrix face (Doto), the change in green/red, a dot-matrix
// chart of the monthly series on the right, and a three-figure strip along the bottom (last
// month, this month, and the long-run total). Every number is in the text; the charts are
// decorative. Admin pages keep KpiTrendCard.

export type KpiAccent = "green" | "red";
const ACCENT: Record<KpiAccent, string> = { green: "#22c55e", red: "#ef4444" };
const DOT_DIM = "rgba(255, 255, 255, 0.14)";
const DOT_MID = "rgba(255, 255, 255, 0.42)";

export type KpiChart =
  | { kind: "bars"; series: number[]; highlight: "all" | "last" | "top" }
  | { kind: "line"; series: number[]; callout?: { title: string; subtitle: string } }
  | { kind: "grid"; series: number[] };

export interface KpiDelta {
  /** Arrow and colour; null for a neutral note (e.g. "Oct 2026 so far - still updating"). */
  direction: "up" | "down" | null;
  /** The coloured part, e.g. "79.4%" or "4". */
  emphasis: string;
  /** The rest, e.g. "vs previous month". */
  text: string;
}

export interface KpiStat {
  label: string;
  value: string;
}

const ROWS = 8;
const VIEW_W = 168;
const VIEW_H = 76;

/** Dot columns: one column per month, filled up to the month's share of the largest. */
function DotBars({
  series,
  accent,
  highlight,
}: {
  series: number[];
  accent: string;
  highlight: "all" | "last" | "top";
}) {
  const values = series.slice(-14);
  const n = Math.max(values.length, 1);
  const max = Math.max(...values, 0);
  const colW = VIEW_W / n;
  const step = VIEW_H / ROWS;
  const r = Math.min(colW, step) * 0.26;
  const top = [...values].sort((a, b) => b - a)[Math.min(2, values.length - 1)] ?? Infinity;
  return (
    <>
      {values.map((v, c) => {
        const filled = max > 0 ? Math.max(1, Math.round((v / max) * ROWS)) : 1;
        const lit =
          highlight === "all" ||
          (highlight === "last" && c >= values.length - 2) ||
          (highlight === "top" && (c === values.length - 1 || (v >= top && v > 0)));
        return Array.from({ length: ROWS }).map((_, row) => {
          const on = row < filled;
          return (
            <circle
              key={`${c}-${row}`}
              cx={c * colW + colW / 2}
              cy={VIEW_H - row * step - step / 2}
              r={r}
              fill={on ? (lit ? accent : DOT_MID) : DOT_DIM}
              opacity={on ? 1 : 0.5}
            />
          );
        });
      })}
    </>
  );
}

/** A dotted line through the months (one dot per step), faint dots under it, a ring at the end. */
function DotLine({ series, accent }: { series: number[]; accent: string }) {
  const raw = series.length >= 2 ? series.slice(-14) : [series[0] ?? 0, series[0] ?? 0];
  const steps = 28;
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  const span = max - min || 1;
  const at = (t: number) => {
    const x = t * (raw.length - 1);
    const i = Math.min(Math.floor(x), raw.length - 2);
    return raw[i] + (raw[i + 1] - raw[i]) * (x - i);
  };
  const step = VIEW_H / ROWS;
  const pts = Array.from({ length: steps + 1 }, (_, k) => {
    const t = k / steps;
    const y = 8 + (1 - (at(t) - min) / span) * (VIEW_H - 16);
    return { x: 4 + t * (VIEW_W - 8), y };
  });
  const end = pts[pts.length - 1];
  return (
    <>
      {pts.map((p, k) =>
        Array.from({ length: ROWS }).map((_, row) => {
          const cy = VIEW_H - row * step - step / 2;
          return cy > p.y + 3 && k % 2 === 0 ? (
            <circle key={`f${k}-${row}`} cx={p.x} cy={cy} r={0.9} fill={DOT_DIM} />
          ) : null;
        }),
      )}
      {pts.map((p, k) => (
        <circle
          key={k}
          cx={p.x}
          cy={p.y}
          r={1.5}
          fill={k >= steps - 3 ? accent : "rgba(255, 255, 255, 0.85)"}
        />
      ))}
      <circle cx={end.x} cy={end.y} r={4.5} fill="none" stroke={accent} strokeWidth={1.5} />
      <circle cx={end.x} cy={end.y} r={2} fill={accent} />
    </>
  );
}

/** A grid of squares, one per month (newest bottom-right); brighter red for busier months. */
function DotGrid({ series, accent }: { series: number[]; accent: string }) {
  const cols = 8;
  const rowsN = 3;
  const cells = cols * rowsN;
  const values = series.slice(-cells);
  const padded = Array.from({ length: cells - values.length }, () => null as number | null).concat(
    values,
  );
  const max = Math.max(...values, 0);
  const size = 9;
  const gap = (VIEW_W - cols * size) / (cols - 1);
  const top = (VIEW_H - (rowsN * size + (rowsN - 1) * gap * 0.55)) / 2;
  return (
    <>
      {padded.map((v, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const share = v && max > 0 ? v / max : 0;
        return (
          <rect
            key={i}
            x={col * (size + gap)}
            y={top + row * (size + gap * 0.55)}
            width={size}
            height={size}
            rx={1.5}
            fill={v === null ? DOT_DIM : share > 0 ? accent : DOT_MID}
            opacity={v === null ? 0.6 : share > 0 ? 0.35 + share * 0.65 : 0.55}
          />
        );
      })}
    </>
  );
}

function KpiDotChart({ chart, accent }: { chart: KpiChart; accent: string }) {
  return (
    <div className="relative">
      {chart.kind === "line" && chart.callout && (
        <div className="absolute -top-2 right-6 z-10 rounded-[6px] border border-dashed border-white/25 bg-[#161616] px-2 py-1 text-center leading-tight">
          <p className="font-dot text-[13px] font-bold text-white">{chart.callout.title}</p>
          <p className="text-[10px] text-white/60">{chart.callout.subtitle}</p>
        </div>
      )}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="kpi-dot-chart h-[76px] w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {chart.kind === "bars" && (
          <DotBars series={chart.series} accent={accent} highlight={chart.highlight} />
        )}
        {chart.kind === "line" && <DotLine series={chart.series} accent={accent} />}
        {chart.kind === "grid" && <DotGrid series={chart.series} accent={accent} />}
      </svg>
    </div>
  );
}

export function DashboardKpiCard({
  index,
  title,
  value,
  delta,
  accent = "red",
  chart,
  stats,
  href,
  className,
}: {
  /** Position on the page (0-based): the "01" label and the entrance stagger. */
  index: number;
  title: string;
  value: string;
  delta: KpiDelta;
  accent?: KpiAccent;
  chart: KpiChart;
  stats: [KpiStat, KpiStat, KpiStat];
  /** Where the "..." button goes (the page with this metric's detail). */
  href: string;
  className?: string;
}) {
  const color = ACCENT[accent];
  const up = delta.direction === "up";
  return (
    // Phones: every card is the same fixed height. From sm up: at least that, rows equal height.
    <div
      className={cn(
        "dashboard-kpi-card relative flex h-[232px] flex-col overflow-hidden border border-white/[0.09] bg-[#121212] text-white shadow-[0_12px_30px_-18px_rgba(0,0,0,0.6)] sm:h-auto sm:min-h-[232px]",
        className,
      )}
      style={
        {
          borderRadius: "var(--kpi-card-radius, 12px)",
          "--i": index,
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="font-dot truncate text-[15px] font-bold uppercase tracking-[0.08em] text-white/90">
          <span className="mr-2 text-white/70">{String(index + 1).padStart(2, "0")}</span> {title}
        </p>
        <Link
          to={href}
          aria-label={`Open ${title} details`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 items-center gap-4 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="font-dot truncate text-[2.25rem] font-extrabold leading-none tracking-tight sm:text-[2.75rem]">
            {value}
          </p>
          <p className="mt-2.5 line-clamp-2 text-sm leading-5 text-white/65">
            {delta.direction && (
              <span
                className="mr-1.5 inline-flex items-center gap-1 align-[-2px] font-semibold"
                style={{ color: up ? "#22c55e" : "#ef4444" }}
              >
                {up ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                {delta.emphasis}
              </span>
            )}
            {!delta.direction && delta.emphasis && (
              <span className="mr-1 font-semibold text-white/80">{delta.emphasis}</span>
            )}
            {delta.text}
          </p>
        </div>
        <div className="w-[38%] max-w-[180px] shrink-0 sm:w-[42%]">
          <KpiDotChart chart={chart} accent={color} />
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/[0.09] border-t border-white/[0.09]">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 px-5 py-3">
            <p className="truncate font-mono text-[15px] font-semibold tabular-nums text-white">
              {s.value}
            </p>
            <p className="truncate text-[13px] text-white/55">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardKpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-[232px] animate-pulse border border-white/[0.06] bg-[#161616] sm:h-auto sm:min-h-[232px]",
        className,
      )}
      style={{ borderRadius: "var(--kpi-card-radius, 12px)" }}
      aria-hidden="true"
    />
  );
}
