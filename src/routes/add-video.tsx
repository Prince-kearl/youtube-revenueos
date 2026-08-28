import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  Link2,
  Loader2,
  Play,
  Save,
  Sparkles,
  Trash2,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";

export const Route = createFileRoute("/add-video")({
  component: AddVideo,
});

type Destination = {
  id: string;
  name: string;
  type: string;
  url: string;
  description: string | null;
  status: "active" | "archived";
};

type YoutubeVideo = {
  id: string;
  channelId: string | null;
  title: string;
  description: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  privacyStatus: string | null;
  url: string;
  views: number;
  likes: number | null;
  comments: number | null;
};

type SavedVideo = {
  id: string;
  channel_id: string;
  youtube_video_id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  status: string;
};

type AnalyzeVideoResponse =
  | {
      data: {
        channel: { id: string; youtubeChannelId: string; title: string; handle: string | null };
        video: YoutubeVideo;
        ownership: "connected" | "external";
        analyticsAccess: "private" | "public_only";
        savedVideo: SavedVideo | null;
        transcript: { id: string; transcript: string; source: string; language: string } | null;
      };
    }
  | { error: string };

type MutationResponse =
  | {
      status: "connected";
      data: { video: YoutubeVideo; savedVideo: SavedVideo; transcript: unknown };
    }
  | { error: string };

type DestinationResponse = { data?: Destination[]; error?: string };

const steps = [
  { icon: Youtube, label: "Analyze video" },
  { icon: FileText, label: "Add transcript" },
  { icon: Sparkles, label: "Edit description" },
  { icon: Save, label: "Save to Tubify" },
];

function parseYoutubeVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(hostname)) return null;

    const id =
      hostname === "youtu.be"
        ? url.pathname.split("/").filter(Boolean)[0]
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.startsWith("/shorts/")
            ? url.pathname.split("/").filter(Boolean)[1]
            : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        date,
      );
}

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "That doesn’t look like a YouTube video link. Check the link and try again.",
    YOUTUBE_VIDEO_NOT_FOUND:
      "We couldn’t find that video. Check the link or make sure the video hasn’t been removed.",
    YOUTUBE_VIDEO_CHANNEL_MISMATCH:
      "That video belongs to a different YouTube channel. Switch channels or choose one of your own videos.",
    YOUTUBE_VIDEO_NOT_PUBLIC:
      "This video isn’t public yet. Make it public on YouTube before adding it here.",
    CHANNEL_NOT_FOUND:
      "We couldn’t find the selected YouTube channel. Choose another channel and try again.",
    DATABASE_ERROR: "We couldn’t save your changes. Please try again.",
    SERVER_ERROR: "Something went wrong. Please try again in a moment.",
    YOUTUBE_DATA_UNAVAILABLE: "YouTube isn’t responding right now. Please try again in a moment.",
    AI_PROVIDER_NOT_CONFIGURED:
      "AI writing isn’t available yet. You can still write and save the description yourself.",
    AI_PROVIDER_FAILED:
      "We couldn’t write the description right now. Your current text is safe—please try again.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function AddVideo() {
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<YoutubeVideo | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(activeChannelId);
  const [savedVideoId, setSavedVideoId] = useState<string | null>(null);
  const [isConnectedChannelVideo, setIsConnectedChannelVideo] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [description, setDescription] = useState("");
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationsError, setDestinationsError] = useState<string | null>(null);
  const [selectedDestinationIds, setSelectedDestinationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<"idle" | "loaded" | "not_connected" | "error" | "reauth">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<
    "load" | "generate" | "save" | "update" | "remove"
  >("load");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSelectedChannelId(activeChannelId);
    setVideo(null);
    setSavedVideoId(null);
    setIsConnectedChannelVideo(false);
    setTranscript("");
    setDescription("");
    setStatus("idle");
    setError(null);
    setErrorAction("load");
  }, [activeChannelId]);

  useEffect(() => {
    const controller = new AbortController();
    setDestinationsError(null);
    fetch("/api/destinations?status=active", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as DestinationResponse;
        if (!response.ok) throw new Error(body.error ?? "DESTINATIONS_UNAVAILABLE");
        setDestinations(body.data ?? []);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setDestinations([]);
          setDestinationsError(
            "We couldn’t load your saved destinations. You can try again later.",
          );
        }
      });
    return () => controller.abort();
  }, []);

  const selectedDestinations = useMemo(
    () => destinations.filter((destination) => selectedDestinationIds.includes(destination.id)),
    [destinations, selectedDestinationIds],
  );

  const loadVideo = async () => {
    setVideo(null);
    setSavedVideoId(null);
    setIsConnectedChannelVideo(false);
    setTranscript("");
    setDescription("");
    setStatus("idle");
    setError(null);
    const youtubeVideoId = parseYoutubeVideoId(url);
    if (!youtubeVideoId) {
      setError(errorMessage("VALIDATION_ERROR"));
      setErrorAction("load");
      setStatus("error");
      return;
    }
    setLoading(true);
    setError(null);
    setErrorAction("load");
    try {
      const params = new URLSearchParams({ videoId: youtubeVideoId });
      if (activeChannelId) params.set("channelId", activeChannelId);
      const response = await fetch(`/api/youtube/analyze-video?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as AnalyzeVideoResponse;
      if (response.status === 401 && "error" in body && body.error === "YOUTUBE_REAUTH_REQUIRED") {
        setStatus("reauth");
        return;
      }
      if (!response.ok || !("data" in body)) {
        const code = "error" in body ? body.error : "SERVER_ERROR";
        throw new Error(code);
      }
      setVideo(body.data.video);
      setSelectedChannelId(body.data.channel.id);
      setIsConnectedChannelVideo(body.data.ownership === "connected");
      setSavedVideoId(body.data.savedVideo?.id ?? null);
      setTranscript(body.data.transcript?.transcript ?? "");
      setDescription(body.data.savedVideo?.description ?? body.data.video.description ?? "");
      setStatus("loaded");
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "SERVER_ERROR";
      setError(errorMessage(code));
      setStatus(code === "YOUTUBE_REAUTH_REQUIRED" ? "reauth" : "error");
    } finally {
      setLoading(false);
    }
  };

  const generateDescription = async () => {
    if (!video || !selectedChannelId) return;
    setGenerating(true);
    setError(null);
    setErrorAction("generate");
    try {
      const response = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannelId,
          title: video.title,
          currentDescription: description || video.description,
          transcript: transcript || null,
          destinations: selectedDestinations.map((destination) => ({
            name: destination.name,
            url: destination.url,
          })),
        }),
      });
      const body = (await response.json()) as { data?: { description?: string }; error?: string };
      if (!response.ok || !body.data?.description) {
        throw new Error(body.error ?? "AI_PROVIDER_FAILED");
      }
      setDescription(body.data.description);
      toast.success("Description generated");
    } catch (reason: unknown) {
      setError(errorMessage(reason instanceof Error ? reason.message : "AI_PROVIDER_FAILED"));
    } finally {
      setGenerating(false);
    }
  };

  const saveVideo = async () => {
    if (!video) return;
    setSaving(true);
    setError(null);
    setErrorAction("save");
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannelId ?? activeChannelId ?? undefined,
          youtubeVideoId: video.id,
          description: description || null,
          transcript: transcript || null,
        }),
      });
      const body = (await response.json()) as MutationResponse;
      if (response.status === 401 && "error" in body && body.error === "YOUTUBE_REAUTH_REQUIRED") {
        setStatus("reauth");
        return;
      }
      if (!response.ok || !("data" in body)) {
        throw new Error("error" in body ? body.error : "SERVER_ERROR");
      }
      setSavedVideoId(body.data.savedVideo.id);
      toast.success("Video saved to Tubify");
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "SERVER_ERROR";
      setError(errorMessage(code));
      setStatus(code === "YOUTUBE_REAUTH_REQUIRED" ? "reauth" : "error");
    } finally {
      setSaving(false);
    }
  };

  const updateVideo = async () => {
    if (!savedVideoId) return;
    setSaving(true);
    setError(null);
    setErrorAction("update");
    try {
      const response = await fetch(`/api/videos?id=${encodeURIComponent(savedVideoId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description || null, transcript: transcript || null }),
      });
      const body = (await response.json()) as MutationResponse;
      if (!response.ok || !("data" in body)) {
        throw new Error("error" in body ? body.error : "SERVER_ERROR");
      }
      toast.success("Video changes saved");
    } catch (reason: unknown) {
      setError(errorMessage(reason instanceof Error ? reason.message : "SERVER_ERROR"));
    } finally {
      setSaving(false);
    }
  };

  const removeVideo = async () => {
    if (
      !savedVideoId ||
      !window.confirm("Remove this video from Tubify? YouTube will not be changed.")
    )
      return;
    setSaving(true);
    setError(null);
    setErrorAction("remove");
    try {
      const response = await fetch(`/api/videos?id=${encodeURIComponent(savedVideoId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "SERVER_ERROR");
      }
      setSavedVideoId(null);
      toast.success("Video removed from Tubify");
    } catch (reason: unknown) {
      setError(errorMessage(reason instanceof Error ? reason.message : "SERVER_ERROR"));
    } finally {
      setSaving(false);
    }
  };

  const injectDestinations = () => {
    if (!selectedDestinations.length) return;
    const lines = selectedDestinations
      .map((destination) => `\n${destination.name}: ${destination.url}`)
      .join("");
    setDescription((current) =>
      current.includes(selectedDestinations[0]?.url ?? "") ? current : `${current}${lines}`.trim(),
    );
  };

  const copyDescription = async () => {
    if (!description) return;
    await navigator.clipboard?.writeText(description);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const retryError = () => {
    if (errorAction === "load") void loadVideo();
    else if (errorAction === "generate") void generateDescription();
    else if (errorAction === "save") void saveVideo();
    else if (errorAction === "update") void updateVideo();
    else void removeVideo();
  };

  const errorTitle = {
    load: "We couldn’t load this video",
    generate: "We couldn’t write the description",
    save: "We couldn’t save this video",
    update: "We couldn’t save your changes",
    remove: "We couldn’t remove this video",
  }[errorAction];

  const loaded = status === "loaded";
  return (
    <DashboardLayout title="Analyze Video">
      <Link
        to="/videos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Videos
      </Link>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analyze a YouTube Video</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a YouTube link to review its public details and use Tubify&apos;s creator tools.
        </p>
      </div>

      <div className="relative mt-6 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <label htmlFor="youtube-video-url" className="text-sm font-medium">
          YouTube video URL
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Youtube className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-red" />
            <input
              id="youtube-video-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => void loadVideo()}
            disabled={loading}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? "Analyzing…" : "Analyze video"}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const done =
              index === 0
                ? loaded
                : index === 1
                  ? Boolean(transcript)
                  : index === 2
                    ? Boolean(description)
                    : Boolean(savedVideoId);
            return (
              <div
                key={step.label}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${done ? "border-success/40 bg-success/10 text-success" : "border-border bg-background text-muted-foreground"}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {index + 1}. {step.label}
                </span>
                {done && <Check className="ml-auto h-3.5 w-3.5" />}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Your connected channel is used to verify ownership and request private analytics. Public
          videos from other channels can be reviewed here, but their private analytics are not
          available. Tubify never publishes changes back to YouTube.
        </p>
      </div>

      {status === "not_connected" && (
        <MessageState
          title="Connect your YouTube channel"
          description="Connect a YouTube account in Settings before analyzing videos."
          action="Open Settings"
        />
      )}
      {status === "reauth" && (
        <div className="mt-5">
          <YoutubeReauthNotice onRetry={() => void loadVideo()} />
        </div>
      )}
      {status === "error" && (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <p className="font-semibold">{errorTitle}</p>
          <p className="mt-1">{error}</p>
          <button
            type="button"
            onClick={retryError}
            className="mt-3 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10"
          >
            Try again
          </button>
        </div>
      )}
      {error && status !== "error" && status !== "reauth" && (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      )}

      {video && (
        <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center">
          {video.thumbnail ? (
            <img
              src={video.thumbnail}
              alt=""
              className="aspect-video w-full rounded-lg object-cover sm:h-24 sm:w-40"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-accent sm:h-24 sm:w-40">
              <Play className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{video.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDate(video.publishedAt)}
              {video.duration ? ` · ${video.duration}` : ""} ·{" "}
              {video.privacyStatus === "public" ? "Public" : "Status unavailable"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isConnectedChannelVideo
                ? "Your connected channel · private analytics available"
                : "Public video from another channel · public details only"}
            </p>
          </div>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Open on YouTube <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
      {video && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-3 text-center text-xs">
          <div>
            <p className="text-muted-foreground">Views</p>
            <p className="mt-1 font-semibold">
              {new Intl.NumberFormat("en", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(video.views)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Likes</p>
            <p className="mt-1 font-semibold">
              {video.likes === null
                ? "Unavailable"
                : new Intl.NumberFormat("en", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(video.likes)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Comments</p>
            <p className="mt-1 font-semibold">
              {video.comments === null
                ? "Unavailable"
                : new Intl.NumberFormat("en", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(video.comments)}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h2 className="text-lg font-semibold">Transcript</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste a transcript if you want to keep it with this video. YouTube caption downloads are
            not requested.
          </p>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            disabled={!loaded}
            rows={12}
            placeholder={loaded ? "Paste your transcript here..." : "Load a video first..."}
            className="mt-4 w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {transcript.length.toLocaleString()} characters · stored as a manual transcript
          </p>
        </div>

        <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5 text-brand-purple" /> Description
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void generateDescription()}
                disabled={!loaded || generating || !selectedChannelId}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-brand-purple/30 px-3 text-sm text-brand-purple hover:bg-brand-purple/10 disabled:opacity-50"
              >
                <Sparkles className={`h-3.5 w-3.5 ${generating ? "animate-pulse" : ""}`} />
                {generating ? "Generating…" : "Generate with AI"}
              </button>
              <button
                type="button"
                onClick={() => void copyDescription()}
                disabled={!description}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              {isConnectedChannelVideo && savedVideoId ? (
                <button
                  type="button"
                  onClick={() => void updateVideo()}
                  disabled={saving}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Update"}
                </button>
              ) : isConnectedChannelVideo ? (
                <button
                  type="button"
                  onClick={() => void saveVideo()}
                  disabled={!loaded || saving}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save video"}
                </button>
              ) : null}
              {isConnectedChannelVideo && savedVideoId && (
                <button
                  type="button"
                  onClick={() => void removeVideo()}
                  disabled={saving}
                  aria-label="Remove video from Tubify"
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-destructive/30 px-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
          </div>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!loaded}
            rows={16}
            placeholder={
              loaded
                ? "Edit the YouTube description here..."
                : "Load a video to edit its description..."
            }
            className="mt-4 w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {video?.duration ?? "Duration unavailable"}
            </span>
            <span className="flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" /> Manual editing
            </span>
            <span className="flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> {selectedDestinations.length} destinations selected
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            <span>
              {isConnectedChannelVideo
                ? "Save changes to keep this description and transcript in Tubify."
                : "This public video can be analyzed, but private analytics and saving to Tubify are available only for your connected channel."}
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
          </div>
        </div>
      </div>

      <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Destinations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Load your real active destinations and optionally insert their URLs into the
              description. Link tracking is managed separately in Link Tracking.
            </p>
          </div>
          <Link to="/destinations" className="text-sm font-medium text-primary hover:underline">
            Manage destinations
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {destinations.map((destination) => {
            const selected = selectedDestinationIds.includes(destination.id);
            return (
              <button
                type="button"
                key={destination.id}
                onClick={() =>
                  setSelectedDestinationIds((current) =>
                    selected
                      ? current.filter((id) => id !== destination.id)
                      : [...current, destination.id],
                  )
                }
                disabled={!loaded}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                >
                  {selected && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{destination.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {destination.url}
                  </span>
                </span>
              </button>
            );
          })}
          {destinationsError ? (
            <p className="text-sm text-destructive">{destinationsError}</p>
          ) : (
            !destinations.length && (
              <p className="text-sm text-muted-foreground">
                No active destinations found. Create one in Destinations first.
              </p>
            )
          )}
        </div>
        <button
          type="button"
          onClick={injectDestinations}
          disabled={!loaded || !selectedDestinations.length}
          className="mt-4 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Insert selected destination URLs
        </button>
      </div>
    </DashboardLayout>
  );
}

function MessageState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: string;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Link
        to="/settings"
        className="rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {action}
      </Link>
    </div>
  );
}
