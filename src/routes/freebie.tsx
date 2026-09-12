import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Download, FileText, Gift, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KpiTrendCard } from "@/components/KpiTrendCard";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/freebie")({
  component: Freebie,
});

const formats = [
  { id: "cheatsheet", label: "Cheatsheet" },
  { id: "guide", label: "Mini-Guide" },
  { id: "list", label: "Resource List" },
  { id: "checklist", label: "Actionable Checklist" },
];

type LeadMagnet = {
  id: string;
  title: string;
  product: string;
  audience: string;
  tone: string;
  format: string;
  content: string;
  created_at: string;
};
type FreebiesResponse = { data?: LeadMagnet[]; error?: string };
type GenerateResponse = { data?: LeadMagnet; error?: string };

function formatLabelFor(id: string): string {
  return formats.find((f) => f.id === id)?.label ?? id;
}

function generateErrorMessage(error: string | undefined): string {
  const messages: Record<string, string> = {
    AI_PROVIDER_NOT_CONFIGURED:
      "AI generation isn't set up yet — add an OpenAI or Anthropic API key.",
    GENERATION_FAILED: "Generation failed. Try again.",
    VALIDATION_ERROR: "Fill in a product and audience first.",
  };
  return messages[error ?? ""] ?? "Couldn't generate that freebie. Please try again.";
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

function Freebie() {
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [format, setFormat] = useState("cheatsheet");
  const [isGenerating, setIsGenerating] = useState(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [magnets, setMagnets] = useState<LeadMagnet[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/freebies", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as FreebiesResponse;
        if (!response.ok || !body.data) throw new Error();
        setMagnets(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [retryNonce]);

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
      const response = await fetch("/api/freebies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: product.trim(),
          audience: audience.trim(),
          tone: tone.trim() || "Direct, no-fluff, practical",
          format,
          formatLabel: formatLabelFor(format),
        }),
      });
      const body = (await response.json()) as GenerateResponse;
      if (!response.ok || !body.data) throw new Error(body.error ?? "GENERATION_FAILED");
      setMagnets((prev) => [body.data!, ...prev]);
      setSelectedId(body.data.id);
      setPreview({ title: body.data.title, content: body.data.content });
    } catch (error) {
      toast.error(generateErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setIsGenerating(false);
    }
  };

  const selectMagnet = (m: LeadMagnet) => {
    setSelectedId(m.id);
    setPreview({ title: m.title, content: m.content });
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
    } catch {
      toast.error("Couldn't delete that freebie. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <DashboardLayout title="AI Freebie">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Freebie Generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate high-converting lead magnets with AI — saved to your library so you can reuse or
          download them anytime.
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

      {/* Freebie studio — split screen */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Input form */}
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-brand-purple" /> Build your freebie
          </h3>
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
            <p className="text-[11px] text-muted-foreground">
              Generated with AI and saved to your library below. There's no public download page
              yet, so downloads/opt-in tracking aren't available — export the content directly
              instead.
            </p>
          </div>
        </div>

        {/* Live preview */}
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

      {/* Saved freebies */}
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
          <>
            {/* Mobile: stacked cards */}
            <div className="space-y-3 p-5 sm:hidden">
              {magnets.map((m) => (
                <div
                  key={m.id}
                  onClick={() => selectMagnet(m)}
                  className={`cursor-pointer rounded-xl border p-4 ${selectedId === m.id ? "border-primary/60 bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium">{m.title}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(m.id);
                      }}
                      disabled={deletingId === m.id}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Delete freebie"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="inline-flex rounded-md bg-brand-purple/15 px-2 py-0.5 text-[11px] font-medium text-brand-purple">
                      {formatLabelFor(m.format)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">{m.audience}</p>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Lead Magnet</th>
                    <th className="px-5 py-3 font-medium">Format</th>
                    <th className="px-5 py-3 font-medium">Audience</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {magnets.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => selectMagnet(m)}
                      className={`cursor-pointer border-b border-border last:border-0 ${selectedId === m.id ? "bg-primary/5" : "hover:bg-accent/40"}`}
                    >
                      <td className="max-w-[280px] truncate px-5 py-3.5 font-medium">{m.title}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex rounded-md bg-brand-purple/15 px-2 py-0.5 text-[11px] font-medium text-brand-purple">
                          {formatLabelFor(m.format)}
                        </span>
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3.5 text-muted-foreground">
                        {m.audience}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(m.id);
                          }}
                          disabled={deletingId === m.id}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Delete freebie"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
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
