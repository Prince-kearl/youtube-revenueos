import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  MessageSquare, Plus, AtSign, HelpCircle, Zap, AlertTriangle, Check, Pencil, Trash2, Eye, Search, X, Inbox,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useCommentRules, useLeads, CommentRule } from "@/lib/stores";
import { RuleDialog, ConfirmDialog } from "@/components/modals";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/comments")({
  component: Comments,
});

const ICONS = { message: MessageSquare, at: AtSign, help: HelpCircle };
const iconBg: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  blue: "bg-brand-blue/15 text-brand-blue",
  green: "bg-brand-green/15 text-brand-green",
};

const recent = [
  { author: "@mike_builds", comment: "yo where's the link??", rule: "Keyword", time: "2m", video: "How I Made $100K" },
  { author: "@sarah.creates", comment: "DM me @sarahcreates 🙏", rule: "IG handle", time: "14m", video: "AI Tools for Creators" },
  { author: "@dropship_dan", comment: "does this work if I'm a total beginner?", rule: "Question (AI)", time: "38m", video: "Business Blueprint" },
  { author: "@ecom_ella", comment: "send me info please", rule: "Keyword", time: "1h", video: "Monetization Deep Dive" },
];

type MockComment = { id: string; author: string; comment: string; video: string; time: string; replied: boolean; replyText?: string };

const initialComments: MockComment[] = [
  { id: "c1", author: "@mike_builds", comment: "yo where's the link??", video: "How I Made $100K on YouTube", time: "2m", replied: false },
  { id: "c2", author: "@sarah.creates", comment: "DM me @sarahcreates 🙏", video: "AI Tools for Content Creators", time: "14m", replied: false },
  { id: "c3", author: "@dropship_dan", comment: "does this work if I'm a total beginner?", video: "The Creator Business Blueprint", time: "38m", replied: false },
  { id: "c4", author: "@ecom_ella", comment: "send me info please", video: "YouTube Monetization Deep Dive", time: "1h", replied: false },
  { id: "c5", author: "@jay_creates", comment: "this was so helpful, thank you!", video: "How I Made $100K on YouTube", time: "1h", replied: false },
  { id: "c6", author: "@laura.biz", comment: "what tool do you use for editing?", video: "AI Tools for Content Creators", time: "2h", replied: false },
  { id: "c7", author: "@tom_hustle", comment: "link please 🙏", video: "The Creator Business Blueprint", time: "3h", replied: false },
  { id: "c8", author: "@nina_grows", comment: "following up, any updates?", video: "YouTube Monetization Deep Dive", time: "3h", replied: false },
  { id: "c9", author: "@kevin.codes", comment: "@kevincodes check my page", video: "How I Made $100K on YouTube", time: "4h", replied: false },
  { id: "c10", author: "@amelia_dev", comment: "how do I get access?", video: "AI Tools for Content Creators", time: "5h", replied: false },
  { id: "c11", author: "@ryan_ops", comment: "great breakdown, subscribed!", video: "The Creator Business Blueprint", time: "6h", replied: false },
  { id: "c12", author: "@priya.scale", comment: "is there a free trial?", video: "YouTube Monetization Deep Dive", time: "7h", replied: true, replyText: "Thanks for your comment! 🙌" },
];

const genericReply = "Thanks for your comment! 🙌";

