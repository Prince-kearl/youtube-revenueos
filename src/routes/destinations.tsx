import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ShoppingCart,
  TrendingUp,
  MousePointer2,
  Link2,
  ExternalLink,
  RefreshCw,
  Instagram,
  Music2,
  X as XIcon,
  Facebook,
  Youtube,
  Linkedin,
  ChevronDown,
  Loader2,
  Trophy,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tag } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DestinationDialog,
  ConfirmDialog,
  type Destination,
  type DestinationInput,
} from "@/components/modals";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/destinations")({
  component: Destinations,
});

const icons = {
  cart: ShoppingCart,
  trend: TrendingUp,
  cursor: MousePointer2,
  link: Link2,
  external: ExternalLink,
  instagram: Instagram,
  tiktok: Music2,
  x: XIcon,
  facebook: Facebook,
  youtube: Youtube,
  linkedin: Linkedin,
};
const iconBg: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  green: "bg-brand-green/15 text-brand-green",
  blue: "bg-brand-blue/15 text-brand-blue",
  amber: "bg-brand-amber/15 text-brand-amber",
  red: "bg-brand-red/15 text-brand-red",
};

type DestinationResponse = { data?: Destination[]; error?: string };
type DestinationMutationResponse = { data?: Destination; error?: string };

type TopVideo = { id: string; title: string; thumbnail: string | null; clicks: number };
type TopVideosResponse = { data?: TopVideo[]; error?: string };

