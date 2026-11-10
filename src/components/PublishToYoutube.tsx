import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  descriptionProblem,
  publishErrorMessage,
  PUBLISH_PROBLEM_TEXT,
  videoVisibility,
} from "@/lib/youtube-description";

// Publishing a video's title, description and tags to YouTube from the AI Description Lab and
// Analyze Video (chapters and calls to action go in as part of the description). The server
// (api.youtube.video-details.ts) decides who may publish and checks everything again; the page
// only shows the buttons to people it says may use them.
//
// One publisher per loaded video: it knows what YouTube holds now (the server refuses to
// overwrite anything else, so an edit made in YouTube Studio meanwhile is never lost), whether
// the last publish can be undone, and owns the one confirmation dialog.

export type YoutubeDetails = { title: string; description: string; tags: string[] };
export type DetailChanges = Partial<YoutubeDetails>;

type StatusResponse = { data: { canPublish: boolean; undoAvailable: boolean } } | { error: string };
type PublishResponse =
  | {
      data: {
        status: "published" | "restored" | "unchanged";
        current: YoutubeDetails;
        undoAvailable: boolean;
      };
    }
  | { error: string };

type PublishVideo = {
  id: string;
  title: string;
  privacyStatus: string | null;
  uploadStatus?: string | null;
  publishAt?: string | null;
};

export type YoutubePublisher = ReturnType<typeof useYoutubePublisher>;

