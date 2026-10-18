import { useEffect, useState } from "react";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import type { RevenueVideosResponse } from "@/lib/server/revenue-videos";
import {
  mapVideoRevenueOverview,
  videoRevenueUrl,
  type VideoRevenueOverviewView,
  type VideoRevenueRange,
} from "@/lib/video-revenue-overview";

// One video's STORED revenue, from the canonical per-video endpoint and nothing else, with its own
// request and its own loading and error states — so it does not wait for, and is not taken down
// by, the page's live YouTube request (a channel that needs reconnecting still has its stored
// revenue). The video page loads it for its "Estimated revenue" and "Revenue per 1,000 views" KPI
// cards (components/VideoRevenueKpiCards.tsx).

export type VideoRevenueViewState =
  | { status: "loading" }
  | { status: "error" }
  // `refreshing`: a newer request is in flight; the figures shown are still the last ones loaded.
  | { status: "ready"; view: VideoRevenueOverviewView; refreshing: boolean };

export interface VideoRevenueLoad {
  state: VideoRevenueViewState;
  retry: () => void;
}

export function useVideoRevenue(
  youtubeVideoId: string,
  range: VideoRevenueRange,
  /** Changing this refetches (the page's Refresh button). */
  refreshNonce = 0,
): VideoRevenueLoad {
  const [state, setState] = useState<VideoRevenueViewState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);

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

  return { state, retry: () => setRetryNonce((n) => n + 1) };
}
