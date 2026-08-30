import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Eye, Filter, Play, Plus, Search, ThumbsUp } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { YoutubeReauthNotice } from "@/components/YoutubeReauthNotice";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";

export const Route = createFileRoute("/videos")({
  component: Videos,
});

type YoutubeVideo = {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  privacyStatus: string | null;
  url: string;
};

type VideosData = {
  channel: {
    id: string;
    youtubeChannelId: string;
    title: string;
    handle: string | null;
    thumbnail: string | null;
    videoCount: number;
  };
  videos: YoutubeVideo[];
  videosStatus: "available" | "disabled" | "unavailable";
  totalVideoCount: number;
};

type VideosResponse =
  | { status: "connected"; data: VideosData }
  | { status: "not_connected"; data: null }
  | { error: string };

type SortOption = "recent" | "views" | "title";

function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
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

function Videos() {
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("recent");
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<{
    data: VideosData | null;
    status: "loading" | "connected" | "not_connected" | "disabled" | "error" | "reauth";
    error: string | null;
  }>({ data: null, status: "loading", error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);

    fetch(`/api/youtube/videos${params.size ? `?${params.toString()}` : ""}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as VideosResponse;
        if (
          response.status === 401 &&
          "error" in body &&
          body.error === "YOUTUBE_REAUTH_REQUIRED"
        ) {
          throw new Error("YOUTUBE_REAUTH_REQUIRED");
        }
        if (!response.ok) {
          if ("error" in body && body.error === "YOUTUBE_REAUTH_REQUIRED") {
            throw new Error("YOUTUBE_REAUTH_REQUIRED");
          }
          if ("status" in body && body.status === "not_connected") return body;
          throw new Error("YOUTUBE_DATA_UNAVAILABLE");
        }
        if (!("status" in body) || body.status !== "connected" || !body.data) {
          throw new Error("YOUTUBE_DATA_UNAVAILABLE");
        }
        return body;
      })
      .then((body) => {
        if (body.status === "not_connected") {
          setState({ data: null, status: "not_connected", error: null });
          return;
        }
        const data = body.data;
        setState({
          data,
          status: data.videosStatus === "disabled" ? "disabled" : "connected",
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "YOUTUBE_DATA_UNAVAILABLE";
        setState({
          data: null,
          status: message === "YOUTUBE_REAUTH_REQUIRED" ? "reauth" : "error",
          error: message,
        });
      });

    return () => controller.abort();
  }, [activeChannelId, retryNonce]);

  const filteredVideos = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return [...(state.data?.videos ?? [])]
      .filter((video) => !normalizedSearch || video.title.toLowerCase().includes(normalizedSearch))
      .sort((a, b) => {
        if (sort === "views") return b.views - a.views;
        if (sort === "title") return a.title.localeCompare(b.title);
        return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
      });
  }, [search, sort, state.data?.videos]);

  const totalVideoCount = state.data?.totalVideoCount ?? 0;
  const summary =
    state.status === "connected" || state.status === "disabled"
      ? `${filteredVideos.length} of ${totalVideoCount.toLocaleString()} published videos`
      : "Your authenticated YouTube videos";

  return (
    <DashboardLayout title="Videos">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          {state.data?.channel.title && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing videos from {state.data.channel.title}
              {state.data.channel.handle ? ` · ${state.data.channel.handle}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="video-search" className="sr-only">
              Search videos
            </label>
            <input
              id="video-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search videos..."
              className="h-9 w-full rounded-[var(--input-radius)] border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <label className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            <span className="sr-only">Sort videos</span>
            <select
              aria-label="Sort videos"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortOption)}
              className="bg-transparent text-foreground outline-none"
            >
              <option value="recent">Most recent</option>
              <option value="views">Most views</option>
              <option value="title">Title</option>
            </select>
          </label>
          <Link
            to="/add-video"
            className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Analyze Video
          </Link>
        </div>
      </div>

      {state.status === "loading" && <LoadingState />}
      {state.status === "not_connected" && (
        <MessageState
          title="Connect your YouTube channel"
          description="Connect YouTube in Settings to load your published videos here."
          action="Open Settings"
        />
      )}
      {state.status === "reauth" && (
        <div className="mt-6">
          <YoutubeReauthNotice onRetry={() => setRetryNonce((value) => value + 1)} />
        </div>
      )}
      {state.status === "error" && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <p className="font-semibold">We couldn&apos;t load your YouTube videos</p>
          <p className="mt-1">The YouTube API is temporarily unavailable.</p>
          <button
            type="button"
            onClick={() => setRetryNonce((value) => value + 1)}
            className="mt-3 rounded-[var(--button-radius)] border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10"
          >
            Try again
          </button>
        </div>
      )}
      {state.status === "disabled" && (
        <div className="mt-6 rounded-xl border border-border bg-accent/20 p-5 text-sm text-muted-foreground">
          Video sync is disabled in YouTube Integration settings. Enable it to refresh this list.
        </div>
      )}

      {(state.status === "connected" || state.status === "disabled") && (
        <>
          <div className="mt-6 space-y-3 sm:hidden">
            {filteredVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
            {!filteredVideos.length && <EmptyVideos search={search} />}
          </div>

          <div className="relative mt-6 hidden overflow-x-auto rounded-xl card-gradient-outline sm:block">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-4 font-medium">Video</th>
                  <th className="px-3 py-4 font-medium">Views</th>
                  <th className="px-3 py-4 font-medium">Likes</th>
                  <th className="px-3 py-4 font-medium">Comments</th>
                  <th className="px-3 py-4 font-medium">Published</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.map((video) => (
                  <VideoRow key={video.id} video={video} />
                ))}
              </tbody>
            </table>
            {!filteredVideos.length && <EmptyVideos search={search} />}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}

function LoadingState() {
  return (
    <div className="mt-6 space-y-3" aria-label="Loading YouTube videos" aria-busy="true">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-xl bg-accent/50" />
      ))}
    </div>
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
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Link
        to="/settings"
        className="rounded-[var(--button-radius)] bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {action}
      </Link>
    </div>
  );
}