export function useYoutubePublisher({
  channelId,
  video,
  initial,
  onRestored,
  onChanged,
}: {
  channelId: string | null;
  video: PublishVideo | null;
  /** What YouTube held when the video was loaded; null while nothing is loaded. */
  initial: YoutubeDetails | null;
  /** After an undo: what is back on YouTube, for the page's editors. */
  onRestored?: (current: YoutubeDetails) => void;
  /** After any publish or undo that changed YouTube. */
  onChanged?: () => void;
}) {
  const key = channelId && video && initial ? `${channelId}:${video.id}` : null;
  const [current, setCurrent] = useState<YoutubeDetails | null>(initial);
  const [canPublish, setCanPublish] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [busy, setBusy] = useState<"publish" | "undo" | null>(null);
  const [pending, setPending] = useState<{
    changes: DetailChanges;
    label: string;
    onDone?: (now: YoutubeDetails) => void;
  } | null>(null);
  const shownKey = useRef<string | null>(key);
  const restored = useRef(onRestored);
  restored.current = onRestored;
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // A new video (or channel) starts over.
  useEffect(() => {
    shownKey.current = key;
    setCurrent(initial);
    setCanPublish(false);
    setUndoAvailable(false);
    setPending(null);
    if (!key || !channelId || !video) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ channelId, videoId: video.id });
    fetch(`/api/youtube/video-details?${params.toString()}`, {
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
    // `initial` is read only when the video changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // `expected` is passed explicitly so a toast's Undo, clicked later, still sends what was
  // published, and `forKey` so its result is not applied to another video opened since.
  const send = useCallback(
    async (
      action: "publish" | "undo",
      target: {
        forKey: string;
        channelId: string;
        videoId: string;
        expected: YoutubeDetails;
        changes?: DetailChanges;
        onDone?: (now: YoutubeDetails) => void;
      },
    ) => {
      const onScreen = () => shownKey.current === target.forKey;
      setBusy(action);
      try {
        const response = await fetch("/api/youtube/video-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            channelId: target.channelId,
            videoId: target.videoId,
            expected: target.expected,
            ...(action === "publish" ? { changes: target.changes } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as PublishResponse;
        if (!response.ok || !("data" in body))
          throw new Error("error" in body ? body.error : "SERVER_ERROR");
        const now = body.data.current;
        if (onScreen()) {
          setCurrent(now);
          setUndoAvailable(body.data.undoAvailable);
          setPending(null);
        }
        if (onScreen() && body.data.status !== "unchanged") changed.current?.();
        if (action === "undo") {
          if (onScreen()) restored.current?.(now);
          toast.success("The previous version is back on YouTube.");
        } else if (body.data.status === "unchanged") {
          toast.success("YouTube already has this.");
        } else {
          if (onScreen()) target.onDone?.(now);
          toast.success("Published to YouTube.", {
            action: {
              label: "Undo",
              onClick: () =>
                void send("undo", {
                  ...target,
                  expected: now,
                  changes: undefined,
                  onDone: undefined,
                }),
            },
          });
        }
      } catch (reason: unknown) {
        toast.error(publishErrorMessage(reason instanceof Error ? reason.message : undefined));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const ready = Boolean(key && canPublish && current);

  /** Opens the confirmation for these changes; `label` names what is being published, and
   * `onDone` runs with what YouTube then holds once it is published. */
  const request = (
    changes: DetailChanges,
    label: string,
    onDone?: (now: YoutubeDetails) => void,
  ) => {
    if (ready) setPending({ changes, label, onDone });
  };

  const undo = () => {
    if (!key || !channelId || !video || !current) return;
    void send("undo", { forKey: key, channelId, videoId: video.id, expected: current });
  };

  const confirm = () => {
    if (!key || !channelId || !video || !current || !pending) return;
    void send("publish", {
      forKey: key,
      channelId,
      videoId: video.id,
      expected: current,
      changes: pending.changes,
      onDone: pending.onDone,
    });
  };

  const dialog =
    video && current ? (
      <PublishDialog
        open={pending !== null}
        onOpenChange={(open) => busy === null && !open && setPending(null)}
        video={video}
        label={pending?.label ?? ""}
        current={current}
        changes={pending?.changes ?? {}}
        busy={busy === "publish"}
        onConfirm={confirm}
      />
    ) : null;

  return { ready, current, undoAvailable, busy, request, undo, dialog };
}

/** True when publishing `changes` would change nothing on YouTube. */
export function sameAsYoutube(current: YoutubeDetails | null, changes: DetailChanges): boolean {
  if (!current) return false;
  return (
    (changes.title === undefined || changes.title.trim() === current.title) &&
    (changes.description === undefined ||
      changes.description.replace(/\r\n?/g, "\n") === current.description) &&
    (changes.tags === undefined ||
      (changes.tags.length === current.tags.length &&
        changes.tags.every((tag, i) => tag === current.tags[i])))
  );
}

/** "Publish to YouTube" for one set of changes. Disabled with a reason when YouTube would refuse
 * it, or when it would change nothing. Renders nothing for someone who may not publish. */
export function PublishButton({
  publisher,
  changes,
  label,
  problem,
  children,
  className,
  onDone,
}: {
  publisher: YoutubePublisher;
  changes: DetailChanges;
  /** Runs with what YouTube holds once this is published. */
  onDone?: (now: YoutubeDetails) => void;
  /** What is being published, for the confirmation ("title", "tags", "chapters"…). */
  label: string;
  /** A PUBLISH_PROBLEM_TEXT key when YouTube would refuse this, or null. */
  problem: keyof typeof PUBLISH_PROBLEM_TEXT | null;
  children?: ReactNode;
  className?: string;
}) {
  if (!publisher.ready) return null;
  const unchanged = sameAsYoutube(publisher.current, changes);
  return (
    <button
      type="button"
      onClick={() => publisher.request(changes, label, onDone)}
      disabled={publisher.busy !== null || Boolean(problem) || unchanged}
      className={cn(
        buttonPrimary,
        "h-8 shrink-0 whitespace-nowrap px-3 disabled:opacity-50",
        className,
      )}
      title={
        problem
          ? PUBLISH_PROBLEM_TEXT[problem]
          : unchanged
            ? "YouTube already has this"
            : `Publish the ${label} to YouTube`
      }
    >
      <Upload className="h-3.5 w-3.5" /> {children ?? "Publish to YouTube"}
    </button>
  );
}

export function UndoPublishButton({
  publisher,
  className,
}: {
  publisher: YoutubePublisher;
  className?: string;
}) {
  if (!publisher.ready || !publisher.undoAvailable) return null;
  return (
    <button
      type="button"
      onClick={publisher.undo}
      disabled={publisher.busy !== null}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--button-radius)] bg-accent px-3 text-sm hover:text-foreground disabled:opacity-50",
        className,
      )}
      title="Put back what YouTube had before your last publish"
    >
      {publisher.busy === "undo" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Undo2 className="h-3.5 w-3.5" />
      )}
      Undo publish
    </button>
  );
}

function PublishDialog({
  open,
  onOpenChange,
  video,
  label,
  current,
  changes,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: PublishVideo;
  label: string;
  current: YoutubeDetails;
  changes: DetailChanges;
  busy: boolean;
  onConfirm: () => void;
}) {
  const box = "rounded-[10px] border p-3 text-xs leading-relaxed break-words";
  const before = `${box} border-border bg-accent/20 text-muted-foreground`;
  const after = `${box} border-primary/40 bg-background`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" /> Publish the {label} to YouTube?
          </DialogTitle>
          <DialogDescription>
            This changes “{video.title}” on YouTube
            {videoVisibility(video) === "public" ? ", where viewers see it right away" : ""}.
            Everything not shown here stays as it is. You can undo it from here afterwards.
          </DialogDescription>
        </DialogHeader>

        {changes.title !== undefined && (
          <Compare
            name="Title"
            before={<div className={before}>{current.title}</div>}
            after={<div className={cn(after, "font-medium")}>{changes.title.trim()}</div>}
          />
        )}
        {changes.description !== undefined && (
          <Compare
            name="Description"
            before={
              <div className={cn(before, "h-56 overflow-y-auto whitespace-pre-wrap font-mono")}>
                {current.description.trim() ? current.description : "No description"}
              </div>
            }
            after={
              <div className={cn(after, "h-56 overflow-y-auto whitespace-pre-wrap font-mono")}>
                {changes.description}
              </div>
            }
          />
        )}
        {changes.tags !== undefined && (
          <Compare
            name="Tags"
            before={<TagList className={before} tags={current.tags} />}
            after={<TagList className={after} tags={changes.tags} />}
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-full"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" className="rounded-full" disabled={busy} onClick={onConfirm}>
            {busy ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Compare({ name, before, after }: { name: string; before: ReactNode; after: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{name} now on YouTube</p>
        {before}
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-foreground">New {name.toLowerCase()}</p>
        {after}
      </div>
    </div>
  );
}

function TagList({ tags, className }: { tags: string[]; className: string }) {
  return (
    <div className={cn(className, "flex min-h-12 flex-wrap gap-1.5")}>
      {tags.length ? (
        tags.map((tag) => (
          <span key={tag} className="rounded-full bg-accent px-2 py-0.5">
            {tag}
          </span>
        ))
      ) : (
        <span>No tags</span>
      )}
    </div>
  );
}

/** Under an editor: why YouTube would refuse this description, if it would. */
export function DescriptionProblemNote({ description }: { description: string }) {
  const problem = description ? descriptionProblem(description) : null;
  if (!problem) return null;
  return <p className="w-full text-xs text-destructive">{PUBLISH_PROBLEM_TEXT[problem]}</p>;
}
