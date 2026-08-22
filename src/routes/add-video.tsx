import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Youtube, Sparkles, FileText, Link2, Copy, Check, RefreshCw,
  Clock, Hash, Wand2, ChevronRight, ArrowLeft, Loader2,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { llm } from "@/lib/llm";

export const Route = createFileRoute("/add-video")({
  component: AddVideo,
});

const destinationOptions = [
  { slug: "vsl", label: "Sales page / VSL", token: "{{LINK_VSL}}", url: "salespage.com/watch", primary: true },
  { slug: "skool", label: "Skool community", token: "{{LINK_SKOOL}}", url: "skool.com/community" },
  { slug: "ig", label: "Instagram profile", token: "{{LINK_IG}}", url: "instagram.com/difaino" },
  { slug: "tiktok", label: "TikTok profile", token: "{{LINK_TIKTOK}}", url: "tiktok.com/@difaino" },
  { slug: "newsletter", label: "Newsletter signup", token: "{{LINK_NEWS}}", url: "creator.io/newsletter" },
  { slug: "freekit", label: "Free resource / lead magnet", token: "{{LINK_KIT}}", url: "creator.io/templates" },
];

const steps = [
  { icon: Youtube, label: "Fetch metadata" },
  { icon: FileText, label: "Get transcript" },
  { icon: Sparkles, label: "Write description" },
  { icon: Link2, label: "Inject tracked links" },
];

const generatedBody = `In this video I show you exactly how I went from 0 to €40K/month dropshipping with one product — no ads, no warehouse, no experience needed. I break down the exact product research method, the supplier I use, and the funnel that converts cold traffic into buyers.

▶ Join my free community (1,200+ members): https://go.yourdomain.com/v/abc1/skool
▶ Watch the full training (free VSL): https://go.yourdomain.com/v/abc1/vsl
▶ Follow on Instagram: https://go.yourdomain.com/v/abc1/ig

TIMESTAMPS
0:00 — How I found the product
2:14 — Setting up the store
5:33 — The ad strategy I used
9:01 — First sale moment
12:45 — Scaling to €40K

#dropshipping #ecommerce #makemoneyonline #shopify #passiveincome`;

function AddVideo() {
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [selected, setSelected] = useState<string[]>(["vsl", "skool", "ig"]);
  const [generated, setGenerated] = useState(false);
  const [description, setDescription] = useState(generatedBody);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const toggle = (slug: string) =>
    setSelected((s) => (s.includes(slug) ? s.filter((x) => x !== slug) : [...s, slug]));

  const copy = () => {
    navigator.clipboard?.writeText(description);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    const links = destinationOptions
      .filter((d) => selected.includes(d.slug))
      .map((d) => ({ label: d.label, url: d.url }));
    const result = await llm.generateVideoDescription({ transcript, links });
    setDescription(result);
    setGenerated(true);
    setIsGenerating(false);
  };

  return (
    <DashboardLayout title="Add Video">
      <Link to="/videos" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Videos
      </Link>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add a Video</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a YouTube URL — we read the transcript, write the description, and inject tracked links automatically.
        </p>
      </div>

      {/* URL input */}
      <div className="relative mt-6 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <label className="text-sm font-medium">YouTube video URL</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Youtube className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-red" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {isGenerating ? "Generating…" : "Generate"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const done = generated;
            return (
              <div
                key={s.label}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                  done ? "border-success/40 bg-success/10 text-success" : "border-border bg-background text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{i + 1}. {s.label}</span>
                {done && <Check className="ml-auto h-3.5 w-3.5" />}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Transcript source: <span className="font-semibold">paste your own (fastest)</span> or run OpenAI Whisper via yt-dlp worker. YouTube caption download is disabled (v3.0). Analytics lag: 24–72h.
        </p>
      </div>

      {/* Transcript paste — Phase 1 primary path */}
      <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <FileText className="h-5 w-5 text-brand-blue" /> Transcript
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste your transcript for instant AI structuring — or leave empty to queue a Whisper job.
            </p>
          </div>
          <span className="rounded-full bg-brand-blue/15 px-3 py-1 text-[11px] font-semibold text-brand-blue">Phase 1 · Manual</span>
        </div>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={5}
          placeholder="00:00 In this video I show you exactly how..."
          className="mt-4 w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span>Claude Sonnet extracts scenes, product mentions, CTAs, and hashtag candidates.</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Destinations */}
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">Destinations</h3>
          <p className="mt-1 text-xs text-muted-foreground">Pick which tracked links apply to this video.</p>
          <div className="mt-4 space-y-2">
            {destinationOptions.map((d) => {
              const on = selected.includes(d.slug);
              return (
                <button
                  key={d.slug}
                  onClick={() => toggle(d.slug)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    on ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {d.label}
                      {d.primary && <span className="rounded bg-brand-purple/15 px-1.5 py-0.5 text-[10px] text-brand-purple">Primary</span>}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">→ {d.url}</span>
                  </span>
                  <code className="hidden shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground xl:block">{d.token}</code>
                </button>
              );
            })}
          </div>
        </div>

        {/* Description editor */}
        <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5 text-brand-purple" /> AI Description
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} /> {isGenerating ? "Generating…" : "Regenerate"}
              </button>
              <button
                onClick={copy}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {generated ? (
            <>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={16}
                className="mt-4 w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-primary"
              />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> 5 timestamps</span>
                <span className="flex items-center gap-1.5"><Hash className="h-3.5 w-3.5" /> 5 hashtags</span>
                <span className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> {selected.length} tracked links</span>
                <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Opening under 125 chars</span>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                Copy the description → paste into YouTube Studio → publish. Every link click is now tracked.
                <ChevronRight className="ml-auto h-4 w-4" />
              </div>
            </>
          ) : (
            <div className="mt-4 flex h-[360px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-muted-foreground">
              <Sparkles className="h-8 w-8 text-brand-purple/60" />
              <p className="text-sm">Paste a video URL and hit Generate to write the description.</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
