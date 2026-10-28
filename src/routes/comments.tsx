import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  Plus,
  AtSign,
  HelpCircle,
  Zap,
  AlertTriangle,
  Check,
  Pencil,
  Trash2,
  Eye,
  Search,
  X,
  Inbox,
  RefreshCw,
  Loader2,
  Play,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KpiCarousel } from "@/components/KpiCarousel";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { KpiTrendCardSkeleton } from "@/components/skeletons";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  RuleDialog,
  ConfirmDialog,
  type CommentRule,
  type CommentRuleInput,
} from "@/components/modals";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";
import { GENERIC_REPLY, matchRule } from "@/lib/comment-rule-match";

// ?video=<video id> opens the comments of that one video (the Videos page links here from a
// video's comment count). Only a short, URL-safe id is accepted, and it is checked again where it
// is read (the router also passes the raw parameter through from the root route). The comments
// API is the real check: it takes only a YouTube video id on the caller's own channel.
const VIDEO_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const videoParam = (value: unknown): string | undefined =>
  typeof value === "string" && VIDEO_PARAM.test(value) ? value : undefined;

export const Route = createFileRoute("/comments")({
  validateSearch: (search: Record<string, unknown>): { video?: string } => {
    const video = videoParam(search.video);
    return video ? { video } : {};
  },
  component: Comments,
});

const TRIGGER_META: Record<
  CommentRule["trigger_type"],
  { icon: typeof MessageSquare; color: string; label: string }
> = {
  keyword: { icon: MessageSquare, color: "purple", label: "Keyword match" },
  handle: { icon: AtSign, color: "blue", label: "@ handle detected" },
  question: { icon: HelpCircle, color: "green", label: "Ends in a question" },
};
const iconBg: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  blue: "bg-brand-blue/15 text-brand-blue",
  green: "bg-brand-green/15 text-brand-green",
};

const DAY_MS = 24 * 60 * 60 * 1000;

type YoutubeComment = {
  id: string;
  videoId: string;
  parentCommentId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  authorAvatarUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  canReply: boolean | null;
  /** Replies in the thread, as YouTube counts them. */
  replyCount?: number | null;
};
/** A reply in a comment's thread (GET /api/comment-replies/thread). */
type ThreadReply = {
  id: string;
  parentId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  authorAvatarUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  /** Written by the connected channel itself: it can be edited. */
  isOwn: boolean;
  /** The reply Tubify sent. */
  autoReply: boolean;
};
/** Thread and AI draft calls for one comment, bound to the active channel. */
type CommentActions = {
  loadThread: (commentId: string) => Promise<{ replies: ThreadReply[]; more: boolean }>;
  editReply: (commentId: string, replyId: string, text: string) => Promise<ThreadReply>;
  draftReply: (commentId: string, intent: string | null) => Promise<string | null>;
  aiAvailable: boolean;
};
type YoutubeVideoOption = { id: string; title: string };
/** The video a one-video comments view is about, for the preview at the top of the dialog. */
type VideoPreview = {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  views: number;
  comments: number | null;
  /** YouTube does not allow comments on this video (e.g. made for kids). */
  commentsDisabled?: boolean;
};
type SavedVideoOption = { id: string; title: string; youtube_video_id: string };
/** The server-side reply queue for bulk auto-replies (GET /api/comment-replies). */
type ReplyQueue = {
  counts: { queued: number; sending: number; sent: number; failed: number; skipped: number };
  allowance: {
    dailyCap: number;
    sentToday: number;
    workspaceRemaining: number;
    quotaRemainingReplies: number;
    remaining: number;
  };
  pendingCommentIds: string[];
  /** An AI provider is configured, so replies can be written by AI. */
  aiAvailable?: boolean;
};
/** Why the queue stopped for now: today's limits, YouTube's quota, a reconnect, or an error. */
type QueuePause = "daily_limit" | "quota" | "reconnect" | "error" | null;
type QueueOutcome = {
  queued: number;
  alreadyReplied: number;
  alreadyQueued: number;
  notOnChannel: number;
  truncated: boolean;
  status: ReplyQueue;
};
type QueueItemInput = { youtubeCommentId: string; replyText: string; ruleId: string | null };
type RecentReply = {
  id: string;
  youtube_comment_id: string;
  youtube_video_id: string;
  author_name: string | null;
  comment_text: string;
  reply_text: string;
  status: "sent" | "failed";
  created_at: string;
  rule: { id: string; name: string } | null;
};

type CommentsResponse =
  | { status: "not_connected"; data: null }
  | {
      status: "connected";
      data: {
        comments: YoutubeComment[];
        videos: YoutubeVideoOption[];
        video?: VideoPreview;
        /** All-videos view: where the next page of comments starts; null when there is none. */
        nextPageToken?: string | null;
      };
    }
  | { error: string };
type RulesResponse = { data?: CommentRule[]; activeRulesThirtyDaysAgo?: number; error?: string };
type RuleMutationResponse = { data?: CommentRule; error?: string };
type SavedVideosResponse = { status?: string; data?: { videos: SavedVideoOption[] } | null };
type QuotaResponse = { data?: { used: number; max: number } };
type ReplyStats = { sentLast30d: number; sentPrior30d: number };
type RepliesResponse = { data?: RecentReply[]; stats?: ReplyStats };

