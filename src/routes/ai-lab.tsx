import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Zap, FileText, ChevronDown, RefreshCw, Pencil, Copy } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";

export const Route = createFileRoute("/ai-lab")({
  component: AILab,
});

const voices = ["Professional", "Casual", "Educational", "Energetic"];
const ctas = ["Course signup", "Newsletter", "Coaching", "Affiliates"];

const transcript = `In today's video, I'm going to break down exactly how I generated over $100,000 in revenue from my YouTube channel in the past 12 months. This isn't just AdSense money — I'm talking about the full stack: brand deals, digital products, memberships, and affiliate revenue. I'll show you the exact split, what worked, what didn't, and how you can replicate this for your own channel regardless of your subscriber count...`;

const generated = `🚀 How I Made $100K on YouTube (Complete Revenue Breakdown)

In this video, I reveal the exact strategies that helped me generate $100,000+ in YouTube revenue — covering every monetization stream from AdSense to 6-figure brand deals.

✅ What you'll learn:
→ The 4 revenue streams that actually matter
→ How to land premium brand deals (script included)
→ My membership funnel that converts at 8%
→ Affiliate stacking strategy for passive income

📌 RESOURCES MENTIONED:
→ Free Creator Business Toolkit: https://creator.io/toolkit
→ My Course (Revenue OS): https://creator.io/course
→ Newsletter (Weekly insights): https://creator.io/newsletter
→ 1:1 Coaching: https://creator.io/coaching

🎬 CHAPTERS:
0:00 - The Full Picture
2:30 - AdSense Optimization
8:45 - Landing Brand Deals
15:20 - Membership Strategy
22:10 - Affiliate Revenue Stacking
28:00 - Putting It Together

🔔 Subscribe for weekly creator business content → @YourChannel

#YouTubeRevenue #CreatorEconomy #YouTubeMonetization #ContentCreator #PassiveIncome`;

function AILab() {
  const [voice, setVoice] = useState("Professional");
  const [cta, setCta] = useState("Course signup");

  return (
    <DashboardLayout title="AI Lab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Description Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Generate high-converting descriptions powered by AI</p>
        </div>
        <span className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
          <Zap className="h-4 w-4" fill="currentColor" /> 47 credits remaining
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold">Select Video</h3>
            <button className="mt-3 flex w-full items-center justify-between rounded-xl border border-border bg-accent/30 px-4 py-3 text-sm">
              How I Made $100K on YouTube
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-brand-blue" /> Transcript</h3>
              <span className="rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">Auto-imported</span>
            </div>
            <div className="mt-3 rounded-xl border border-border bg-accent/20 p-4 text-sm leading-relaxed text-muted-foreground">
              {transcript}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold">Generation Settings</h3>

            <p className="mt-4 text-sm text-muted-foreground">Brand Voice</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {voices.map((v) => (
                <button
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                    voice === v ? "border-primary bg-primary/15 text-primary" : "border-border bg-accent/20 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm text-muted-foreground">Primary CTA</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {ctas.map((c) => (
                <button
                  key={c}
                  onClick={() => setCta(c)}
                  className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                    cta === c ? "border-primary bg-primary/15 text-primary" : "border-border bg-accent/20 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm text-muted-foreground">Custom Instructions</p>
            <textarea
              rows={3}
              placeholder="e.g., Always mention the free toolkit first, use emojis sparingly..."
              className="mt-2 w-full resize-none rounded-xl border border-border bg-accent/20 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />

            <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Sparkles className="h-4 w-4" /> Generate Description
            </button>
          </div>
        </div>

        {/* Right column */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Generated Description</h3>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent hover:text-foreground"><Pencil className="h-4 w-4" /></button>
              <button className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm hover:text-foreground"><Copy className="h-3.5 w-3.5" /> Copy</button>
            </div>
          </div>

          <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">{generated}</pre>

          <div className="mt-5 flex items-end justify-between border-t border-border pt-4">
            <div className="flex gap-8">
              <Stat value="1,020" label="Characters" />
              <Stat value="141" label="Words" />
              <Stat value="4" label="CTAs" />
            </div>
            <span className="flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> Optimized
            </span>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
