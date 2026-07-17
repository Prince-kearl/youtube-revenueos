import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2, Circle, Rocket, ShieldCheck, Sparkles, MessageSquare,
  BarChart3, Handshake, Globe, Lock, ScrollText,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";

export const Route = createFileRoute("/roadmap")({
  head: () => ({
    meta: [
      { title: "Roadmap — Tubify" },
      { name: "description", content: "The Tubify v3.0 engineering roadmap: phases, milestones, and compliance posture." },
      { property: "og:title", content: "Roadmap — Tubify" },
      { property: "og:description", content: "Phased delivery plan, from video ingestion through Phase 5 GA4/Meta integration." },
    ],
  }),
  component: Roadmap,
});

type Phase = {
  id: string;
  name: string;
  window: string;
  status: "shipped" | "active" | "next" | "later";
  icon: React.ComponentType<{ className?: string }>;
  bullets: string[];
};

const phases: Phase[] = [
  {
    id: "P1",
    name: "Phase 1 — Ingest & AI Descriptions",
    window: "Weeks 1–6",
    status: "shipped",
    icon: Rocket,
    bullets: [
      "YouTube OAuth (youtube.force-ssl + yt-analytics.readonly)",
      "Video import, metadata sync, manual transcript paste",
      "Claude Sonnet structures transcript into description + tags",
      "Basic dashboard: views, watch time, revenue",
    ],
  },
  {
    id: "P2",
    name: "Phase 2 — Link Attribution",
    window: "Weeks 5–10",
    status: "active",
    icon: Handshake,
    bullets: [
      "Destination links with yt_ref tracking parameter",
      "Safari ITP-2.3 safe: URL-first, then localStorage fallback",
      "Stripe pixel + webhook attribution to originating video",
      "Click → purchase revenue rollups by video & destination",
    ],
  },
  {
    id: "P3",
    name: "Phase 3 — Whisper & Comment Automation",
    window: "Weeks 8–14",
    status: "next",
    icon: MessageSquare,
    bullets: [
      "yt-dlp + OpenAI Whisper transcription worker (BullMQ)",
      "Adaptive comment polling — recent videos only, hourly max",
      "Claude reply drafts with transcript context",
      "Auto-post or manual approval queue",
    ],
  },
  {
    id: "P4",
    name: "Phase 4 — Reporting & PDF Exports",
    window: "Weeks 12–18",
    status: "later",
    icon: BarChart3,
    bullets: [
      "Daily YouTube Analytics import (Reports API)",
      "Data-freshness indicators (24–72h lag surfaced per metric)",
      "PDF sponsorship / revenue reports",
      "Compliance audit + NIS2 sign-off",
    ],
  },
  {
    id: "P5",
    name: "Phase 5 — GA4 / Meta CAPI",
    window: "Weeks 18+",
    status: "later",
    icon: Sparkles,
    bullets: [
      "Optional GA4 property link, conversion supplementation",
      "Meta CAPI for creators running paid amplification",
      "Multi-channel attribution model",
    ],
  },
];

const milestones = [
  { id: "M1", label: "OAuth verification submitted (8–16 wk review)" },
  { id: "M2", label: "Phase 1 beta — ingest + manual transcripts" },
  { id: "M3", label: "Stripe attribution end-to-end on staging" },
  { id: "M4", label: "Comment automation alpha" },
  { id: "M5", label: "Compliance audit complete (GDPR / NIS2 / Cybersecurity Act)" },
  { id: "M6", label: "Release candidate — Phase 4 GA" },
];

const statusStyles: Record<Phase["status"], { badge: string; ring: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  shipped: { badge: "bg-success/15 text-success", ring: "ring-success/30", label: "Shipped", Icon: CheckCircle2 },
  active: { badge: "bg-primary/15 text-primary", ring: "ring-primary/40", label: "In progress", Icon: Circle },
  next: { badge: "bg-brand-amber/15 text-brand-amber", ring: "ring-brand-amber/30", label: "Up next", Icon: Circle },
  later: { badge: "bg-accent text-muted-foreground", ring: "ring-border", label: "Planned", Icon: Circle },
};

function Roadmap() {
  return (
    <DashboardLayout title="Roadmap">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roadmap</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tubify v3.0 phased delivery plan · EU-hosted (Hetzner ISO 27001) · GDPR / NIS2 / Dutch Cybersecurity Act aligned
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip icon={Globe} label="EU-first hosting" />
          <Chip icon={Lock} label="Encrypted at rest" />
          <Chip icon={ShieldCheck} label="Audit logging" />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {phases.map((p) => {
          const style = statusStyles[p.status];
          const Icon = p.icon;
          return (
            <div key={p.id} className={`rounded-xl border border-border bg-card p-5 ring-1 ${style.ring}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{p.id} · {p.window}</p>
                    <h3 className="text-base font-semibold leading-tight">{p.name}</h3>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.badge}`}>
                  <style.Icon className="h-3 w-3" /> {style.label}
                </span>
              </div>
              <ul className="mt-4 space-y-2">
                {p.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${p.status === "shipped" ? "text-success" : "text-muted-foreground/50"}`} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <ScrollText className="h-5 w-5 text-brand-purple" /> Milestones
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {milestones.map((m) => (
            <div key={m.id} className="flex items-start gap-3 rounded-lg border border-border bg-accent/20 p-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{m.id}</span>
              <p className="text-sm">{m.label}</p>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Chip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" /> {label}
    </span>
  );
}
