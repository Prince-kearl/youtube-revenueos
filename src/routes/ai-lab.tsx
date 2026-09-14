import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Sparkles,
  FileText,
  RefreshCw,
  Copy,
  Check,
  Loader2,
  ChevronDown,
  Search,
  Play,
  Plus,
  Trash2,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ai-lab")({
  component: AILab,
});

const voices = ["Professional", "Casual", "Educational", "Energetic"];

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

type AnalyzeVideoResponse =
  | {
      data: {
        channel: { id: string; youtubeChannelId: string; title: string; handle: string | null };
        video: YoutubeVideo;
        savedVideo: { id: string; description: string | null } | null;
        transcript: { id: string; transcript: string } | null;
      };
    }
  | { error: string };

type MyVideosResponse =
  | { status: "not_connected"; data: null }
  | {
      status: "connected";
      data: { videos: YoutubeVideo[]; videosStatus: "available" | "disabled" };
    }
  | { error: string };

type DestinationResponse = { data?: Destination[]; error?: string };

type DescriptionTemplate = {
  id: string;
  name: string;
  voice: string;
  destination_id: string | null;
  custom_instructions: string | null;
};
type TemplatesResponse = { data?: DescriptionTemplate[]; error?: string };
type TemplateResponse = { data?: DescriptionTemplate; error?: string };

