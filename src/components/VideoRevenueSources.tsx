import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Info, Layers, Link2, MousePointerClick, Plus, Youtube } from "lucide-react";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import type { VideoRevenueRange } from "@/lib/video-revenue-overview";
import {
  SOURCES_CLICKS_NOTE,
  SOURCES_EMPTY_NOTE,
  SOURCES_NOT_CONNECTED_NOTE,
  SOURCES_PERIOD_NOTE,
  SOURCES_RESTRICTED_NOTE,
  SOURCES_YOUTUBE_NOTE,
  mapVideoRevenueSources,
  videoLinkActivityUrl,
  type VideoRevenueSourcesView,
} from "@/lib/video-revenue-sources";
import type { VideoLinkActivityResponse } from "@/lib/server/video-link-activity";

// The Revenue sources section on a video's page: what is connected to this video besides the
// YouTube revenue shown in the Revenue overview above it. Today that is tracked-link ACTIVITY —
// clicks and visitors, never money — and a plain statement of what is not connected yet.
//
// It has its own request, loading and error states, so neither the Revenue overview nor the
// page's live YouTube request waits for it or is taken down by it. A member whose role does not
// have link tracking gets the section without any link data: the server refuses the request
// before reading anything, and nothing about the links is shown.

type LinksState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  // `refreshing`: a newer request is in flight; the counts shown are still the last ones loaded.
  | { status: "ready"; view: VideoRevenueSourcesView; refreshing: boolean };

export function VideoRevenueSources({
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
  const [state, setState] = useState<LinksState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const headingId = useId();

  // A different video starts from the skeleton: one video's links are never shown for another.
  useEffect(() => setState({ status: "loading" }), [youtubeVideoId]);

  useEffect(() => {
    const url = videoLinkActivityUrl(youtubeVideoId, range, { demo: IS_LOCAL_DEMO });
    if (!url) {
      setState({ status: "error" });
      return;
    }
    const controller = new AbortController();
    setState((previous) =>
      previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" },
    );
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        // The role does not have link tracking: no link data was read, and none is shown.
        if (response.status === 403) {
          setState({ status: "restricted" });
          return;
        }
        const body = (await response.json()) as { data?: VideoLinkActivityResponse };
        if (!response.ok || !body.data) throw new Error();
        setState({ status: "ready", view: mapVideoRevenueSources(body.data), refreshing: false });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        // A failed request shows the error state and no counts at all — never a zero.
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [youtubeVideoId, range, refreshNonce, retryNonce]);

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-border bg-card p-5 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Layers className="h-4 w-4" />
        </span>
        <h2 id={headingId} className="text-lg font-semibold">
          Revenue sources
        </h2>
        {IS_LOCAL_DEMO && (
          <span
            className="rounded-full border border-border bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            data-testid="sources-sample-badge"
          >
            Sample data
          </span>
        )}
      </div>

      {/* YouTube: a pointer to the figure above, never a second figure. */}
      <div className="mt-4 flex items-start gap-3" data-testid="sources-youtube">
        <Youtube className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold">YouTube</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{SOURCES_YOUTUBE_NOTE}</p>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-4" data-testid="sources-links">
        <div className="flex items-start gap-3">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Tracked links</h3>

            {state.status === "loading" && (
              <div
                className="mt-3"
                role="status"
                aria-label="Loading link activity"
                aria-busy="true"
              >
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="mt-3 h-16 w-full rounded-lg" />
                <span className="sr-only">Loading link activity</span>
              </div>
            )}

            {state.status === "restricted" && (
              <p className="mt-0.5 text-sm text-muted-foreground" data-testid="sources-restricted">
                {SOURCES_RESTRICTED_NOTE}
              </p>
            )}

            {state.status === "error" && (
              <ErrorState
                className="mt-3"
                title="We couldn't load this video's link activity"
                description="The rest of this page is unaffected. Please try again."
                onRetry={() => setRetryNonce((n) => n + 1)}
              />
            )}

            {state.status === "ready" && (
              <div
                aria-busy={state.refreshing}
                className={
                  state.refreshing ? "opacity-60 transition-opacity" : "transition-opacity"
                }
              >
                <LinkActivity view={state.view} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 border-t border-border pt-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold">Not connected yet</h3>
          <p className="mt-0.5 text-sm text-muted-foreground" data-testid="sources-not-connected">
            {SOURCES_NOT_CONNECTED_NOTE}
          </p>
        </div>
      </div>
    </section>
  );
}

function LinkActivity({ view }: { view: VideoRevenueSourcesView }) {
  if (view.state === "empty")
    return (
      <div className="mt-1" data-testid="sources-empty">
        <p className="text-sm text-muted-foreground">{SOURCES_EMPTY_NOTE}</p>
        <Link
          to="/link-tracking"
          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a tracked link
        </Link>
      </div>
    );

  return (
    <>
      <p className="mt-0.5 text-xs text-muted-foreground" data-testid="sources-period">
        Link activity for this video,{" "}
        <span className="font-medium text-foreground">{view.periodLabel}</span>
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" /> Link clicks
          </dt>
          <dd className="mt-1 text-2xl font-bold tracking-tight" data-testid="sources-clicks">
            {view.clicks}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Unique visitors</dt>
          <dd className="mt-1 text-2xl font-bold tracking-tight" data-testid="sources-visitors">
            {view.uniqueVisitors}
          </dd>
        </div>
      </dl>

      {view.noCurrentLinksNote && (
        <p className="mt-3 text-sm text-muted-foreground">{view.noCurrentLinksNote}</p>
      )}

      {(view.links.length > 0 || view.formerLinks) && (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {view.links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              data-testid="sources-link"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {link.title}
                  {link.statusLabel && (
                    <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {link.statusLabel}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{link.shortUrl}</p>
              </div>
              <LinkCounts clicks={link.clicks} visitors={link.uniqueVisitors} />
            </li>
          ))}
          {view.formerLinks && (
            <li
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-accent/30 px-4 py-3"
              data-testid="sources-former-links"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{view.formerLinks.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{view.formerLinks.detail}</p>
              </div>
              <LinkCounts
                clicks={view.formerLinks.clicks}
                visitors={view.formerLinks.uniqueVisitors}
              />
            </li>
          )}
        </ul>
      )}

      <p className="mt-3 text-sm font-medium" data-testid="sources-clicks-note">
        {SOURCES_CLICKS_NOTE}
      </p>
      <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground" data-testid="sources-notes">
        {view.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        <li>{SOURCES_PERIOD_NOTE}</li>
      </ul>
    </>
  );
}

function LinkCounts({ clicks, visitors }: { clicks: string; visitors: string }) {
  return (
    <p className="shrink-0 text-right text-sm">
      <span className="font-semibold">{clicks}</span>{" "}
      <span className="text-muted-foreground">clicks</span>
      <span className="mx-1.5 text-muted-foreground" aria-hidden="true">
        ·
      </span>
      <span className="font-semibold">{visitors}</span>{" "}
      <span className="text-muted-foreground">unique</span>
    </p>
  );
}
