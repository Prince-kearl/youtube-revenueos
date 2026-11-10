import { buttonPrimary, buttonSecondary } from "@/lib/button-styles";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
  Upload,
  X,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { PrePublishUploadDialog } from "@/components/PrePublishUploadDialog";
import { PRE_PUBLISH_ENABLED } from "@/lib/feature-flags";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import {
  analysisBasis,
  chaptersBlock,
  cleanTags,
  descriptionProblem,
  descriptionWithCallToAction,
  descriptionWithChapters,
  parseChapterLine,
  parseChapters,
  PUBLISH_PROBLEM_TEXT,
  tagsLength,
  tagsProblem,
  titleProblem,
  VISIBILITY_LABEL,
  videoVisibility,
  YOUTUBE_TAGS_MAX_CHARS,
  YOUTUBE_TITLE_MAX_CHARS,
} from "@/lib/youtube-description";
import {
  DescriptionProblemNote,
  PublishButton,
  UndoPublishButton,
  useYoutubePublisher,
  type YoutubeDetails,
} from "@/components/PublishToYoutube";
import { VideoStatusBadges } from "@/components/VideoStatusBadges";
import {
  checklistComplete,
  videoChecklist,
  type ChecklistItem,
  type FixTab,
} from "@/lib/video-checklist";
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
  tags?: string[];
  durationSeconds?: number | null;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  privacyStatus: string | null;
  uploadStatus?: string | null;
  publishAt?: string | null;
  url: string;
  views: number;
  likes: number | null;
  comments: number | null;
};

// Matches AnalyzeVideoResult in src/lib/server/ai-generation.ts — the AI-powered content
// intelligence report from POST /api/ai/analyze-video (OpenRouter), kept in sync manually since
// that module is server-only and can't be imported into this client route.
type ContentAnalysis = {
  /** analysisBasis() of what was analyzed; missing on analyses saved before it existed. */
  basis?: string;
  summary: string;
  overallScore: number;
  scores: {
    hook: number;
    title: number;
    seo: number;
    content: number;
    engagement: number;
  };
  strengths: string[];
  weaknesses: string[];
  /** Newer analyses: each issue placed where it would be fixed (see ISSUE_AREAS on the server). */
  issues?: Array<{ text: string; area: IssueArea; severity: "major" | "minor" }>;
  /** Newer analyses: the previous analysis's issues, re-checked. */
  previousIssueReview?: Array<{
    text: string;
    status: "resolved" | "still_present";
    reason: string;
  }>;
  titleSuggestions: string[];
  descriptionSuggestion: string;
  keywordSuggestions: string[];
  recommendations: string[];
  contentIdeas: string[];
};

type IssueArea =
  | "title"
  | "description"
  | "tags"
  | "chapters"
  | "thumbnail"
  | "content"
  | "audience"
  | "transcript";

