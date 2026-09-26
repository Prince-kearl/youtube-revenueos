import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Copy,
  FileVideo,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/modals";

export const Route = createFileRoute("/pre-publish/$id")({
  component: PrePublishDetail,
});

type TitleIdea = { title: string; angle: string; rationale: string };
type Chapter = { timestamp: string; title: string };
type CtaIdea = { type: string; text: string; placement: string };
type AnalysisResult = {
  summary: string;
  recommendedTitle: string;
  titleIdeas: TitleIdea[];
  description: string;
  tags: { primary: string[]; secondary: string[]; longTail: string[] };
  chapters: Chapter[];
  ctaIdeas: CtaIdea[];
  optimizationNotes: string[];
};

type PrePublishRow = {
  id: string;
  channel_id: string | null;
  file_name: string;
  file_size: number;
  duration_seconds: number | null;
  status: "uploaded" | "analyzing" | "completed" | "failed";
  topic: string | null;
  audience: string | null;
  tone: string | null;
  goal: string | null;
  transcript: string | null;
  analysis_result: AnalysisResult | null;
  analysis_model: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Duration unavailable";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyText(value: string, label: string) {
  if (!navigator.clipboard) {
    toast.error("Copy isn't available in this browser context. Select and copy manually.");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}. Select and copy manually.`);
  }
}

const errorMessages: Record<string, string> = {
  AI_PROVIDER_NOT_CONFIGURED: "AI analysis isn't available right now. Please try again later.",
  AI_PROVIDER_FAILED: "We couldn't complete the analysis. Please try again.",
  AI_PROVIDER_RATE_LIMITED:
    "AI analysis is getting a lot of requests right now. Try again shortly.",
  RATE_LIMIT_EXCEEDED: "You've reached your AI analysis limit for now. Please try again shortly.",
  AI_ANALYSIS_FAILED: "We couldn't analyze this video. Please try again.",
  UPLOAD_NOT_FOUND: "The uploaded file couldn't be found. Try uploading again.",
};

function PrePublishDetail() {
  const { id } = Route.useParams();
  const [row, setRow] = useState<PrePublishRow | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "loaded" | "not_found" | "error">(
    "loading",
  );
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pollToken, setPollToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pre-publish-videos?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { data?: PrePublishRow; error?: string };
        if (response.status === 404) {
          setLoadStatus("not_found");
          return;
        }
        if (!response.ok || !body.data) throw new Error(body.error ?? "SERVER_ERROR");
        setRow(body.data);
        setAnalysis(body.data.analysis_result);
        setTranscript(body.data.transcript ?? "");
        setLoadStatus("loaded");
        // Still processing — poll until it settles, matching how the app avoids making a
        // long-running action look frozen elsewhere (e.g. YouTube channel sync status).
        if (body.data.status === "analyzing" || body.data.status === "uploaded") {
          window.setTimeout(() => setPollToken((value) => value + 1), 3000);
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setLoadStatus("error");
      });
    return () => controller.abort();
  }, [id, pollToken]);

  const saveAnalysis = async () => {
    if (!analysis) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/pre-publish-videos?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisResult: analysis }),
      });
      if (!response.ok) throw new Error();
      toast.success("Analysis saved");
    } catch {
      toast.error("Couldn't save your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveTranscript = async () => {
    setTranscriptSaving(true);
    try {
      const response = await fetch(`/api/pre-publish-videos?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcript.trim() || null }),
      });
      if (!response.ok) throw new Error();
      toast.success("Transcript saved");
    } catch {
      toast.error("Couldn't save the transcript. Please try again.");
    } finally {
      setTranscriptSaving(false);
    }
  };

  // Goes through the exact same endpoint (and therefore the same usage/rate-limit accounting) as
  // the very first analysis — re-analysis is never free or unmetered, per the feature spec.
  const reanalyze = async () => {
    setReanalyzing(true);
    try {
      const response = await fetch("/api/pre-publish-videos/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await response.json()) as { data?: PrePublishRow; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "AI_ANALYSIS_FAILED");
      setRow(body.data);
      setAnalysis(body.data.analysis_result);
      toast.success("Analysis complete");
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "AI_ANALYSIS_FAILED";
      toast.error(errorMessages[code] ?? "Something went wrong. Please try again.");
    } finally {
      setReanalyzing(false);
    }
  };

  const deleteAnalysis = async () => {
    try {
      const response = await fetch(`/api/pre-publish-videos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error();
      toast.success("Analysis deleted");
      window.location.href = "/pre-publish";
    } catch {
      toast.error("Couldn't delete this analysis. Please try again.");
    }
  };

  const allTagsText = useMemo(() => {
    if (!analysis) return "";
    return [...analysis.tags.primary, ...analysis.tags.secondary, ...analysis.tags.longTail].join(
      ", ",
    );
  }, [analysis]);

  const chaptersText = useMemo(() => {
    if (!analysis) return "";
    return analysis.chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n");
  }, [analysis]);

  if (loadStatus === "loading") {
    return (
      <DashboardLayout title="Pre-Publish Analysis">
        <div className="space-y-4" aria-busy="true" aria-label="Loading analysis">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (loadStatus === "not_found" || (loadStatus === "error" && !row)) {
    return (
      <DashboardLayout title="Pre-Publish Analysis">
        <div className="rounded-xl border border-border bg-accent/20 p-6 text-center">
          <p className="font-semibold">We couldn&apos;t find that analysis</p>
          <Link
            to="/pre-publish"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Back to Pre-Publish Analyses
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  if (!row) return null;

  return (
    <DashboardLayout title="Pre-Publish Analysis">
      <Link
        to="/pre-publish"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Pre-Publish Analyses
      </Link>

      <div className="relative flex flex-col gap-4 rounded-xl card-gradient-outline p-5 sm:flex-row sm:items-center sm:justify-between">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground">
            <FileVideo className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{row.file_name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatDuration(row.duration_seconds)}
              </span>
              <span>·</span>
              <span>{formatBytes(row.file_size)}</span>
              {row.analysis_model && (
                <>
                  <span>·</span>
                  <span>{row.analysis_model}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete analysis"
            className="flex h-9 items-center gap-1.5 rounded-full border border-destructive/30 px-3 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            type="button"
            onClick={() => void reanalyze()}
            disabled={reanalyzing || row.status === "analyzing"}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {reanalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {reanalyzing ? "Analyzing…" : "Analyze again"}
          </button>
        </div>
      </div>

      {(row.status === "uploaded" || row.status === "analyzing") && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-border bg-accent/20 p-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-semibold">Analyzing your video…</p>
          <p className="text-sm text-muted-foreground">This usually takes under a minute.</p>
        </div>
      )}

      {row.status === "failed" && (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" /> Analysis failed
          </p>
          <p className="mt-1">{errorMessages[row.error ?? ""] ?? "Please try again."}</p>
          <button
            type="button"
            onClick={() => void reanalyze()}
            disabled={reanalyzing}
            className="mt-3 rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10 disabled:opacity-50"
          >
            {reanalyzing ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}

      {row.status === "completed" && analysis && (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h2 className="text-base font-semibold">Summary</h2>
              <p className="mt-2 text-sm text-muted-foreground">{analysis.summary}</p>
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Recommended title</h2>
                <button
                  type="button"
                  onClick={() => void copyText(analysis.recommendedTitle, "Title")}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium hover:bg-accent"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <input
                value={analysis.recommendedTitle}
                onChange={(event) =>
                  setAnalysis((current) =>
                    current ? { ...current, recommendedTitle: event.target.value } : current,
                  )
                }
                className="mt-3 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:border-primary"
              />

              {analysis.titleIdeas.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Other title ideas
                  </p>
                  {analysis.titleIdeas.map((idea, index) => (
                    <button
                      key={`${idea.title}-${index}`}
                      type="button"
                      onClick={() =>
                        setAnalysis((current) =>
                          current ? { ...current, recommendedTitle: idea.title } : current,
                        )
                      }
                      className="flex w-full flex-col gap-0.5 rounded-lg border border-border bg-background p-2.5 text-left text-sm hover:border-primary/40"
                    >
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {idea.angle}
                        </span>
                        <span className="font-medium">{idea.title}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{idea.rationale}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Description</h2>
                <button
                  type="button"
                  onClick={() => void copyText(analysis.description, "Description")}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium hover:bg-accent"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <textarea
                value={analysis.description}
                onChange={(event) =>
                  setAnalysis((current) =>
                    current ? { ...current, description: event.target.value } : current,
                  )
                }
                rows={12}
                className="mt-3 w-full resize-none rounded-[10px] border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary"
              />
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Chapters</h2>
                {analysis.chapters.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void copyText(chaptersText, "Chapters")}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium hover:bg-accent"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                )}
              </div>
              {analysis.chapters.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No chapters were generated — add a transcript below and analyze again for
                  timestamped chapters.
                </p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {analysis.chapters.map((chapter, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        value={chapter.timestamp}
                        onChange={(event) =>
                          setAnalysis((current) => {
                            if (!current) return current;
                            const chapters = [...current.chapters];
                            chapters[index] = { ...chapters[index], timestamp: event.target.value };
                            return { ...current, chapters };
                          })
                        }
                        className="h-9 w-20 shrink-0 rounded-lg border border-border bg-background px-2 text-center font-mono text-xs outline-none focus:border-primary"
                      />
                      <input
                        value={chapter.title}
                        onChange={(event) =>
                          setAnalysis((current) => {
                            if (!current) return current;
                            const chapters = [...current.chapters];
                            chapters[index] = { ...chapters[index], title: event.target.value };
                            return { ...current, chapters };
                          })
                        }
                        className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Tags</h2>
                {allTagsText && (
                  <button
                    type="button"
                    onClick={() => void copyText(allTagsText, "Tags")}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium hover:bg-accent"
                  >
                    <Copy className="h-3 w-3" /> Copy all
                  </button>
                )}
              </div>
              <TagGroup label="Primary" tags={analysis.tags.primary} />
              <TagGroup label="Secondary" tags={analysis.tags.secondary} />
              <TagGroup label="Long-tail" tags={analysis.tags.longTail} />
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h2 className="text-base font-semibold">CTA ideas</h2>
              {analysis.ctaIdeas.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No CTA ideas generated.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {analysis.ctaIdeas.map((cta, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-border bg-background p-2.5"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <span className="rounded-full bg-accent px-2 py-0.5">{cta.type}</span>
                        <span className="rounded-full bg-accent px-2 py-0.5">{cta.placement}</span>
                      </div>
                      <textarea
                        value={cta.text}
                        onChange={(event) =>
                          setAnalysis((current) => {
                            if (!current) return current;
                            const ctaIdeas = [...current.ctaIdeas];
                            ctaIdeas[index] = { ...ctaIdeas[index], text: event.target.value };
                            return { ...current, ctaIdeas };
                          })
                        }
                        rows={2}
                        className="mt-1.5 w-full resize-none rounded-md border border-border bg-transparent p-1.5 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {analysis.optimizationNotes.length > 0 && (
              <div className="relative rounded-xl card-gradient-outline p-5">
                <GlowingEffect
                  spread={40}
                  glow
                  disabled={false}
                  proximity={64}
                  inactiveZone={0.01}
                />
                <h2 className="text-base font-semibold">Optimization notes</h2>
                <ul className="mt-2 space-y-1.5">
                  {analysis.optimizationNotes.map((note, index) => (
                    <li key={index} className="flex items-start gap-1.5 text-sm">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-amber" />
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h2 className="text-base font-semibold">Transcript</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional — add one for more accurate chapters, then analyze again.
              </p>
              <textarea
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                rows={6}
                placeholder="Paste your transcript here..."
                className="mt-3 w-full resize-none rounded-[10px] border border-border bg-background p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => void saveTranscript()}
                disabled={transcriptSaving}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {transcriptSaving ? "Saving…" : "Save transcript"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => void saveAnalysis()}
              disabled={saving}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save analysis"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this analysis?"
        description="This removes the uploaded video and its analysis. This can't be undone."
        onConfirm={() => {
          setDeleteOpen(false);
          void deleteAnalysis();
        }}
      />
    </DashboardLayout>
  );
}

function TagGroup({ label, tags }: { label: string; tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
