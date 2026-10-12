import { useEffect, useId, useState } from "react";
import { DollarSign, EyeOff, Info } from "lucide-react";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import type { RevenueVideosResponse } from "@/lib/server/revenue-videos";
import {
  VIDEO_REVENUE_PERIOD_NOTE,
  VIDEO_REVENUE_SCOPE_NOTE,
  mapVideoRevenueOverview,
  videoRevenueUrl,
  type VideoRevenueOverviewView,
  type VideoRevenueRange,
} from "@/lib/video-revenue-overview";

// The Revenue overview on a video's page: the one place on that page a revenue figure appears.
//
// It reads STORED revenue from the canonical per-video endpoint and nothing else, with its own
// request and its own loading and error states — so it does not wait for, and is not taken down
// by, the page's live YouTube request (a channel that needs reconnecting still has its stored
// revenue). Everything it prints is decided by mapVideoRevenueOverview; this file only lays it out.

type ViewState =
  | { status: "loading" }
  | { status: "error" }
  // `refreshing`: a newer request is in flight; the figures shown are still the last ones loaded.
  | { status: "ready"; view: VideoRevenueOverviewView; refreshing: boolean };

export function VideoRevenueOverview({
  youtubeVideoId,
  range,
  refreshNonce = 0,
  className,
}: {
  youtubeVideoId: string;
  range: VideoRevenueRange;
  /** Changing this refetches (the page's Refresh button). */
  refreshNonce?: number;
  className?: string;
}) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const headingId = useId();

  // A different video starts from the skeleton: one video's figures are never shown for another.
  useEffect(() => setState({ status: "loading" }), [youtubeVideoId]);

  useEffect(() => {
    const url = videoRevenueUrl(youtubeVideoId, range, { demo: IS_LOCAL_DEMO });
    if (!url) {
      setState({ status: "error" });
      return;
    }
    const controller = new AbortController();
    // A change of range or a refresh keeps the last figures in place (marked as refreshing, with
    // their own period still labelled) instead of collapsing to the skeleton and back.
    setState((previous) =>
      previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" },
    );
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { data?: RevenueVideosResponse };
        if (!response.ok || !body.data) throw new Error();
        setState({
          status: "ready",
          view: mapVideoRevenueOverview(body.data, youtubeVideoId),
          refreshing: false,
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        // No figure of any kind is shown for a failed request — not a zero, not a dash, and not
        // the figures of the period that was showing before.
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [youtubeVideoId, range, refreshNonce, retryNonce]);

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-border bg-card p-5 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15 text-success"
            aria-hidden="true"
          >
            <DollarSign className="h-4 w-4" />
          </span>
          <h2 id={headingId} className="text-lg font-semibold">
            Revenue overview
          </h2>
          {IS_LOCAL_DEMO && (
            <span
              className="rounded-full border border-border bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              data-testid="revenue-sample-badge"
            >
              Sample data
            </span>
          )}
        </div>
        {state.status === "ready" && (
          <p className="text-xs text-muted-foreground" data-testid="revenue-period">
            Revenue period:{" "}
            <span className="font-medium text-foreground">{state.view.periodLabel}</span>
          </p>
        )}
      </div>

      {state.status === "loading" && <OverviewSkeleton />}

      {state.status === "error" && (
        <ErrorState
          className="mt-4"
          title="We couldn't load this video's revenue"
          description="The rest of this page is unaffected. Please try again."
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      )}

      {state.status === "ready" && (
        <div
          aria-busy={state.refreshing}
          className={state.refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}
        >
          <Overview view={state.view} />
        </div>
      )}
    </section>
  );
}

/** Shaped like the reported state (figure, note, the list of sources, footnotes), so the cards
 * below move as little as possible when the figures arrive. */
function OverviewSkeleton() {
  return (
    <div className="mt-4" role="status" aria-label="Loading revenue" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-9 w-36" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <Skeleton className="mt-5 h-40 w-full rounded-lg" />
      <Skeleton className="mt-3 h-3 w-56 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full" />
      <span className="sr-only">Loading revenue</span>
    </div>
  );
}

function Overview({ view }: { view: VideoRevenueOverviewView }) {
  const hidden = view.state === "hidden";
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Estimated YouTube revenue</p>
          <p
            className={`mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight ${view.hasAmount ? "" : "text-muted-foreground"}`}
            data-testid="revenue-headline"
          >
            {hidden && <EyeOff className="h-5 w-5" aria-hidden="true" />}
            {view.headline}
          </p>
        </div>
        {view.rpm && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Revenue per 1,000 views</p>
            <p className="mt-1 text-xl font-semibold" data-testid="revenue-rpm">
              {view.rpm}
            </p>
          </div>
        )}
        {view.change && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              vs {view.change.comparedWith}
            </p>
            <p
              className={`mt-1 text-xl font-semibold ${view.change.positive ? "text-success" : "text-destructive"}`}
              data-testid="revenue-change"
            >
              {view.change.text}
            </p>
          </div>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground" data-testid="revenue-note">
        {view.note}
      </p>

      {view.sources.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reported sources
          </h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {view.sources.map((source) => (
              <li
                key={source.key}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span>
                  {source.label}
                  {source.partial && (
                    <span className="ml-2 text-xs text-muted-foreground">partly reported</span>
                  )}
                </span>
                <span className="font-semibold">{source.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.sourcesNote && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="revenue-sources-note">
          {view.sourcesNote}
        </p>
      )}

      {(view.freshnessNote || view.completenessNote) && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="revenue-freshness">
          {[view.freshnessNote, view.completenessNote].filter(Boolean).join(" · ")}
        </p>
      )}

      {!hidden && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {VIDEO_REVENUE_SCOPE_NOTE} {VIDEO_REVENUE_PERIOD_NOTE}
          </span>
        </p>
      )}
    </>
  );
}
