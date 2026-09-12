import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  HelpCircle,
  Info,
  Lightbulb,
  Link2,
  Loader2,
  Lock,
  Play,
  Save,
  Search,
  Sparkles,
  Trash2,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import { goToNextOnboardingStep } from "@/lib/onboarding";

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

type ContentAnalysis = {
  mainTopic: string;
  contentType: string;
  audienceIntent: string;
  complexity: string;
  engagementPotential: string;
  summary: string;
  topics: string[];
  strengths: string[];
  opportunities: string[];
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
  content_analysis: ContentAnalysis | null;
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

type MyVideosResponse =
  | { status: "not_connected"; data: null }
  | {
      status: "connected";
      data: { videos: YoutubeVideo[]; videosStatus: "available" | "disabled" };
    }
  | { error: string };

type OptimizeTab = "description" | "titles" | "tags" | "chapters" | "cta";

const stepMeta = [
  { label: "Select video", desc: "Choose a video to analyze" },
  { label: "Analyze", desc: "AI analyzes content & transcript" },
  { label: "Optimize", desc: "Generate improvements & links" },
  { label: "Save", desc: "Save your analysis" },
];

const optimizeTabs: { key: OptimizeTab; label: string }[] = [
  { key: "description", label: "Description" },
  { key: "titles", label: "Title ideas" },
  { key: "tags", label: "Tags" },
  { key: "chapters", label: "Chapters" },
  { key: "cta", label: "Call-to-action ideas" },
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

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
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
      "We couldn’t complete that AI request right now. Your current text is safe—please try again.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function AddVideo() {
  const navigate = useNavigate();
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [pickerTab, setPickerTab] = useState<"mine" | "url">("mine");
  const [myVideos, setMyVideos] = useState<YoutubeVideo[]>([]);
  const [myVideosStatus, setMyVideosStatus] = useState<
    "idle" | "loading" | "loaded" | "error" | "not_connected"
  >("idle");
  // Distinguishes "video sync is turned off in Settings" (empty list, not an error) from
  // "genuinely no videos yet" — otherwise both render as an identical, unexplained empty state.
  const [myVideosSyncDisabled, setMyVideosSyncDisabled] = useState(false);
  // Bumped by the "Try again" button. Deliberately NOT using myVideosStatus itself to gate/retry
  // the fetch effect below — activeChannelId can change shortly after mount (e.g. once
  // useLocalStore finishes reading localStorage), which aborts an in-flight fetch; if the guard
  // were "only fetch while status is idle", that abort would leave status stuck on "loading"
  // forever, since nothing would ever set it back to idle to unblock a retry.
  const [myVideosRetryToken, setMyVideosRetryToken] = useState(0);
  const [videoSearch, setVideoSearch] = useState("");
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<YoutubeVideo | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(activeChannelId);
  const [savedVideoId, setSavedVideoId] = useState<string | null>(null);
  const [isConnectedChannelVideo, setIsConnectedChannelVideo] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [description, setDescription] = useState("");
  // Tracks genuine optimization activity for the "Optimize" step — distinct from `description`
  // being merely non-empty, which happens automatically once a video with any YouTube
  // description loads, before the user has done anything.
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [titleIdeas, setTitleIdeas] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [ctaIdeas, setCtaIdeas] = useState<string[]>([]);
  const [optimizeTab, setOptimizeTab] = useState<OptimizeTab>("description");
  const [analysis, setAnalysis] = useState<ContentAnalysis | null>(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationsError, setDestinationsError] = useState<string | null>(null);
  const [selectedDestinationIds, setSelectedDestinationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState<"idle" | "loaded" | "not_connected" | "error" | "reauth">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<
    "load" | "analyze" | "optimize" | "save" | "update" | "remove"
  >("load");
  const [copied, setCopied] = useState(false);

  const resetVideoState = () => {
    setVideo(null);
    setSavedVideoId(null);
    setIsConnectedChannelVideo(false);
    setTranscript("");
    setTranscriptExpanded(false);
    setDescription("");
    setDescriptionTouched(false);
    setTitleIdeas([]);
    setTags([]);
    setCtaIdeas([]);
    setOptimizeTab("description");
    setAnalysis(null);
    setAnalysisExpanded(false);
    setStatus("idle");
    setError(null);
  };

  useEffect(() => {
    setSelectedChannelId(activeChannelId);
    resetVideoState();
    setErrorAction("load");
    setMyVideos([]);
    setMyVideosStatus("idle");
    setMyVideosSyncDisabled(false);
    setVideoSearch("");
  }, [activeChannelId]);

  useEffect(() => {
    if (pickerTab !== "mine") return;
    const controller = new AbortController();
    setMyVideosStatus("loading");

    const fetchVideos = async (channelId: string | null) => {
      const params = new URLSearchParams({ limit: "12" });
      if (channelId) params.set("channelId", channelId);
      const response = await fetch(`/api/youtube/videos?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await response.json()) as MyVideosResponse;
      return { response, body };
    };

    (async () => {
      let { response, body } = await fetchVideos(activeChannelId);
      // The remembered "active channel" (yroos.activeYoutubeChannelId, set via the channel
      // switcher) can go stale — e.g. a channel gets disconnected/reconnected, or this browser
      // never opened the switcher to self-correct it. A 404 here doesn't mean the account has no
      // channel, just that THIS specific remembered id no longer resolves — retry once without it
      // so the endpoint falls back to the most recently connected channel, the same recovery the
      // switcher itself would have done.
      if (
        activeChannelId &&
        response.status === 404 &&
        "error" in body &&
        body.error === "CHANNEL_NOT_FOUND"
      ) {
        ({ response, body } = await fetchVideos(null));
      }
      if ("status" in body && body.status === "not_connected") {
        setMyVideosStatus("not_connected");
        return;
      }
      if (!response.ok || !("data" in body) || !body.data) {
        throw new Error("error" in body ? body.error : "SERVER_ERROR");
      }
      setMyVideos(body.data.videos);
      setMyVideosSyncDisabled(body.data.videosStatus === "disabled");
      setMyVideosStatus("loaded");
    })().catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setMyVideosStatus("error");
    });
    return () => controller.abort();
  }, [pickerTab, activeChannelId, myVideosRetryToken]);

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

  const filteredMyVideos = useMemo(() => {
    const query = videoSearch.trim().toLowerCase();
    if (!query) return myVideos;
    return myVideos.filter((item) => item.title.toLowerCase().includes(query));
  }, [myVideos, videoSearch]);

  const loadVideo = async (explicitVideoId?: string) => {
    resetVideoState();
    const youtubeVideoId = explicitVideoId ?? parseYoutubeVideoId(url);
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
      // A previously-saved description represents real prior optimization; the raw YouTube
      // original (the other fallback above) does not.
      setDescriptionTouched(Boolean(body.data.savedVideo?.description));
      setAnalysis(body.data.savedVideo?.content_analysis ?? null);
      setStatus("loaded");
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "SERVER_ERROR";
      // No channelId was sent (activeChannelId is null) and the server still came back with
      // "no channel found" — that only happens when the account has never connected a YouTube
      // channel at all, as opposed to a stale reference to one specific (now-deleted) channel.
      if (code === "CHANNEL_NOT_FOUND" && !activeChannelId) {
        setStatus("not_connected");
        return;
      }
      setError(errorMessage(code));
      setStatus(code === "YOUTUBE_REAUTH_REQUIRED" ? "reauth" : "error");
    } finally {
      setLoading(false);
    }
  };

  const analyzeContent = async () => {
    if (!video) return;
    setAnalyzing(true);
    setError(null);
    setErrorAction("analyze");
    try {
      const response = await fetch("/api/videos/analyze-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: video.title,
          description: description || video.description,
          transcript: transcript || null,
        }),
      });
      const body = (await response.json()) as { data?: ContentAnalysis; error?: string };
      if (!response.ok || !body.data) {
        throw new Error(body.error ?? "AI_PROVIDER_FAILED");
      }
      setAnalysis(body.data);
      toast.success("Content analyzed");
    } catch (reason: unknown) {
      setError(errorMessage(reason instanceof Error ? reason.message : "AI_PROVIDER_FAILED"));
    } finally {
      setAnalyzing(false);
    }
  };

  const optimizeContent = async () => {
    if (!video || !selectedChannelId) return;
    setOptimizing(true);
    setError(null);
    setErrorAction("optimize");
    try {
      const response = await fetch("/api/videos/optimize", {
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
      const body = (await response.json()) as {
        data?: { description: string; titleIdeas: string[]; tags: string[]; ctaIdeas: string[] };
        error?: string;
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error ?? "AI_PROVIDER_FAILED");
      }
      setDescription(body.data.description);
      setDescriptionTouched(true);
      setTitleIdeas(body.data.titleIdeas);
      setTags(body.data.tags);
      setCtaIdeas(body.data.ctaIdeas);
      toast.success("Optimization suggestions generated");
    } catch (reason: unknown) {
      setError(errorMessage(reason instanceof Error ? reason.message : "AI_PROVIDER_FAILED"));
    } finally {
      setOptimizing(false);
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
          contentAnalysis: analysis,
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
      void goToNextOnboardingStep(navigate, "video");
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
        body: JSON.stringify({
          description: description || null,
          transcript: transcript || null,
          contentAnalysis: analysis,
        }),
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
    setDescription((current) => {
      // Only append destinations whose URL isn't already in the text — checking just the first
      // selected destination let a partial overlap (e.g. destination A already inserted, B not)
      // silently skip inserting B too.
      const missing = selectedDestinations.filter(
        (destination) => !current.includes(destination.url),
      );
      if (!missing.length) return current;
      const lines = missing
        .map((destination) => `\n${destination.name}: ${destination.url}`)
        .join("");
      return `${current}${lines}`.trim();
    });
    setDescriptionTouched(true);
  };

  const copyDescription = async () => {
    if (!description) return;
    // navigator.clipboard is undefined outside secure/permitted contexts — writeText() would
    // otherwise be skipped via optional chaining while the UI still claimed success.
    if (!navigator.clipboard) {
      toast.error(
        "Copy isn't available in this browser context. Select and copy the text manually.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy the description. Select and copy the text manually.");
    }
  };

  const changeVideo = () => {
    resetVideoState();
  };

  const retryError = () => {
    if (errorAction === "load") void loadVideo();
    else if (errorAction === "analyze") void analyzeContent();
    else if (errorAction === "optimize") void optimizeContent();
    else if (errorAction === "save") void saveVideo();
    else if (errorAction === "update") void updateVideo();
    else void removeVideo();
  };

  const errorTitle = {
    load: "We couldn’t load this video",
    analyze: "We couldn’t analyze this video",
    optimize: "We couldn’t generate optimization suggestions",
    save: "We couldn’t save this video",
    update: "We couldn’t save your changes",
    remove: "We couldn’t remove this video",
  }[errorAction];

  const loaded = status === "loaded";
  const stepsDone = [loaded, Boolean(analysis), descriptionTouched, Boolean(savedVideoId)];
  const currentStepIndex = stepsDone.findIndex((done) => !done);
  const activeStepIndex = currentStepIndex === -1 ? stepMeta.length - 1 : currentStepIndex;
  const transcriptWordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  return (
    <DashboardLayout title="Analyze Video">
      <Link
        to="/videos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Videos
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analyze a YouTube Video</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get AI-powered insights, optimize your content, and grow your audience.
          </p>
        </div>
        <Link
          to="/support"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4" /> Learn how it works
        </Link>
      </div>

      {/* Stepper */}
      <div className="relative mt-5 rounded-xl card-gradient-outline p-4">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />

        {/* Mobile: segmented progress bar + current step, no horizontal scrolling required */}
        <div className="sm:hidden">
          <div
            className="flex gap-1.5"
            role="progressbar"
            aria-valuenow={activeStepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={stepMeta.length}
          >
            {stepMeta.map((step, index) => (
              <div
                key={step.label}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  index <= activeStepIndex || stepsDone[index] ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {stepsDone[activeStepIndex] && activeStepIndex < stepMeta.length - 1 ? (
                <Check className="h-4 w-4" />
              ) : (
                activeStepIndex + 1
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {stepMeta[activeStepIndex].label}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {stepMeta[activeStepIndex].desc}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {activeStepIndex + 1}/{stepMeta.length}
            </span>
          </div>
        </div>

        {/* Desktop/tablet: full step row with a progress-aware connecting line */}
        <div className="hidden items-stretch gap-2 sm:flex">
          {stepMeta.map((step, index) => {
            const done = stepsDone[index];
            const active = index === activeStepIndex;
            const isLast = index === stepMeta.length - 1;
            return (
              <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                    active ? "border-primary bg-primary/10 shadow-sm" : "border-border",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-success text-success-foreground"
                          : "border border-border text-muted-foreground",
                    )}
                  >
                    {done && !active ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-semibold",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      {step.label}
                    </p>
                    <p
                      className={cn(
                        "truncate text-xs",
                        active ? "text-primary/80" : "text-muted-foreground",
                      )}
                    >
                      {step.desc}
                    </p>
                  </div>
                </div>
                {!isLast && (
                  <div
                    className={cn(
                      "h-0.5 w-4 shrink-0 rounded-full transition-colors",
                      done ? "bg-primary" : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>
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
            className="mt-3 rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10"
          >
            Try again
          </button>
        </div>
      )}
      {error && status !== "error" && status !== "reauth" && (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Select video source */}
          <div
            data-onboarding-step="video"
            className="relative rounded-xl card-gradient-outline p-5"
          >
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h2 className="text-base font-semibold">Select video source</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPickerTab("mine")}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  pickerTab === "mine"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40",
                )}
              >
                <Youtube className="h-5 w-5 shrink-0 text-brand-red" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">My YouTube videos</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Analyze one of your uploaded videos
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPickerTab("url")}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  pickerTab === "url"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40",
                )}
              >
                <Link2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Paste YouTube URL</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Analyze any public YouTube video
                  </p>
                </div>
              </button>
            </div>

            {pickerTab === "mine" ? (
              <div className="mt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={videoSearch}
                    onChange={(event) => setVideoSearch(event.target.value)}
                    placeholder="Search your videos..."
                    aria-label="Search your videos"
                    className="h-10 w-full rounded-full border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div className="mt-3">
                  {myVideosStatus === "loading" && (
                    <div className="space-y-1.5" aria-busy="true" aria-label="Loading your videos">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 rounded-lg border border-border p-2"
                        >
                          <Skeleton className="h-12 w-20 shrink-0 rounded" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-3/4" />
                            <Skeleton className="h-3 w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {myVideosStatus === "not_connected" && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Connect your YouTube channel in{" "}
                      <Link
                        to="/settings"
                        search={{ tab: "YouTube Integration" }}
                        className="font-medium text-primary hover:underline"
                      >
                        Settings
                      </Link>{" "}
                      to select from your own videos, or paste a public video URL instead.
                    </p>
                  )}
                  {myVideosStatus === "error" && (
                    <div className="py-6 text-center text-sm text-destructive">
                      We couldn’t load your videos.{" "}
                      <button
                        type="button"
                        onClick={() => setMyVideosRetryToken((value) => value + 1)}
                        className="font-medium underline"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                  {myVideosStatus === "loaded" && !myVideos.length && myVideosSyncDisabled && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Video sync is turned off for your channel in{" "}
                      <Link
                        to="/settings"
                        search={{ tab: "YouTube Integration" }}
                        className="font-medium text-primary hover:underline"
                      >
                        Settings
                      </Link>
                      . Turn it on to select from your videos here, or paste a URL instead.
                    </p>
                  )}
                  {myVideosStatus === "loaded" && !myVideos.length && !myVideosSyncDisabled && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No videos found on your connected channel yet.
                    </p>
                  )}
                  {myVideosStatus === "loaded" &&
                    myVideos.length > 0 &&
                    !filteredMyVideos.length && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No videos match “{videoSearch}”.
                      </p>
                    )}
                  {myVideosStatus === "loaded" && filteredMyVideos.length > 0 && (
                    <div className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
                      {filteredMyVideos.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void loadVideo(item.id)}
                          disabled={loading}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                            video?.id === item.id
                              ? "border-primary bg-primary/10"
                              : "border-border bg-background hover:border-primary/40",
                          )}
                        >
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="h-12 w-20 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-accent">
                              <Play className="h-4 w-4" />
                            </div>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {item.duration ?? "Duration unavailable"} ·{" "}
                              {formatDate(item.publishedAt)} · {formatCompactNumber(item.views)}{" "}
                              views
                            </span>
                          </span>
                          {loading && video?.id === item.id && (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadVideo();
                }}
                className="mt-4 flex flex-col gap-3 sm:flex-row"
              >
                <input
                  aria-label="YouTube video URL"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="h-11 w-full flex-1 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {loading ? "Loading…" : "Load video"}
                </button>
              </form>
            )}

            {video && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-accent/20 p-3 sm:flex-row sm:items-center">
                {video.thumbnail ? (
                  <img
                    src={video.thumbnail}
                    alt=""
                    className="h-14 w-24 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded bg-accent">
                    <Play className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{video.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(video.publishedAt)} · {formatCompactNumber(video.views)} views ·{" "}
                    {video.likes === null
                      ? "likes unavailable"
                      : `${formatCompactNumber(video.likes)} likes`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={changeVideo}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                >
                  Change video
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-accent/10 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                We’ll use this video’s details and transcript (if you’ve added one) to generate
                insights. Tubify never publishes changes back to YouTube.
              </p>
              <button
                type="button"
                onClick={() => void analyzeContent()}
                disabled={!loaded || analyzing}
                className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analyzing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {analyzing ? "Analyzing…" : "Analyze video"}
              </button>
            </div>
          </div>

          {/* Content analysis */}
          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold">Content analysis</h2>
              <span title="Generated from this video's title, description, and transcript">
                <Info
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-label="Generated from this video's title, description, and transcript"
                />
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              A quick AI summary of what your video is about, who it’s for, and how it could be
              better.
            </p>
            {!analysis && !analyzing && (
              <p className="mt-3 text-sm text-muted-foreground">
                {loaded
                  ? 'Click "Analyze video" above to see it.'
                  : "Select a video above to analyze its content."}
              </p>
            )}
            {analyzing && !analysis && (
              <div className="mt-3 space-y-3" aria-busy="true" aria-label="Analyzing content">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            )}
            {analysis && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <AnalysisChip label="Main topic" value={analysis.mainTopic} />
                  <AnalysisChip label="Video type" value={analysis.contentType} />
                  <AnalysisChip label="Viewer goal" value={analysis.audienceIntent} />
                  <AnalysisChip label="Skill level" value={analysis.complexity} />
                  <AnalysisChip label="Engagement" value={analysis.engagementPotential} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Summary
                    </p>
                    <p className="mt-1 text-sm">{analysis.summary}</p>
                  </div>
                  {analysis.topics.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Key topics
                      </p>
                      <ul className="mt-1.5 space-y-1 text-sm">
                        {analysis.topics.map((topic) => (
                          <li key={topic} className="flex items-center gap-1.5">
                            <span
                              className="h-1 w-1 shrink-0 rounded-full bg-primary"
                              aria-hidden="true"
                            />
                            {topic}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {(analysis.strengths.length > 0 || analysis.opportunities.length > 0) && (
                  <>
                    <button
                      type="button"
                      onClick={() => setAnalysisExpanded((value) => !value)}
                      className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full border border-border py-2 text-sm font-medium hover:bg-accent"
                    >
                      {analysisExpanded ? "Hide full analysis" : "View full analysis"}
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          analysisExpanded && "rotate-180",
                        )}
                      />
                    </button>
                    {analysisExpanded && (
                      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {analysis.strengths.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-success">
                              Strengths
                            </p>
                            <ul className="mt-1.5 space-y-1.5">
                              {analysis.strengths.map((strength) => (
                                <li key={strength} className="flex items-start gap-1.5 text-sm">
                                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                                  {strength}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.opportunities.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-brand-amber">
                              Opportunities
                            </p>
                            <ul className="mt-1.5 space-y-1.5">
                              {analysis.opportunities.map((opportunity) => (
                                <li key={opportunity} className="flex items-start gap-1.5 text-sm">
                                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-amber" />
                                  {opportunity}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Optimize your content */}
          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h2 className="text-base font-semibold">Optimize your content</h2>
            <p className="text-xs text-muted-foreground">
              Let AI help write a better description, title, tags, and closing message — pick a tab
              below.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-accent/40 p-1.5 text-sm">
              {optimizeTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setOptimizeTab(tab.key)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 font-medium shadow-sm transition-colors",
                    optimizeTab === tab.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {optimizeTab === "description" && (
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    AI-generated description (editable)
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void optimizeContent()}
                      disabled={!loaded || optimizing || !selectedChannelId}
                      className="flex h-9 items-center gap-1.5 rounded-full border border-brand-purple/30 px-3 text-sm text-brand-purple hover:bg-brand-purple/10 disabled:opacity-50"
                    >
                      <Sparkles className={cn("h-3.5 w-3.5", optimizing && "animate-pulse")} />
                      {optimizing ? "Generating…" : descriptionTouched ? "Regenerate" : "Generate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyDescription()}
                      disabled={!description}
                      className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDescriptionTouched(true);
                  }}
                  disabled={!loaded}
                  rows={14}
                  placeholder={
                    loaded
                      ? "Edit the YouTube description here..."
                      : "Load a video to edit its description..."
                  }
                  className="mt-3 w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> {video?.duration ?? "Duration unavailable"}
                  </span>
                  <span>{description.length.toLocaleString()} / 5,000</span>
                </div>
              </div>
            )}
            {optimizeTab === "titles" && (
              <div className="mt-4">
                {titleIdeas.length ? (
                  <ul className="space-y-1.5">
                    {titleIdeas.map((idea) => (
                      <li
                        key={idea}
                        className="rounded-lg border border-border bg-background p-2.5 text-sm"
                      >
                        {idea}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyOptimizeState loaded={loaded} label="title ideas" />
                )}
              </div>
            )}
            {optimizeTab === "tags" && (
              <div className="mt-4">
                {tags.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyOptimizeState loaded={loaded} label="tags" />
                )}
              </div>
            )}
            {optimizeTab === "chapters" && (
              <p className="mt-4 text-sm text-muted-foreground">
                Chapters mark where each part of your video starts (like "Intro" at 0:00, "Tutorial"
                at 1:30). Tubify can’t generate these yet — it would need a transcript that includes
                exact timestamps, which isn’t supported yet. Coming soon.
              </p>
            )}
            {optimizeTab === "cta" && (
              <div className="mt-4">
                {ctaIdeas.length ? (
                  <ul className="space-y-1.5">
                    {ctaIdeas.map((idea) => (
                      <li
                        key={idea}
                        className="rounded-lg border border-border bg-background p-2.5 text-sm"
                      >
                        {idea}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyOptimizeState loaded={loaded} label="call-to-action ideas" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h2 className="text-base font-semibold">Video overview</h2>
            {!video ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Select a video to see its details here.
              </p>
            ) : (
              <>
                <div className="mt-3 flex gap-3">
                  {video.thumbnail ? (
                    <img
                      src={video.thumbnail}
                      alt=""
                      className="h-16 w-28 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-accent">
                      <Play className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{video.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(video.publishedAt)}
                      {video.duration ? ` · ${video.duration}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {video.privacyStatus === "public" ? "Public" : "Status unavailable"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-border bg-background p-3 text-center text-xs">
                  <div>
                    <p className="text-muted-foreground">Views</p>
                    <p className="mt-1 font-semibold">{formatCompactNumber(video.views)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Likes</p>
                    <p className="mt-1 font-semibold">
                      {video.likes === null ? "Unavailable" : formatCompactNumber(video.likes)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Comments</p>
                    <p className="mt-1 font-semibold">
                      {video.comments === null
                        ? "Unavailable"
                        : formatCompactNumber(video.comments)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-border bg-accent/10 p-3 text-xs text-muted-foreground">
                  {isConnectedChannelVideo
                    ? "This is your video, so you can save your work here and come back to it later."
                    : "This video belongs to another channel. You can still analyze what's public, but you can't save changes to it."}
                </div>
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  Open on YouTube <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </>
            )}
          </div>

          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Transcript</h2>
              {loaded && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    transcript ? "bg-success/15 text-success" : "bg-accent text-muted-foreground",
                  )}
                >
                  {transcript ? "Added" : "Not available"}
                </span>
              )}
            </div>
            {!loaded ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Select a video above, then you can add a transcript here.
              </p>
            ) : transcript ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Good — Tubify will use this to give more accurate analysis and suggestions.
                </p>
                <div className="mt-3 rounded-lg border border-border bg-background p-3 text-xs">
                  <p className="text-muted-foreground">Word count</p>
                  <p className="mt-0.5 font-semibold">{transcriptWordCount.toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTranscriptExpanded((value) => !value)}
                  className="mt-3 w-full rounded-full border border-border py-2 text-sm font-medium hover:bg-accent"
                >
                  {transcriptExpanded ? "Hide transcript" : "View or edit transcript"}
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  A transcript is just the words spoken in your video. Adding one (optional) helps
                  Tubify write better suggestions. Tubify never pulls captions from YouTube on its
                  own — you choose what to add.
                </p>
                <button
                  type="button"
                  onClick={() => setTranscriptExpanded(true)}
                  className="mt-3 w-full rounded-full border border-border py-2 text-sm font-medium hover:bg-accent"
                >
                  Add a transcript
                </button>
              </>
            )}
            {transcriptExpanded && loaded && (
              <textarea
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                rows={10}
                placeholder="Paste your transcript here..."
                className="mt-3 w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-primary"
              />
            )}
          </div>

          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h2 className="text-base font-semibold">Recommended destinations</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Select links to insert into your description.
            </p>
            <div className="mt-3 space-y-1.5">
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
                    className={cn(
                      "flex w-full items-center gap-3 rounded-full border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:border-primary/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Link to="/destinations" className="text-sm font-medium text-primary hover:underline">
                Manage destinations
              </Link>
              <button
                type="button"
                onClick={injectDestinations}
                disabled={!loaded || !selectedDestinations.length}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Insert selected URLs
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save & publish */}
      <div className="relative mt-5 flex flex-col gap-3 rounded-xl card-gradient-outline p-5 sm:flex-row sm:items-center sm:justify-between">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div>
          <h2 className="text-base font-semibold">Save & publish</h2>
          <p className="text-xs text-muted-foreground">
            Save your analysis, or update this video’s description and transcript in Tubify.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isConnectedChannelVideo && savedVideoId && (
            <button
              type="button"
              onClick={() => void removeVideo()}
              disabled={saving}
              aria-label="Remove video from Tubify"
              className="flex h-10 items-center gap-1.5 rounded-full border border-destructive/30 px-3.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          {isConnectedChannelVideo && (
            <button
              type="button"
              onClick={() => void (savedVideoId ? updateVideo() : saveVideo())}
              disabled={!loaded || saving}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />{" "}
              {saving ? "Saving…" : savedVideoId ? "Update" : "Save to Tubify"}
            </button>
          )}
          <button
            type="button"
            disabled
            title="Tubify doesn't publish changes back to YouTube yet"
            className="flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Youtube className="h-4 w-4" /> Publish to YouTube
            <span className="text-[10px] text-muted-foreground">(coming soon)</span>
          </button>
        </div>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3 w-3" /> Only you can see this analysis. Your content and data are
        private and secure.
      </p>
    </DashboardLayout>
  );
}

function AnalysisChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function EmptyOptimizeState({ loaded, label }: { loaded: boolean; label: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {loaded
        ? `Click "Generate" on the Description tab to also get ${label}.`
        : "Select a video above, then click Generate to see suggestions here."}
    </p>
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
        search={{ tab: "YouTube Integration" }}
        className="rounded-full bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {action}
      </Link>
    </div>
  );
}
