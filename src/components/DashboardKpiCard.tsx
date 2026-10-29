import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// The Dashboard's KPI cards: a saturated colour on the left fading paler to the right, where the
// metric's mascot stands, with a white callout (the latest month) in the top-right corner and a
// small bar chart of the trend under the numbers. Colours sampled from the design reference.
// The mascot is decorative; every number is in the text. Admin pages keep KpiTrendCard.

export type KpiCardTheme = "green" | "blue" | "purple" | "pink" | "yellow" | "red";

const THEMES: Record<KpiCardTheme, { background: string; mascot: string; text: "light" | "dark" }> =
  {
    green: {
      background: "linear-gradient(90deg, #8ce589 0%, #91e58e 45%, #b5f0ab 72%, #cbf4bc 100%)",
      mascot: "/kpi/kpi-revenue.webp",
      text: "light",
    },
    blue: {
      background: "linear-gradient(90deg, #69b4fe 0%, #86c3fe 45%, #a2d4fe 75%, #acdafe 100%)",
      mascot: "/kpi/kpi-latest-revenue.webp",
      text: "light",
    },
    purple: {
      background: "linear-gradient(90deg, #b876fd 0%, #c483fd 45%, #d28ffd 75%, #d998fe 100%)",
      mascot: "/kpi/kpi-views.webp",
      text: "light",
    },
    pink: {
      background: "linear-gradient(90deg, #fd8181 0%, #feadae 45%, #fec8c9 75%, #fed5d6 100%)",
      mascot: "/kpi/kpi-videos.webp",
      text: "light",
    },
    yellow: {
      background: "linear-gradient(90deg, #ffe382 0%, #fee692 45%, #fee9a0 75%, #feeaa5 100%)",
      mascot: "/kpi/kpi-subscribers.webp",
      text: "dark",
    },
    red: {
      background: "linear-gradient(90deg, #f46968 0%, #f27777 45%, #fea3a2 72%, #fed6d5 100%)",
      mascot: "/kpi/kpi-watch-time.webp",
      text: "light",
    },
  };

/** The trend as small bars (the latest months), heights relative to the largest. */
function TrendBars({ series, dark }: { series: number[]; dark: boolean }) {
  const values = series.slice(-16);
  if (values.length === 0) return null;
  const max = Math.max(...values.map((v) => Math.abs(v)), 0);
  return (
    <div className="flex h-[22px] items-end gap-1" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={cn("w-[9px] rounded-[2px]", dark ? "bg-[#c9a227]/35" : "bg-white/40")}
          style={{ height: `${max > 0 ? Math.max(30, (Math.abs(v) / max) * 100) : 30}%` }}
        />
      ))}
    </div>
  );
}

function ChangePill({ changePercent, positive }: { changePercent: number; positive: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[13px] font-semibold leading-5",
        positive ? "bg-[#dcfce7] text-[#16a34a]" : "bg-[#fee2e2] text-[#e5484d]",
      )}
    >
      {positive ? (
        <ArrowUpRight className="h-3.5 w-3.5" />
      ) : (
        <ArrowDownRight className="h-3.5 w-3.5" />
      )}
      {Math.abs(changePercent).toFixed(1)}%
    </span>
  );
}

export function DashboardKpiCard({
  theme,
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
  className,
}: {
  theme: KpiCardTheme;
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
  className?: string;
}) {
  const t = THEMES[theme];
  const dark = t.text === "dark";
  return (
    // Phones: every card is the same fixed height (the change badge moves onto the title row so
    // no card grows taller). From sm up: the design's layout, at least 168px, rows equal height.
    <div
      className={cn(
        "dashboard-kpi-card relative isolate flex h-[168px] overflow-hidden px-5 py-4 shadow-[0_10px_24px_-14px_rgba(15,23,42,0.35)] sm:h-auto sm:min-h-[168px]",
        dark ? "text-zinc-800" : "text-white",
        className,
      )}
      style={{ background: t.background, borderRadius: "var(--kpi-card-radius, 16px)" }}
    >
      <img
        src={t.mascot}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
        className="pointer-events-none absolute bottom-0 right-[4%] -z-10 h-[88%] max-h-[150px] w-auto max-w-[42%] sm:max-w-[46%] select-none object-contain object-bottom"
      />

      {markerTitle && (
        <div className="absolute right-3 top-3 z-10 min-w-[84px] rounded-[8px] bg-white px-3 py-1.5 text-left shadow-[0_2px_8px_rgba(15,23,42,0.08)] sm:right-4">
          <p className="text-[13px] font-semibold leading-tight text-zinc-900">{markerTitle}</p>
          {markerSubtitle && (
            <p className="text-xs leading-tight text-zinc-500">{markerSubtitle}</p>
          )}
        </div>
      )}

      <div className="relative z-0 flex min-w-0 max-w-[55%] flex-col sm:max-w-[60%]">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "truncate text-[15px] font-medium leading-5",
              dark ? "text-zinc-700" : "text-white/95",
            )}
          >
            {title}
          </p>
          {changePercent !== null && (
            <span className="sm:hidden">
              <ChangePill changePercent={changePercent} positive={positive} />
            </span>
          )}
        </div>
        {changePercent !== null && (
          <div className="mt-1.5 hidden items-center gap-2 text-sm sm:flex">
            <ChangePill changePercent={changePercent} positive={positive} />
            {periodLabel && (
              <span
                className={cn(
                  "flex items-center gap-0.5 whitespace-nowrap",
                  dark ? "text-zinc-700" : "text-white/90",
                )}
              >
                {periodLabel}
                <ChevronDown className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        )}
        <p className="mt-2 truncate text-[2.25rem] font-bold leading-none tracking-tight">
          {value}
        </p>
        <p
          className={cn(
            "mt-1.5 line-clamp-2 text-sm leading-5",
            dark ? "text-zinc-700" : "text-white/90",
          )}
        >
          {deltaLabel} {deltaSuffix}
        </p>
        <div className="mt-auto pt-2">
          <TrendBars series={series} dark={dark} />
        </div>
      </div>
    </div>
  );
}

export function DashboardKpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-[168px] animate-pulse bg-muted sm:h-auto sm:min-h-[168px]", className)}
      style={{ borderRadius: "var(--kpi-card-radius, 16px)" }}
      aria-hidden="true"
    />
  );
}
