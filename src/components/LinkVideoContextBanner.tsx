import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Circle, Plus } from "lucide-react";
import {
  CONTEXT_CREATED,
  CONTEXT_UNAVAILABLE,
  type LinkVideoContext,
} from "@/lib/link-tracking-context";
import { linkContextProgress } from "@/lib/revenue-actions";
import type { VideoRevenueRange } from "@/lib/video-revenue-overview";

// The top of the Link Tracking page when it was opened from a video (Phase 2D-1): which video the
// links are for, a way back to it, and — after a link was created for it — where that link now
// shows. Rendering only. The video is the one the server confirmed for the current workspace; an
// id it did not confirm gets the "not available" line and nothing about the video.
//
// Phase 3B-1: whether "add a tracked link" is done for the video, from the links the server listed
// for it (persisted data — the same links the video's suggestions count), and the clicks recorded
// on them as activity, never income. Opening or closing the creation dialog changes nothing here.

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
  links,
  range,
}: {
  context: VideoContextState;
  justCreated: boolean;
  onCreate: () => void;
  /** The video's links as the server listed them (and as saved since); null while not known. */
  links?: ReadonlyArray<{ clicks: number }> | null;
  /** The period the video was being looked at over: "Back to video" returns to it. */
  range?: VideoRevenueRange;
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
                search={range ? { range } : {}}
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
          {links && <LinkProgress links={links} />}
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

function LinkProgress({ links }: { links: ReadonlyArray<{ clicks: number }> }) {
  const progress = linkContextProgress(links);
  return (
    <div
      className="mt-3 flex items-start gap-2 text-sm"
      data-testid="link-context-progress"
      data-state={progress.completed ? "completed" : "available"}
    >
      {progress.completed ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <p>
        <span className="font-medium">{progress.text}</span>
        {progress.activity && (
          <span className="text-muted-foreground" data-testid="link-context-activity">
            {" "}
            {progress.activity}
          </span>
        )}
      </p>
    </div>
  );
}