function Destinations() {
  const [view, setView] = useState<"Cards" | "List">("Cards");
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [editing, setEditing] = useState<Destination | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState<Destination["category"]>("conversion");
  const [deleting, setDeleting] = useState<Destination | null>(null);

  const openCreate = (category: Destination["category"]) => {
    setCreatingCategory(category);
    setCreating(true);
  };

  useEffect(() => {
    const controller = new AbortController();
    setPageStatus("loading");
    fetch("/api/destinations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as DestinationResponse;
        if (!response.ok || !body.data) throw new Error();
        setDestinations(body.data);
        setPageStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPageStatus("error");
      });
    return () => controller.abort();
  }, [retryNonce]);

  const save = async (input: DestinationInput, id?: string) => {
    const response = await fetch(id ? `/api/destinations?id=${id}` : "/api/destinations", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as DestinationMutationResponse;
    if (!response.ok || !body.data) throw new Error();
    const saved = body.data;
    setDestinations((current) =>
      id ? current.map((x) => (x.id === id ? saved : x)) : [saved, ...current],
    );
  };

  const remove = async (d: Destination) => {
    const previous = destinations;
    setDestinations((current) => current.filter((x) => x.id !== d.id));
    try {
      const response = await fetch(`/api/destinations?id=${d.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast.success("Destination deleted");
    } catch {
      setDestinations(previous);
      toast.error("We couldn’t delete that destination. Please try again.");
    }
  };

  const activeCount = destinations.filter((d) => d.status === "active").length;
  const archivedCount = destinations.length - activeCount;
  const conversionDestinations = destinations.filter((d) => d.category !== "social");
  const socialDestinations = destinations.filter((d) => d.category === "social");

  return (
    <DashboardLayout title="Destinations">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Destinations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage the links you send traffic to</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-full border border-border bg-card p-1 text-sm">
            {(["Cards", "List"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 font-medium ${view === v ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => openCreate("conversion")}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Add Destination
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
        <Summary value={String(destinations.length)} label="Total Destinations" />
        <Summary value={String(activeCount)} label="Active" />
        <Summary value={String(archivedCount)} label="Archived" />
      </div>

      {pageStatus === "loading" && (
        <div
          className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Loading destinations"
          aria-busy="true"
        >
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl card-gradient-outline p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-full" />
            </div>
          ))}
        </div>
      )}

      {pageStatus === "error" && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t load your destinations.</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {pageStatus === "ready" && destinations.length === 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No destinations yet.</p>
          <button
            onClick={() => openCreate("conversion")}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Add your first destination
          </button>
        </div>
      )}

      {pageStatus === "ready" && destinations.length > 0 && view === "Cards" && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Conversion Destinations
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {conversionDestinations.map((d) => (
              <DestinationCard
                key={d.id}
                destination={d}
                onEdit={() => setEditing(d)}
                onDelete={() => setDeleting(d)}
              />
            ))}
            <button
              onClick={() => openCreate("conversion")}
              className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-[var(--button-radius)] border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                <Plus className="h-5 w-5" />
              </div>
              Add new destination
            </button>
          </div>

          <div className="my-8 border-t border-border" />

          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Social Destinations
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {socialDestinations.map((d) => (
              <DestinationCard
                key={d.id}
                destination={d}
                onEdit={() => setEditing(d)}
                onDelete={() => setDeleting(d)}
              />
            ))}
            <button
              onClick={() => openCreate("social")}
              className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-[var(--button-radius)] border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                <Plus className="h-5 w-5" />
              </div>
              Add social destination
            </button>
          </div>
        </>
      )}

      {pageStatus === "ready" && destinations.length > 0 && view === "List" && (
        <>
          {/* Mobile: stacked cards */}
          <div className="mt-5 space-y-3 sm:hidden">
            {destinations.map((d) => (
              <div key={d.id} className="relative rounded-xl card-gradient-outline p-4">
                <GlowingEffect
                  spread={40}
                  glow
                  disabled={false}
                  proximity={64}
                  inactiveZone={0.01}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{d.url}</p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-muted-foreground">
                    <button
                      onClick={() => setEditing(d)}
                      aria-label="Edit"
                      className="hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleting(d)}
                      aria-label="Delete"
                      className="hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Tag label={d.type} color={d.color} />
                  {d.status === "archived" && <Tag label="Archived" color="neutral" />}
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
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">URL</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-border last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-4 py-3 font-medium">{d.name}</td>
                    <td className="px-3 py-3">
                      <Tag label={d.type} color={d.color} />
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-3 text-muted-foreground">
                      {d.url}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "text-xs",
                          d.status === "archived" ? "text-muted-foreground" : "text-success",
                        )}
                      >
                        {d.status === "archived" ? "Archived" : "Active"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2 text-muted-foreground">
                        <button onClick={() => setEditing(d)} className="hover:text-foreground">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setDeleting(d)} className="hover:text-destructive">
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

      <DestinationDialog
        open={creating}
        onOpenChange={setCreating}
        defaultCategory={creatingCategory}
        onSave={save}
      />
      <DestinationDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        initial={editing}
        onSave={save}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        onConfirm={() => {
          if (deleting) void remove(deleting);
          setDeleting(null);
        }}
      />
    </DashboardLayout>
  );
}

function DestinationCard({
  destination: d,
  onEdit,
  onDelete,
}: {
  destination: Destination;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = icons[d.icon as keyof typeof icons] ?? Link2;
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [topVideos, setTopVideos] = useState<TopVideo[]>([]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && status === "idle") {
      setStatus("loading");
      fetch(`/api/destinations/top-videos?id=${d.id}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as TopVideosResponse;
          if (!response.ok || !body.data) throw new Error();
          setTopVideos(body.data);
          setStatus("loaded");
        })
        .catch(() => setStatus("error"));
    }
  };

  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg[d.color] ?? iconBg.purple}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{d.name}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <Tag label={d.type} color={d.color} />
              {d.status === "archived" && <Tag label="Archived" color="neutral" />}
            </div>
          </div>
        </div>
        <div className="flex gap-1 text-muted-foreground">
          <button onClick={onEdit} className="hover:text-foreground" aria-label="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="hover:text-destructive" aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <a
        href={d.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        {d.url}
      </a>
      {d.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{d.description}</p>
      )}

      <button
        type="button"
        onClick={toggle}
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
      >
        <span className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5" /> See top performers
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-accent/20 p-3">
          {status === "loading" && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {status === "error" && (
            <p className="text-center text-xs text-muted-foreground">
              We couldn’t load top performers.
            </p>
          )}
          {status === "loaded" && topVideos.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              No video-attributed clicks yet for this destination.
            </p>
          )}
          {status === "loaded" &&
            topVideos.map((v, i) => (
              <div key={v.id} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                {v.thumbnail ? (
                  <img
                    src={v.thumbnail}
                    alt=""
                    className="h-8 w-14 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-8 w-14 shrink-0 rounded bg-accent" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{v.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {v.clicks.toLocaleString()} clicks
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
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