function matchRule(comment: string, rules: CommentRule[]): CommentRule | undefined {
  const active = rules.filter((r) => r.active);
  if (/@\w+/.test(comment)) {
    const handleRule = active.find((r) => r.icon === "at");
    if (handleRule) return handleRule;
  }
  for (const r of active.filter((r) => r.icon === "message")) {
    const keywords = [...r.match.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    if (keywords.some((k) => comment.toLowerCase().includes(k))) return r;
  }
  if (comment.trim().endsWith("?")) {
    const questionRule = active.find((r) => r.icon === "help");
    if (questionRule) return questionRule;
  }
  return undefined;
}

function Comments() {
  const [rules, setRules] = useCommentRules();
  const [leads] = useLeads();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CommentRule | null>(null);
  const [deleting, setDeleting] = useState<CommentRule | null>(null);
  const [allComments, setAllComments] = useState<MockComment[]>(initialComments);
  const [viewingComments, setViewingComments] = useState(false);
  const quotaUsed = 6400;
  const quotaMax = 10000;
  const pct = Math.round((quotaUsed / quotaMax) * 100);

  const save = (r: CommentRule) =>
    setRules((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [r, ...prev]));
  const toggle = (r: CommentRule) => {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    toast.success(`Rule ${!r.active ? "activated" : "paused"}`);
  };

  return (
    <DashboardLayout title="Comment Automation">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comment Automation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-reply to comments asking for links, dropping handles, or asking questions — every trigger creates a lead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/leads" className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3.5 text-sm font-medium hover:bg-accent">
            <Inbox className="h-4 w-4" /> Lead Inbox
          </Link>
          <button onClick={() => setViewingComments(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3.5 text-sm font-medium hover:bg-accent">
            <Eye className="h-4 w-4" /> View All Comments
          </button>
          <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New Rule
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <StatCard icon={<Zap className="h-5 w-5" />} value={String(rules.reduce((a, r) => a + r.fired, 0))} label="Auto-replies (30d)" change="18.2%" up />
        <StatCard icon={<MessageSquare className="h-5 w-5" />} value={String(rules.filter((r) => r.active).length)} label="Active Rules" />
        <StatCard icon={<AtSign className="h-5 w-5" />} value="118" label="IG Handles Detected" change="9.4%" up />
        <Link to="/leads">
          <StatCard icon={<Check className="h-5 w-5" />} value={String(leads.length)} label="Leads Created" sub="View in Lead Inbox →" />
        </Link>
      </div>

      <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
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
          Each auto-reply costs 50 units (comments.insert) — max ~200/day. Resets at midnight UTC.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {rules.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">No rules yet.</p>
              <button onClick={() => setCreating(true)} className="mt-3 inline-flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground">
                <Plus className="h-4 w-4" /> Create your first rule
              </button>
            </div>
          )}
          {rules.map((r) => {
            const Icon = ICONS[r.icon];
            return (
              <div key={r.id} className="relative rounded-xl card-gradient-outline p-5">
                <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg[r.color]}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{r.type}</p>
                      <p className="text-xs text-muted-foreground">{r.fired} replies · {r.video || "All videos"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(r)} className="text-muted-foreground hover:text-foreground" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setDeleting(r)} className="text-muted-foreground hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                    <Switch checked={r.active} onCheckedChange={() => toggle(r)} aria-label="Toggle rule" />
                  </div>
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

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
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

      <RuleDialog open={creating} onOpenChange={setCreating} onSave={save} />
      <RuleDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} onSave={save} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.type}"?`}
        onConfirm={() => { if (deleting) { setRules((p) => p.filter((x) => x.id !== deleting.id)); toast.success("Rule deleted"); } setDeleting(null); }}
      />
      <AllCommentsDialog
        open={viewingComments}
        onOpenChange={setViewingComments}
        comments={allComments}
        setComments={setAllComments}
        rules={rules}
      />
    </DashboardLayout>
  );
}

function AllCommentsDialog({
  open, onOpenChange, comments, setComments, rules,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  comments: MockComment[];
  setComments: React.Dispatch<React.SetStateAction<MockComment[]>>;
  rules: CommentRule[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unreplied" | "replied">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) { setSelected(new Set()); setFilter("all"); setQuery(""); }
  }, [open]);

  const repliedCount = comments.filter((c) => c.replied).length;
  const unrepliedCount = comments.length - repliedCount;
  const q = query.trim().toLowerCase();
  const visible = comments.filter((c) => {
    if (filter === "replied" && !c.replied) return false;
    if (filter === "unreplied" && c.replied) return false;
    if (!q) return true;
    return c.author.toLowerCase().includes(q) || c.comment.toLowerCase().includes(q);
  });

  const pending = visible.filter((c) => !c.replied);
  const allPendingSelected = pending.length > 0 && pending.every((c) => selected.has(c.id));

  const toggleAll = () => {
    setSelected(allPendingSelected ? new Set() : new Set(pending.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const markReplied = (ids: string[]) => {
    setComments((prev) => prev.map((c) => (
      ids.includes(c.id) ? { ...c, replied: true, replyText: matchRule(c.comment, rules)?.reply ?? genericReply } : c
    )));
  };

  const replyOne = (c: MockComment) => {
    const replyText = matchRule(c.comment, rules)?.reply ?? genericReply;
    markReplied([c.id]);
    toast.success(`Auto-replied to ${c.author}`, { description: replyText });
  };

  const replySelected = () => {
    const ids = [...selected];
    markReplied(ids);
    toast.success(`Auto-replied to ${ids.length} comment${ids.length === 1 ? "" : "s"}`);
    setSelected(new Set());
  };

  const editReply = (id: string, text: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, replyText: text } : c)));
    toast.success("Auto-reply updated");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>All Comments</DialogTitle>
          <DialogDescription>Reply to comments individually, or select several for a bulk automated response.</DialogDescription>
        </DialogHeader>

        <div className="border-b border-border pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username or keyword..."
              className="h-9 w-full rounded-lg border border-border bg-accent/20 pl-9 pr-9 text-sm outline-none focus:border-primary"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
          {([
            ["all", `All (${comments.length})`],
            ["unreplied", `Unreplied (${unrepliedCount})`],
            ["replied", `Replied (${repliedCount})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${filter === key ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-b border-border pb-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allPendingSelected} onCheckedChange={toggleAll} disabled={pending.length === 0} />
            Select all pending ({pending.length})
          </label>
          <button
            onClick={replySelected}
            disabled={selected.size === 0}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Zap className="h-3.5 w-3.5" /> Auto-reply to {selected.size || ""} selected
          </button>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {visible.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {q ? `No comments match "${query.trim()}".` : `No ${filter === "all" ? "" : filter} comments.`}
            </p>
          )}
          {visible.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              rule={matchRule(c.comment, rules)}
              selected={selected.has(c.id)}
              onToggleSelect={() => toggleOne(c.id)}
              onReply={() => replyOne(c)}
              onEditReply={(text) => editReply(c.id, text)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommentRow({
  comment, rule, selected, onToggleSelect, onReply, onEditReply,
}: {
  comment: MockComment;
  rule: CommentRule | undefined;
  selected: boolean;
  onToggleSelect: () => void;
  onReply: () => void;
  onEditReply: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.replyText ?? "");

  const startEdit = () => {
    setDraft(comment.replyText ?? "");
    setEditing(true);
  };
  const save = () => {
    if (!draft.trim()) return;
    onEditReply(draft.trim());
    setEditing(false);
  };

  return (
    <div className={`rounded-xl border border-border p-3 ${comment.replied ? "bg-accent/20" : ""}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={selected}
          onCheckedChange={onToggleSelect}
          disabled={comment.replied}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{comment.author}</span>
            <span className="text-[11px] shrink-0 text-muted-foreground">{comment.time}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">"{comment.comment}"</p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{comment.video}</span>
            {rule && <span className="shrink-0 rounded bg-brand-purple/15 px-1.5 py-0.5 text-brand-purple">{rule.type}</span>}
          </div>
        </div>
        {comment.replied ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Replied</span>
        ) : (
          <button
            onClick={onReply}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
          >
            <Zap className="h-3.5 w-3.5" /> Auto-reply
          </button>
        )}
      </div>

      {comment.replied && comment.replyText && (
        <div className="ml-7 mt-2 rounded-lg border border-border bg-background p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-brand-purple">Auto-reply sent</span>
            {!editing && (
              <button onClick={startEdit} className="text-muted-foreground hover:text-foreground" aria-label="Edit auto-reply">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {editing ? (
            <div className="mt-1.5 space-y-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="text-sm" autoFocus />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditing(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
                <button onClick={save} className="rounded-[var(--button-radius)] bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm text-foreground">{comment.replyText}</p>
          )}
        </div>
      )}
    </div>
  );
}