function EmptyVideos({ search }: { search: string }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-muted-foreground">
      {search
        ? "No videos match your search."
        : "No published videos are available for this channel."}
    </p>
  );
}

function VideoCard({ video }: { video: YoutubeVideo }) {
  return (
    <div className="relative block rounded-xl card-gradient-outline p-4">
      <div className="flex items-center gap-3">
        <VideoThumbnail video={video} />
        <div className="min-w-0 flex-1">
          <Link
            to="/videos/$videoId"
            params={{ videoId: video.id }}
            className="line-clamp-2 font-medium hover:text-primary"
          >
            {video.title}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(video.publishedAt)}
            {video.duration ? ` · ${video.duration}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-accent/30 p-2.5 text-center text-xs">
        <div>
          <p className="text-muted-foreground">Views</p>
          <p className="mt-0.5 font-medium">{formatCount(video.views)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Likes</p>
          <p className="mt-0.5 font-medium">
            {video.likes === null ? "Unavailable" : formatCount(video.likes)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Comments</p>
          <p className="mt-0.5 font-medium">
            {video.comments === null ? "Unavailable" : formatCount(video.comments)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <Link
          to="/videos/$videoId"
          params={{ videoId: video.id }}
          className="font-semibold text-primary hover:underline"
        >
          View analytics
        </Link>
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          Open on YouTube
        </a>
      </div>
    </div>
  );
}

function VideoRow({ video }: { video: YoutubeVideo }) {
  return (
    <tr className="border-b border-border last:border-0 transition-colors hover:bg-accent/30">
      <td className="px-5 py-3.5">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-3"
        >
          <VideoThumbnail video={video} />
          <span className="min-w-0">
            <span className="block max-w-[32rem] truncate font-medium">{video.title}</span>
            <span className="block text-xs text-muted-foreground">
              {video.duration ? `${video.duration} · ` : ""}
              {video.privacyStatus === "public" ? "Public" : "Status unavailable"}
            </span>
          </span>
        </a>
        <Link
          to="/videos/$videoId"
          params={{ videoId: video.id }}
          className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
        >
          View analytics
        </Link>
      </td>
      <td className="px-3 py-3.5 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          {formatCount(video.views)}
        </span>
      </td>
      <td className="px-3 py-3.5 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {video.likes === null ? (
            "Unavailable"
          ) : (
            <>
              <ThumbsUp className="h-3.5 w-3.5" />
              {formatCount(video.likes)}
            </>
          )}
        </span>
      </td>
      <td className="px-3 py-3.5 text-muted-foreground">
        {video.comments === null ? "Unavailable" : formatCount(video.comments)}
      </td>
      <td className="px-3 py-3.5 text-muted-foreground">{formatDate(video.publishedAt)}</td>
    </tr>
  );
}

function VideoThumbnail({ video }: { video: YoutubeVideo }) {
  return video.thumbnail ? (
    <img src={video.thumbnail} alt="" className="h-11 w-16 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-red/40 to-brand-purple/40 text-white/80">
      <Play className="h-4 w-4" fill="currentColor" />
    </span>
  );
}
