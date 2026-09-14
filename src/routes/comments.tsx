import { createFileRoute, Link } from "@tanstack/react-router";
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
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
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

export const Route = createFileRoute("/comments")({
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

const GENERIC_REPLY = "Thanks for your comment! 🙌";
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
};
type YoutubeVideoOption = { id: string; title: string };
type SavedVideoOption = { id: string; title: string; youtube_video_id: string };
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
  | { status: "connected"; data: { comments: YoutubeComment[]; videos: YoutubeVideoOption[] } }
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
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

// videoIdByRuleVideoId maps a rule's video (our internal videos.id, the value stored in
// rule.video.id) to that video's real YouTube video ID, since incoming comments are keyed by the
// latter (see fetchRecentYoutubeComments) — without this a rule scoped to "this video only" would
// never actually match anything, or would need string comparison across two different ID spaces.
function matchRule(
  comment: YoutubeComment,
  rules: CommentRule[],
  videoIdByRuleVideoId: Map<string, string>,
): CommentRule | undefined {
  const active = rules.filter(
    (r) => r.active && (!r.video || videoIdByRuleVideoId.get(r.video.id) === comment.videoId),
  );
  if (/@\w+/.test(comment.text)) {
    const handleRule = active.find((r) => r.trigger_type === "handle");
    if (handleRule) return handleRule;
  }
  for (const r of active.filter((r) => r.trigger_type === "keyword")) {
    if (r.keywords.some((k) => comment.text.toLowerCase().includes(k.toLowerCase()))) return r;
  }
  if (comment.text.trim().endsWith("?")) {
    const questionRule = active.find((r) => r.trigger_type === "question");
    if (questionRule) return questionRule;
  }
  return undefined;
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

  useEffect(() => {
    const controller = new AbortController();
    setCommentsStatus("loading");
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
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
        setCommentsStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCommentsStatus("error");
      });
    return () => controller.abort();
  }, [activeChannelId, commentsRetryToken]);

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
            Auto-reply to real comments on your videos — keyword matches, @handles, or questions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/leads"
            className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-sm font-medium hover:bg-accent"
          >
            <Inbox className="h-4 w-4" /> Lead Inbox
          </Link>
          <button
            onClick={() => setViewingComments(true)}
            className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-sm font-medium hover:bg-accent"
          >
            <Eye className="h-4 w-4" /> View All Comments
          </button>
          <button
            onClick={() => setCreating(true)}
            data-onboarding-step="comments"
            className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New Rule
          </button>
        </div>
      </div>

      {insufficientScope && (
        <div className="mt-5">
          <YoutubeReauthNotice />
        </div>
      )}

      <div
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-busy={rulesStatus === "loading" || commentsStatus === "loading"}
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
      </div>

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
            Each auto-reply costs 50 units (comments.insert) — max ~200/day. Resets at midnight UTC.
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
        onOpenChange={setViewingComments}
        status={commentsStatus}
        onRetry={() => setCommentsRetryToken((n) => n + 1)}
        comments={comments}
        videos={commentVideos}
        rules={rules}
        videoIdByRuleVideoId={videoIdByRuleVideoId}
        repliedCommentIds={repliedCommentIds}
        onSendReply={sendReply}
      />
    </DashboardLayout>
  );
}

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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
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

  const pending = visible.filter((c) => !repliedCommentIds.has(c.id) && c.canReply !== false);
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

  const replySelected = async () => {
    const ids = [...selected];
    setBulkSending(true);
    let sent = 0;
    for (const id of ids) {
      const comment = comments.find((c) => c.id === id);
      if (!comment) continue;
      const rule = matchRule(comment, rules, videoIdByRuleVideoId);
      try {
        await onSendReply(comment, rule, rule?.reply_template ?? GENERIC_REPLY);
        sent += 1;
      } catch {
        // individual failure — continue the batch, summarized below
      }
    }
    setBulkSending(false);
    setSelected(new Set());
    toast.success(`Auto-replied to ${sent} of ${ids.length} comment${ids.length === 1 ? "" : "s"}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>All Comments</DialogTitle>
          <DialogDescription>
            Real comments from your recent videos. Reply individually, or select several for a bulk
            automated response.
          </DialogDescription>
        </DialogHeader>

        {status === "loading" && (
          <div className="space-y-2 py-4" aria-label="Loading comments" aria-busy="true">
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
          <>
            <div className="border-b border-border pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by username or keyword..."
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
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
              {(
                [
                  ["all", `All (${comments.length})`],
                  ["unreplied", `Unreplied (${unrepliedCount})`],
                  ["replied", `Replied (${repliedCount})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-2.5 py-1.5 text-xs font-medium ${filter === key ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between border-b border-border pb-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allPendingSelected}
                  onCheckedChange={toggleAll}
                  disabled={pending.length === 0}
                />
                Select all pending ({pending.length})
              </label>
              <button
                onClick={() => void replySelected()}
                disabled={selected.size === 0 || bulkSending}
                className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              >
                {bulkSending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Auto-reply to {selected.size || ""} selected
              </button>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {visible.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {q
                    ? `No comments match "${query.trim()}".`
                    : `No ${filter === "all" ? "" : filter} comments.`}
                </p>
              )}
              {visible.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  videoTitle={videoTitle(c.videoId)}
                  rule={matchRule(c, rules, videoIdByRuleVideoId)}
                  replied={repliedCommentIds.has(c.id)}
                  sending={sendingIds.has(c.id)}
                  selected={selected.has(c.id)}
                  onToggleSelect={() => toggleOne(c.id)}
                  onReply={(text) => void replyOne(c, text)}
                />
              ))}
            </div>
          </>
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
  sending,
  selected,
  onToggleSelect,
  onReply,
}: {
  comment: YoutubeComment;
  videoTitle: string;
  rule: CommentRule | undefined;
  replied: boolean;
  sending: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onReply: (text: string) => void;
}) {
  const [draft, setDraft] = useState(rule?.reply_template ?? GENERIC_REPLY);

  return (
    <div className={`rounded-xl border border-border p-3 ${replied ? "bg-accent/20" : ""}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={selected}
          onCheckedChange={onToggleSelect}
          disabled={replied}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{comment.authorName ?? "Unknown"}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {timeAgo(comment.publishedAt)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">&quot;{comment.text}&quot;</p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{videoTitle}</span>
            {rule && (
              <span className="shrink-0 rounded bg-brand-purple/15 px-1.5 py-0.5 text-brand-purple">
                {rule.name}
              </span>
            )}
          </div>
        </div>
        {replied ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5" /> Replied
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

      {!replied && comment.canReply !== false && (
        <div className="ml-7 mt-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="text-sm"
            placeholder="Reply text..."
          />
        </div>
      )}
    </div>
  );
}