function changePct(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
type ReplyMutationResponse = { data?: RecentReply; error?: string };

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    CHANNEL_NOT_FOUND: "We couldn’t find your YouTube channel. Reconnect it in Settings.",
    DATABASE_ERROR: "We couldn’t save that. Please try again.",
    YOUTUBE_DATA_UNAVAILABLE: "YouTube isn’t responding right now. Please try again in a moment.",
    YOUTUBE_INSUFFICIENT_SCOPE: "Reconnect your YouTube channel to enable auto-replies.",
    YOUTUBE_COMMENT_REPLY_FAILED: "That reply couldn’t be sent. Please try again.",
    ALREADY_REPLIED: "That comment already has a reply.",
    ALREADY_QUEUED: "A reply to that comment is already queued.",
    DAILY_REPLY_LIMIT: "Today’s auto-reply limit is reached. Replies continue tomorrow.",
    QUOTA_RESERVE_REACHED: "Today’s YouTube quota for replies is used up. Try again tomorrow.",
    YOUTUBE_QUOTA_EXCEEDED: "YouTube’s daily quota is used up. Try again tomorrow.",
    COMMENT_NOT_FOUND: "That comment wasn’t found on your channel.",
    REPLIES_DISABLED: "Replies are turned off for that comment.",
    YOUTUBE_REAUTH_REQUIRED: "Reconnect your YouTube channel in Settings.",
    AI_NOT_CONFIGURED: "AI replies aren’t available right now.",
    AI_REPLY_FAILED: "The AI couldn’t write a reply. Please try again.",
    RATE_LIMIT_EXCEEDED: "You’ve reached your AI limit for now. Try again later.",
    VIDEO_NOT_FOUND: "We couldn’t find that video on your channel.",
    REPLY_NOT_FOUND: "Only your channel’s own replies can be edited.",
    YOUTUBE_COMMENT_UPDATE_FAILED: "That reply couldn’t be updated. Please try again.",
    VALIDATION_ERROR: "That request wasn’t valid. Please try again.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function Comments() {
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const requestedVideo = videoParam(Route.useSearch().video);
  // "Show all videos" switches the dialog straight away (and also clears the address); a new
  // ?video= starts a one-video view again.
  const [showAllVideos, setShowAllVideos] = useState(false);
  useEffect(() => setShowAllVideos(false), [requestedVideo]);
  const videoFilter = showAllVideos ? undefined : requestedVideo;
  const [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null);
  const navigate = useNavigate();

  const [rules, setRules] = useState<CommentRule[]>([]);
  const [activeRulesThirtyDaysAgo, setActiveRulesThirtyDaysAgo] = useState<number | null>(null);
  const [rulesStatus, setRulesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rulesRetryToken, setRulesRetryToken] = useState(0);
  const [savedVideos, setSavedVideos] = useState<SavedVideoOption[]>([]);
  const videoIdByRuleVideoId = useMemo(
    () => new Map(savedVideos.map((v) => [v.id, v.youtube_video_id])),
    [savedVideos],
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CommentRule | null>(null);
  const [deleting, setDeleting] = useState<CommentRule | null>(null);

  const [comments, setComments] = useState<YoutubeComment[]>([]);
  const [commentVideos, setCommentVideos] = useState<YoutubeVideoOption[]>([]);
  const [commentsStatus, setCommentsStatus] = useState<
    "loading" | "ready" | "error" | "not_connected" | "reauth"
  >("loading");
  const [commentsRetryToken, setCommentsRetryToken] = useState(0);
  const [nextCommentsPage, setNextCommentsPage] = useState<string | null>(null);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [viewingComments, setViewingComments] = useState(false);

  const [quota, setQuota] = useState<{ used: number; max: number } | null>(null);
  const [recentReplies, setRecentReplies] = useState<RecentReply[]>([]);
  const [replyStats, setReplyStats] = useState<ReplyStats | null>(null);
  const [insufficientScope, setInsufficientScope] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRulesStatus("loading");
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/comment-rules?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as RulesResponse;
        if (!response.ok || !body.data) throw new Error();
        setRules(body.data);
        setActiveRulesThirtyDaysAgo(body.activeRulesThirtyDaysAgo ?? null);
        setRulesStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRulesStatus("error");
      });
    return () => controller.abort();
  }, [activeChannelId, rulesRetryToken]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/videos?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as SavedVideosResponse;
        if (response.ok && body.status === "connected" && body.data)
          setSavedVideos(body.data.videos);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeChannelId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/youtube/quota?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as QuotaResponse;
        if (response.ok && body.data) setQuota(body.data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeChannelId]);

  const loadRecentReplies = () => {
    const params = new URLSearchParams({ limit: "50" });
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/comment-rules/replies?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as RepliesResponse;
        if (response.ok && body.data) setRecentReplies(body.data);
        if (response.ok && body.stats) setReplyStats(body.stats);
      })
      .catch(() => {});
  };
  useEffect(loadRecentReplies, [activeChannelId]);

  // The server-side reply queue for bulk replies: its progress, and — while this page is open —
  // asking the server for the next small batch every few seconds. The server sends only within
  // the workspace's daily limit and the app's quota reserve; what is left goes out on following
  // days (a daily job), whether or not this page is open.
  const [replyQueue, setReplyQueue] = useState<ReplyQueue | null>(null);
  const [queuePause, setQueuePause] = useState<QueuePause>(null);
  const loadReplyQueue = () => {
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/comment-replies?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: ReplyQueue };
        if (response.ok && body.data) setReplyQueue(body.data);
      })
      .catch(() => {});
  };
  useEffect(loadReplyQueue, [activeChannelId]);
  const queueWaiting = replyQueue ? replyQueue.counts.queued + replyQueue.counts.sending : 0;
  useEffect(() => {
    if (!queueWaiting || queuePause) return;
    const timer = setTimeout(() => {
      fetch("/api/comment-replies/process", { method: "POST", cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as { data?: { paused: QueuePause } };
          setQueuePause(response.ok && body.data ? body.data.paused : "error");
        })
        .catch(() => setQueuePause("error"))
        .finally(() => {
          loadReplyQueue();
          loadRecentReplies();
        });
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyQueue, queuePause]);
  const queuedCommentIds = useMemo(
    () => new Set(replyQueue?.pendingCommentIds ?? []),
    [replyQueue],
  );
  const postQueue = async (body: unknown): Promise<QueueOutcome> => {
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    const response = await fetch(`/api/comment-replies?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { data?: QueueOutcome; error?: string };
    if (!response.ok || !result.data)
      throw new Error(errorMessage(result.error ?? "YOUTUBE_DATA_UNAVAILABLE"));
    setReplyQueue(result.data.status);
    setQueuePause(null);
    return result.data;
  };
  // Selected comments, 500 per request (the server's limit).
  const queueSelectedReplies = async (
    items: QueueItemInput[],
    ai: boolean,
  ): Promise<QueueOutcome> => {
    const total: QueueOutcome = {
      queued: 0,
      alreadyReplied: 0,
      alreadyQueued: 0,
      notOnChannel: 0,
      truncated: false,
      status: replyQueue as ReplyQueue,
    };
    for (let i = 0; i < items.length; i += 500) {
      const part = await postQueue({ mode: "selected", items: items.slice(i, i + 500), ai });
      total.queued += part.queued;
      total.alreadyReplied += part.alreadyReplied;
      total.alreadyQueued += part.alreadyQueued;
      total.notOnChannel += part.notOnChannel;
      total.status = part.status;
    }
    return total;
  };
  const queueAllReplies = (ai: boolean) => postQueue({ mode: "all", ai });

  // One comment's thread (replies, and editing the channel's own), and AI-written drafts.
  const channelQuery = () => {
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    return params;
  };
  const callJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!response.ok || body.data === undefined) {
      if (body.error === "YOUTUBE_INSUFFICIENT_SCOPE") setInsufficientScope(true);
      throw new Error(errorMessage(body.error ?? "YOUTUBE_DATA_UNAVAILABLE"));
    }
    return body.data;
  };
  const commentActions: CommentActions = {
    aiAvailable: replyQueue?.aiAvailable ?? false,
    loadThread: (commentId) => {
      const params = channelQuery();
      params.set("commentId", commentId);
      return callJson(`/api/comment-replies/thread?${params.toString()}`);
    },
    editReply: async (commentId, replyId, text) => {
      const updated = await callJson<ThreadReply>(
        `/api/comment-replies/thread?${channelQuery().toString()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId, replyId, text }),
        },
      );
      loadRecentReplies();
      return updated;
    },
    draftReply: async (commentId, intent) => {
      const draft = await callJson<{ text: string | null }>(
        `/api/comment-replies/draft?${channelQuery().toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeCommentId: commentId, intent }),
        },
      );
      return draft.text;
    },
  };
  const cancelReplyQueue = async () => {
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    await fetch(`/api/comment-replies?${params.toString()}`, { method: "DELETE" }).catch(() => {});
    loadReplyQueue();
  };

  useEffect(() => {
    const controller = new AbortController();
    setCommentsStatus("loading");
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    if (videoFilter) params.set("videoId", videoFilter);
    fetch(`/api/youtube/comments?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as CommentsResponse;
        if (response.status === 401) {
          setCommentsStatus("reauth");
          return;
        }
        if ("status" in body && body.status === "not_connected") {
          setCommentsStatus("not_connected");
          return;
        }
        if (!response.ok || !("data" in body) || !body.data) throw new Error();
        setComments(body.data.comments);
        setCommentVideos(body.data.videos);
        setVideoPreview(body.data.video ?? null);
        setNextCommentsPage(body.data.nextPageToken ?? null);
        setCommentsStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCommentsStatus("error");
      });
    return () => controller.abort();
  }, [activeChannelId, commentsRetryToken, videoFilter]);

  // Arriving from a video's comment count: show its comments straight away.
  useEffect(() => {
    if (videoFilter) setViewingComments(true);
  }, [videoFilter]);
  // The next page (up to 100) of comments across every video, added to what is already shown.
  const loadMoreComments = async () => {
    if (!nextCommentsPage || loadingMoreComments) return;
    setLoadingMoreComments(true);
    try {
      const params = new URLSearchParams({ pageToken: nextCommentsPage });
      if (activeChannelId) params.set("channelId", activeChannelId);
      const response = await fetch(`/api/youtube/comments?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as CommentsResponse;
      if (!response.ok || !("data" in body) || !body.data) throw new Error();
      const page = body.data;
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.comments.filter((c) => !seen.has(c.id))];
      });
      setCommentVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        return [...prev, ...page.videos.filter((v) => !seen.has(v.id))];
      });
      setNextCommentsPage(page.nextPageToken ?? null);
    } catch {
      toast.error("We couldn’t load more comments. Please try again.");
    } finally {
      setLoadingMoreComments(false);
    }
  };

  const clearVideoFilter = () => {
    setShowAllVideos(true);
    void navigate({ to: "/comments", search: {}, replace: true });
  };

  const saveRule = async (input: CommentRuleInput, id?: string) => {
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    if (id) params.set("id", id);
    const response = await fetch(`/api/comment-rules?${params.toString()}`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as RuleMutationResponse;
    if (!response.ok || !body.data) throw new Error(errorMessage(body.error ?? "DATABASE_ERROR"));
    const saved = body.data;
    setRules((current) =>
      id ? current.map((x) => (x.id === id ? saved : x)) : [saved, ...current],
    );
  };

  const toggleRule = async (rule: CommentRule) => {
    const previous = rules;
    setRules((current) => current.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    const params = new URLSearchParams({ id: rule.id });
    if (activeChannelId) params.set("channelId", activeChannelId);
    try {
      const response = await fetch(`/api/comment-rules?${params.toString()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!response.ok) throw new Error();
      toast.success(`Rule ${!rule.active ? "activated" : "paused"}`);
    } catch {
      setRules(previous);
      toast.error("We couldn’t update that rule. Please try again.");
    }
  };

  const removeRule = async (rule: CommentRule) => {
    const previous = rules;
    setRules((current) => current.filter((r) => r.id !== rule.id));
    try {
      const response = await fetch(`/api/comment-rules?id=${rule.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast.success("Rule deleted");
    } catch {
      setRules(previous);
      toast.error("We couldn’t delete that rule. Please try again.");
    }
  };

  const sendReply = async (
    comment: YoutubeComment,
    rule: CommentRule | undefined,
    replyText: string,
  ) => {
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    const response = await fetch(`/api/comment-rules/replies?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleId: rule?.id ?? null,
        youtubeCommentId: comment.id,
        youtubeVideoId: comment.videoId,
        authorName: comment.authorName,
        authorChannelId: comment.authorChannelId,
        authorAvatarUrl: comment.authorAvatarUrl,
        commentText: comment.text,
        replyText,
      }),
    });
    const body = (await response.json()) as ReplyMutationResponse;
    if (!response.ok) {
      if (body.error === "YOUTUBE_INSUFFICIENT_SCOPE") setInsufficientScope(true);
      throw new Error(errorMessage(body.error ?? "YOUTUBE_COMMENT_REPLY_FAILED"));
    }
    loadRecentReplies();
    if (rule)
      setRules((current) =>
        current.map((r) => (r.id === rule.id ? { ...r, firedCount: r.firedCount + 1 } : r)),
      );
  };

  const repliedCommentIds = useMemo(
    () =>
      new Set(recentReplies.filter((r) => r.status === "sent").map((r) => r.youtube_comment_id)),
    [recentReplies],
  );
  const igHandlesDetected = useMemo(
    () => comments.filter((c) => /@\w+/.test(c.text)).length,
    [comments],
  );
  // Split by the comment's own real publish date (from YouTube), not by when this page happened to
  // fetch it — same 30-day-window comparison as the reply stats below, just computed client-side
  // since comments aren't persisted with a scan history to query server-side.
  const now = Date.now();
  const igHandlesLast30d = useMemo(
    () =>
      comments.filter(
        (c) =>
          /@\w+/.test(c.text) &&
          c.publishedAt &&
          now - new Date(c.publishedAt).getTime() <= 30 * DAY_MS,
      ).length,
    [comments, now],
  );
  const igHandlesPrior30d = useMemo(
    () =>
      comments.filter((c) => {
        if (!/@\w+/.test(c.text) || !c.publishedAt) return false;
        const age = now - new Date(c.publishedAt).getTime();
        return age > 30 * DAY_MS && age <= 60 * DAY_MS;
      }).length,
    [comments, now],
  );
  const igHandlesChangePct = changePct(igHandlesLast30d, igHandlesPrior30d);

  const autoRepliesChangePct = replyStats
    ? changePct(replyStats.sentLast30d, replyStats.sentPrior30d)
    : null;

  const activeRulesNow = rules.filter((r) => r.active).length;
  const activeRulesChangePct =
    activeRulesThirtyDaysAgo !== null ? changePct(activeRulesNow, activeRulesThirtyDaysAgo) : null;

  const quotaPct = quota ? Math.round((quota.used / quota.max) * 100) : 0;

  return (
    <DashboardLayout title="Comment Automation">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comment Automation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-reply by keyword, @handle, or question.
          </p>
        </div>
        {/* Phones: the three actions share one row equally, with short labels (the full names
            stay their accessible names). Wider screens: as before. */}
        <div className="flex w-full items-center gap-1.5 sm:w-auto sm:flex-wrap sm:gap-2">
          <Link
            to="/leads"
            aria-label="Lead Inbox"
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent sm:flex-none sm:gap-2 sm:px-3.5 sm:text-sm"
          >
            <Inbox className="h-4 w-4 shrink-0" />
            <span className="sm:hidden">Inbox</span>
            <span className="hidden sm:inline">Lead Inbox</span>
          </Link>
          <button
            onClick={() => setViewingComments(true)}
            aria-label="View All Comments"
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent sm:flex-none sm:gap-2 sm:px-3.5 sm:text-sm"
          >
            <Eye className="h-4 w-4 shrink-0" />
            <span className="sm:hidden">Comments</span>
            <span className="hidden sm:inline">View All Comments</span>
          </button>
          <button
            onClick={() => setCreating(true)}
            data-onboarding-step="comments"
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 sm:flex-none sm:gap-2 sm:px-3.5 sm:text-sm"
          >
            <Plus className="h-4 w-4 shrink-0" /> New Rule
          </button>
        </div>
      </div>

      {insufficientScope && (
        <div className="mt-5">
          <YoutubeReauthNotice />
        </div>
      )}

      <KpiCarousel
        className="mt-6"
        gridClassName="gap-3 sm:grid-cols-3"
        loading={rulesStatus === "loading" || commentsStatus === "loading"}
        aria-label={
          rulesStatus === "loading" || commentsStatus === "loading"
            ? "Loading key metrics"
            : undefined
        }
      >
        {rulesStatus === "loading" || commentsStatus === "loading" ? (
          <>
            <KpiTrendCardSkeleton />
            <KpiTrendCardSkeleton />
            <KpiTrendCardSkeleton />
          </>
        ) : (
          <>
            <KpiTrendCard
              title="Auto-replies"
              accent="var(--brand-purple)"
              value={replyStats ? String(replyStats.sentLast30d) : String(recentReplies.length)}
              deltaLabel={
                autoRepliesChangePct !== null && replyStats
                  ? `${replyStats.sentLast30d - replyStats.sentPrior30d >= 0 ? "+" : ""}${replyStats.sentLast30d - replyStats.sentPrior30d}`
                  : "—"
              }
              deltaSuffix="vs prior 30 days"
              changePercent={autoRepliesChangePct}
              periodLabel="vs prior 30 days"
              series={replyStats ? [replyStats.sentPrior30d, replyStats.sentLast30d] : []}
              markerTitle={replyStats ? `${replyStats.sentLast30d} replies` : "—"}
              markerSubtitle="last 30 days"
              positive={(autoRepliesChangePct ?? 0) >= 0}
            />
            <KpiTrendCard
              title="Active Rules"
              accent="var(--brand-green)"
              value={String(activeRulesNow)}
              deltaLabel={
                activeRulesThirtyDaysAgo !== null
                  ? `${activeRulesNow - activeRulesThirtyDaysAgo >= 0 ? "+" : ""}${activeRulesNow - activeRulesThirtyDaysAgo}`
                  : "—"
              }
              deltaSuffix="vs 30 days ago"
              changePercent={activeRulesChangePct}
              periodLabel="vs 30 days ago"
              series={
                activeRulesThirtyDaysAgo !== null ? [activeRulesThirtyDaysAgo, activeRulesNow] : []
              }
              markerTitle={`${activeRulesNow} active`}
              markerSubtitle="right now"
              positive={(activeRulesChangePct ?? 0) >= 0}
            />
            <KpiTrendCard
              title="IG Handles Detected"
              accent="var(--brand-blue)"
              value={String(igHandlesLast30d)}
              deltaLabel={
                igHandlesChangePct !== null
                  ? `${igHandlesLast30d - igHandlesPrior30d >= 0 ? "+" : ""}${igHandlesLast30d - igHandlesPrior30d}`
                  : "—"
              }
              deltaSuffix="vs prior 30 days"
              changePercent={igHandlesChangePct}
              periodLabel="vs prior 30 days"
              series={[igHandlesPrior30d, igHandlesLast30d]}
              markerTitle={`${igHandlesLast30d} handles`}
              markerSubtitle="last 30 days"
              positive={(igHandlesChangePct ?? 0) >= 0}
            />
          </>
        )}
      </KpiCarousel>

      {quota && (
        <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className={`h-5 w-5 ${quotaPct > 80 ? "text-warning" : "text-muted-foreground"}`}
              />
              <h3 className="font-semibold">YouTube API Quota</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              {quota.used.toLocaleString()} / {quota.max.toLocaleString()} units today
            </span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-accent">
            <div
              className={`h-full rounded-full ${quotaPct > 80 ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${quotaPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each auto-reply costs 50 units — max ~200/day. Resets at midnight UTC.
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {rulesStatus === "loading" && (
            <div className="space-y-4" aria-label="Loading rules" aria-busy="true">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-border p-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {rulesStatus === "error" && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">We couldn’t load your rules.</p>
              <button
                type="button"
                onClick={() => setRulesRetryToken((n) => n + 1)}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          )}

          {rulesStatus === "ready" && rules.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">No rules yet.</p>
              <button
                onClick={() => setCreating(true)}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" /> Create your first rule
              </button>
            </div>
          )}

          {rulesStatus === "ready" &&
            rules.map((r) => {
              const meta = TRIGGER_META[r.trigger_type];
              const Icon = meta.icon;
              return (
                <div key={r.id} className="relative rounded-xl card-gradient-outline p-5">
                  <GlowingEffect
                    spread={40}
                    glow
                    disabled={false}
                    proximity={64}
                    inactiveZone={0.01}
                  />
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg[meta.color]}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.firedCount} replies · {r.video?.title ?? "All videos"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing(r)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleting(r)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <Switch
                        checked={r.active}
                        onCheckedChange={() => void toggleRule(r)}
                        aria-label="Toggle rule"
                      />
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      <span className="text-foreground">Trigger:</span>{" "}
                      {r.trigger_type === "keyword"
                        ? `Comment contains: ${r.keywords.join(", ")}`
                        : meta.label}
                    </p>
                    <div className="rounded-xl border border-border bg-background p-3 text-muted-foreground">
                      <span className="text-[11px] uppercase tracking-wide text-brand-purple">
                        Auto-reply
                      </span>
                      <p className="mt-1 text-foreground">{r.reply_template}</p>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="font-semibold">Recent Triggers</h3>
          <div className="mt-4 space-y-3">
            {recentReplies.length === 0 && (
              <p className="text-sm text-muted-foreground">No auto-replies sent yet.</p>
            )}
            {recentReplies.slice(0, 6).map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.author_name ?? "Unknown"}</span>
                  <span className="text-[11px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">&quot;{c.comment_text}&quot;</p>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5",
                      c.status === "sent"
                        ? "bg-brand-purple/15 text-brand-purple"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {c.status === "sent" ? (c.rule?.name ?? "Auto-reply") : "Failed"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <RuleDialog
        open={creating}
        onOpenChange={setCreating}
        videos={savedVideos}
        onSave={saveRule}
      />
      <RuleDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        initial={editing}
        videos={savedVideos}
        onSave={saveRule}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        onConfirm={() => {
          if (deleting) void removeRule(deleting);
          setDeleting(null);
        }}
      />
      <AllCommentsDialog
        open={viewingComments}
        onOpenChange={(next) => {
          setViewingComments(next);
          // Closing the one-video view returns the page to its usual recent comments.
          if (!next && videoFilter) clearVideoFilter();
        }}
        moreOnYoutube={
          !videoFilter && nextCommentsPage
            ? { loading: loadingMoreComments, onLoad: () => void loadMoreComments() }
            : null
        }
        videoFilter={
          videoFilter
            ? {
                title:
                  commentVideos.find((v) => v.id === videoFilter)?.title ??
                  (commentsStatus === "loading" ? "…" : "this video"),
                onClear: clearVideoFilter,
                preview: videoPreview?.id === videoFilter ? videoPreview : null,
              }
            : null
        }
        status={commentsStatus}
        onRetry={() => setCommentsRetryToken((n) => n + 1)}
        comments={comments}
        videos={commentVideos}
        rules={rules}
        videoIdByRuleVideoId={videoIdByRuleVideoId}
        repliedCommentIds={repliedCommentIds}
        onSendReply={sendReply}
        queue={{
          state: replyQueue,
          pause: queuePause,
          queuedIds: queuedCommentIds,
          onQueueSelected: queueSelectedReplies,
          onQueueAll: queueAllReplies,
          onCancel: cancelReplyQueue,
        }}
        actions={commentActions}
      />
    </DashboardLayout>
  );
}

const compactCount = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

// The comments dialog renders a long list this many at a time.
const COMMENTS_PAGE = 40;

function AllCommentsDialog({
  open,
  onOpenChange,
  status,
  onRetry,
  comments,
  videos,
  rules,
  videoIdByRuleVideoId,
  repliedCommentIds,
  onSendReply,
  videoFilter,
  moreOnYoutube,
  queue,
  actions,
}: {
  open: boolean;
  actions: CommentActions;
  /** The server-side reply queue: progress, today's allowance, and how to add to or cancel it. */
  queue: {
    state: ReplyQueue | null;
    pause: QueuePause;
    queuedIds: Set<string>;
    onQueueSelected: (items: QueueItemInput[], ai: boolean) => Promise<QueueOutcome>;
    onQueueAll: (ai: boolean) => Promise<QueueOutcome>;
    onCancel: () => Promise<void>;
  };
  onOpenChange: (v: boolean) => void;
  /** Showing one video's comments (from the Videos page), and how to go back to all. */
  videoFilter: { title: string; onClear: () => void; preview: VideoPreview | null } | null;
  /** More comments are on YouTube than have been loaded so far, and how to fetch them. */
  moreOnYoutube: { loading: boolean; onLoad: () => void } | null;
  status: "loading" | "ready" | "error" | "not_connected" | "reauth";
  onRetry: () => void;
  comments: YoutubeComment[];
  videos: YoutubeVideoOption[];
  rules: CommentRule[];
  videoIdByRuleVideoId: Map<string, string>;
  repliedCommentIds: Set<string>;
  onSendReply: (
    comment: YoutubeComment,
    rule: CommentRule | undefined,
    replyText: string,
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unreplied" | "replied">("all");
  const [query, setQuery] = useState("");
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setFilter("all");
      setQuery("");
    }
  }, [open]);

  const videoTitle = (id: string) => videos.find((v) => v.id === id)?.title ?? "Unknown video";

  const repliedCount = comments.filter((c) => repliedCommentIds.has(c.id)).length;
  const unrepliedCount = comments.length - repliedCount;
  const q = query.trim().toLowerCase();
  const visible = comments.filter((c) => {
    const replied = repliedCommentIds.has(c.id);
    if (filter === "replied" && !replied) return false;
    if (filter === "unreplied" && replied) return false;
    if (!q) return true;
    return (c.authorName ?? "").toLowerCase().includes(q) || c.text.toLowerCase().includes(q);
  });

  const pending = visible.filter(
    (c) => !repliedCommentIds.has(c.id) && !queue.queuedIds.has(c.id) && c.canReply !== false,
  );
  const allPendingSelected = pending.length > 0 && pending.every((c) => selected.has(c.id));

  const toggleAll = () =>
    setSelected(allPendingSelected ? new Set() : new Set(pending.map((c) => c.id)));
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const replyOne = async (comment: YoutubeComment, replyText: string) => {
    const rule = matchRule(comment, rules, videoIdByRuleVideoId);
    setSendingIds((prev) => new Set(prev).add(comment.id));
    try {
      await onSendReply(comment, rule, replyText);
      toast.success(`Auto-replied to ${comment.authorName ?? "commenter"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That reply couldn’t be sent.");
    } finally {
      setSendingIds((prev) => {
        const next = new Set(prev);
        next.delete(comment.id);
        return next;
      });
    }
  };

  // Bulk replies go to the server's queue (never a loop of sends from this browser), after a
  // confirmation that says how many can go out today.
  const [confirming, setConfirming] = useState<null | "selected" | "all">(null);
  // AI replies (on by default when available): each reply is written for its own comment from the
  // video's details when it is sent, instead of the same template text for every comment.
  const [useAi, setUseAi] = useState(true);
  const aiReplies = actions.aiAvailable && useAi;
  const summarize = (outcome: QueueOutcome) =>
    [
      `Queued ${outcome.queued} repl${outcome.queued === 1 ? "y" : "ies"}`,
      outcome.alreadyReplied ? `${outcome.alreadyReplied} already replied` : "",
      outcome.alreadyQueued ? `${outcome.alreadyQueued} already queued` : "",
      outcome.notOnChannel ? `${outcome.notOnChannel} not found on your channel` : "",
      outcome.truncated ? "the newest 2,000 comments this time" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const confirmQueue = async () => {
    const mode = confirming;
    if (!mode) return;
    setBulkSending(true);
    try {
      const outcome =
        mode === "all"
          ? await queue.onQueueAll(aiReplies)
          : await queue.onQueueSelected(
              [...selected].flatMap((id) => {
                const comment = comments.find((c) => c.id === id);
                if (!comment) return [];
                const rule = matchRule(comment, rules, videoIdByRuleVideoId);
                return [
                  {
                    youtubeCommentId: id,
                    replyText: rule?.reply_template ?? GENERIC_REPLY,
                    ruleId: rule?.id ?? null,
                  },
                ];
              }),
              aiReplies,
            );
      setSelected(new Set());
      toast.success(summarize(outcome));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn’t queue those replies.");
    } finally {
      setBulkSending(false);
      setConfirming(null);
    }
  };
  const allowance = queue.state?.allowance ?? null;
  const waiting = queue.state ? queue.state.counts.queued + queue.state.counts.sending : 0;
  const pauseText: Record<Exclude<QueuePause, null>, string> = {
    daily_limit: "today’s limit reached — continues tomorrow",
    quota: "YouTube’s daily quota is used up — continues tomorrow",
    reconnect: "reconnect YouTube in Settings to continue",
    error: "paused — retries when you reopen this page",
  };

  // Long lists render a page at a time; any change of filter, search or comments starts over.
  const [shown, setShown] = useState(COMMENTS_PAGE);
  useEffect(() => setShown(COMMENTS_PAGE), [filter, q, comments, open]);
  const rendered = visible.slice(0, shown);
  // While more comments are on YouTube, the counts are of what has been loaded so far.
  const more = moreOnYoutube ? "+" : "";

  // Phones: a full-screen sheet. Wider screens: a centred window at most 85% of the screen tall.
  // Either way the header (title, video, search, filters) and the footer (bulk reply) stay put
  // and only the list between them scrolls, however many comments there are.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="shrink-0 space-y-3 border-b border-border px-4 pb-3 pt-5 sm:px-6 sm:pt-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>{videoFilter ? "Video Comments" : "All Comments"}</DialogTitle>
            <DialogDescription>Reply individually or in bulk.</DialogDescription>
          </DialogHeader>
          {videoFilter && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-accent/30 p-2.5">
              {videoFilter.preview?.thumbnail ? (
                <img
                  src={videoFilter.preview.thumbnail}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-24 shrink-0 rounded-md object-cover sm:w-32"
                />
              ) : (
                <div className="flex aspect-video w-24 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground sm:w-32">
                  <Play className="h-4 w-4" aria-hidden />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">Comments on</p>
                <p className="line-clamp-2 text-sm font-semibold leading-snug">
                  {videoFilter.preview?.title ?? videoFilter.title}
                </p>
                {videoFilter.preview && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {[
                      videoFilter.preview.publishedAt &&
                        new Date(videoFilter.preview.publishedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }),
                      videoFilter.preview.duration,
                      `${compactCount(videoFilter.preview.views)} views`,
                      videoFilter.preview.comments !== null &&
                        `${compactCount(videoFilter.preview.comments)} comments`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={videoFilter.onClear}
                  className="mt-1 text-xs font-medium text-primary hover:underline"
                >
                  Show all videos
                </button>
              </div>
            </div>
          )}

          {status === "ready" && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by username or keyword..."
                  aria-label="Search comments"
                  className="h-9 w-full rounded-full border border-border bg-accent/20 pl-9 pr-9 text-sm outline-none focus:border-primary"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {/* One row of filters; it scrolls sideways rather than wrapping on narrow screens. */}
              <div
                role="group"
                aria-label="Filter comments"
                className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6"
              >
                {(
                  [
                    ["all", `All (${comments.length}${more})`],
                    ["unreplied", `Unreplied (${unrepliedCount}${more})`],
                    ["replied", `Replied (${repliedCount})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium ${filter === key ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
          {status === "loading" && (
            <div className="space-y-2" aria-label="Loading comments" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          )}

          {status === "not_connected" && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Connect a YouTube channel in Settings to see your comments.
            </p>
          )}

          {status === "reauth" && <YoutubeReauthNotice />}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">We couldn’t load your comments.</p>
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          )}

          {status === "ready" && (
            <div className="space-y-2">
              {/* Empty: say what was looked at, so "nothing here" never reads as "not loaded". */}
              {visible.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {comments.length === 0 ? (
                    <>
                      <p className="font-medium text-foreground">
                        {videoFilter?.preview?.commentsDisabled
                          ? "Comments are turned off for this video"
                          : videoFilter
                            ? "This video has no comments yet"
                            : "No comments yet"}
                      </p>
                      <p className="mt-1 text-xs">
                        {videoFilter?.preview?.commentsDisabled
                          ? "YouTube doesn’t allow comments on it — for example, a video made for kids. You can change this in YouTube Studio."
                          : `${videoFilter ? "YouTube returned no comments for it." : "YouTube returned no comments on any of your videos."} New comments appear here when you open this again.`}
                      </p>
                    </>
                  ) : q ? (
                    <p>No comments match &quot;{query.trim()}&quot;.</p>
                  ) : filter === "replied" ? (
                    <p>You haven&apos;t replied to any of these comments yet.</p>
                  ) : filter === "unreplied" ? (
                    <p>Every comment here has a reply.</p>
                  ) : (
                    <p>No comments.</p>
                  )}
                </div>
              )}
              {rendered.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  videoTitle={videoTitle(c.videoId)}
                  rule={matchRule(c, rules, videoIdByRuleVideoId)}
                  replied={repliedCommentIds.has(c.id)}
                  queued={queue.queuedIds.has(c.id)}
                  sending={sendingIds.has(c.id)}
                  selected={selected.has(c.id)}
                  onToggleSelect={() => toggleOne(c.id)}
                  onReply={(text) => void replyOne(c, text)}
                  showVideo={!videoFilter}
                  actions={actions}
                />
              ))}
              {visible.length > rendered.length && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + COMMENTS_PAGE)}
                  className="w-full rounded-xl border border-border py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Show more ({visible.length - rendered.length} more)
                </button>
              )}
              {/* Everything loaded is shown: fetch the next page of comments from YouTube. */}
              {visible.length <= rendered.length && moreOnYoutube && (
                <button
                  type="button"
                  onClick={moreOnYoutube.onLoad}
                  disabled={moreOnYoutube.loading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
                >
                  {moreOnYoutube.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Load more from YouTube
                </button>
              )}
            </div>
          )}
        </div>

        {status === "ready" && (
          <div
            className="shrink-0 space-y-2 border-t border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-6"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            {waiting > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5" aria-live="polite">
                  {!queue.pause && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
                  <span className="truncate">
                    {waiting} waiting · {allowance?.sentToday ?? 0} sent today
                    {queue.pause ? ` · ${pauseText[queue.pause]}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void queue.onCancel()}
                  className="shrink-0 font-medium text-primary hover:underline"
                >
                  Cancel remaining
                </button>
              </div>
            )}
            {confirming ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {confirming === "all"
                    ? `Reply to every unreplied comment on your channel (the newest 2,000 at a time)? `
                    : `Queue ${selected.size} repl${selected.size === 1 ? "y" : "ies"}? `}
                  {allowance
                    ? `Up to ${
                        confirming === "all"
                          ? allowance.remaining
                          : Math.min(selected.size, allowance.remaining)
                      } go out today (limit ${allowance.dailyCap} a day); the rest continue on the following days.`
                    : "They go out a few at a time within today’s limit; the rest continue on the following days."}
                </p>
                {actions.aiAvailable && (
                  <label className="flex w-full items-center gap-2 text-xs">
                    <Switch checked={useAi} onCheckedChange={setUseAi} aria-label="AI replies" />
                    <span className="min-w-0">
                      <span className="font-medium">AI replies</span>
                      <span className="text-muted-foreground">
                        {useAi
                          ? " · each reply is written for its comment from the video’s description and details; spam is skipped"
                          : " · every comment gets its rule’s reply text"}
                      </span>
                    </span>
                  </label>
                )}
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="h-9 rounded-full border border-border px-3.5 text-xs font-medium hover:bg-accent"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmQueue()}
                    disabled={bulkSending}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {bulkSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Queue
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={allPendingSelected}
                    onCheckedChange={toggleAll}
                    disabled={pending.length === 0}
                  />
                  <span className="truncate" title="Select every comment still waiting for a reply">
                    Select all ({pending.length})
                  </span>
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  {!videoFilter && (
                    <button
                      type="button"
                      onClick={() => setConfirming("all")}
                      className="h-9 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
                      title="Queue replies to every unreplied comment on your channel"
                    >
                      All on YouTube
                    </button>
                  )}
                  <button
                    onClick={() => setConfirming("selected")}
                    disabled={selected.size === 0 || bulkSending}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Auto-reply{selected.size ? ` to ${selected.size}` : ""}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CommentRow({
  comment,
  videoTitle,
  rule,
  replied,
  queued,
  sending,
  selected,
  onToggleSelect,
  onReply,
  showVideo,
  actions,
}: {
  comment: YoutubeComment;
  actions: CommentActions;
  /** A reply to it is waiting in the queue. */
  queued: boolean;
  videoTitle: string;
  /** Name the video on the row (off when every row is on the same video). */
  showVideo: boolean;
  rule: CommentRule | undefined;
  replied: boolean;
  sending: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onReply: (text: string) => void;
}) {
  const [draft, setDraft] = useState(rule?.reply_template ?? GENERIC_REPLY);
  const [drafting, setDrafting] = useState(false);
  // The thread: loaded when the comment is opened, kept while the dialog is.
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; replies: ThreadReply[]; more: boolean }
    | null
  >(null);
  const loadThread = () => {
    setThread({ status: "loading" });
    actions
      .loadThread(comment.id)
      .then((result) => setThread({ status: "ready", ...result }))
      .catch((error: unknown) =>
        setThread({
          status: "error",
          message: error instanceof Error ? error.message : "We couldn’t load the replies.",
        }),
      );
  };
  const toggleThread = () => {
    const next = !open;
    setOpen(next);
    if (next && (!thread || thread.status === "error")) loadThread();
  };
  // Replying changes the thread: load it again next time it is opened.
  useEffect(() => {
    if (replied) {
      setThread(null);
      setOpen(false);
    }
  }, [replied]);
  const replyCount =
    thread?.status === "ready" ? thread.replies.length : (comment.replyCount ?? null);

  const writeWithAi = async () => {
    setDrafting(true);
    try {
      const text = await actions.draftReply(comment.id, rule?.reply_template ?? null);
      if (text) setDraft(text);
      else toast.message("This comment looks like spam, so the AI suggests not replying.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI couldn’t write a reply.");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className={`rounded-xl border border-border p-3 ${replied ? "bg-accent/20" : ""}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={selected}
          onCheckedChange={onToggleSelect}
          disabled={replied || queued}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{comment.authorName ?? "Unknown"}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {timeAgo(comment.publishedAt)}
            </span>
          </div>
          {/* The comment opens its thread: every reply, and the channel's own can be edited. */}
          <button
            type="button"
            onClick={toggleThread}
            aria-expanded={open}
            className="mt-0.5 block w-full text-left"
            title="Show replies"
          >
            <span
              className={`break-words text-sm text-muted-foreground ${open ? "" : "line-clamp-4"}`}
            >
              &quot;{comment.text}&quot;
            </span>
            <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
              {open ? (
                <ChevronUp className="h-3 w-3" aria-hidden />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden />
              )}
              {open
                ? "Hide replies"
                : replyCount
                  ? `${replyCount} repl${replyCount === 1 ? "y" : "ies"}`
                  : "Replies"}
            </span>
          </button>
          {(showVideo || rule) && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              {showVideo && <span className="truncate">{videoTitle}</span>}
              {rule && (
                <span className="shrink-0 rounded bg-brand-purple/15 px-1.5 py-0.5 text-brand-purple">
                  {rule.name}
                </span>
              )}
            </div>
          )}
        </div>
        {replied ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5" /> Replied
          </span>
        ) : queued ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Queued
          </span>
        ) : comment.canReply === false ? (
          <span className="shrink-0 text-xs text-muted-foreground">Replies disabled</span>
        ) : (
          <button
            onClick={() => onReply(draft)}
            disabled={sending}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs font-medium hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}{" "}
            Auto-reply
          </button>
        )}
      </div>

      {open && (
        <CommentThread
          state={thread}
          onRetry={loadThread}
          onEdit={async (reply, text) => {
            const updated = await actions.editReply(comment.id, reply.id, text);
            setThread((current) =>
              current?.status === "ready"
                ? {
                    ...current,
                    replies: current.replies.map((r) =>
                      r.id === reply.id ? { ...r, ...updated } : r,
                    ),
                  }
                : current,
            );
          }}
        />
      )}

      {!replied && !queued && comment.canReply !== false && (
        <div className="ml-7 mt-2 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            aria-label={`Reply to ${comment.authorName ?? "commenter"}`}
            className="min-h-[2.25rem] resize-y py-1.5 text-sm"
            placeholder="Reply text..."
          />
          {actions.aiAvailable && (
            <button
              type="button"
              onClick={() => void writeWithAi()}
              disabled={drafting}
              className="flex items-center gap-1 text-[11px] font-medium text-brand-purple hover:underline disabled:opacity-60"
              title="Write a reply to this comment from the video’s description and details — you can edit it before sending"
            >
              {drafting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {drafting ? "Writing…" : "Write with AI"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A comment's replies, oldest first; the channel's own replies can be edited in place. */
function CommentThread({
  state,
  onRetry,
  onEdit,
}: {
  state:
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; replies: ThreadReply[]; more: boolean }
    | null;
  onRetry: () => void;
  onEdit: (reply: ThreadReply, text: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (reply: ThreadReply) => {
    const text = editText.trim();
    if (!text) return;
    setSaving(true);
    try {
      await onEdit(reply, text);
      setEditingId(null);
      toast.success("Reply updated on YouTube");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That reply couldn’t be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ml-7 mt-2 border-l-2 border-border pl-3" aria-live="polite">
      {(!state || state.status === "loading") && (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading replies">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      )}
      {state?.status === "error" && (
        <p className="text-xs text-muted-foreground">
          {state.message}{" "}
          <button type="button" onClick={onRetry} className="font-medium text-primary">
            Try again
          </button>
        </p>
      )}
      {state?.status === "ready" && state.replies.length === 0 && (
        <p className="text-xs text-muted-foreground">No replies yet.</p>
      )}
      {state?.status === "ready" && state.replies.length > 0 && (
        <ul className="space-y-2">
          {state.replies.map((reply) => (
            <li key={reply.id} className="text-sm">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate font-medium text-foreground">
                  {reply.authorName ?? "Unknown"}
                </span>
                {reply.isOwn && (
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-primary">
                    {reply.autoReply ? "Auto-reply" : "You"}
                  </span>
                )}
                <span className="shrink-0">{timeAgo(reply.publishedAt)}</span>
                {reply.isOwn && editingId !== reply.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(reply.id);
                      setEditText(reply.text);
                    }}
                    className="ml-auto flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                    aria-label="Edit reply"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              {editingId === reply.id ? (
                <div className="mt-1 space-y-1.5">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    aria-label="Edit your reply"
                    className="resize-y py-1.5 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="h-8 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void save(reply)}
                      disabled={saving || !editText.trim() || editText.trim() === reply.text}
                      className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                    >
                      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-line break-words text-muted-foreground">
                  {reply.text}
                </p>
              )}
            </li>
          ))}
          {state.more && (
            <li className="text-[11px] text-muted-foreground">
              Showing the first {state.replies.length} replies.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
