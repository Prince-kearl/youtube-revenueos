import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Plus } from "lucide-react";
import {
  CONTEXT_CREATED,
  CONTEXT_UNAVAILABLE,
  type LinkVideoContext,
} from "@/lib/link-tracking-context";

// The top of the Link Tracking page when it was opened from a video (Phase 2D-1): which video the
// links are for, a way back to it, and — after a link was created for it — where that link now
// shows. Rendering only. The video is the one the server confirmed for the current workspace; an
// id it did not confirm gets the "not available" line and nothing about the video.

export type VideoContextState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "valid"; video: LinkVideoContext }
  | { status: "unavailable" };

const PILL =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium hover:bg-accent";

export function LinkVideoContextBanner({
  context,
  justCreated,
  onCreate,
}: {
  context: VideoContextState;
  justCreated: boolean;
  onCreate: () => void;
}) {
  if (context.status === "none") return null;
  return (
    <div
      className="mt-4 rounded-xl border border-border bg-card p-4"
      data-testid="link-context"
      data-status={context.status}
    >
      {context.status === "loading" && (
        <p className="text-sm text-muted-foreground" role="status">
          Checking the video…
        </p>
      )}
      {context.status === "unavailable" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{CONTEXT_UNAVAILABLE}</p>
          <Link
            to="/link-tracking"
            search={{}}
            className="text-sm font-medium text-primary hover:underline"
          >
            Show all links
          </Link>
        </div>
      )}
      {context.status === "valid" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                Tracked links for this video
              </p>
              <p className="truncate text-sm font-semibold" data-testid="link-context-title">
                {context.video.title}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/videos/$videoId"
                params={{ videoId: context.video.youtubeVideoId }}
                className={PILL}
                data-testid="link-context-back"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to video
              </Link>
              <button type="button" onClick={onCreate} className={PILL}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Link for this video
              </button>
              <Link
                to="/link-tracking"
                search={{}}
                className="px-1 text-sm font-medium text-primary hover:underline"
              >
                Show all links
              </Link>
            </div>
          </div>
          {justCreated && (
            <p
              className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-foreground"
              role="status"
              data-testid="link-context-created"
            >
              <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-success" aria-hidden="true" />
              {CONTEXT_CREATED}
            </p>
          )}
        </>
      )}
    </div>
  );
}
