import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  MessageSquare, Plus, AtSign, HelpCircle, Zap, AlertTriangle, Check,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";

export const Route = createFileRoute("/comments")({
  component: Comments,
});

const rules = [
  {
    type: "Keyword trigger", icon: MessageSquare, color: "purple", active: true,
    match: 'Comment contains "link", "info", "send me", "how do I get"',
    reply: "Thanks! Grab everything in the pinned comment 👉 the free training link is there.",
    fired: 342, video: "How I Made $100K on YouTube",
  },
  {
    type: "Instagram handle detection", icon: AtSign, color: "blue", active: true,
    match: "Comment contains an @handle pattern",
    reply: "Just DM'd you on Instagram! Check your requests 📩",
    fired: 118, video: "AI Tools for Content Creators",
  },
  {
    type: "Question detection (AI)", icon: HelpCircle, color: "green", active: false,
    match: "AI classifies comment as purchase-intent question",
    reply: "Great question — yes, it works for beginners. Full breakdown here: {{LINK_VSL}}",
    fired: 64, video: "The Creator Business Blueprint",
  },
];

const recent = [
  { author: "@mike_builds", comment: "yo where's the link??", rule: "Keyword", time: "2m", video: "How I Made $100K" },
  { author: "@sarah.creates", comment: "DM me @sarahcreates 🙏", rule: "IG handle", time: "14m", video: "AI Tools for Creators" },
  { author: "@dropship_dan", comment: "does this work if I'm a total beginner?", rule: "Question (AI)", time: "38m", video: "Business Blueprint" },
  { author: "@ecom_ella", comment: "send me info please", rule: "Keyword", time: "1h", video: "Monetization Deep Dive" },
];

const iconBg: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  blue: "bg-brand-blue/15 text-brand-blue",
  green: "bg-brand-green/15 text-brand-green",
};

function Comments() {
  const [ruleState, setRuleState] = useState(rules.map((r) => r.active));
  const quotaUsed = 6400;
  const quotaMax = 10000;
  const pct = Math.round((quotaUsed / quotaMax) * 100);

  return (
    <DashboardLayout title="Comment Automation">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comment Automation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-reply to comments asking for links, dropping handles, or asking questions — every trigger creates a lead.
          </p>
        </div>
        <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Rule
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Zap className="h-5 w-5" />} value="524" label="Auto-replies (30d)" change="18.2%" up />
        <StatCard icon={<MessageSquare className="h-5 w-5" />} value="3" label="Active Rules" />
        <StatCard icon={<AtSign className="h-5 w-5" />} value="118" label="IG Handles Detected" change="9.4%" up />
        <StatCard icon={<Check className="h-5 w-5" />} value="487" label="Leads Created" change="12.1%" up />
      </div>

      {/* Quota tracker */}
      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${pct > 80 ? "text-warning" : "text-muted-foreground"}`} />
            <h3 className="font-semibold">YouTube API Quota</h3>
          </div>
          <span className="text-sm text-muted-foreground">{quotaUsed.toLocaleString()} / {quotaMax.toLocaleString()} units today</span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-accent">
          <div className={`h-full rounded-full ${pct > 80 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Each auto-reply costs 50 units (comments.insert) — max ~200/day. Resets at midnight UTC. Request a quota increase if you regularly hit the cap.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Rules */}
        <div className="space-y-4 lg:col-span-2">
          {rules.map((r, i) => {
            const Icon = r.icon;
            return (
              <div key={r.type} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg[r.color]}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{r.type}</p>
                      <p className="text-xs text-muted-foreground">{r.fired} replies · {r.video}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setRuleState((s) => s.map((v, idx) => (idx === i ? !v : v)))}
                    className={`relative h-6 w-11 rounded-full transition-colors ${ruleState[i] ? "bg-primary" : "bg-accent"}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${ruleState[i] ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="text-muted-foreground"><span className="text-foreground">Trigger:</span> {r.match}</p>
                  <div className="rounded-lg border border-border bg-background p-3 text-muted-foreground">
                    <span className="text-[11px] uppercase tracking-wide text-brand-purple">Auto-reply</span>
                    <p className="mt-1 text-foreground">{r.reply}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Recent Triggers</h3>
          <div className="mt-4 space-y-3">
            {recent.map((c, i) => (
              <div key={i} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.author}</span>
                  <span className="text-[11px] text-muted-foreground">{c.time}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">"{c.comment}"</p>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <span className="rounded bg-brand-purple/15 px-1.5 py-0.5 text-brand-purple">{c.rule}</span>
                  <span className="truncate text-muted-foreground">{c.video}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
