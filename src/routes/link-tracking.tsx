import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Copy, Pencil, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LinkDialog,
  ConfirmDialog,
  type TrackLink,
  type TrackLinkInput,
} from "@/components/modals";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useLocalStore } from "@/lib/local-store";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/link-tracking")({
  component: LinkTracking,
});

type LinkListResponse = { data?: TrackLink[]; error?: string };
type LinkMutationResponse = { data?: TrackLink; error?: string };
type DestinationOption = { id: string; name: string };
type VideoOption = { id: string; title: string };

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "Check the fields and try again.",
    DESTINATION_NOT_FOUND: "That destination couldn’t be found. Choose another one.",
    VIDEO_NOT_FOUND: "That video couldn’t be found. Choose another one.",
    SLUG_TAKEN: "That slug is already in use. Try a different one.",
    DATABASE_ERROR: "We couldn’t save that. Please try again.",
    NOT_FOUND: "That link no longer exists.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function shortUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/r/${slug}`;
}

function LinkTracking() {
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [links, setLinks] = useState<TrackLink[]>([]);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TrackLink | null>(null);
  const [deleting, setDeleting] = useState<TrackLink | null>(null);
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [videos, setVideos] = useState<VideoOption[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setPageStatus("loading");
    fetch("/api/tracking-links", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as LinkListResponse;
        if (!response.ok || !body.data) throw new Error();
        setLinks(body.data);
        setPageStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPageStatus("error");
      });
    return () => controller.abort();
  }, [retryNonce]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/destinations?status=active", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { data?: DestinationOption[] };
        if (response.ok && body.data) setDestinations(body.data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/videos?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          status?: string;
          data?: { videos: VideoOption[] } | null;
        };
        if (response.ok && body.status === "connected" && body.data) setVideos(body.data.videos);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeChannelId]);

  const save = async (input: TrackLinkInput, id?: string) => {
    const response = await fetch(id ? `/api/tracking-links?id=${id}` : "/api/tracking-links", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as LinkMutationResponse;
    if (!response.ok || !body.data) throw new Error(errorMessage(body.error ?? "DATABASE_ERROR"));
    const saved = body.data;
    setLinks((current) =>
      id ? current.map((x) => (x.id === id ? saved : x)) : [saved, ...current],
    );
  };

  const remove = async (l: TrackLink) => {
    const previous = links;
    setLinks((current) => current.filter((x) => x.id !== l.id));
    try {
      const response = await fetch(`/api/tracking-links?id=${l.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast.success("Link deleted");
    } catch {
      setLinks(previous);
      toast.error("We couldn’t delete that link. Please try again.");
    }
  };

  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(shortUrl(slug));
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return links;
    return links.filter((l) =>
      (l.slug + (l.destination?.name ?? "") + (l.destination?.url ?? "") + (l.video?.title ?? ""))
        .toLowerCase()
        .includes(q),
    );
  }, [links, query]);

  const totalClicks = links.reduce((a, l) => a + l.clicks, 0);
  const totalUnique = links.reduce((a, l) => a + l.uniqueClicks, 0);

  return (
    <DashboardLayout title="Link Tracking">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Link Tracking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create short links and track real clicks
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          data-onboarding-step="link"
          className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Create Link
        </button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
        <Summary value={String(links.length)} label="Total Links" />
        <Summary value={totalClicks.toLocaleString()} label="Total Clicks" />
        <Summary value={totalUnique.toLocaleString()} label="Unique Visitors" />
      </div>

      <div className="relative mt-5">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search links..."
          className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-primary"
        />
      </div>

      {pageStatus === "loading" && (
        <div className="mt-5 space-y-3" aria-label="Loading tracking links" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-4">
              <Skeleton className="h-2 w-2 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      )}

      {pageStatus === "error" && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t load your tracking links.</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {pageStatus === "ready" && filtered.length === 0 && (
        <div className="relative mt-5 rounded-xl card-gradient-outline">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query ? "No links match your search." : "No links yet — click Create Link to add one."}
          </p>
        </div>
      )}

      {pageStatus === "ready" && filtered.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="mt-5 space-y-3 sm:hidden">
            {filtered.map((l) => (
              <div key={l.id} className="relative rounded-xl card-gradient-outline p-4">
                <GlowingEffect
                  spread={40}
                  glow
                  disabled={false}
                  proximity={64}
                  inactiveZone={0.01}
                />
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      l.status === "active" ? "bg-success" : "bg-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-brand-purple">
                      {shortUrl(l.slug).replace(/^https?:\/\//, "")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.destination?.url ?? "Destination removed"}
                    </p>
                  </div>
                </div>
                {l.video && (
                  <p className="mt-2 text-xs text-muted-foreground">Video: {l.video.title}</p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-accent/30 p-2.5 text-center text-xs">
                  <div>
                    <p className="text-muted-foreground">Clicks</p>
                    <p className="mt-0.5 font-medium">{l.clicks.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Unique</p>
                    <p className="mt-0.5 font-medium">{l.uniqueClicks.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {l.status === "active" ? "Active" : "Archived"}
                  </span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <button
                      onClick={() => copy(l.slug)}
                      className="hover:text-foreground"
                      aria-label="Copy"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditing(l)}
                      className="hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleting(l)}
                      className="hover:text-destructive"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="relative mt-5 hidden overflow-x-auto rounded-xl card-gradient-outline sm:block">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-4 font-medium">Short Link</th>
                  <th className="px-3 py-4 font-medium">Destination</th>
                  <th className="px-3 py-4 font-medium">Video</th>
                  <th className="px-3 py-4 font-medium">Clicks</th>
                  <th className="px-3 py-4 font-medium">Unique</th>
                  <th className="px-3 py-4 font-medium">Status</th>
                  <th className="px-3 py-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-border last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            l.status === "active" ? "bg-success" : "bg-muted-foreground",
                          )}
                        />
                        <p className="font-medium text-brand-purple">
                          {shortUrl(l.slug).replace(/^https?:\/\//, "")}
                        </p>
                      </div>
                    </td>
                    <td className="max-w-[200px] px-3 py-4 text-muted-foreground">
                      {l.destination ? (
                        <a
                          href={l.destination.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 truncate hover:text-primary hover:underline"
                        >
                          <span className="truncate">{l.destination.name}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        "Destination removed"
                      )}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-4 text-muted-foreground">
                      {l.video?.title ?? "—"}
                    </td>
                    <td className="px-3 py-4">{l.clicks.toLocaleString()}</td>
                    <td className="px-3 py-4 text-muted-foreground">
                      {l.uniqueClicks.toLocaleString()}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={cn(
                          "text-xs",
                          l.status === "archived" ? "text-muted-foreground" : "text-success",
                        )}
                      >
                        {l.status === "active" ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center justify-end gap-2 text-muted-foreground">
                        <button
                          onClick={() => copy(l.slug)}
                          className="hover:text-foreground"
                          aria-label="Copy"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setEditing(l)}
                          className="hover:text-foreground"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleting(l)}
                          className="hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <LinkDialog
        open={creating}
        onOpenChange={setCreating}
        destinations={destinations}
        videos={videos}
        onSave={save}
      />
      <LinkDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        initial={editing}
        destinations={destinations}
        videos={videos}
        onSave={save}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete this link?`}
        description="This removes the short link. Existing click history is kept for your records."
        onConfirm={() => {
          if (deleting) void remove(deleting);
          setDeleting(null);
        }}
      />
    </DashboardLayout>
  );
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
