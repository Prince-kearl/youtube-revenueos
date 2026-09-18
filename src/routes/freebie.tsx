import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Sparkles,
  Download,
  FileText,
  Gift,
  Trash2,
  RefreshCw,
  Loader2,
  BookOpen,
  Palette,
  Upload,
  Paperclip,
  X,
  Rocket,
  Copy,
  ExternalLink,
  Eye,
  Users,
  StickyNote,
  File as FileIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { GlowingEffect } from "@/components/ui/glowing-effect";
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
import { cn } from "@/lib/utils";
import { FREEBIE_FORMATS, freebieFormatLabel } from "@/lib/freebie-formats";

export const Route = createFileRoute("/freebie")({
  component: Freebie,
});

const formats = FREEBIE_FORMATS.filter((f) => f.id !== "upload");
const FONT_OPTIONS = [
  { id: "sans", label: "Modern Sans" },
  { id: "serif", label: "Classic Serif" },
  { id: "mono", label: "Mono" },
  { id: "rounded", label: "Rounded" },
];

type LeadMagnet = {
  id: string;
  title: string;
  product: string;
  audience: string;
  tone: string;
  format: string;
  content: string | null;
  source: "generated" | "uploaded";
  status: "draft" | "published";
  slug: string | null;
  teaser: string | null;
  file_name: string | null;
  views: number;
  published_at: string | null;
  created_at: string;
  optins?: { count: number }[];
};
type FreebiesResponse = { data?: LeadMagnet[]; error?: string };
type GenerateResponse = { data?: LeadMagnet; error?: string };

type KnowledgeItem = {
  id: string;
  title: string;
  kind: "note" | "file";
  content: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  extraction_status: "ready" | "unsupported" | "failed";
  lead_magnet_id: string | null;
  created_at: string;
};
type KnowledgeResponse = { data?: KnowledgeItem[]; error?: string };

type Branding = {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string;
  canManage: boolean;
};
type BrandingResponse = { data?: Branding; error?: string };

function formatLabelFor(id: string): string {
  return freebieFormatLabel(id);
}

function generateErrorMessage(error: string | undefined): string {
  const messages: Record<string, string> = {
    AI_PROVIDER_NOT_CONFIGURED:
      "AI generation isn't set up yet — add an OpenAI or Anthropic API key.",
    GENERATION_FAILED: "Generation failed. Try again.",
    VALIDATION_ERROR: "Fill in a product and audience first.",
    FILE_TOO_LARGE: "That file is too large (15MB max).",
  };
  return messages[error ?? ""] ?? "Couldn't generate that freebie. Please try again.";
}

function publishErrorMessage(error: string | undefined): string {
  const messages: Record<string, string> = {
    SLUG_TAKEN: "That link is already taken. Try a different one.",
    NO_FILE: "Upload a file before launching this freebie.",
    VALIDATION_ERROR: "Use only letters, numbers, and dashes for the link.",
  };
  return messages[error ?? ""] ?? "Couldn't launch that freebie. Please try again.";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(key: string | undefined): string {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return "";
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value)}`;
}

function pctChange(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series.at(-2)!;
  const curr = series.at(-1)!;
  if (prev === 0) return curr > 0 ? 100 : null;
  return ((curr - prev) / prev) * 100;
}

function lastMonthKeys(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    monthKey(
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1),
      ).toISOString(),
    ),
  );
}

function downloadMarkdown(title: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "freebie"}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function publicUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/f/${slug}`;
}