type OptimizeResponse =
  | { data: { description: string; titleIdeas: string[]; tags: string[]; ctaIdeas: string[] } }
  | { error: string };

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
    CHANNEL_NOT_FOUND:
      "We couldn’t find the selected YouTube channel. Choose another channel and try again.",
    DATABASE_ERROR: "We couldn’t load that. Please try again.",
    SERVER_ERROR: "Something went wrong. Please try again in a moment.",
    YOUTUBE_DATA_UNAVAILABLE: "YouTube isn’t responding right now. Please try again in a moment.",
    AI_PROVIDER_NOT_CONFIGURED:
      "AI writing isn’t available yet. Add a provider API key in Settings.",
    AI_PROVIDER_FAILED: "We couldn’t complete that AI request right now. Please try again.",
    VALIDATION_ERROR: "Give the template a name before saving.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function AILab() {
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);

  const [myVideos, setMyVideos] = useState<YoutubeVideo[]>([]);
  const [myVideosStatus, setMyVideosStatus] = useState<
    "idle" | "loading" | "loaded" | "error" | "not_connected"
  >("idle");
  const [myVideosSyncDisabled, setMyVideosSyncDisabled] = useState(false);
  const [myVideosRetryToken, setMyVideosRetryToken] = useState(0);
  const [videoPickerOpen, setVideoPickerOpen] = useState(false);
  const [videoSearch, setVideoSearch] = useState("");

  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [video, setVideo] = useState<YoutubeVideo | null>(null);
  const [transcript, setTranscript] = useState("");
  const [videoLoadStatus, setVideoLoadStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [voice, setVoice] = useState("Professional");
  const [customInstructions, setCustomInstructions] = useState("");

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationsStatus, setDestinationsStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [selectedDestinationId, setSelectedDestinationId] = useState<string>("");

  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [templatesStatus, setTemplatesStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setMyVideosStatus("loading");
    const params = new URLSearchParams({ limit: "25" });
    if (activeChannelId) params.set("channelId", activeChannelId);

    (async () => {
      const response = await fetch(`/api/youtube/videos?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await response.json()) as MyVideosResponse;
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
  }, [activeChannelId, myVideosRetryToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/destinations?status=active", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as DestinationResponse;
        if (!response.ok || !body.data) throw new Error();
        setDestinations(body.data);
        setDestinationsStatus("loaded");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDestinationsStatus("error");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/description-templates", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as TemplatesResponse;
        if (!response.ok || !body.data) throw new Error();
        setTemplates(body.data);
        setTemplatesStatus("loaded");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setTemplatesStatus("error");
      });
    return () => controller.abort();
  }, []);

  const filteredMyVideos = useMemo(() => {
    const query = videoSearch.trim().toLowerCase();
    if (!query) return myVideos;
    return myVideos.filter((item) => item.title.toLowerCase().includes(query));
  }, [myVideos, videoSearch]);

  const selectedVideoSummary = myVideos.find((item) => item.id === selectedVideoId) ?? null;

  const loadVideo = async (youtubeVideoId: string) => {
    setSelectedVideoId(youtubeVideoId);
    setVideoPickerOpen(false);
    setVideoSearch("");
    setVideoLoadStatus("loading");
    setVideoLoadError(null);
    setVideo(null);
    setTranscript("");
    setDescription("");
    setDescriptionTouched(false);
    try {
      const params = new URLSearchParams({ videoId: youtubeVideoId });
      if (activeChannelId) params.set("channelId", activeChannelId);
      const response = await fetch(`/api/youtube/analyze-video?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as AnalyzeVideoResponse;
      if (!response.ok || !("data" in body)) {
        throw new Error("error" in body ? body.error : "SERVER_ERROR");
      }
      setVideo(body.data.video);
      setSelectedChannelId(body.data.channel.id);
      setTranscript(body.data.transcript?.transcript ?? "");
      const startingDescription =
        body.data.savedVideo?.description ?? body.data.video.description ?? "";
      setDescription(startingDescription);
      setDescriptionTouched(Boolean(body.data.savedVideo?.description));
      setVideoLoadStatus("loaded");
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "SERVER_ERROR";
      setVideoLoadError(errorMessage(code));
      setVideoLoadStatus("error");
    }
  };

  const handleGenerate = async () => {
    if (!video || !selectedChannelId) return;
    setIsGenerating(true);
    try {
      const destination = destinations.find((d) => d.id === selectedDestinationId);
      const response = await fetch("/api/videos/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannelId,
          title: video.title,
          currentDescription: description || video.description,
          transcript: transcript || null,
          destinations: destination ? [{ name: destination.name, url: destination.url }] : [],
          voice,
          customInstructions: customInstructions || null,
        }),
      });
      const body = (await response.json()) as OptimizeResponse;
      if (!response.ok || !("data" in body)) {
        throw new Error("error" in body ? body.error : "AI_PROVIDER_FAILED");
      }
      setDescription(body.data.description);
      setDescriptionTouched(true);
      toast.success("Description generated");
    } catch (reason: unknown) {
      toast.error(errorMessage(reason instanceof Error ? reason.message : "AI_PROVIDER_FAILED"));
    } finally {
      setIsGenerating(false);
    }
  };

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setVoice(template.voice);
    setSelectedDestinationId(template.destination_id ?? "");
    setCustomInstructions(template.custom_instructions ?? "");
  };

  const handleSaveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    setSavingTemplate(true);
    try {
      const response = await fetch("/api/description-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTemplateName,
          voice,
          destinationId: selectedDestinationId || null,
          customInstructions: customInstructions || null,
        }),
      });
      const body = (await response.json()) as TemplateResponse;
      if (!response.ok || !body.data) {
        throw new Error("error" in body ? body.error : "SERVER_ERROR");
      }
      setTemplates((prev) => [...prev, body.data!].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTemplateId(body.data.id);
      setNewTemplateName("");
      setTemplateDialogOpen(false);
      toast.success(`Saved "${body.data.name}" template`);
    } catch (reason: unknown) {
      toast.error(errorMessage(reason instanceof Error ? reason.message : "SERVER_ERROR"));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return;
    setDeletingTemplate(true);
    try {
      const response = await fetch(`/api/description-templates?id=${selectedTemplateId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error();
      setTemplates((prev) => prev.filter((t) => t.id !== selectedTemplateId));
      setSelectedTemplateId("");
      toast.success("Template deleted");
    } catch {
      toast.error("Couldn’t delete that template. Please try again.");
    } finally {
      setDeletingTemplate(false);
    }
  };

  const handleCopy = () => {
    if (!description) return;
    navigator.clipboard?.writeText(description);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const linkCount = useMemo(() => (description.match(/https?:\/\//g) ?? []).length, [description]);
  const wordCount = useMemo(
    () => description.trim().split(/\s+/).filter(Boolean).length,
    [description],
  );

  const loaded = videoLoadStatus === "loaded" && Boolean(video);
  const triggerVideo = video && video.id === selectedVideoId ? video : selectedVideoSummary;

  return (
    <DashboardLayout title="AI Lab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Description Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate a description for one of your videos, powered by AI
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4" /> AI-generated descriptions
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h3 className="font-semibold">Select Video</h3>

            {myVideosStatus === "loading" && (
              <Skeleton className="mt-3 h-11 w-full rounded-[var(--button-radius)]" />
            )}

            {myVideosStatus === "not_connected" && (
              <p className="mt-3 rounded-lg border border-border bg-accent/20 p-3 text-sm text-muted-foreground">
                Connect a YouTube channel in{" "}
                <Link to="/settings" className="text-primary hover:underline">
                  Settings
                </Link>{" "}
                to select a video.
              </p>
            )}

            {myVideosStatus === "error" && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-accent/20 p-3 text-sm text-muted-foreground">
                <span>We couldn’t load your videos.</span>
                <button
                  type="button"
                  onClick={() => setMyVideosRetryToken((n) => n + 1)}
                  className="flex items-center gap-1.5 text-primary hover:underline"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            )}

            {myVideosStatus === "loaded" && myVideos.length === 0 && (
              <p className="mt-3 rounded-lg border border-border bg-accent/20 p-3 text-sm text-muted-foreground">
                {myVideosSyncDisabled
                  ? "Video sync is turned off in Settings, so no videos are available here."
                  : "No published videos are available for this channel."}
              </p>
            )}

            {myVideosStatus === "loaded" && myVideos.length > 0 && (
              <Popover
                open={videoPickerOpen}
                onOpenChange={(open) => {
                  setVideoPickerOpen(open);
                  if (!open) setVideoSearch("");
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center gap-3 rounded-[var(--button-radius)] border border-border bg-accent/30 px-3 py-2.5 text-left text-sm outline-none focus:border-primary"
                  >
                    {triggerVideo ? (
                      triggerVideo.thumbnail ? (
                        <img
                          src={triggerVideo.thumbnail}
                          alt=""
                          className="h-9 w-16 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-accent">
                          <Play className="h-3.5 w-3.5" />
                        </div>
                      )
                    ) : null}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        !triggerVideo && "text-muted-foreground",
                      )}
                    >
                      {triggerVideo ? triggerVideo.title : "Choose a video…"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                >
                  <div className="relative border-b border-border p-2">
                    <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      autoFocus
                      value={videoSearch}
                      onChange={(event) => setVideoSearch(event.target.value)}
                      placeholder="Search your videos..."
                      aria-label="Search your videos"
                      className="h-9 w-full rounded-lg border border-transparent bg-accent/30 pl-9 pr-3 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  {filteredMyVideos.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      No videos match “{videoSearch}”.
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-1 overflow-y-auto p-1.5">
                      {filteredMyVideos.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void loadVideo(item.id)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                            item.id === selectedVideoId ? "bg-primary/10" : "hover:bg-accent",
                          )}
                        >
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="h-10 w-[4.5rem] shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-[4.5rem] shrink-0 items-center justify-center rounded bg-accent">
                              <Play className="h-3.5 w-3.5" />
                            </div>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.duration ?? "Duration unavailable"} ·{" "}
                              {formatDate(item.publishedAt)} · {formatCompactNumber(item.views)}{" "}
                              views
                            </span>
                          </span>
                          {videoLoadStatus === "loading" && item.id === selectedVideoId && (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}

            {videoLoadStatus === "error" && videoLoadError && (
              <p className="mt-2 text-sm text-destructive">{videoLoadError}</p>
            )}
          </div>

          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold">
                <FileText className="h-4 w-4 text-brand-blue" /> Transcript
              </h3>
              {loaded && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    transcript ? "bg-success/15 text-success" : "bg-accent text-muted-foreground",
                  )}
                >
                  {transcript ? "Saved" : "Not available"}
                </span>
              )}
            </div>
            {videoLoadStatus === "loading" ? (
              <Skeleton className="mt-3 h-24 w-full rounded-xl" />
            ) : !loaded ? (
              <p className="mt-3 rounded-xl border border-border bg-accent/20 p-4 text-sm text-muted-foreground">
                Select a video to see its transcript.
              </p>
            ) : transcript ? (
              <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-border bg-accent/20 p-4 text-sm leading-relaxed text-muted-foreground">
                {transcript}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-border bg-accent/20 p-4 text-sm text-muted-foreground">
                No transcript saved for this video yet. Descriptions generate fine from the title
                alone, but adding a transcript in{" "}
                <Link to="/add-video" className="text-primary hover:underline">
                  Analyze Video
                </Link>{" "}
                gives sharper results.
              </p>
            )}
          </div>

          <div className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h3 className="font-semibold">Generation Settings</h3>

            <p className="mt-4 text-sm text-muted-foreground">Description Template</p>
            {templatesStatus === "loading" && <Skeleton className="mt-2 h-11 w-full rounded-lg" />}
            {templatesStatus === "error" && (
              <p className="mt-2 text-sm text-muted-foreground">We couldn’t load your templates.</p>
            )}
            {templatesStatus === "loaded" && (
              <div className="mt-2 flex items-center gap-2">
                <select
                  aria-label="Description template"
                  value={selectedTemplateId}
                  onChange={(event) => applyTemplate(event.target.value)}
                  className="w-full min-w-0 rounded-full border border-border bg-accent/20 py-2.5 pl-4 pr-9 text-sm outline-none focus:border-primary"
                >
                  <option value="">{templates.length === 0 ? "No saved templates" : "None"}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {selectedTemplateId && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteTemplate()}
                    disabled={deletingTemplate}
                    aria-label="Delete template"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
                  >
                    {deletingTemplate ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTemplateDialogOpen(true)}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus className="h-4 w-4" /> New
                </button>
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Save your Brand Voice, destination, and custom instructions below as a named preset to
              reuse across videos.
            </p>

            <p className="mt-4 text-sm text-muted-foreground">Brand Voice</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {voices.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVoice(v)}
                  className={`rounded-full border py-2.5 text-sm font-medium transition-colors ${
                    voice === v
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-accent/20 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm text-muted-foreground">Feature a destination (optional)</p>
            {destinationsStatus === "loading" && (
              <Skeleton className="mt-2 h-11 w-full rounded-lg" />
            )}
            {destinationsStatus === "error" && (
              <p className="mt-2 text-sm text-muted-foreground">
                We couldn’t load your destinations.
              </p>
            )}
            {destinationsStatus === "loaded" && destinations.length === 0 && (
              <p className="mt-2 rounded-lg border border-border bg-accent/20 p-3 text-sm text-muted-foreground">
                No destinations yet.{" "}
                <Link to="/link-tracking" className="text-primary hover:underline">
                  Add one in Link Tracking
                </Link>{" "}
                to feature it here.
              </p>
            )}
            {destinationsStatus === "loaded" && destinations.length > 0 && (
              <select
                aria-label="Feature a destination"
                value={selectedDestinationId}
                onChange={(event) => setSelectedDestinationId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-accent/20 px-3 py-2.5 text-sm outline-none focus:border-primary"
              >
                <option value="">None</option>
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            )}

            <p className="mt-4 text-sm text-muted-foreground">Custom Instructions</p>
            <textarea
              rows={3}
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder="e.g., Always mention the free toolkit first, use emojis sparingly..."
              className="mt-2 w-full resize-none rounded-xl border border-border bg-accent/20 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!loaded || isGenerating}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {isGenerating ? "Generating…" : "Generate Description"}
            </button>
          </div>
        </div>

        {/* Right column */}
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Generated Description
            </h3>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!loaded || isGenerating}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--button-radius)] hover:bg-accent hover:text-foreground disabled:opacity-50"
                aria-label="Regenerate"
              >
                <RefreshCw className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!description}
                className="flex h-8 items-center gap-1.5 rounded-[var(--button-radius)] bg-accent px-3 text-sm hover:text-foreground disabled:opacity-50"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
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
            rows={16}
            placeholder={
              loaded
                ? "Click Generate Description, or write your own here..."
                : "Select a video to get started..."
            }
            className="mt-4 w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          />

          <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
            <div className="flex gap-8">
              <Stat value={description.length.toLocaleString()} label="Characters" />
              <Stat value={wordCount.toLocaleString()} label="Words" />
              <Stat value={String(linkCount)} label="Links" />
            </div>
            {descriptionTouched && (
              <span className="flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Optimized
              </span>
            )}
          </div>
        </div>
      </div>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-primary" /> Save as template
            </DialogTitle>
            <DialogDescription>
              Saves the current Brand Voice, featured destination, and custom instructions under a
              name you can pick again later.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleSaveTemplate(event)} className="space-y-3">
            <Input
              autoFocus
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="e.g. Course launch, Weekly vlog"
              maxLength={80}
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="rounded-full"
                onClick={() => setTemplateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="rounded-full" disabled={savingTemplate}>
                {savingTemplate ? "Saving…" : "Save Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