// Issues in these areas are fixed on this page, in the Optimize tab named here.
const FIX_TAB_FOR_AREA: Partial<Record<IssueArea, OptimizeTab>> = {
  title: "titles",
  description: "description",
  tags: "tags",
  chapters: "chapters",
};
const AREA_LABEL: Record<IssueArea, string> = {
  title: "Title",
  description: "Description",
  tags: "Tags",
  chapters: "Chapters",
  thumbnail: "Thumbnail",
  content: "Content",
  audience: "Audience",
  transcript: "Transcript",
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
      "That video isn’t public and isn’t on your connected channel, so it can’t be analyzed here.",
    CHANNEL_NOT_FOUND:
      "We couldn’t find the selected YouTube channel. Choose another channel and try again.",
    DATABASE_ERROR: "We couldn’t save your changes. Please try again.",
    SERVER_ERROR: "Something went wrong. Please try again in a moment.",
    YOUTUBE_DATA_UNAVAILABLE: "YouTube isn’t responding right now. Please try again in a moment.",
    AI_PROVIDER_NOT_CONFIGURED:
      "AI writing isn’t available yet. You can still write and save the description yourself.",
    AI_PROVIDER_FAILED:
      "We couldn’t complete that AI request right now. Your current text is safe—please try again.",
    AI_PROVIDER_RATE_LIMITED:
      "AI analysis is getting a lot of requests right now. Please try again in a moment.",
    RATE_LIMIT_EXCEEDED:
      "You’re sending AI requests very quickly. Please wait a minute and try again.",
    AI_QUOTA_EXCEEDED:
      "This month’s AI analyses for your plan are used. They reset on the 1st (UTC), or upgrade in Billing.",
    AI_QUOTA_UNAVAILABLE: "We couldn’t check your AI allowance. Please try again.",
    SUBSCRIPTION_REQUIRED: "AI analysis needs an active subscription. Choose a plan in Billing.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function AddVideo() {
  const navigate = useNavigate();
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [pickerTab, setPickerTab] = useState<"mine" | "url">("mine");
  const [prePublishDialogOpen, setPrePublishDialogOpen] = useState(false);
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
  // What YouTube held when the video was loaded, for Publish to YouTube (PublishToYoutube.tsx).
  const [youtubeDetails, setYoutubeDetails] = useState<YoutubeDetails | null>(null);
  // Editable drafts for publishing the other tabs: the chosen title, the tag list, the chapters.
  const [titleDraft, setTitleDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [chaptersText, setChaptersText] = useState("");
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
  // The video being loaded, so its row in the picker can show a spinner and the page can show a
  // placeholder card until it arrives.
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);
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
    setYoutubeDetails(null);
    setTitleDraft("");
    setTagsDraft([]);
    setNewTag("");
    setChaptersText("");
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
      // visibility=all: the channel's unlisted, private and scheduled uploads too, so a video
      // can be analyzed and its description written before it goes public.
      const params = new URLSearchParams({ limit: "12", visibility: "all" });
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
    setLoadingVideoId(youtubeVideoId);
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
      const loadedDescription = body.data.video.description ?? "";
      setYoutubeDetails({
        title: body.data.video.title,
        description: loadedDescription,
        tags: body.data.video.tags ?? [],
      });
      setTitleDraft(body.data.video.title);
      setTagsDraft(body.data.video.tags ?? []);
      setChaptersText(existingChapters(loadedDescription));
      setSavedVideoId(body.data.savedVideo?.id ?? null);
      setTranscript(body.data.transcript?.transcript ?? "");
      setDescription(body.data.savedVideo?.description ?? body.data.video.description ?? "");
      // A previously-saved description represents real prior optimization; the raw YouTube
      // original (the other fallback above) does not.
      setDescriptionTouched(Boolean(body.data.savedVideo?.description));
      // A saved analysis from before the AnalyzeVideoResult schema change (overallScore/scores/
      // etc.) would otherwise crash the results view below on the missing fields — treat it as
      // "not yet analyzed" rather than rendering it, prompting a fresh (fast, cached) re-analysis.
      const savedAnalysis = body.data.savedVideo?.content_analysis ?? null;
      setAnalysis(
        savedAnalysis && typeof savedAnalysis.overallScore === "number" ? savedAnalysis : null,
      );
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
      setLoadingVideoId(null);
    }
  };

  const analyzeContent = async () => {
    if (!video) return;
    setAnalyzing(true);
    setError(null);
    setErrorAction("analyze");
    try {
      const response = await fetch("/api/ai/analyze-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.id,
          channelId: selectedChannelId ?? undefined,
          // The analysis judges the video as it is on YouTube (the server reads its title,
          // description, tags and visibility), never an unpublished draft from the editor, so
          // it can be compared with YouTube afterwards (analysisBasis).
          transcript: transcript || null,
          // What the analysis on screen raised, so the new one re-checks each instead of
          // starting over (and does not find fresh nitpicks every time).
          previousIssues: previousIssueTexts(analysis),
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
          durationSeconds: video.durationSeconds ?? null,
          currentDescription: description || video.description,
          transcript: transcript || null,
          destinations: selectedDestinations.map((destination) => ({
            name: destination.name,
            url: destination.url,
          })),
        }),
      });
      const body = (await response.json()) as {
        data?: {
          description: string;
          titleIdeas: string[];
          tags: string[];
          ctaIdeas: string[];
          chapters?: Array<{ timestamp: string; title: string }>;
        };
        error?: string;
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error ?? "AI_PROVIDER_FAILED");
      }
      setDescription(body.data.description);
      setDescriptionTouched(true);
      setTitleIdeas(body.data.titleIdeas);
      setTags(body.data.tags);
      // The tags to publish start as the video's own tags plus the new suggestions.
      setTagsDraft((draft) => cleanTags([...draft, ...body.data!.tags]));
      setCtaIdeas(body.data.ctaIdeas);
      const suggested = (body.data.chapters ?? [])
        .map((c) => parseChapterLine(`${c.timestamp} ${c.title}`))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (suggested.length) setChaptersText(chaptersBlock(suggested));
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
  const publisher = useYoutubePublisher({
    channelId: selectedChannelId,
    video: loaded && isConnectedChannelVideo ? video : null,
    initial: loaded && isConnectedChannelVideo ? youtubeDetails : null,
    onRestored: (now) => {
      setDescription(now.description);
      setTitleDraft(now.title);
      setTagsDraft(now.tags);
      setChaptersText(existingChapters(now.description));
    },
  });
  // What is on YouTube now: after a publish, what the publisher knows; otherwise what was loaded.
  const onYoutube = publisher.current ?? youtubeDetails;
  // The analysis on screen no longer describes the video as it is on YouTube (its title,
  // description, tags or visibility changed since), or it predates the stamp that would tell.
  const analysisOutdated = Boolean(
    analysis &&
    onYoutube &&
    video &&
    analysis.basis !==
      analysisBasis({
        title: onYoutube.title,
        description: onYoutube.description,
        tags: onYoutube.tags,
        privacyStatus: video.privacyStatus,
      }),
  );
  // The objective checklist for what is on YouTube now (lib/video-checklist.ts).
  const checklist = onYoutube
    ? videoChecklist({
        title: onYoutube.title,
        description: onYoutube.description,
        tags: onYoutube.tags,
        durationSeconds: video?.durationSeconds ?? null,
      })
    : [];
  const failingChecks = checklist.filter((item) => item.status === "fail");
  const fixableIssues = (analysis?.issues ?? []).filter((issue) => FIX_TAB_FOR_AREA[issue.area]);
  const contextIssues = (analysis?.issues ?? []).filter((issue) => !FIX_TAB_FOR_AREA[issue.area]);
  const resolvedIssues = (analysis?.previousIssueReview ?? []).filter(
    (review) => review.status === "resolved",
  );
  // Done: every check passes, and a current analysis has no major issue that can be fixed here.
  const ready =
    loaded &&
    checklist.length > 0 &&
    checklistComplete(checklist) &&
    Boolean(analysis?.issues) &&
    !analysisOutdated &&
    !fixableIssues.some((issue) => issue.severity === "major");
  const optimizeSection = useRef<HTMLDivElement>(null);
  const openFix = (tab: FixTab | OptimizeTab) => {
    setOptimizeTab(tab);
    optimizeSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [showPassing, setShowPassing] = useState(false);

  // Whether the description editor holds exactly what YouTube has.
  const draftOnYoutube =
    onYoutube !== null &&
    description.replace(/\r\n?/g, "\n").trim() === onYoutube.description.trim();
  const durationSeconds = video?.durationSeconds ?? null;
  const parsedChapters = parseChapters(chaptersText, durationSeconds);
  const cleanedTags = cleanTags(tagsDraft);
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
            AI analysis, description optimization, and destination links for one video.
          </p>
        </div>
        <Link to="/support" className={cn(buttonSecondary, "shrink-0")}>
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
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              {PRE_PUBLISH_ENABLED && (
                <button
                  type="button"
                  onClick={() => setPrePublishDialogOpen(true)}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40"
                >
                  <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Upload a video (not yet published)</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Get packaging ideas before it&apos;s on YouTube
                    </p>
                  </div>
                </button>
              )}
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
                            video?.id === item.id || loadingVideoId === item.id
                              ? "border-primary bg-primary/10"
                              : "border-border bg-background hover:border-primary/40",
                          )}
                        >
                          {item.thumbnail ? (
                            <img
                              referrerPolicy="no-referrer"
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
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{item.title}</span>
                              <VideoStatusBadges video={item} />
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {item.duration ?? "Duration unavailable"} ·{" "}
                              {formatDate(item.publishedAt)} · {formatCompactNumber(item.views)}{" "}
                              views
                            </span>
                          </span>
                          {loading && loadingVideoId === item.id && (
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
                  className={cn(buttonPrimary, "disabled:cursor-not-allowed")}
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

            {loading && !video && (
              <div
                className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-accent/20 p-3 sm:flex-row sm:items-center"
                role="status"
                aria-busy="true"
              >
                <Skeleton className="h-[72px] w-32 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Loading the video from YouTube…
                  </p>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <div className="grid grid-cols-3 gap-2 sm:w-56">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-11 w-full rounded-md" />
                  ))}
                </div>
              </div>
            )}

            {video && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-accent/20 p-3 sm:flex-row sm:items-center">
                {video.thumbnail ? (
                  <img
                    referrerPolicy="no-referrer"
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
                  className={cn(buttonSecondary, "shrink-0")}
                >
                  Change video
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-accent/10 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                We’ll analyze the video as it is on YouTube now (title, description, tags and
                visibility), plus its transcript if you’ve added one. Analyzing never changes
                anything on YouTube — only a publish you confirm does.
              </p>
              <button
                type="button"
                onClick={() => void analyzeContent()}
                disabled={!loaded || analyzing}
                className={cn(buttonPrimary, "shrink-0 disabled:cursor-not-allowed")}
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

            {/* Header: title, where things stand, and Re-analyze always in the same place. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Content analysis</h2>
                {loaded && (
                  <StatusPill
                    tone={
                      ready
                        ? "success"
                        : analysis && analysisOutdated
                          ? "warning"
                          : failingChecks.length ||
                              fixableIssues.some((i) => i.severity === "major")
                            ? "attention"
                            : "neutral"
                    }
                  >
                    {ready
                      ? "Ready"
                      : analysis && analysisOutdated
                        ? "Out of date"
                        : failingChecks.length
                          ? `${failingChecks.length} to fix`
                          : analysis
                            ? "Review"
                            : "Not analyzed"}
                  </StatusPill>
                )}
              </div>
              {analysis && (
                <button
                  type="button"
                  onClick={() => void analyzeContent()}
                  disabled={analyzing}
                  className={cn(buttonSecondary, "h-8 px-3 text-xs")}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", analyzing && "animate-spin")} />
                  {analyzing ? "Analyzing…" : "Re-analyze"}
                </button>
              )}
            </div>

            {/* Readiness: the checklist and the verdict in one card. */}
            {loaded && checklist.length > 0 && (
              <ReadinessCard
                ready={ready}
                analyzed={Boolean(analysis?.issues) && !analysisOutdated}
                checklist={checklist}
                showPassing={showPassing}
                onTogglePassing={() => setShowPassing((value) => !value)}
                onFix={openFix}
              />
            )}

            {!analysis && !analyzing && (
              <p className="mt-4 text-sm text-muted-foreground">
                {loading
                  ? "Loading the video…"
                  : loaded
                    ? 'Run "Analyze video" above for scores, strengths and what to improve.'
                    : "Select a video above to analyze its content."}
              </p>
            )}
            {analyzing && !analysis && (
              <div
                className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]"
                aria-busy="true"
                aria-label="Analyzing content"
              >
                <Skeleton className="mx-auto h-28 w-28 rounded-full" />
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              </div>
            )}
            {analysis && analysisOutdated && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {analysis.basis
                  ? "Scores below are for an earlier version of this video. Re-analyze to update them."
                  : "These scores may be out of date. Re-analyze to update them."}
              </div>
            )}
            {analysis && (
              <>
                {/* Scores: the overall ring, and each area as a bar. */}
                <div
                  className={cn(
                    "mt-4 grid items-center gap-5 rounded-xl bg-accent/30 p-4 sm:grid-cols-[auto_1fr]",
                    (analysisOutdated || analyzing) && "opacity-60",
                  )}
                >
                  <ScoreRing value={analysis.overallScore} />
                  <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <ScoreBar label="Hook" value={analysis.scores.hook} />
                    <ScoreBar label="Title" value={analysis.scores.title} />
                    <ScoreBar label="SEO" value={analysis.scores.seo} />
                    <ScoreBar label="Content" value={analysis.scores.content} />
                    <ScoreBar label="Engagement" value={analysis.scores.engagement} />
                  </div>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {analysis.summary}
                </p>

                <InsightTabs
                  strengths={analysis.strengths}
                  fixable={fixableIssues}
                  context={contextIssues}
                  resolved={resolvedIssues}
                  legacyWeaknesses={analysis.issues ? null : analysis.weaknesses}
                  onFix={(area) => openFix(FIX_TAB_FOR_AREA[area]!)}
                />

                <button
                  type="button"
                  onClick={() => setAnalysisExpanded((value) => !value)}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full border border-border py-2 text-sm font-medium hover:bg-accent"
                >
                  {analysisExpanded ? "Hide suggestions" : "View suggestions"}
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", analysisExpanded && "rotate-180")}
                  />
                </button>
                {analysisExpanded && (
                  <div className="mt-3 space-y-4">
                    {analysis.titleSuggestions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Title suggestions
                        </p>
                        <ul className="mt-1.5 space-y-1.5">
                          {analysis.titleSuggestions.map((title) => (
                            <li key={title} className="flex items-start gap-1.5 text-sm">
                              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                              {title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.descriptionSuggestion && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Description suggestion
                        </p>
                        <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm">
                          {analysis.descriptionSuggestion}
                        </p>
                      </div>
                    )}
                    {analysis.keywordSuggestions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Keywords
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {analysis.keywordSuggestions.map((keyword) => (
                            <span
                              key={keyword}
                              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.recommendations.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Recommendations
                        </p>
                        <ul className="mt-1.5 space-y-1.5">
                          {analysis.recommendations.map((recommendation) => (
                            <li key={recommendation} className="flex items-start gap-1.5 text-sm">
                              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                              {recommendation}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.contentIdeas.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Content ideas
                        </p>
                        <ul className="mt-1.5 space-y-1.5">
                          {analysis.contentIdeas.map((idea) => (
                            <li key={idea} className="flex items-start gap-1.5 text-sm">
                              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-amber" />
                              {idea}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Optimize your content */}
          <div
            ref={optimizeSection}
            className="relative scroll-mt-24 rounded-xl card-gradient-outline p-5"
          >
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
                    {loaded && onYoutube && isConnectedChannelVideo && (
                      <span
                        className={cn(
                          "ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          draftOnYoutube
                            ? "bg-success/15 text-success"
                            : "bg-warning/15 text-warning",
                        )}
                      >
                        {draftOnYoutube ? "Matches YouTube" : "Not on YouTube yet"}
                      </span>
                    )}
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
                    {/* Only for a video on the connected channel; the server checks again. */}
                    <UndoPublishButton
                      publisher={publisher}
                      className="h-9 rounded-full border border-border bg-transparent text-muted-foreground"
                    />
                    <PublishButton
                      publisher={publisher}
                      changes={{ description }}
                      label="description"
                      problem={descriptionProblem(description)}
                      className="h-9"
                    />
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
                  className="mt-3 w-full resize-none rounded-[10px] border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> {video?.duration ?? "Duration unavailable"}
                  </span>
                  <span>{description.length.toLocaleString()} / 5,000</span>
                </div>
                {loaded && <DescriptionProblemNote description={description} />}
              </div>
            )}
            {optimizeTab === "titles" && (
              <div className="mt-4">
                {titleIdeas.length ? (
                  <ul className="space-y-1.5" aria-label="Title ideas">
                    {titleIdeas.map((idea) => (
                      <li key={idea}>
                        <button
                          type="button"
                          onClick={() => setTitleDraft(idea)}
                          aria-pressed={titleDraft === idea}
                          className={cn(
                            "w-full rounded-lg border p-2.5 text-left text-sm transition-colors",
                            titleDraft === idea
                              ? "border-primary bg-primary/5"
                              : "border-border bg-background hover:bg-accent/40",
                          )}
                        >
                          {idea}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyOptimizeState loaded={loaded} label="title ideas" />
                )}
                {loaded && publisher.ready && (
                  <div className="mt-4 space-y-2">
                    <label
                      htmlFor="title-draft"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Title to publish{titleIdeas.length ? " (pick an idea above, or edit it)" : ""}
                    </label>
                    <input
                      id="title-draft"
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      maxLength={200}
                      className="h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[11px]",
                          titleProblem(titleDraft) ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {titleProblem(titleDraft)
                          ? PUBLISH_PROBLEM_TEXT[titleProblem(titleDraft)!]
                          : `${[...titleDraft].length} / ${YOUTUBE_TITLE_MAX_CHARS}`}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <UndoPublishButton publisher={publisher} />
                        <PublishButton
                          publisher={publisher}
                          changes={{ title: titleDraft }}
                          label="title"
                          problem={titleProblem(titleDraft)}
                        >
                          Publish title
                        </PublishButton>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {optimizeTab === "tags" && (
              <div className="mt-4">
                {!tags.length && !(loaded && publisher.ready) && (
                  <EmptyOptimizeState loaded={loaded} label="tags" />
                )}
                {!(loaded && publisher.ready) && tags.length > 0 && (
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
                )}
                {loaded && publisher.ready && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {tags.length
                        ? "Your video's current tags plus the suggestions. Remove any you don't want, then publish."
                        : "Your video's current tags. Generate on the Description tab for suggestions, or add your own."}
                    </p>
                    <div className="flex flex-wrap gap-1.5" aria-label="Tags to publish">
                      {cleanedTags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                            tags.some((t) => t.toLowerCase() === tag.toLowerCase()) &&
                              !publisher.current?.tags.includes(tag)
                              ? "bg-primary/10 text-primary"
                              : "bg-accent",
                          )}
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => setTagsDraft((draft) => draft.filter((t) => t !== tag))}
                            aria-label={`Remove tag ${tag}`}
                            className="rounded-full p-0.5 hover:bg-foreground/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      {!cleanedTags.length && (
                        <span className="text-xs text-muted-foreground">No tags</span>
                      )}
                    </div>
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const added = newTag
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean);
                        if (!added.length) return;
                        setTagsDraft((draft) => cleanTags([...draft, ...added]));
                        setNewTag("");
                      }}
                    >
                      <input
                        value={newTag}
                        onChange={(event) => setNewTag(event.target.value)}
                        placeholder="Add a tag (comma-separate several)"
                        aria-label="Add a tag"
                        maxLength={200}
                        className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                      />
                      <button type="submit" className={cn(buttonSecondary, "h-9")}>
                        Add
                      </button>
                    </form>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[11px]",
                          tagsProblem(cleanedTags) ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {tagsProblem(cleanedTags)
                          ? PUBLISH_PROBLEM_TEXT[tagsProblem(cleanedTags)!]
                          : `${tagsLength(cleanedTags)} / ${YOUTUBE_TAGS_MAX_CHARS} characters`}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <UndoPublishButton publisher={publisher} />
                        <PublishButton
                          publisher={publisher}
                          changes={{ tags: cleanedTags }}
                          label="tags"
                          problem={tagsProblem(cleanedTags)}
                        >
                          Publish tags
                        </PublishButton>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {optimizeTab === "chapters" && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  YouTube shows chapters from a list of times in the description. One chapter per
                  line, starting at 0:00, at least 3, each at least 10 seconds long. Generate on the
                  Description tab with a timed transcript for suggestions, or write your own.
                </p>
                <textarea
                  value={chaptersText}
                  onChange={(event) => setChaptersText(event.target.value)}
                  disabled={!loaded}
                  rows={8}
                  placeholder={"0:00 Intro\n1:15 The setup\n4:30 Results"}
                  aria-label="Chapters"
                  className="w-full resize-none rounded-[10px] border border-border bg-background p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                {loaded && chaptersText.trim() && parsedChapters.problem && (
                  <p className="text-xs text-destructive">
                    {PUBLISH_PROBLEM_TEXT[parsedChapters.problem]}
                  </p>
                )}
                {loaded && publisher.ready && publisher.current && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <UndoPublishButton publisher={publisher} />
                    <PublishButton
                      publisher={publisher}
                      changes={{
                        description: descriptionWithChapters(
                          publisher.current.description,
                          chaptersBlock(parsedChapters.chapters),
                        ),
                      }}
                      label="chapters"
                      problem={
                        parsedChapters.problem ??
                        descriptionProblem(
                          descriptionWithChapters(
                            publisher.current.description,
                            chaptersBlock(parsedChapters.chapters),
                          ),
                        )
                      }
                      onDone={(now) =>
                        setDescription((draft) =>
                          descriptionWithChapters(
                            draft || now.description,
                            chaptersBlock(parsedChapters.chapters),
                          ),
                        )
                      }
                    >
                      Publish chapters
                    </PublishButton>
                  </div>
                )}
              </div>
            )}
            {optimizeTab === "cta" && (
              <div className="mt-4">
                {ctaIdeas.length ? (
                  <ul className="space-y-1.5">
                    {ctaIdeas.map((idea) => (
                      <li
                        key={idea}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-2.5 text-sm"
                      >
                        <span className="min-w-0 flex-1">{idea}</span>
                        {loaded && publisher.ready && publisher.current && (
                          <PublishButton
                            publisher={publisher}
                            changes={{
                              description: descriptionWithCallToAction(
                                publisher.current.description,
                                idea,
                              ),
                            }}
                            label="call to action"
                            problem={descriptionProblem(
                              descriptionWithCallToAction(publisher.current.description, idea),
                            )}
                            onDone={() =>
                              setDescription((draft) => descriptionWithCallToAction(draft, idea))
                            }
                          >
                            Add to YouTube description
                          </PublishButton>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyOptimizeState loaded={loaded} label="call-to-action ideas" />
                )}
                {loaded && publisher.ready && publisher.undoAvailable && (
                  <div className="mt-3 flex justify-end">
                    <UndoPublishButton publisher={publisher} />
                  </div>
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
                      referrerPolicy="no-referrer"
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
                      {video.privacyStatus
                        ? VISIBILITY_LABEL[videoVisibility(video)]
                        : "Status unavailable"}
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
                    ? "You own this video — save your work here."
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
                  Tubify will use this for more accurate analysis and suggestions.
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
                  Optional — adding a transcript helps Tubify write sharper suggestions. Tubify
                  never pulls captions automatically.
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
                className="mt-3 w-full resize-none rounded-[10px] border border-border bg-background p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-primary"
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
                className={cn(buttonSecondary, "disabled:cursor-not-allowed")}
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
              className={cn(buttonPrimary, "disabled:cursor-not-allowed")}
            >
              <Save className="h-4 w-4" />{" "}
              {saving ? "Saving…" : savedVideoId ? "Update" : "Save to Tubify"}
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3 w-3" /> This analysis is private to you.
      </p>

      {PRE_PUBLISH_ENABLED && (
        <PrePublishUploadDialog
          open={prePublishDialogOpen}
          onOpenChange={setPrePublishDialogOpen}
        />
      )}
      {publisher.dialog}
    </DashboardLayout>
  );
}

/** What an analysis raised, as text for the next one to re-check (newest format first). */
function previousIssueTexts(analysis: ContentAnalysis | null): string[] | undefined {
  if (!analysis) return undefined;
  const texts = analysis.issues?.map((issue) => issue.text) ?? analysis.weaknesses;
  const list = texts
    .map((text) => text.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 12);
  return list.length ? list : undefined;
}

/** The chapter list already in a description (the run of timestamp lines from 0:00), as text. */
function existingChapters(description: string): string {
  const lines = description.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => parseChapterLine(line)?.seconds === 0);
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length && parseChapterLine(lines[i]); i++)
    out.push(lines[i].trim());
  return out.join("\n");
}

// ---------- Content analysis pieces ----------

const scoreTone = (value: number) =>
  value >= 8 ? "success" : value >= 5 ? "warning" : ("destructive" as const);
const TONE_TEXT = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;
const TONE_BG = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
} as const;

function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "warning" | "attention" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "success" && "bg-success/15 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "attention" && "bg-primary/10 text-primary",
        tone === "neutral" && "bg-accent text-muted-foreground",
      )}
    >
      {tone === "success" && <Check className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The overall score as a ring: how full, and coloured by how good. */
function ScoreRing({ value }: { value: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const tone = scoreTone(value);
  return (
    <div
      className="relative mx-auto h-28 w-28"
      role="img"
      aria-label={`Overall score ${value.toFixed(1)} out of 10`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className="stroke-border" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(10, Math.max(0, value)) / 10)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700",
            tone === "success"
              ? "stroke-success"
              : tone === "warning"
                ? "stroke-warning"
                : "stroke-destructive",
          )}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        aria-hidden="true"
      >
        <span className={cn("text-2xl font-bold tabular-nums", TONE_TEXT[tone])}>
          {value.toFixed(1)}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Overall
        </span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const tone = scoreTone(value);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className={cn("font-semibold", TONE_TEXT[tone])}>{value.toFixed(1)}</span>/10
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={`${label} score`}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", TONE_BG[tone])}
          style={{ width: `${Math.min(100, Math.max(0, value * 10))}%` }}
        />
      </div>
    </div>
  );
}

/** Where the video stands: ready or not, the checklist's progress, and what fails. */
function ReadinessCard({
  ready,
  analyzed,
  checklist,
  showPassing,
  onTogglePassing,
  onFix,
}: {
  ready: boolean;
  analyzed: boolean;
  checklist: ChecklistItem[];
  showPassing: boolean;
  onTogglePassing: () => void;
  onFix: (tab: FixTab) => void;
}) {
  const applicable = checklist.filter((item) => item.status !== "na");
  const passing = applicable.filter((item) => item.status === "pass");
  const failing = checklist.filter((item) => item.status === "fail");
  const percent = applicable.length ? Math.round((passing.length / applicable.length) * 100) : 100;
  const headline = ready
    ? "Ready to publish"
    : failing.length
      ? `${failing.length} ${failing.length === 1 ? "thing" : "things"} to fix`
      : analyzed
        ? "Checklist complete — see what to improve below"
        : "Checklist complete — analyze for a full review";
  return (
    <div
      className={cn(
        "mt-4 rounded-xl border p-4",
        ready ? "border-success/30 bg-success/5" : "border-border bg-background",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            ready || !failing.length ? "bg-success/15 text-success" : "bg-primary/10 text-primary",
          )}
          aria-hidden="true"
        >
          {ready || !failing.length ? (
            <Check className="h-4 w-4" />
          ) : (
            <Target className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", ready && "text-success")}>{headline}</p>
          <p className="text-xs text-muted-foreground">
            Checklist: {passing.length} of {applicable.length} passing
          </p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700",
            failing.length ? "bg-primary" : "bg-success",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      {(failing.length > 0 || showPassing) && (
        <ul className="mt-3 divide-y divide-border">
          {[
            ...failing,
            ...(showPassing ? checklist.filter((item) => item.status !== "fail") : []),
          ].map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  item.status === "pass" && "bg-success/15 text-success",
                  item.status === "fail" && "bg-destructive/10 text-destructive",
                  item.status === "na" && "bg-accent text-muted-foreground",
                )}
                aria-label={
                  item.status === "pass"
                    ? "Passes"
                    : item.status === "fail"
                      ? "Fails"
                      : "Not applicable"
                }
              >
                {item.status === "pass" ? (
                  <Check className="h-3 w-3" />
                ) : item.status === "fail" ? (
                  <X className="h-3 w-3" />
                ) : (
                  <span className="text-[10px]">–</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn("block text-sm", item.status === "na" && "text-muted-foreground")}
                >
                  {item.label}
                </span>
                <span className="block text-xs text-muted-foreground">{item.detail}</span>
              </span>
              {item.status === "fail" && (
                <button
                  type="button"
                  onClick={() => onFix(item.fix)}
                  className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Fix
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onTogglePassing}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={showPassing}
      >
        {showPassing ? "Hide passing checks" : `Show ${passing.length} passing checks`}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", showPassing && "rotate-180")}
        />
      </button>
    </div>
  );
}

type Issue = { text: string; area: IssueArea; severity: "major" | "minor" };

/** Strengths, what to improve here, what was fixed, and context — as tabs with counts. */
function InsightTabs({
  strengths,
  fixable,
  context,
  resolved,
  legacyWeaknesses,
  onFix,
}: {
  strengths: string[];
  fixable: Issue[];
  context: Issue[];
  resolved: Array<{ text: string; reason: string }>;
  /** An analysis from before issues existed: its plain weaknesses, shown as they are. */
  legacyWeaknesses: string[] | null;
  onFix: (area: IssueArea) => void;
}) {
  type Key = "improve" | "strengths" | "fixed" | "context";
  const improveCount = legacyWeaknesses ? legacyWeaknesses.length : fixable.length;
  const tabs: Array<{ key: Key; label: string; count: number }> = [
    { key: "improve", label: legacyWeaknesses ? "Weaknesses" : "To improve", count: improveCount },
    { key: "strengths", label: "Strengths", count: strengths.length },
    ...(resolved.length ? [{ key: "fixed" as Key, label: "Fixed", count: resolved.length }] : []),
    ...(context.length ? [{ key: "context" as Key, label: "Context", count: context.length }] : []),
  ];
  const [active, setActive] = useState<Key>(improveCount ? "improve" : "strengths");
  const current = tabs.some((tab) => tab.key === active) ? active : "improve";

  return (
    <div className="mt-4">
      <div
        role="tablist"
        aria-label="Analysis findings"
        className="flex gap-1 overflow-x-auto rounded-full bg-accent/50 p-1"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={current === tab.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              current === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                current === tab.key ? "bg-accent" : "bg-background/70",
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-3">
        {current === "improve" &&
          (legacyWeaknesses ? (
            <FindingList
              items={legacyWeaknesses.map((text) => ({ text }))}
              icon="warning"
              empty="Nothing listed."
            />
          ) : fixable.length ? (
            <ul className="space-y-2">
              {fixable.map((issue) => (
                <li
                  key={issue.text}
                  className="flex items-start gap-3 rounded-xl border border-border bg-background p-3"
                >
                  <TriangleAlert
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      issue.severity === "major" ? "text-warning" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    {issue.text}
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {AREA_LABEL[issue.area]}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          issue.severity === "major"
                            ? "bg-warning/15 text-warning"
                            : "bg-accent text-muted-foreground",
                        )}
                      >
                        {issue.severity === "major" ? "Important" : "Optional"}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onFix(issue.area)}
                    className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
                  >
                    Fix
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              Nothing significant to improve in the title, description, tags or chapters.
            </p>
          ))}
        {current === "strengths" && (
          <FindingList
            items={strengths.map((text) => ({ text }))}
            icon="check"
            empty="None listed."
          />
        )}
        {current === "fixed" && (
          <FindingList
            items={resolved.map((r) => ({ text: r.text, note: r.reason }))}
            icon="check"
            strike
            empty="Nothing yet."
          />
        )}
        {current === "context" && (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              About the video itself — worth knowing, not something to change on this page.
            </p>
            <FindingList
              items={context.map((issue) => ({ text: issue.text, note: AREA_LABEL[issue.area] }))}
              icon="info"
              empty="Nothing listed."
            />
          </>
        )}
      </div>
    </div>
  );
}

function FindingList({
  items,
  icon,
  strike,
  empty,
}: {
  items: Array<{ text: string; note?: string }>;
  icon: "check" | "warning" | "info";
  strike?: boolean;
  empty: string;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const Icon = icon === "check" ? Check : icon === "warning" ? TriangleAlert : Info;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.text} className="flex items-start gap-2.5 text-sm">
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              icon === "check" && "bg-success/15 text-success",
              icon === "warning" && "bg-warning/15 text-warning",
              icon === "info" && "bg-accent text-muted-foreground",
            )}
            aria-hidden="true"
          >
            <Icon className="h-3 w-3" />
          </span>
          <span className="min-w-0">
            <span className={cn(strike && "text-muted-foreground line-through")}>{item.text}</span>
            {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}
          </span>
        </li>
      ))}
    </ul>
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
      <Link to="/settings" search={{ tab: "YouTube Integration" }} className={buttonPrimary}>
        {action}
      </Link>
    </div>
  );
}
