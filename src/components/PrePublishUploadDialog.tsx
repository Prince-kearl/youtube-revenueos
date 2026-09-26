import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Film, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useLocalStore } from "@/lib/local-store";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { cn } from "@/lib/utils";

const ALLOWED_EXTENSIONS = ["mp4", "mov", "webm", "m4v"];
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // matches MAX_PRE_PUBLISH_VIDEO_BYTES in api.pre-publish-videos.ts

const TONE_OPTIONS = [
  "Professional",
  "Educational",
  "Entertaining",
  "Conversational",
  "Storytelling",
  "Technical",
];
const GOAL_OPTIONS = [
  "Get views",
  "Generate subscribers",
  "Drive comments",
  "Promote a product",
  "Generate leads",
  "Educate",
  "Build authority",
];

type Stage = "idle" | "creating" | "uploading" | "analyzing" | "error";

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Reads real duration/dimensions from the file itself via a throwaway <video> element — the only
// "video metadata extraction" this feature does client-side, and enough to validate AI-generated
// chapter timestamps against the real duration server-side. Never blocks indefinitely: an unusual
// container some browsers can't probe falls back to nulls after a short timeout rather than
// hanging the upload flow.
function readVideoMetadata(
  file: File,
): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (result: {
      durationSeconds: number | null;
      width: number | null;
      height: number | null;
    }) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadedmetadata = () => {
      finish({
        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    };
    video.onerror = () => finish({ durationSeconds: null, width: null, height: null });
    window.setTimeout(() => finish({ durationSeconds: null, width: null, height: null }), 8000);
    video.src = url;
  });
}

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    UNSUPPORTED_FILE_TYPE: "That file type isn't supported. Upload an MP4, MOV, WebM, or M4V file.",
    VALIDATION_ERROR: "That file couldn't be validated. Try a different file.",
    CHANNEL_NOT_FOUND: "That channel is no longer available. Choose another and try again.",
    UPLOAD_URL_FAILED: "We couldn't start the upload. Please try again.",
    UPLOAD_FAILED: "The upload didn't complete. Please try again.",
    UPLOAD_NOT_FOUND: "We couldn't confirm the upload finished. Please try again.",
    AI_PROVIDER_NOT_CONFIGURED: "AI analysis isn't available right now. Please try again later.",
    AI_PROVIDER_FAILED: "We couldn't complete the analysis right now. Please try again.",
    AI_PROVIDER_RATE_LIMITED:
      "AI analysis is getting a lot of requests right now. Try again shortly.",
    RATE_LIMIT_EXCEEDED: "You've reached your AI analysis limit for now. Please try again shortly.",
    AI_ANALYSIS_FAILED: "We couldn't analyze this video. Please try again.",
    DATABASE_ERROR: "We couldn't save your changes. Please try again.",
  };
  return messages[error] ?? "Something went wrong. Please try again.";
}

export function PrePublishUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [goal, setGoal] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setFileError(null);
    setTopic("");
    setAudience("");
    setTone("");
    setGoal("");
    setStage("idle");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && (stage === "creating" || stage === "uploading" || stage === "analyzing")) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const validateAndSetFile = (candidate: File) => {
    setFileError(null);
    const extension = extensionOf(candidate.name);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setFileError("Upload an MP4, MOV, WebM, or M4V file.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setFileError(`That file is too large. Maximum size is ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setFile(candidate);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) validateAndSetFile(dropped);
  };

  const startAnalysis = async () => {
    if (!file) return;
    setError(null);
    setStage("creating");
    try {
      const metadata = await readVideoMetadata(file);

      const createResponse = await fetch("/api/pre-publish-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          durationSeconds: metadata.durationSeconds,
          width: metadata.width,
          height: metadata.height,
          channelId: activeChannelId || null,
        }),
      });
      const createBody = (await createResponse.json()) as {
        data?: { id: string; path: string; uploadUrl: string; uploadToken: string };
        error?: string;
      };
      if (!createResponse.ok || !createBody.data) {
        throw new Error(createBody.error ?? "VALIDATION_ERROR");
      }
      const { id, path, uploadToken } = createBody.data;

      setStage("uploading");
      const supabase = getSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("workspace-files")
        .uploadToSignedUrl(path, uploadToken, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (uploadError) throw new Error("UPLOAD_FAILED");

      await fetch(`/api/pre-publish-videos?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim() || null,
          audience: audience.trim() || null,
          tone: tone || null,
          goal: goal || null,
        }),
      });

      setStage("analyzing");
      const analyzeResponse = await fetch("/api/pre-publish-videos/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const analyzeBody = (await analyzeResponse.json()) as { data?: unknown; error?: string };
      if (!analyzeResponse.ok || !analyzeBody.data) {
        throw new Error(analyzeBody.error ?? "AI_ANALYSIS_FAILED");
      }

      toast.success("Analysis complete");
      reset();
      onOpenChange(false);
      void navigate({ to: "/pre-publish/$id", params: { id } });
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "AI_ANALYSIS_FAILED";
      setError(errorMessage(code));
      setStage("error");
    }
  };

  const busy = stage === "creating" || stage === "uploading" || stage === "analyzing";
  const stageLabel = {
    creating: "Preparing upload…",
    uploading: "Uploading video… this can take a few minutes for larger files",
    analyzing: "Analyzing your video…",
  }[stage as "creating" | "uploading" | "analyzing"];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Analyze before publishing</DialogTitle>
          <DialogDescription>
            Upload a finished video and get AI-powered title, description, tags, chapters, and CTA
            ideas before you publish it to YouTube.
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">{stageLabel}</p>
            <p className="text-xs text-muted-foreground">Don&apos;t close this window.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {!file ? (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">Drag &amp; drop your video here</p>
                <p className="text-xs text-muted-foreground">or click to browse files</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  MP4, MOV, WebM, M4V · up to {formatBytes(MAX_BYTES)}
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
                  className="hidden"
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    event.target.value = "";
                    if (selected) validateAndSetFile(selected);
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-accent/20 p-3">
                <Film className="h-8 w-8 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label="Remove file"
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {fileError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {fileError}
              </p>
            )}

            {file && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  Optional context (helps the AI, not required)
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      What is this video about?
                    </span>
                    <input
                      value={topic}
                      onChange={(event) => setTopic(event.target.value)}
                      placeholder="e.g. Editing workflow for YouTube"
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Who is this video for?
                    </span>
                    <input
                      value={audience}
                      onChange={(event) => setAudience(event.target.value)}
                      placeholder="e.g. New creators"
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Desired tone
                    </span>
                    <select
                      value={tone}
                      onChange={(event) => setTone(event.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">Not specified</option>
                      {TONE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Primary goal
                    </span>
                    <select
                      value={goal}
                      onChange={(event) => setGoal(event.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">Not specified</option>
                      {GOAL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {error && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void startAnalysis()}
              disabled={!file}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Analyze video
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
