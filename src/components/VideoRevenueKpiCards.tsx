import { KpiTrendCard } from "@/components/KpiTrendCard";
import type { VideoRevenueViewState } from "@/hooks/use-video-revenue";
import { videoRevenueKpi } from "@/lib/video-revenue-overview";

// The revenue KPI cards at the top of a video's page: the video's estimated YouTube revenue and
// its revenue per 1,000 views — the same stored figures as the Revenue overview below, from the
// one load the page shares with it (hooks/use-video-revenue.ts), never the live YouTube request.

/** The video's estimated YouTube revenue as the first KPI card — the same figure as the Revenue
 * overview below (one request, shared). While it loads the card says so; a failed load or an
 * amount the viewer may not see is never shown as a zero. */
export function RevenueKpiCard({ revenue }: { revenue: VideoRevenueViewState }) {
  const card =
    revenue.status === "ready"
      ? videoRevenueKpi(revenue.view)
      : {
          value: "—",
          changePercent: null,
          positive: true,
          deltaLabel: "",
          deltaSuffix: revenue.status === "loading" ? "Loading…" : "Couldn't load revenue",
          series: [],
        };
  return (
    <KpiTrendCard
      title="Estimated revenue"
      accent="var(--brand-green)"
      value={card.value}
      deltaLabel={card.deltaLabel}
      deltaSuffix={card.deltaSuffix}
      changePercent={card.changePercent}
      periodLabel="vs. previous period"
      series={card.series}
      markerTitle={card.value}
      markerSubtitle="This period"
      positive={card.positive}
    />
  );
}

/** Revenue per 1,000 views, from the same shared load as the Estimated revenue card. */
export function RpmKpiCard({ revenue }: { revenue: VideoRevenueViewState }) {
  const view = revenue.status === "ready" ? revenue.view : null;
  const value = view?.rpm ?? "—";
  return (
    <KpiTrendCard
      title="Revenue per 1,000 views"
      accent="var(--brand-amber)"
      value={value}
      deltaLabel=""
      deltaSuffix={
        revenue.status === "loading"
          ? "Loading…"
          : revenue.status === "error"
            ? "Couldn't load revenue"
            : view?.state === "hidden"
              ? "hidden by revenue settings"
              : view?.rpm
                ? "this period"
                : "not available"
      }
      changePercent={null}
      periodLabel=""
      series={[]}
      markerTitle={value}
      markerSubtitle="This period"
      positive
    />
  );
}