function Freebie() {
  const [tab, setTab] = useState<"create" | "knowledge" | "branding">("create");

  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [format, setFormat] = useState("cheatsheet");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<Set<string>>(new Set());
  const [perFreebieFile, setPerFreebieFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [magnets, setMagnets] = useState<LeadMagnet[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [launchTarget, setLaunchTarget] = useState<LeadMagnet | null>(null);

  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [knowledgeStatus, setKnowledgeStatus] = useState<"loading" | "ready" | "error">("loading");

  const [branding, setBranding] = useState<Branding | null>(null);

  const refreshMagnets = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/freebies", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as FreebiesResponse;
        if (!response.ok || !body.data) throw new Error();
        setMagnets(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(refreshMagnets, [retryNonce]);

  const refreshKnowledge = () => {
    setKnowledgeStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/knowledge", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as KnowledgeResponse;
        if (!response.ok || !body.data) throw new Error();
        setKnowledge(body.data);
        setKnowledgeStatus("ready");
      })
      .catch(() => setKnowledgeStatus("error"));
  };
  useEffect(refreshKnowledge, []);

  useEffect(() => {
    fetch("/api/workspace/branding", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as BrandingResponse;
        if (response.ok && body.data) setBranding(body.data);
      })
      .catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const months = lastMonthKeys(6);
    const countByMonth = new Map<string, number>();
    for (const m of magnets) {
      const k = monthKey(m.created_at);
      countByMonth.set(k, (countByMonth.get(k) ?? 0) + 1);
    }
    const perMonthSeries = months.map((k) => countByMonth.get(k) ?? 0);

    const totalBeforeWindow = magnets.filter((m) => monthKey(m.created_at) < months[0]).length;
    let running = totalBeforeWindow;
    const cumulativeSeries = perMonthSeries.map((v) => (running += v));

    const formatCounts = new Map<string, number>();
    for (const m of magnets) formatCounts.set(m.format, (formatCounts.get(m.format) ?? 0) + 1);
    const topFormatEntry = [...formatCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topFormatId = topFormatEntry?.[0];
    const topFormatSeries = months.map(
      (k) => magnets.filter((m) => m.format === topFormatId && monthKey(m.created_at) === k).length,
    );

    return {
      total: magnets.length,
      thisMonthCount: perMonthSeries.at(-1) ?? 0,
      monthChangePct: pctChange(perMonthSeries),
      totalChangePct: pctChange(cumulativeSeries),
      topFormatLabel: topFormatEntry ? formatLabelFor(topFormatEntry[0]) : "—",
      topFormatChangePct: pctChange(topFormatSeries),
      latestMonthLabel: monthLabel(months.at(-1)),
      periodLabel: `Past ${months.length} months`,
      cumulativeSeries,
      perMonthSeries,
      topFormatSeries,
    };
  }, [magnets]);

  const handleGenerate = async () => {
    if (!product.trim() || !audience.trim()) return;
    setIsGenerating(true);
    try {
      const form = new FormData();
      form.set("product", product.trim());
      form.set("audience", audience.trim());
      form.set("tone", tone.trim() || "Direct, no-fluff, practical");
      form.set("format", format);
      form.set("formatLabel", formatLabelFor(format));
      form.set("knowledgeItemIds", JSON.stringify([...selectedKnowledgeIds]));
      if (perFreebieFile) form.set("file", perFreebieFile);

      const response = await fetch("/api/freebies", { method: "POST", body: form });
      const body = (await response.json()) as GenerateResponse;
      if (!response.ok || !body.data) throw new Error(body.error ?? "GENERATION_FAILED");
      setMagnets((prev) => [body.data!, ...prev]);
      setSelectedId(body.data.id);
      setPreview({ title: body.data.title, content: body.data.content ?? "" });
      setPerFreebieFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refreshKnowledge();
      toast.success("Freebie generated");
    } catch (error) {
      toast.error(generateErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setIsGenerating(false);
    }
  };

  const selectMagnet = (m: LeadMagnet) => {
    setSelectedId(m.id);
    setPreview(m.content ? { title: m.title, content: m.content } : null);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/freebies?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setMagnets((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setPreview(null);
      }
      toast.success("Freebie deleted");
    } catch {
      toast.error("Couldn't delete that freebie. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const applyMagnetUpdate = (updated: LeadMagnet) => {
    setMagnets((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
  };

  return (
    <DashboardLayout title="AI Freebie">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Freebie Generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate high-converting lead magnets grounded in your own material, brand them, and
          launch a real opt-in page.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTrendCard
          title="Total Freebies"
          accent="var(--brand-purple)"
          value={String(stats.total)}
          deltaLabel={signed(stats.cumulativeSeries.at(-1) ?? 0)}
          deltaSuffix="all time"
          changePercent={stats.totalChangePct}
          periodLabel={stats.periodLabel}
          series={stats.cumulativeSeries}
          markerTitle={String(stats.cumulativeSeries.at(-1) ?? 0)}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.totalChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Created This Month"
          accent="var(--brand-green)"
          value={String(stats.thisMonthCount)}
          deltaLabel={signed(stats.thisMonthCount)}
          deltaSuffix="this month"
          changePercent={stats.monthChangePct}
          periodLabel={stats.periodLabel}
          series={stats.perMonthSeries}
          markerTitle={String(stats.thisMonthCount)}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.monthChangePct ?? 0) >= 0}
        />
        <KpiTrendCard
          title="Most Popular Format"
          accent="var(--brand-blue)"
          value={stats.topFormatLabel}
          deltaLabel={signed(stats.topFormatSeries.at(-1) ?? 0)}
          deltaSuffix="this month"
          changePercent={stats.topFormatChangePct}
          periodLabel={stats.periodLabel}
          series={stats.topFormatSeries}
          markerTitle={`${stats.topFormatSeries.at(-1) ?? 0}`}
          markerSubtitle={stats.latestMonthLabel}
          positive={(stats.topFormatChangePct ?? 0) >= 0}
        />
      </div>

      <div className="mt-6 flex gap-1.5 border-b border-border">
        {(
          [
            { id: "create", label: "Create", icon: Sparkles },
            { id: "knowledge", label: "Knowledge Base", icon: BookOpen },
            { id: "branding", label: "Branding", icon: Palette },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm font-medium",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <>
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="h-5 w-5 text-brand-purple" /> Build your freebie
                </h3>
                <button
                  onClick={() => setUploadOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary"
                >
                  <Upload className="h-3.5 w-3.5" /> Upload your own
                </button>
              </div>
              <div className="mt-4 space-y-4">
                <Field label="Product / service">
                  <input
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-primary"
                    placeholder="e.g. Dropshipping course"
                  />
                </Field>
                <Field label="Target audience">
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-primary"
                    placeholder="e.g. Beginner e-commerce creators"
                  />
                </Field>
                <Field label="Brand tone">
                  <input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="h-11 w-full rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-primary"
                    placeholder="e.g. Direct, no-fluff, practical"
                  />
                </Field>
                <Field label="Format">
                  <div className="flex flex-wrap gap-2">
                    {formats.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFormat(f.id)}
                        className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                          format === f.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Ground it in your knowledge (optional)">
                  {knowledge.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      Nothing in your Knowledge Base yet — add notes or files in the Knowledge Base
                      tab to give the AI real sauce to work with.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {knowledge.map((item) => (
                        <label
                          key={item.id}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm",
                            item.extraction_status !== "ready"
                              ? "opacity-50"
                              : "cursor-pointer hover:border-primary",
                          )}
                        >
                          <input
                            type="checkbox"
                            disabled={item.extraction_status !== "ready"}
                            checked={selectedKnowledgeIds.has(item.id)}
                            onChange={() =>
                              setSelectedKnowledgeIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                            }
                            className="h-4 w-4 shrink-0 accent-primary"
                          />
                          {item.kind === "note" ? (
                            <StickyNote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          {item.extraction_status === "unsupported" && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              can't read this file type
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </Field>

                <Field label="Attach a file just for this freebie (optional)">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={(e) => setPerFreebieFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border file:border-border file:bg-accent/30 file:px-3 file:py-1.5 file:text-xs file:font-medium"
                    />
                    {perFreebieFile && (
                      <button
                        onClick={() => {
                          setPerFreebieFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </Field>

                <button
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating || !product.trim() || !audience.trim()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {isGenerating ? "Generating…" : "Generate Freebie"}
                </button>
              </div>
            </div>

            <div className="relative rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <FileText className="h-5 w-5" /> Live Preview
                </h3>
                <button
                  onClick={() => preview && downloadMarkdown(preview.title, preview.content)}
                  disabled={!preview}
                  className="flex h-9 items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
              </div>
              {preview ? (
                <div className="mt-4 h-[420px] overflow-y-auto rounded-lg border border-border bg-background p-5">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                    {preview.content}
                  </pre>
                </div>
              ) : (
                <div className="mt-4 flex h-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-muted-foreground">
                  <Gift className="h-8 w-8 text-brand-purple/60" />
                  <p className="text-sm">
                    Fill in the form and generate to preview, or select a saved freebie below.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="relative mt-5 rounded-xl card-gradient-outline">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="border-b border-border p-5">
              <h3 className="text-lg font-semibold">Your Freebies</h3>
            </div>

            {status === "loading" && (
              <p className="p-5 text-sm text-muted-foreground">Loading your freebies…</p>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center gap-2 p-8 text-center">
                <p className="text-sm text-muted-foreground">Couldn't load your freebies.</p>
                <button
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            )}

            {status === "ready" && magnets.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No freebies yet. Generate your first one above.
              </p>
            )}

            {status === "ready" && magnets.length > 0 && (
              <div className="divide-y divide-border">
                {magnets.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => selectMagnet(m)}
                    className={cn(
                      "flex cursor-pointer flex-wrap items-center gap-3 p-4",
                      selectedId === m.id ? "bg-primary/5" : "hover:bg-accent/30",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{m.title}</p>
                        <span
                          className={cn(
                            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                            m.status === "published"
                              ? "bg-success/15 text-success"
                              : "bg-accent text-muted-foreground",
                          )}
                        >
                          {m.status === "published" ? "Live" : "Draft"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-md bg-brand-purple/15 px-2 py-0.5 font-medium text-brand-purple">
                          {formatLabelFor(m.format)}
                        </span>
                        {m.status === "published" && (
                          <>
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" /> {m.views}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" /> {m.optins?.[0]?.count ?? 0}
                            </span>
                          </>
                        )}
                        <span>{new Date(m.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLaunchTarget(m);
                      }}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
                    >
                      <Rocket className="h-3.5 w-3.5" />{" "}
                      {m.status === "published" ? "Manage" : "Launch"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(m.id);
                      }}
                      disabled={deletingId === m.id}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Delete freebie"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "knowledge" && (
        <KnowledgeTab
          items={knowledge}
          status={knowledgeStatus}
          onChanged={refreshKnowledge}
          onRetry={refreshKnowledge}
        />
      )}

      {tab === "branding" && branding && <BrandingTab branding={branding} onSaved={setBranding} />}

      <UploadFreebieDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(m) => {
          setMagnets((prev) => [m, ...prev]);
          setLaunchTarget(m);
        }}
      />
      <LaunchDialog
        magnet={launchTarget}
        onOpenChange={(v) => !v && setLaunchTarget(null)}
        onUpdated={(m) => {
          applyMagnetUpdate(m);
          setLaunchTarget(m);
        }}
      />
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// ---------- Knowledge Base tab ----------
function KnowledgeTab({
  items,
  status,
  onChanged,
  onRetry,
}: {
  items: KnowledgeItem[];
  status: "loading" | "ready" | "error";
  onChanged: () => void;
  onRetry: () => void;
}) {
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    setSavingNote(true);
    try {
      const form = new FormData();
      form.set("title", noteTitle.trim());
      form.set("kind", "note");
      form.set("content", noteContent.trim());
      const response = await fetch("/api/knowledge", { method: "POST", body: form });
      if (!response.ok) throw new Error();
      setNoteTitle("");
      setNoteContent("");
      onChanged();
      toast.success("Added to Knowledge Base");
    } catch {
      toast.error("Couldn't save that note. Please try again.");
    } finally {
      setSavingNote(false);
    }
  };

  const addFile = async (e: FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("title", uploadTitle.trim() || uploadFile.name);
      form.set("kind", "file");
      form.set("file", uploadFile);
      const response = await fetch("/api/knowledge", { method: "POST", body: form });
      const body = (await response.json()) as { data?: KnowledgeItem; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "UPLOAD_FAILED");
      setUploadTitle("");
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      onChanged();
      toast.success(
        body.data.extraction_status === "ready"
          ? "Added to Knowledge Base"
          : "Uploaded, but we couldn't read text from that file type — it's stored but won't be used in generation.",
      );
    } catch {
      toast.error("Couldn't upload that file. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/knowledge?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      onChanged();
    } catch {
      toast.error("Couldn't delete that item. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <StickyNote className="h-4 w-4 text-brand-purple" /> Drop a note
          </h3>
          <form onSubmit={addNote} className="mt-3 space-y-2.5">
            <input
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Title (e.g. Coaching call notes)"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              rows={5}
              placeholder="Paste knowledge, a transcript, sheet content — anything the AI should draw on…"
              className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={savingNote || !noteTitle.trim() || !noteContent.trim()}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {savingNote ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StickyNote className="h-4 w-4" />
              )}
              Add note
            </button>
          </form>
        </div>

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Upload className="h-4 w-4 text-brand-blue" /> Upload a file
          </h3>
          <form onSubmit={addFile} className="mt-3 space-y-2.5">
            <input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="Title (optional — defaults to file name)"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <input
              ref={uploadInputRef}
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border file:border-border file:bg-accent/30 file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
            <p className="text-[11px] text-muted-foreground">
              Text (.txt, .md, .csv) and PDF get their text extracted automatically. Other file
              types are stored but can't be used in generation yet.
            </p>
            <button
              type="submit"
              disabled={uploading || !uploadFile}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload
            </button>
          </form>
        </div>
      </div>

      <div className="relative rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="border-b border-border p-5">
          <h3 className="text-lg font-semibold">Your Knowledge Base</h3>
        </div>
        {status === "loading" && <p className="p-5 text-sm text-muted-foreground">Loading…</p>}
        {status === "error" && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load your Knowledge Base.</p>
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        )}
        {status === "ready" && items.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nothing here yet. Add a note or upload a file above.
          </p>
        )}
        {status === "ready" && items.length > 0 && (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground">
                  {item.kind === "note" ? (
                    <StickyNote className="h-4 w-4" />
                  ) : (
                    <FileIcon className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.kind === "file"
                      ? `${item.file_name} · ${formatBytes(item.file_size)} · `
                      : ""}
                    {item.extraction_status === "ready" && "Ready to use"}
                    {item.extraction_status === "unsupported" &&
                      "Can't read text from this file type"}
                    {item.extraction_status === "failed" && "Couldn't extract text"}
                  </p>
                </div>
                <button
                  onClick={() => void remove(item.id)}
                  disabled={deletingId === item.id}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Branding tab ----------
function BrandingTab({
  branding,
  onSaved,
}: {
  branding: Branding;
  onSaved: (b: Branding) => void;
}) {
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor ?? "#7c3aed");
  const [accentColor, setAccentColor] = useState(branding.accentColor ?? "#7c3aed");
  const [fontFamily, setFontFamily] = useState(branding.fontFamily);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(branding.logoUrl);
  const [saving, setSaving] = useState(false);
  const canManage = branding.canManage;

  const save = async (removeLogo = false) => {
    setSaving(true);
    try {
      const form = new FormData();
      form.set("primaryColor", primaryColor);
      form.set("accentColor", accentColor);
      form.set("fontFamily", fontFamily);
      if (removeLogo) form.set("removeLogo", "true");
      else if (logoFile) form.set("logo", logoFile);
      const response = await fetch("/api/workspace/branding", { method: "PATCH", body: form });
      const body = (await response.json()) as { data?: Branding; error?: string };
      if (!response.ok || !body.data) throw new Error();
      onSaved(body.data);
      setLogoPreview(body.data.logoUrl);
      setLogoFile(null);
      toast.success("Branding saved");
    } catch {
      toast.error("Couldn't save your branding. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="relative rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <h3 className="text-lg font-semibold">Brand kit</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to your freebies' public opt-in pages.
        </p>
        {!canManage && (
          <p className="mt-3 rounded-lg border border-border bg-accent/20 p-3 text-xs text-muted-foreground">
            Only the workspace owner or a manager can change branding.
          </p>
        )}
        <fieldset disabled={!canManage} className="mt-4 space-y-4 disabled:opacity-60">
          <div>
            <label className="text-sm font-medium">Logo</label>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-accent/20">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <Gift className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setLogoFile(f);
                    if (f) setLogoPreview(URL.createObjectURL(f));
                  }}
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border file:border-border file:bg-accent/30 file:px-3 file:py-1.5 file:text-xs file:font-medium"
                />
                {logoPreview && (
                  <button
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                      void save(true);
                    }}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Primary color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
                />
                <span className="text-xs text-muted-foreground">{primaryColor}</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Accent color</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
                />
                <span className="text-xs text-muted-foreground">{accentColor}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Font</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFontFamily(f.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    fontFamily === f.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => void save(false)}
            disabled={saving}
            className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Palette className="h-4 w-4" />
            )}
            Save branding
          </button>
        </fieldset>
      </div>

      <div className="relative rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <h3 className="text-lg font-semibold">Preview</h3>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <div className="flex flex-col items-center gap-2 bg-[#f5f5f7] px-6 py-8 text-center">
            {logoPreview && (
              <img src={logoPreview} alt="" className="h-8 max-w-[140px] object-contain" />
            )}
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ backgroundColor: `${primaryColor}1a`, color: primaryColor }}
            >
              Free Cheatsheet
            </span>
            <p
              className="text-lg font-bold text-neutral-900"
              style={{
                fontFamily:
                  fontFamily === "serif"
                    ? "Georgia, serif"
                    : fontFamily === "mono"
                      ? "ui-monospace, monospace"
                      : fontFamily === "rounded"
                        ? "ui-rounded, sans-serif"
                        : undefined,
              }}
            >
              5 Ways to Grow Faster
            </p>
            <button
              style={{ backgroundColor: primaryColor }}
              className="mt-1 rounded-full px-5 py-2 text-xs font-semibold text-white"
            >
              Get it free →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Upload your own freebie ----------
function UploadFreebieDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: (m: LeadMagnet) => void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setFile(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !file) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("file", file);
      const response = await fetch("/api/freebies/upload", { method: "POST", body: form });
      const body = (await response.json()) as { data?: LeadMagnet; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error);
      onUploaded(body.data);
      onOpenChange(false);
      toast.success("Freebie uploaded — launch it when you're ready");
    } catch (error) {
      toast.error(generateErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" /> Upload your own freebie
          </DialogTitle>
          <DialogDescription>
            Already have a finished PDF or file? Skip AI generation and launch it directly.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Ultimate Editing Checklist"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">File</label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border file:border-border file:bg-accent/30 file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="rounded-full"
              disabled={saving || !title.trim() || !file}
            >
              {saving ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Launch / manage dialog ----------
function LaunchDialog({
  magnet,
  onOpenChange,
  onUpdated,
}: {
  magnet: LeadMagnet | null;
  onOpenChange: (v: boolean) => void;
  onUpdated: (m: LeadMagnet) => void;
}) {
  const [teaser, setTeaser] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTeaser(magnet?.teaser ?? "");
    setSlug(magnet?.slug ?? "");
  }, [magnet]);

  if (!magnet) return null;
  const canLaunch = magnet.source === "generated" ? !!magnet.content : !!magnet.file_name;

  const publish = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/freebies?id=${magnet.id}&action=publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teaser: teaser.trim() || null, slug: slug.trim() || undefined }),
      });
      const body = (await response.json()) as { data?: LeadMagnet; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error);
      onUpdated(body.data);
      toast.success("Freebie launched!");
    } catch (error) {
      toast.error(publishErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSaving(false);
    }
  };

  const unpublish = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/freebies?id=${magnet.id}&action=unpublish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { data?: LeadMagnet; error?: string };
      if (!response.ok || !body.data) throw new Error();
      onUpdated(body.data);
      toast.success("Freebie unpublished");
    } catch {
      toast.error("Couldn't unpublish that freebie.");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!magnet.slug) return;
    try {
      await navigator.clipboard.writeText(publicUrl(magnet.slug));
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Dialog open={!!magnet} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" /> {magnet.title}
          </DialogTitle>
          <DialogDescription>
            {magnet.status === "published"
              ? "This freebie is live. Anyone with the link can opt in for it."
              : "Launch this freebie as a real public opt-in page."}
          </DialogDescription>
        </DialogHeader>

        {!canLaunch && (
          <p className="rounded-lg border border-border bg-accent/20 p-3 text-sm text-muted-foreground">
            {magnet.source === "uploaded"
              ? "This freebie has no file — something went wrong with the upload."
              : "This freebie has no content yet."}
          </p>
        )}

        {canLaunch && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Teaser (optional)</label>
              <Input
                value={teaser}
                onChange={(e) => setTeaser(e.target.value)}
                placeholder="One line that makes people want it"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Link</label>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">/f/</span>
                <Input
                  value={slug}
                  onChange={(e) =>
                    setSlug(e.target.value.replace(/[^a-z0-9-]/gi, "").toLowerCase())
                  }
                  placeholder="auto-generated"
                />
              </div>
            </div>

            {magnet.status === "published" && magnet.slug && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-accent/20 p-2.5">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {publicUrl(magnet.slug)}
                </span>
                <button
                  onClick={() => void copyLink()}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a
                  href={publicUrl(magnet.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            {magnet.status === "published" && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> {magnet.views} views
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {magnet.optins?.[0]?.count ?? 0} opt-ins
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {magnet.status === "published" ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => void unpublish()}
              disabled={saving}
            >
              Unpublish
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          )}
          {canLaunch && (
            <Button className="rounded-full" onClick={() => void publish()} disabled={saving}>
              {saving ? "Saving…" : magnet.status === "published" ? "Update" : "Launch"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
