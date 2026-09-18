import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Inbox,
  Search,
  Send,
  ChevronLeft,
  Instagram,
  Youtube,
  Mail,
  X,
  Plus,
  AlertTriangle,
  Sparkles,
  Flag,
  MessageCircleReply,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  Bell,
  BellOff,
  Star,
  Archive,
  ArchiveRestore,
  Eraser,
  MailOpen,
  ExternalLink,
  Loader2,
  RefreshCw,
  Link2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/modals";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leads")({
  component: LeadInbox,
});

type LeadStatus = "new" | "contacted" | "qualified" | "call_booked" | "converted" | "lost";
type LeadPlatform = "Instagram" | "YouTube Comment" | "Email";
type Lead = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  platform: LeadPlatform;
  status: LeadStatus;
  assigned_to: string | null;
  primary_lead_id: string | null;
  tags: string[];
  unread: boolean;
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
  archived: boolean;
  source: string | null;
  notes: string | null;
  ai_summary: { painPoints: string[]; desiredOutcomes: string[] } | null;
  ai_summary_generated_at: string | null;
  created_at: string;
  updated_at: string;
};
type LeadMessage = {
  id: string;
  lead_id: string;
  from_who: "lead" | "you" | "system";
  kind: "comment" | "note";
  text: string;
  pinned: boolean;
  created_at: string;
};

const STATUS_ORDER: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "call_booked",
  "converted",
  "lost",
];
const STATUS_META: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: "New Lead", color: "bg-brand-blue/15 text-brand-blue" },
  contacted: { label: "In Contact", color: "bg-brand-purple/15 text-brand-purple" },
  qualified: { label: "Qualified", color: "bg-brand-amber/15 text-brand-amber" },
  call_booked: { label: "Call Booked", color: "bg-brand-green/15 text-brand-green" },
  converted: { label: "Won", color: "bg-success/15 text-success" },
  lost: { label: "Unqualified", color: "bg-destructive/15 text-destructive" },
};
const channelIcon = { Instagram, "YouTube Comment": Youtube, Email: Mail } as const;

