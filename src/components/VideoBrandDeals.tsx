import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import { BRAND_DEALS_ANCHOR } from "@/lib/revenue-actions";
import { BUTTON, BrandDealsContent, type BrandDealsState } from "@/components/VideoBrandDealsView";
import {
  linkDealRequest,
  linkableDeals,
  mapVideoBrandDeals,
  mutationErrorMessage,
  unlinkDealRequest,
  videoDealsUrl,
  type LinkableDeal,
} from "@/lib/video-brand-deals";
import type { VideoDealsResponse } from "@/lib/server/video-deals";

// Revenue sources → Brand deals: the deals linked to this video and the share of their agreed
// value attributed to it (see lib/video-brand-deals.ts for the wording and the rules).
//
// Its own request, loading and error states, so nothing else on the page waits for it or is
// taken down by it. The API decides everything that matters — who sees amounts, who may link —
// and these controls only follow its answer: a member without the brand_deals feature gets the
// restricted line and no deal data at all; a member who may not see amounts gets names and
// stages with every amount "Hidden"; link and unlink appear only when the API says the caller
// may use them. Linking and unlinking answer with the refreshed figures, which replace the
// block's state directly — no second request.

export function VideoBrandDeals({
  youtubeVideoId,
  refreshNonce = 0,
  onChanged,
}: {
  youtubeVideoId: string;
  /** Changing this refetches (the page's Refresh button). */
  refreshNonce?: number;
  /** A link or unlink was saved (called after the block shows the saved state). */
  onChanged?: () => void;
}) {
  const [state, setState] = useState<BrandDealsState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The video a mutation's answer belongs to: an answer for a video the page has since left is
  // dropped rather than shown on another video.
  const currentVideo = useRef(youtubeVideoId);
  currentVideo.current = youtubeVideoId;

  // A different video starts from the skeleton: one video's deals are never shown for another.
  useEffect(() => {
    setState({ status: "loading" });
    setDialogOpen(false);
  }, [youtubeVideoId]);

  // Opened at this block ("#brand-deals", from a "Link a deal" suggestion elsewhere): brought into
  // view once it has loaded, since the sections above it load on their own and move it down.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (state.status === "loading" || scrolledFor.current === youtubeVideoId) return;
    if (typeof window === "undefined" || window.location.hash !== `#${BRAND_DEALS_ANCHOR}`) return;
    scrolledFor.current = youtubeVideoId;
    document.getElementById(BRAND_DEALS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [state.status, youtubeVideoId]);

  useEffect(() => {
    const url = videoDealsUrl(youtubeVideoId, { demo: IS_LOCAL_DEMO });
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
        // The role does not have brand deals: nothing was read, and nothing is shown.
        if (response.status === 403) {
          setState({ status: "restricted" });
          return;
        }
        const body = (await response.json()) as Partial<VideoDealsResponse>;
        if (!response.ok || !body.data || !body.visibility || !body.permissions) throw new Error();
        setState({
          status: "ready",
          view: mapVideoBrandDeals(body as VideoDealsResponse),
          refreshing: false,
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        // A failed request shows the error state and no figures at all — never a zero.
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [youtubeVideoId, refreshNonce, retryNonce]);

  const mutate = useCallback(
    async (kind: "link" | "unlink", dealId: string): Promise<boolean> => {
      const video = youtubeVideoId;
      setPendingId(dealId);
      try {
        const [url, init] =
          kind === "link" ? linkDealRequest(video, dealId) : unlinkDealRequest(video, dealId);
        const response = await fetch(url, init);
        let body: Partial<VideoDealsResponse> & { error?: unknown } = {};
        try {
          body = (await response.json()) as typeof body;
        } catch {
          body = {};
        }
        if (currentVideo.current !== video) return false;
        if (!response.ok || !body.data || !body.visibility || !body.permissions) {
          toast.error(mutationErrorMessage(response.status, body.error));
          return false;
        }
        // The answer IS the refreshed block: shown as it is, with no second request.
        setState({
          status: "ready",
          view: mapVideoBrandDeals(body as VideoDealsResponse),
          refreshing: false,
        });
        toast.success(kind === "link" ? "Deal linked to this video" : "Deal unlinked");
        onChanged?.();
        return true;
      } catch {
        if (currentVideo.current === video) toast.error(mutationErrorMessage(0, null));
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [youtubeVideoId, onChanged],
  );

  return (
    <>
      <BrandDealsContent
        state={state}
        pendingId={pendingId}
        onRetry={() => setRetryNonce((n) => n + 1)}
        onOpenLink={() => setDialogOpen(true)}
        onUnlink={(dealId) => void mutate("unlink", dealId)}
      />
      {state.status === "ready" && state.view.canLink && (
        <LinkDealDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          linkedIds={state.view.linkedIds}
          pendingId={pendingId}
          onLink={async (dealId) => {
            if (await mutate("link", dealId)) setDialogOpen(false);
          }}
        />
      )}
    </>
  );
}

type DealListState =
  { status: "loading" } | { status: "error" } | { status: "ready"; deals: LinkableDeal[] };

/** Pick one of the workspace's existing deals to link. Lists names and stages only. */
function LinkDealDialog({
  open,
  onOpenChange,
  linkedIds,
  pendingId,
  onLink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedIds: string[];
  pendingId: string | null;
  onLink: (dealId: string) => void;
}) {
  const [list, setList] = useState<DealListState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const linkedKey = linkedIds.join(",");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setList({ status: "loading" });
    fetch("/api/deals", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: Array<{ id: string; name: string; stage: string }>;
        };
        if (!response.ok || !Array.isArray(body.data)) throw new Error();
        setList({ status: "ready", deals: linkableDeals(body.data, linkedKey.split(",")) });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setList({ status: "error" });
      });
    return () => controller.abort();
  }, [open, reload, linkedKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link a brand deal</DialogTitle>
          <DialogDescription>
            Its agreed value will be split equally across every video it is linked to.
          </DialogDescription>
        </DialogHeader>

        {list.status === "loading" && (
          <div role="status" aria-label="Loading deals" aria-busy="true" className="space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        )}

        {list.status === "error" && (
          <ErrorState
            title="We couldn't load your deals"
            description="Please try again."
            onRetry={() => setReload((n) => n + 1)}
          />
        )}

        {list.status === "ready" && list.deals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Every deal in this workspace is already linked to this video, or there are no deals yet.{" "}
            <Link to="/brand-deals" className="font-medium text-primary hover:underline">
              Open Brand Deals
            </Link>
          </p>
        )}

        {list.status === "ready" && list.deals.length > 0 && (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {list.deals.map((deal) => (
              <li key={deal.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{deal.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {deal.contracted ? deal.stageLabel : `Pipeline · ${deal.stageLabel}`}
                  </p>
                </div>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => onLink(deal.id)}
                  disabled={pendingId !== null}
                  aria-label={`Link ${deal.name} to this video`}
                >
                  {pendingId === deal.id ? "Linking…" : "Link"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
