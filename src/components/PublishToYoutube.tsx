import { useEffect, useRef, useState } from "react";
import { Loader2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buttonPrimary } from "@/lib/button-styles";
import { cn } from "@/lib/utils";
import {
  DESCRIPTION_PROBLEM_TEXT,
  descriptionProblem,
  publishErrorMessage,
  videoVisibility,
} from "@/lib/youtube-description";

// "Publish to YouTube" and "Undo publish" for one loaded video, used by the AI Description Lab and
// Analyze Video. The server (api.youtube.video-description.ts) decides who may publish and checks
// everything again; this only shows the buttons to people it says may use them.
//
// Mount it with key={video.id}: everything here (what YouTube holds, whether undo is available)
// belongs to that one video and starts over for the next.

type StatusResponse = { data: { canPublish: boolean; undoAvailable: boolean } } | { error: string };
type PublishResponse =
  | {
      data: {
        status: "published" | "restored" | "unchanged";
        description: string;
        undoAvailable: boolean;
      };
    }
  | { error: string };

export function PublishToYoutube({
  channelId,
  video,
  youtubeDescription: initialYoutubeDescription,
  description,
  onRestored,
  buttonClassName,
}: {
  channelId: string;
  video: {
    id: string;
    title: string;
    privacyStatus: string | null;
    uploadStatus?: string | null;
    publishAt?: string | null;
  };
  /** What YouTube held when the video was loaded. */
  youtubeDescription: string;
  /** The text in the editor, to publish. */
  description: string;
  /** After an undo: the description now back on YouTube, for the editor. */
  onRestored: (description: string) => void;
  /** Extra classes for the secondary (Undo) button, to match the page's other buttons. */
  buttonClassName?: string;
}) {
  // What YouTube holds now, as far as this page knows. The server refuses to overwrite anything
  // else, so an edit made in YouTube Studio meanwhile is never lost.
  const [youtubeDescription, setYoutubeDescription] = useState(initialYoutubeDescription);
  const [canPublish, setCanPublish] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<"publish" | "undo" | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ channelId, videoId: video.id });
    fetch(`/api/youtube/video-description?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as StatusResponse;
        if (!response.ok || !("data" in body)) return;
        setCanPublish(body.data.canPublish);
        setUndoAvailable(body.data.undoAvailable);
      })
      .catch(() => {
        // a failure only hides the buttons
      });
    return () => controller.abort();
  }, [channelId, video.id]);

  // `expected` is passed explicitly so a toast's Undo, clicked later, still sends what was published.
  const send = async (action: "publish" | "undo", expected: string) => {
    setBusy(action);
    try {
      const response = await fetch("/api/youtube/video-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          channelId,
          videoId: video.id,
          expectedDescription: expected,
          ...(action === "publish" ? { description } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as PublishResponse;
      if (!response.ok || !("data" in body))
        throw new Error("error" in body ? body.error : "SERVER_ERROR");
      const now = body.data.description;
      // Still on screen (another video may have been opened since a toast's Undo was shown).
      if (mounted.current) {
        setYoutubeDescription(now);
        setUndoAvailable(body.data.undoAvailable);
        setDialogOpen(false);
      }
      if (action === "undo") {
        if (mounted.current) onRestored(now);
        toast.success("The previous description is back on YouTube.");
      } else if (body.data.status === "unchanged") {
        toast.success("YouTube already has this description.");
      } else {
        toast.success("Description published to YouTube.", {
          action: { label: "Undo", onClick: () => void send("undo", now) },
        });
      }
    } catch (reason: unknown) {
      toast.error(publishErrorMessage(reason instanceof Error ? reason.message : undefined));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  if (!canPublish) return null;

  const problem = descriptionProblem(description);
  const sameAsYoutube = description.replace(/\r\n?/g, "\n") === youtubeDescription;

  return (
    <>
      {undoAvailable && (
        <button
          type="button"
          onClick={() => void send("undo", youtubeDescription)}
          disabled={busy !== null}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--button-radius)] bg-accent px-3 text-sm hover:text-foreground disabled:opacity-50",
            buttonClassName,
          )}
          title="Put back the description YouTube had before your last publish"
        >
          {busy === "undo" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Undo2 className="h-3.5 w-3.5" />
          )}
          Undo publish
        </button>
      )}
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={busy !== null || Boolean(problem) || sameAsYoutube}
        className={cn(buttonPrimary, "h-8 shrink-0 whitespace-nowrap px-3 disabled:opacity-50")}
        title={
          problem
            ? DESCRIPTION_PROBLEM_TEXT[problem]
            : sameAsYoutube
              ? "YouTube already has this description"
              : "Replace this video's description on YouTube"
        }
      >
        <Upload className="h-3.5 w-3.5" /> Publish to YouTube
      </button>

      <Dialog open={dialogOpen} onOpenChange={(open) => busy === null && setDialogOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" /> Publish to YouTube?
            </DialogTitle>
            <DialogDescription>
              This replaces the description of “{video.title}” on YouTube
              {videoVisibility(video) === "public" ? ", where viewers see it right away" : ""}. The
              title, tags and everything else stay as they are. You can undo it from here
              afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Now on YouTube</p>
              <div className="h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-accent/20 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {youtubeDescription.trim() ? youtubeDescription : "No description"}
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-foreground">New description</p>
              <div className="h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-primary/40 bg-background p-3 font-mono text-xs leading-relaxed">
                {description}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              disabled={busy !== null}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={busy !== null}
              onClick={() => void send("publish", youtubeDescription)}
            >
              {busy === "publish" ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Under the editor: why YouTube would refuse this description, if it would. */
export function DescriptionProblemNote({ description }: { description: string }) {
  const problem = description ? descriptionProblem(description) : null;
  if (!problem) return null;
  return <p className="w-full text-xs text-destructive">{DESCRIPTION_PROBLEM_TEXT[problem]}</p>;
}