type MobileView = "list" | "thread" | "profile";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Avatar({ lead, size = 36 }: { lead: Pick<Lead, "name" | "avatar_url">; size?: number }) {
  if (lead.avatar_url) {
    return (
      <img
        src={lead.avatar_url}
        alt={lead.name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {initials(lead.name)}
    </div>
  );
}

function LeadThreadActions({
  lead,
  onTogglePin,
  onToggleMute,
  onToggleUnread,
  onToggleFavorite,
  onToggleArchive,
  onClearChat,
  onDelete,
}: {
  lead: Lead;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onToggleUnread: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onClearChat: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-100 hover:bg-accent hover:text-foreground lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
          aria-label="Chat actions"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onTogglePin}>
          {lead.pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
          {lead.pinned ? "Unpin chat" : "Pin chat"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleMute}>
          {lead.muted ? <Bell className="mr-2 h-4 w-4" /> : <BellOff className="mr-2 h-4 w-4" />}
          {lead.muted ? "Unmute notifications" : "Mute notifications"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleUnread}>
          {lead.unread ? <MailOpen className="mr-2 h-4 w-4" /> : <Mail className="mr-2 h-4 w-4" />}
          {lead.unread ? "Mark as read" : "Mark as unread"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleFavorite}>
          <Star className={cn("mr-2 h-4 w-4", lead.favorite && "fill-current")} />
          {lead.favorite ? "Remove from favourites" : "Add to favourites"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleArchive}>
          {lead.archived ? (
            <ArchiveRestore className="mr-2 h-4 w-4" />
          ) : (
            <Archive className="mr-2 h-4 w-4" />
          )}
          {lead.archived ? "Unarchive chat" : "Archive chat"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onClearChat}>
          <Eraser className="mr-2 h-4 w-4" /> Clear chat
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" /> Delete lead
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type LeadsResponse = { data?: Lead[]; error?: string };
type LeadMutationResponse = { data?: Lead; error?: string };
type MessagesResponse = { data?: LeadMessage[]; error?: string };
type MessageMutationResponse = { data?: LeadMessage; error?: string };
type SummaryResponse = {
  data?: { painPoints: string[]; desiredOutcomes: string[]; generatedAt: string };
  error?: string;
};

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "Check the fields and try again.",
    DATABASE_ERROR: "We couldn’t save that. Please try again.",
    NOT_FOUND: "That lead no longer exists.",
    AI_PROVIDER_NOT_CONFIGURED:
      "AI summaries aren’t available yet. Add a provider API key in Settings.",
    AI_PROVIDER_FAILED: "We couldn’t generate a summary right now. Please try again.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

type TeamMemberOption = { id: string; name: string };

function LeadInbox() {
  const [team, setTeam] = useState<TeamMemberOption[]>([]);
  useEffect(() => {
    fetch("/api/workspace/members", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.data) return;
        const options: TeamMemberOption[] = body.data
          .filter((m: { status: string }) => m.status === "active")
          .map(
            (m: { id: string; member: { name: string | null } | null; invited_email: string }) => ({
              id: m.id,
              name: m.member?.name || m.invited_email,
            }),
          );
        setTeam(options);
      })
      .catch(() => setTeam([]));
  }, []);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsStatus, setLeadsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | "Unread" | "Favourites">("All");
  const [showArchived, setShowArchived] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [draft, setDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [creating, setCreating] = useState(false);

  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [sendingNote, setSendingNote] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLeadsStatus("loading");
    fetch("/api/leads", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as LeadsResponse;
        if (!response.ok || !body.data) throw new Error();
        setLeads(body.data);
        setLeadsStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLeadsStatus("error");
      });
    return () => controller.abort();
  }, [retryToken]);

  // Leads linked to the same person are grouped under the top-level (parent) lead.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const l of leads) {
      if (!l.primary_lead_id) continue;
      const arr = map.get(l.primary_lead_id) ?? [];
      arr.push(l);
      map.set(l.primary_lead_id, arr);
    }
    return map;
  }, [leads]);
  const topLevelLeads = useMemo(
    () => leads.filter((l) => !l.primary_lead_id || !leads.some((p) => p.id === l.primary_lead_id)),
    [leads],
  );
  const groupOf = (lead: Lead) => [lead, ...(childrenByParent.get(lead.id) ?? [])];

  const sorted = useMemo(
    () =>
      [...topLevelLeads].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return +new Date(b.updated_at) - +new Date(a.updated_at);
      }),
    [topLevelLeads],
  );
  const archivedCount = topLevelLeads.filter((l) => l.archived).length;
  const filtered = sorted.filter((l) => {
    if (showArchived) return l.archived;
    if (l.archived) return false;
    if (filter === "Unread" && !l.unread) return false;
    if (filter === "Favourites" && !l.favorite) return false;
    const q = query.toLowerCase();
    if (!q) return true;
    return groupOf(l).some(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.username ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  });
  const selected = leads.find((l) => l.id === selectedId) ?? null;
  const selectedGroup = selected ? groupOf(selected) : [];
  const linkedChildren = selected ? (childrenByParent.get(selected.id) ?? []) : [];
  const groupKey = selectedId
    ? [selectedId, ...linkedChildren.map((c) => c.id)].sort().join(",")
    : "";
  const unreadCount = topLevelLeads.filter((l) => l.unread).length;
  const newCount = topLevelLeads.filter((l) => l.status === "new").length;
  const bookedCount = topLevelLeads.filter(
    (l) => l.status === "call_booked" || l.status === "converted",
  ).length;
  const pinnedMessages = messages.filter((m) => m.pinned);

  const updateLead = (id: string, patch: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const patchLead = async (id: string, patch: Record<string, unknown>) => {
    const previous = leads;
    updateLead(id, patch as Partial<Lead>);
    try {
      const response = await fetch(`/api/leads?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json()) as LeadMutationResponse;
      if (!response.ok || !body.data) throw new Error(errorMessage(body.error ?? "DATABASE_ERROR"));
      setLeads((prev) => prev.map((l) => (l.id === id ? (body.data as Lead) : l)));
    } catch (error) {
      setLeads(previous);
      toast.error(error instanceof Error ? error.message : "We couldn’t save that change.");
    }
  };

  const selectLead = (lead: Lead) => {
    setSelectedId(lead.id);
    setMobileView("thread");
    if (lead.unread) void patchLead(lead.id, { unread: false });
  };

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessagesStatus("idle");
      return;
    }
    const groupIds = groupKey.split(",").filter(Boolean);
    const controller = new AbortController();
    setMessagesStatus("loading");
    Promise.all(
      groupIds.map((id) =>
        fetch(`/api/leads/messages?leadId=${id}`, {
          cache: "no-store",
          signal: controller.signal,
        }).then(async (response) => {
          const body = (await response.json()) as MessagesResponse;
          if (!response.ok || !body.data) throw new Error();
          return body.data;
        }),
      ),
    )
      .then((lists) => {
        const merged = lists
          .flat()
          .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
        setMessages(merged);
        setMessagesStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessagesStatus("error");
      });
    return () => controller.abort();
  }, [selectedId, groupKey]);

  const addNote = async () => {
    if (!selected || !draft.trim()) return;
    setSendingNote(true);
    try {
      const response = await fetch("/api/leads/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id, text: draft.trim() }),
      });
      const body = (await response.json()) as MessageMutationResponse;
      if (!response.ok || !body.data) throw new Error();
      setMessages((prev) => [...prev, body.data as LeadMessage]);
      updateLead(selected.id, { updated_at: new Date().toISOString() });
      setDraft("");
      if (selected.status === "new") void patchLead(selected.id, { status: "contacted" });
    } catch {
      toast.error("We couldn’t save that note. Please try again.");
    } finally {
      setSendingNote(false);
    }
  };

  const setStatus = (status: LeadStatus) => {
    if (!selected) return;
    void patchLead(selected.id, { status });
    toast.success(`${selected.name} moved to ${STATUS_META[status].label}`);
  };

  const assign = (memberId: string) =>
    selected && void patchLead(selected.id, { assignedTo: memberId || null });

  const addTag = () => {
    if (!selected || !tagInput.trim()) return;
    void patchLead(selected.id, { tags: [...selected.tags, tagInput.trim()] });
    setTagInput("");
  };
  const removeTag = (tag: string) =>
    selected && void patchLead(selected.id, { tags: selected.tags.filter((t) => t !== tag) });

  const togglePinMessage = async (message: LeadMessage) => {
    const next = !message.pinned;
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, pinned: next } : m)));
    try {
      const response = await fetch(`/api/leads/messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: next }),
      });
      if (!response.ok) throw new Error();
      toast.success(next ? "Message pinned" : "Message unpinned");
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, pinned: !next } : m)));
      toast.error("We couldn’t update that message.");
    }
  };

  const toggleThreadFlag = (
    lead: Lead,
    key: "pinned" | "muted" | "favorite" | "archived",
    labels: [string, string],
  ) => {
    const next = !lead[key];
    void patchLead(lead.id, { [key]: next });
    toast.success(next ? labels[0] : labels[1]);
  };
  const toggleUnread = (lead: Lead) => {
    void patchLead(lead.id, { unread: !lead.unread });
    toast.success(lead.unread ? "Marked as read" : "Marked as unread");
  };

  const clearChat = async (leadId: string) => {
    try {
      const response = await fetch(`/api/leads/messages?leadId=${leadId}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      if (selectedId === leadId) setMessages([]);
      toast.success("Chat cleared");
    } catch {
      toast.error("We couldn’t clear that chat.");
    } finally {
      setClearingId(null);
    }
  };

  const deleteLead = async (leadId: string) => {
    const previous = leads;
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    if (selectedId === leadId) setSelectedId(null);
    try {
      const response = await fetch(`/api/leads?id=${leadId}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast.success("Lead deleted");
    } catch {
      setLeads(previous);
      toast.error("We couldn’t delete that lead.");
    } finally {
      setDeletingId(null);
    }
  };

  const applyLinkResult = (updated: Lead[]) => {
    setLeads((prev) => {
      const map = new Map(prev.map((l) => [l.id, l]));
      for (const u of updated) map.set(u.id, u);
      return Array.from(map.values());
    });
  };

  const unlinkLead = async (leadId: string) => {
    try {
      const response = await fetch("/api/leads/link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, primaryLeadId: null }),
      });
      const body = (await response.json()) as { data?: Lead[]; error?: string };
      if (!response.ok || !body.data) throw new Error();
      applyLinkResult(body.data);
      toast.success("Account unlinked");
    } catch {
      toast.error("We couldn’t unlink that account. Please try again.");
    }
  };

  const generateSummary = async () => {
    if (!selected) return;
    setSummarizing(true);
    try {
      const response = await fetch("/api/leads/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id }),
      });
      const body = (await response.json()) as SummaryResponse;
      if (!response.ok || !body.data)
        throw new Error(errorMessage(body.error ?? "AI_PROVIDER_FAILED"));
      updateLead(selected.id, {
        ai_summary: {
          painPoints: body.data.painPoints,
          desiredOutcomes: body.data.desiredOutcomes,
        },
        ai_summary_generated_at: body.data.generatedAt,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn’t generate a summary.");
    } finally {
      setSummarizing(false);
    }
  };

  const clearingLead = leads.find((l) => l.id === clearingId) ?? null;
  const deletingLead = leads.find((l) => l.id === deletingId) ?? null;

  const externalLink = (lead: Lead): { href: string; label: string } | null => {
    if (lead.platform === "Email" && lead.email)
      return { href: `mailto:${lead.email}`, label: "Email" };
    if (lead.platform === "Instagram" && lead.username)
      return {
        href: `https://instagram.com/${lead.username.replace(/^@/, "")}`,
        label: "Open Instagram",
      };
    return null;
  };
  // Same as externalLink, but across every channel linked to this person.
  const externalLinksForGroup = (lead: Lead): { href: string; label: string }[] => {
    const links: { href: string; label: string }[] = [];
    for (const member of groupOf(lead)) {
      const link = externalLink(member);
      if (link && !links.some((l) => l.label === link.label)) links.push(link);
    }
    return links;
  };

  return (
    <DashboardLayout title="Lead Inbox">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          mobileView === "list" ? "" : "hidden lg:flex",
        )}
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Inbox className="h-6 w-6 text-primary" /> Lead Inbox
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everyone who commented, dropped a handle, or reached out — in one place.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Lead
        </button>
      </div>

      {leadsStatus === "error" && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t load your leads.</p>
          <button
            type="button"
            onClick={() => setRetryToken((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {leadsStatus !== "error" && (
        <div className="relative mt-4 grid grid-cols-1 overflow-hidden rounded-xl card-gradient-outline h-[calc(100dvh_-_212px)] lg:h-[calc(100dvh_-_210px)] lg:min-h-[560px] lg:grid-cols-[300px_1fr_320px]">
          {/* Thread list */}
          <div
            className={cn(
              "flex min-h-0 flex-col border-border lg:border-r",
              mobileView === "list" ? "flex" : "hidden lg:flex",
            )}
          >
            <div className="shrink-0 space-y-2 border-b border-border p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search leads…"
                  className="h-9 w-full rounded-full border border-border bg-accent/20 pl-8 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(["All", "Unread", "Favourites"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setFilter(f);
                        setShowArchived(false);
                      }}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        filter === f && !showArchived
                          ? "bg-primary text-primary-foreground"
                          : "bg-accent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f}
                      {f === "Unread" && unreadCount > 0 ? ` [${unreadCount}]` : ""}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1" title="Total leads">
                    <Inbox className="h-3 w-3" /> {topLevelLeads.length}
                  </span>
                  <span className="flex items-center gap-1" title="New — awaiting reply">
                    <Flag className="h-3 w-3 text-brand-amber" /> {newCount}
                  </span>
                  <span className="flex items-center gap-1" title="Booked / Won">
                    <MessageCircleReply className="h-3 w-3 text-success" /> {bookedCount}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {leadsStatus === "loading" && (
                <div className="space-y-3 p-3" aria-label="Loading leads" aria-busy="true">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {leadsStatus === "ready" &&
                filtered.map((lead) => {
                  const ChannelIcon = channelIcon[lead.platform];
                  const group = groupOf(lead);
                  const groupPlatforms = Array.from(new Set(group.map((m) => m.platform)));
                  return (
                    <div
                      key={lead.id}
                      className={cn(
                        "group relative flex w-full items-start gap-2.5 border-b border-border p-3 hover:bg-accent/40",
                        selected?.id === lead.id && "bg-accent/60",
                      )}
                    >
                      <button
                        onClick={() => selectLead(lead)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                      >
                        <div className="relative shrink-0">
                          <Avatar lead={lead} size={36} />
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border">
                            <ChannelIcon className="h-2.5 w-2.5" />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            {lead.pinned && (
                              <Pin className="h-3 w-3 shrink-0 fill-current text-muted-foreground" />
                            )}
                            <p
                              className={cn(
                                "truncate text-sm",
                                lead.unread ? "font-semibold" : "font-medium",
                              )}
                            >
                              {lead.name}
                            </p>
                            {lead.favorite && (
                              <Star className="h-3 w-3 shrink-0 fill-current text-brand-amber" />
                            )}
                            {lead.muted && (
                              <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            {lead.unread && !lead.muted && (
                              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {lead.source ?? "No notes yet"}
                          </p>
                          <span
                            className={cn(
                              "mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                              STATUS_META[lead.status].color,
                            )}
                          >
                            {STATUS_META[lead.status].label}
                          </span>
                          {groupPlatforms.length > 1 && (
                            <div className="mt-1 flex items-center gap-1">
                              {groupPlatforms.map((p) => {
                                const Icon = channelIcon[p];
                                return (
                                  <span
                                    key={p}
                                    title={p}
                                    className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-muted-foreground"
                                  >
                                    <Icon className="h-2.5 w-2.5" />
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </button>
                      <LeadThreadActions
                        lead={lead}
                        onTogglePin={() =>
                          toggleThreadFlag(lead, "pinned", ["Chat pinned", "Chat unpinned"])
                        }
                        onToggleMute={() =>
                          toggleThreadFlag(lead, "muted", [
                            "Notifications muted",
                            "Notifications unmuted",
                          ])
                        }
                        onToggleUnread={() => toggleUnread(lead)}
                        onToggleFavorite={() =>
                          toggleThreadFlag(lead, "favorite", [
                            "Added to favourites",
                            "Removed from favourites",
                          ])
                        }
                        onToggleArchive={() =>
                          toggleThreadFlag(lead, "archived", ["Chat archived", "Chat unarchived"])
                        }
                        onClearChat={() => setClearingId(lead.id)}
                        onDelete={() => setDeletingId(lead.id)}
                      />
                    </div>
                  );
                })}
              {leadsStatus === "ready" && filtered.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {showArchived ? "No archived chats." : "No leads match this filter."}
                </p>
              )}
              {leadsStatus === "ready" && !showArchived && archivedCount > 0 && (
                <button
                  onClick={() => setShowArchived(true)}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-border p-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  <Archive className="h-3.5 w-3.5" /> {archivedCount} archived chat
                  {archivedCount > 1 ? "s" : ""}
                </button>
              )}
            </div>
          </div>

          {/* Conversation */}
          <div
            className={cn(
              "min-h-0 min-w-0 flex-col lg:static lg:flex",
              mobileView === "thread" ? "flex" : "hidden lg:flex",
            )}
          >
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Select a lead to see the conversation.
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-3 border-b border-border p-3">
                  <button
                    onClick={() => setMobileView("list")}
                    className="text-muted-foreground hover:text-foreground lg:hidden"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <Avatar lead={selected} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{selected.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selected.username ?? selected.platform}
                    </p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    {externalLinksForGroup(selected).map((link) => (
                      <a
                        key={link.label}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
                      >
                        {link.label} <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                  <button
                    onClick={() => setMobileView("profile")}
                    className="rounded-full border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent lg:hidden"
                  >
                    Details
                  </button>
                </div>

                {pinnedMessages.length > 0 && (
                  <div className="shrink-0 border-b border-border bg-accent/20 px-4 py-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />
                      {pinnedMessages.length} pinned message{pinnedMessages.length > 1 ? "s" : ""}
                    </div>
                    <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                      {pinnedMessages.map((m) => (
                        <div
                          key={m.id}
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
                        >
                          <span className="max-w-[160px] truncate text-muted-foreground">
                            {m.text}
                          </span>
                          <button
                            onClick={() => void togglePinMessage(m)}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messagesStatus === "loading" && (
                    <div className="space-y-3" aria-label="Loading conversation" aria-busy="true">
                      <Skeleton className="ml-auto h-10 w-2/3 rounded-xl" />
                      <Skeleton className="h-10 w-2/3 rounded-xl" />
                    </div>
                  )}
                  {messagesStatus === "error" && (
                    <p className="text-center text-sm text-muted-foreground">
                      We couldn’t load this conversation.
                    </p>
                  )}
                  {messagesStatus === "ready" && messages.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground">No messages yet.</p>
                  )}
                  {messagesStatus === "ready" &&
                    messages.map((m) => {
                      if (m.from_who === "system") {
                        return (
                          <p key={m.id} className="my-2 text-center text-xs text-muted-foreground">
                            {m.text}
                          </p>
                        );
                      }
                      const isYou = m.from_who === "you";
                      const sourceLead =
                        selectedGroup.length > 1
                          ? selectedGroup.find((l) => l.id === m.lead_id)
                          : undefined;
                      return (
                        <div
                          key={m.id}
                          className={cn("group flex", isYou ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "relative max-w-[80%] rounded-xl py-2.5 pl-3.5 pr-3.5 text-sm",
                              isYou ? "bg-primary text-primary-foreground" : "bg-accent",
                            )}
                          >
                            <button
                              onClick={() => void togglePinMessage(m)}
                              className={cn(
                                "absolute -top-1.5 opacity-0 group-hover:opacity-100",
                                isYou ? "-left-1.5" : "-right-1.5",
                              )}
                              aria-label={m.pinned ? "Unpin message" : "Pin message"}
                            >
                              <Pin
                                className={cn(
                                  "h-3 w-3 rotate-45",
                                  m.pinned ? "fill-current text-primary" : "text-muted-foreground",
                                )}
                              />
                            </button>
                            <p
                              className={cn(
                                "mb-1 text-[10px] font-medium uppercase tracking-wide",
                                isYou ? "text-primary-foreground/70" : "text-muted-foreground",
                              )}
                            >
                              {m.kind === "comment" ? "YouTube comment reply" : "Note"}
                              {sourceLead ? ` · ${sourceLead.platform}` : ""}
                            </p>
                            {m.text}
                          </div>
                        </div>
                      );
                    })}
                </div>

                <div className="shrink-0 border-t border-border p-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addNote();
                    }}
                    className="flex items-end gap-2 rounded-2xl border border-border bg-accent/10 p-1.5 pl-3.5 focus-within:border-primary"
                  >
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Add a private note…"
                      className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      type="submit"
                      disabled={sendingNote || !draft.trim()}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                      aria-label="Save note"
                    >
                      {sendingNote ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </form>
                  <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                    Private note only — not sent to {selected.name}.
                    {externalLinksForGroup(selected).length > 0 && (
                      <>
                        {" "}
                        {externalLinksForGroup(selected).map((link, i) => (
                          <span key={link.label}>
                            {i > 0 && " · "}
                            <a
                              href={link.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary hover:underline"
                            >
                              {link.label} →
                            </a>
                          </span>
                        ))}
                      </>
                    )}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Profile */}
          <div
            className={cn(
              "min-h-0 flex-col border-border lg:flex lg:border-l",
              mobileView === "profile" ? "flex" : "hidden",
            )}
          >
            {!selected ? (
              <div className="hidden flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground lg:flex">
                No lead selected.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4">
                <button
                  onClick={() => setMobileView("thread")}
                  className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
                >
                  <ChevronLeft className="h-4 w-4" /> Back to conversation
                </button>

                <div className="flex items-center gap-3">
                  <Avatar lead={selected} size={48} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{selected.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selected.username ?? "No handle"} · {selected.platform}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={selected.status} onValueChange={(v) => setStatus(v as LeadStatus)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-3">
                  <label className="text-xs font-medium text-muted-foreground">Assigned to</label>
                  <Select
                    value={selected.assigned_to || "unassigned"}
                    onValueChange={(v) => assign(v === "unassigned" ? "" : v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {team.map((m) => (
                        <SelectItem key={m.id} value={m.name}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-4">
                  <label className="text-xs font-medium text-muted-foreground">Tags</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-xs text-muted-foreground"
                      >
                        {tag}
                        <button onClick={() => removeTag(tag)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <div className="flex items-center gap-1">
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                        placeholder="Add tag"
                        className="h-7 w-20 rounded-full border border-border bg-accent/10 px-2 text-xs outline-none focus:border-primary"
                      />
                      <button
                        onClick={addTag}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      Linked accounts
                    </label>
                    <button
                      onClick={() => setLinking(true)}
                      className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      <Link2 className="h-3 w-3" /> Link another
                    </button>
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {selectedGroup.map((member) => {
                      const MemberIcon = channelIcon[member.platform];
                      return (
                        <div
                          key={member.id}
                          className="flex items-center gap-2.5 rounded-lg border border-border p-2"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground">
                            <MemberIcon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">{member.platform}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {member.username ?? member.email ?? "No handle"}
                            </p>
                          </div>
                          {member.id !== selected.id && (
                            <button
                              onClick={() => void unlinkLead(member.id)}
                              title="Unlink this account"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                              <Unlink className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {selected.source && (
                  <div className="mt-5 rounded-lg border border-border p-3">
                    <p className="text-xs font-medium text-muted-foreground">Captured from</p>
                    <p className="mt-1 text-sm italic text-muted-foreground">
                      &quot;{selected.source}&quot;
                    </p>
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles className="h-3.5 w-3.5" /> AI Summary
                    </p>
                    <button
                      onClick={() => void generateSummary()}
                      disabled={summarizing}
                      className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {selected.ai_summary ? "Regenerate" : "Generate"}
                    </button>
                  </div>
                  {!selected.ai_summary ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Summarize this conversation's pain points and desired outcomes with AI.
                    </p>
                  ) : (
                    <>
                      {selected.ai_summary_generated_at && (
                        <p className="text-[10px] text-muted-foreground">
                          {timeLabel(selected.ai_summary_generated_at)}
                        </p>
                      )}
                      {selected.ai_summary.painPoints.length > 0 && (
                        <div className="mt-3">
                          <p className="flex items-center gap-1 text-xs font-medium">
                            <AlertTriangle className="h-3 w-3 text-warning" /> Pain Points
                          </p>
                          <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                            {selected.ai_summary.painPoints.map((p, i) => (
                              <li key={i} className="flex gap-1.5">
                                <span>·</span>
                                {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selected.ai_summary.desiredOutcomes.length > 0 && (
                        <div className="mt-3">
                          <p className="flex items-center gap-1 text-xs font-medium">
                            <Flag className="h-3 w-3 text-success" /> Desired Outcomes
                          </p>
                          <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                            {selected.ai_summary.desiredOutcomes.map((p, i) => (
                              <li key={i} className="flex gap-1.5">
                                <span>·</span>
                                {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selected.ai_summary.painPoints.length === 0 &&
                        selected.ai_summary.desiredOutcomes.length === 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Nothing concrete found in the conversation yet.
                          </p>
                        )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!clearingLead}
        onOpenChange={(v) => !v && setClearingId(null)}
        title={`Clear chat with ${clearingLead?.name}?`}
        description="This deletes every message in this conversation. The lead itself stays in your inbox."
        confirmLabel="Clear chat"
        onConfirm={() => clearingLead && void clearChat(clearingLead.id)}
      />
      <ConfirmDialog
        open={!!deletingLead}
        onOpenChange={(v) => !v && setDeletingId(null)}
        title={`Delete ${deletingLead?.name}?`}
        description="This removes the lead and its entire conversation history. This cannot be undone."
        confirmLabel="Delete lead"
        onConfirm={() => deletingLead && void deleteLead(deletingLead.id)}
      />
      <NewLeadDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(created) => {
          setLeads((prev) => [created, ...prev]);
          setSelectedId(created.id);
          setMobileView("thread");
        }}
      />
      <LinkLeadDialog
        open={linking}
        onOpenChange={setLinking}
        targetLead={selected}
        allLeads={leads}
        excludeIds={new Set(selectedGroup.map((l) => l.id))}
        onLinked={applyLinkResult}
      />
    </DashboardLayout>
  );
}

function LinkLeadDialog({
  open,
  onOpenChange,
  targetLead,
  allLeads,
  excludeIds,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetLead: Lead | null;
  allLeads: Lead[];
  excludeIds: Set<string>;
  onLinked: (leads: Lead[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!targetLead) return null;

  const q = query.toLowerCase();
  const candidates = allLeads.filter(
    (l) =>
      !excludeIds.has(l.id) &&
      (l.name.toLowerCase().includes(q) || (l.username ?? "").toLowerCase().includes(q)),
  );

  const link = async (leadId: string) => {
    setLinkingId(leadId);
    try {
      const response = await fetch("/api/leads/link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, primaryLeadId: targetLead.id }),
      });
      const body = (await response.json()) as { data?: Lead[]; error?: string };
      if (!response.ok || !body.data) throw new Error();
      onLinked(body.data);
      toast.success("Accounts linked");
      onOpenChange(false);
    } catch {
      toast.error("We couldn’t link that account. Please try again.");
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link another channel</DialogTitle>
          <DialogDescription>
            Connect another lead record to {targetLead.name} when it’s the same person reaching out
            on a different channel.
          </DialogDescription>
        </DialogHeader>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads…"
          className="w-full rounded-[10px] border border-border bg-accent/20 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No other leads to link.</p>
          )}
          {candidates.map((c) => {
            const ChannelIcon = channelIcon[c.platform];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => void link(c.id)}
                disabled={linkingId !== null}
                className="flex w-full items-center gap-2.5 rounded-lg border border-border p-2 text-left hover:border-primary disabled:opacity-50"
              >
                <Avatar lead={c} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <ChannelIcon className="h-3 w-3" /> {c.username ?? c.email ?? c.platform}
                  </p>
                </div>
                {linkingId === c.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewLeadDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (lead: Lead) => void;
}) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<LeadPlatform>("Instagram");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPlatform("Instagram");
    setUsername("");
    setEmail("");
    setSource("");
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          platform,
          username: username.trim() || null,
          email: email.trim() || null,
          source: source.trim() || null,
        }),
      });
      const body = (await response.json()) as LeadMutationResponse;
      if (!response.ok || !body.data) throw new Error();
      onCreate(body.data);
      onOpenChange(false);
      toast.success("Lead added");
    } catch {
      toast.error("We couldn’t add that lead. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
          <DialogDescription>
            Track someone who reached out on Instagram or Email.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              className="mt-1 w-full rounded-[10px] border border-border bg-accent/20 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Platform</label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as LeadPlatform)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Instagram">Instagram</SelectItem>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="YouTube Comment">YouTube Comment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {platform === "Email" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-[10px] border border-border bg-accent/20 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Handle (optional)</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@handle"
                className="mt-1 w-full rounded-[10px] border border-border bg-accent/20 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Source (optional)</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="How this lead came in"
              className="mt-1 w-full rounded-[10px] border border-border bg-accent/20 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add lead"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
