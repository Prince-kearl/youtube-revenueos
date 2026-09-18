import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Search,
  Plus,
  Copy,
  Pencil,
  Trash2,
  RefreshCw,
  ExternalLink,
  Globe,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LinkDialog,
  ConfirmDialog,
  type TrackLink,
  type TrackLinkInput,
} from "@/components/modals";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    LINK_ALREADY_EXISTS: "This video already has a link for that destination.",
    DATABASE_ERROR: "We couldn’t save that. Please try again.",
    NOT_FOUND: "That link no longer exists.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
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
  const [domainOpen, setDomainOpen] = useState(false);
  const [domain, setDomain] = useState<string | null>(null);
  const [domainVerifiedAt, setDomainVerifiedAt] = useState<string | null>(null);

  const refreshDomain = () => {
    fetch("/api/workspace/domain", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: { domain: string | null; verifiedAt: string | null };
        };
        if (response.ok && body.data) {
          setDomain(body.data.domain);
          setDomainVerifiedAt(body.data.verifiedAt);
        }
      })
      .catch(() => {});
  };
  useEffect(refreshDomain, []);

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

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDomainOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Globe className="h-4 w-4" />
            {domain ? (
              <>
                {domain}
                {domainVerifiedAt && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
              </>
            ) : (
              "Custom Domain"
            )}
          </button>
          <button
            onClick={() => setCreating(true)}
            data-onboarding-step="link"
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Create Link
          </button>
        </div>
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
                      {l.shortUrl.replace(/^https?:\/\//, "")}
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
                      onClick={() => copy(l.shortUrl)}
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
                          {l.shortUrl.replace(/^https?:\/\//, "")}
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
                          onClick={() => copy(l.shortUrl)}
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
      <DomainDialog
        open={domainOpen}
        onOpenChange={(v) => {
          setDomainOpen(v);
          if (!v) refreshDomain();
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

type DomainInfo = {
  domain: string | null;
  verifiedAt: string | null;
  cnameTarget: string;
  canManage: boolean;
};

function domainErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "Enter a real domain, like go.yourbrand.com.",
    DOMAIN_TAKEN: "That domain is already connected to another workspace.",
    FORBIDDEN: "Only the workspace owner or a manager can change this.",
    NO_DOMAIN: "Add a domain first.",
    DATABASE_ERROR: "We couldn’t save that. Please try again.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function DomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [domainInput, setDomainInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus("loading");
    fetch("/api/workspace/domain", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: DomainInfo; error?: string };
        if (!response.ok || !body.data) throw new Error();
        setInfo(body.data);
        setDomainInput(body.data.domain ?? "");
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [open]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/workspace/domain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim() }),
      });
      const body = (await response.json()) as { data?: DomainInfo; error?: string };
      if (!response.ok || !body.data)
        throw new Error(domainErrorMessage(body.error ?? "DATABASE_ERROR"));
      setInfo(body.data);
      toast.success("Domain saved — add the DNS record below, then verify.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn’t save that domain.");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/workspace/domain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: null }),
      });
      const body = (await response.json()) as { data?: DomainInfo; error?: string };
      if (!response.ok || !body.data) throw new Error();
      setInfo(body.data);
      setDomainInput("");
      toast.success("Custom domain disconnected");
    } catch {
      toast.error("We couldn’t disconnect that domain.");
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const response = await fetch("/api/workspace/domain?action=verify", { method: "POST" });
      const body = (await response.json()) as {
        data?: { verified: boolean; records: string[] };
        error?: string;
      };
      if (!response.ok || !body.data)
        throw new Error(domainErrorMessage(body.error ?? "DATABASE_ERROR"));
      if (body.data.verified) {
        setInfo((prev) => (prev ? { ...prev, verifiedAt: new Date().toISOString() } : prev));
        toast.success("Domain verified! Your new links will use it.");
      } else {
        toast.error(
          body.data.records.length > 0
            ? "That CNAME doesn’t point here yet. Double-check the value and try again."
            : "We couldn’t find a CNAME record for that domain yet — DNS changes can take a few minutes.",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn’t verify that domain.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" /> Custom Domain
          </DialogTitle>
          <DialogDescription>
            Use your own domain for short links instead of this app’s default address.
          </DialogDescription>
        </DialogHeader>

        {status === "loading" && (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        )}
        {status === "error" && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            We couldn’t load your domain settings.
          </p>
        )}
        {status === "ready" && info && !info.canManage && (
          <p className="rounded-lg border border-border bg-accent/20 p-3 text-sm text-muted-foreground">
            Only the workspace owner or a manager can connect a custom domain.
            {info.domain && ` Currently connected: ${info.domain}.`}
          </p>
        )}
        {status === "ready" && info && info.canManage && (
          <div className="space-y-4">
            <form onSubmit={save} className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Domain</label>
              <div className="flex items-center gap-2">
                <Input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="go.yourbrand.com"
                  disabled={saving}
                />
                <Button
                  type="submit"
                  className="rounded-full"
                  disabled={saving || !domainInput.trim()}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </form>

            {info.domain && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {info.verifiedAt ? (
                      <span className="flex items-center gap-1.5 text-success">
                        <CheckCircle2 className="h-4 w-4" /> Verified
                      </span>
                    ) : (
                      "Not verified yet"
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    disabled={saving}
                    className="text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </div>

                <div className="rounded-md bg-accent/30 p-2.5 font-mono text-xs">
                  <p className="text-muted-foreground">Add this DNS record:</p>
                  <p className="mt-1">
                    Type: <span className="font-semibold">CNAME</span>
                  </p>
                  <p>
                    Name: <span className="font-semibold">{info.domain.split(".")[0]}</span>
                  </p>
                  <p>
                    Value: <span className="font-semibold">{info.cnameTarget}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void verify()}
                  disabled={verifying}
                  className="flex w-full items-center justify-center gap-1.5 rounded-full border border-border py-2 text-sm font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {verifying ? "Checking DNS…" : "Verify"}
                </button>

                <p className="text-xs text-muted-foreground">
                  Once DNS verifies, also add {info.domain} in your hosting provider’s domain
                  settings — that’s the step that actually routes traffic to Tubify, and it isn’t
                  something we can do from here.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
