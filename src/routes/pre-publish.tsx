import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Clock, FileVideo, Loader2, Plus, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { PrePublishUploadDialog } from "@/components/PrePublishUploadDialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pre-publish")({
  component: PrePublishList,
});

type PrePublishStatus = "uploaded" | "analyzing" | "completed" | "failed";

type PrePublishRow = {
  id: string;
  file_name: string;
  status: PrePublishStatus;
  analysis_result: { recommendedTitle?: string } | null;
  error: string | null;
  created_at: string;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

const STATUS_META: Record<PrePublishStatus, { label: string; className: string }> = {
  uploaded: { label: "Uploaded", className: "bg-accent text-muted-foreground" },
  analyzing: { label: "Analyzing…", className: "bg-primary/15 text-primary" },
  completed: { label: "Completed", className: "bg-success/15 text-success" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
};

export function PrePublishList() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isListRoute = pathname === "/pre-publish" || pathname === "/pre-publish/";
  const [rows, setRows] = useState<PrePublishRow[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!isListRoute) return;
    const controller = new AbortController();
    setStatus((previous) => (rows.length ? previous : "loading"));
    fetch("/api/pre-publish-videos", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { data?: PrePublishRow[]; error?: string };
        if (!response.ok || !body.data) throw new Error(body.error ?? "SERVER_ERROR");
        setRows(body.data);
        setStatus("loaded");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListRoute, retryToken]);

  if (!isListRoute) return <Outlet />;

  return (
    <DashboardLayout title="Analyze Before Publishing">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pre-Publish Analyses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a video you&apos;ve finished but haven&apos;t published to YouTube yet. Tubify
            will analyze it and generate titles, description, tags, chapters, and CTA ideas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/videos"
            className="flex h-9 items-center gap-2 rounded-full border border-border px-3.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Back to Videos
          </Link>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Analyze Before Publishing
          </button>
        </div>
      </div>

      {status === "loading" && (
        <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading analyses">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <p className="font-semibold">We couldn&apos;t load your pre-publish analyses</p>
          <button
            type="button"
            onClick={() => setRetryToken((value) => value + 1)}
            className="mt-3 rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10"
          >
            Try again
          </button>
        </div>
      )}

      {status === "loaded" && rows.length === 0 && (
        <div className="relative mt-6 flex flex-col items-center gap-3 rounded-xl card-gradient-outline p-10 text-center">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">No pre-publish analyses yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Upload a finished video to get AI-generated titles, description, tags, chapters, and CTA
            ideas before it goes live.
          </p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="mt-2 flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Analyze Before Publishing
          </button>
        </div>
      )}

      {status === "loaded" && rows.length > 0 && (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <PrePublishRowCard key={row.id} row={row} />
          ))}
        </div>
      )}

      <PrePublishUploadDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </DashboardLayout>
  );
}

function PrePublishRowCard({ row }: { row: PrePublishRow }) {
  const meta = STATUS_META[row.status];
  const title = row.analysis_result?.recommendedTitle || row.file_name;
  return (
    <Link
      to="/pre-publish/$id"
      params={{ id: row.id }}
      className="relative flex items-center gap-3 rounded-xl card-gradient-outline p-4 transition-colors hover:bg-accent/20"
    >
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground">
        {row.status === "analyzing" ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : row.status === "failed" ? (
          <AlertTriangle className="h-5 w-5 text-destructive" />
        ) : (
          <FileVideo className="h-5 w-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> {formatDate(row.created_at)}
        </p>
      </div>
      <span
        className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", meta.className)}
      >
        {meta.label}
      </span>
    </Link>
  );
}
