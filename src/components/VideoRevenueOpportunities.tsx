import { useEffect, useId, useState } from "react";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import type { VideoRevenueRange } from "@/lib/video-revenue-overview";
import { videoOpportunitiesUrl } from "@/lib/video-opportunities-view";
import type { VideoOpportunitiesResponse } from "@/lib/server/video-opportunities";
import {
  VideoOpportunitiesContent,
  type OpportunitiesState,
} from "@/components/VideoOpportunitiesView";

// Video details → Revenue opportunities: what to do next with this video, worked out by the API
// from data the page's other sections already show. Its own request, loading and error states,
// so nothing else on the page waits for it or is taken down by it.

export function VideoRevenueOpportunities({
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
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const headingId = useId();

  // A different video starts from the skeleton: one video's suggestions are never shown for another.
  useEffect(() => setState({ status: "loading" }), [youtubeVideoId]);

  useEffect(() => {
    const url = videoOpportunitiesUrl(youtubeVideoId, range, { demo: IS_LOCAL_DEMO });
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
        if (response.status === 403) {
          setState({ status: "restricted" });
          return;
        }
        const body = (await response.json()) as Partial<VideoOpportunitiesResponse>;
        if (!response.ok || !body.data || !Array.isArray(body.data.opportunities))
          throw new Error();
        setState({
          status: "ready",
          response: body as VideoOpportunitiesResponse,
          refreshing: false,
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [youtubeVideoId, range, refreshNonce, retryNonce]);

  return (
    <VideoOpportunitiesContent
      state={state}
      headingId={headingId}
      onRetry={() => setRetryNonce((n) => n + 1)}
      className={className}
    />
  );
}
