import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox, Search, Send, ChevronLeft, Instagram, Youtube, Mail, Lock, X, Plus,
  AlertTriangle, Sparkles, Flag, MessageCircleReply, Paperclip, Mic, Square, FileText,
  MoreHorizontal, MoreVertical, Pin, PinOff, Trash2, Bell, BellOff, Star, Archive,
  ArchiveRestore, Eraser, MailOpen,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/modals";
import { cn } from "@/lib/utils";
import { useLeads, useTeam, type Lead, type LeadAttachment, type LeadStatus } from "@/lib/stores";
import { uid } from "@/lib/local-store";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUSES: LeadStatus[] = ["New Lead", "In Contact", "Qualified", "Call Booked", "Won", "Unqualified"];

const statusColor: Record<LeadStatus, string> = {
  "New Lead": "bg-brand-blue/15 text-brand-blue",
  "In Contact": "bg-brand-purple/15 text-brand-purple",
  Qualified: "bg-brand-amber/15 text-brand-amber",
  "Call Booked": "bg-brand-green/15 text-brand-green",
  Won: "bg-success/15 text-success",
  Unqualified: "bg-destructive/15 text-destructive",
};

const channelIcon = { Instagram, "YouTube Comment": Youtube, Email: Mail } as const;

const QUICK_REPLIES = [
  { label: "Ask channel size", text: "Mind sharing your subscriber count and average views? Just want to point you to the right plan." },
  { label: "Propose a call", text: "Want to hop on a quick 15-minute call so I can show you exactly how this would work for your channel?" },
  { label: "Send pricing", text: "Here's how pricing breaks down — plans start at $29/mo and scale with your team size, no long-term contract." },
];

type Suggestion = { label: string; text: string };

// Mocked "AI" reply suggestions — reacts to whatever the lead last said, the same way the
// Tubi assistant elsewhere in the app keyword-matches instead of calling a real model. Only
// makes sense to suggest a reply when the ball is in our court, i.e. the lead spoke last.
function suggestReplies(lead: Lead): Suggestion[] | null {
  const lastReal = [...lead.messages].reverse().find((m) => m.from !== "system");
  if (!lastReal || lastReal.from !== "lead") return null;
  const msg = lastReal.text.toLowerCase();

  if (/sign(ed)? up|just joined|excited|can'?t wait/.test(msg)) {
    return [
      { label: "Direct Answer", text: "Amazing, welcome aboard! 🎉 Really glad to have you." },
      { label: "Value Pivot", text: "You're going to love how much time the AI Lab saves once it's set up." },
      { label: "Next Step", text: "Want a quick rundown of the best 3 things to set up first?" },
    ];
  }
  if (/thanks but|not (right )?now|all set|no thanks|pass on|already (have|got)/.test(msg)) {
    return [
      { label: "Direct Answer", text: "Totally understand — appreciate you taking the time to check it out." },
      { label: "Value Pivot", text: "Most people said the same thing until the spreadsheet started slipping. No pressure either way." },
      { label: "Next Step", text: "No worries at all — I'll leave the door open if priorities shift." },
    ];
  }
  if (/cost|price|pricing|\$|plan|budget/.test(msg)) {
    return [
      { label: "Direct Answer", text: "Yeah exactly — pricing scales with your team size, so you only pay for what you're actually using." },
      { label: "Value Pivot", text: "That's usually the moment it clicks — one dashboard instead of five tools adds up fast." },
      { label: "Next Step", text: "Want me to send a quick breakdown of what's included at each plan?" },
    ];
  }
  if (/call|time|free|available|schedule|thursday|friday|tomorrow|evening/.test(msg)) {
    return [
      { label: "Direct Answer", text: "Perfect — I'll lock that in and send a confirmation your way." },
      { label: "Value Pivot", text: "A quick call is honestly the fastest way to see if this is actually a fit for you." },
      { label: "Next Step", text: "Sending over a booking link now so you can grab whatever slot works best." },
    ];
  }
  if (/team|seat|editor|setter|hire|hiring/.test(msg)) {
    return [
      { label: "Direct Answer", text: "Got it — how many people are on the team right now?" },
      { label: "Value Pivot", text: "That's exactly what the Team page is for — everyone works off the same pipeline instead of a spreadsheet." },
      { label: "Next Step", text: "Want me to walk you through how seat-based pricing works for a team your size?" },
    ];
  }
  return [
    { label: "Direct Answer", text: "Thanks for sharing that — really helps me understand where you're at." },
    { label: "Value Pivot", text: "Honestly, that's the exact problem this was built to solve." },
    { label: "Next Step", text: "Want me to show you exactly how that would work for your channel?" },
  ];
}

type MobileView = "list" | "thread" | "profile";

function MessageActions({ pinned, onPin, onDelete, isYou }: { pinned: boolean; onPin: () => void; onDelete: () => void; isYou: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full opacity-100 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100",
            isYou ? "text-primary-foreground/80 hover:bg-white/20 hover:text-primary-foreground" : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
          )}
          aria-label="Message actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isYou ? "end" : "start"}>
        <DropdownMenuItem onSelect={onPin}>
          {pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
          {pinned ? "Unpin message" : "Pin message"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" /> Delete message
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeadThreadActions({
  lead, onTogglePin, onToggleMute, onToggleUnread, onToggleFavorite, onToggleArchive, onClearChat, onDelete,
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
          {lead.archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
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

function LeadInbox() {
  const [leads, setLeads] = useLeads();
  const [team] = useTeam();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | "Unread" | "Favourites" | "Archived">("All");
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [draft, setDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [pendingFile, setPendingFile] = useState<LeadAttachment | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sorted = useMemo(
    () =>
      [...leads].sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return +new Date(b.updatedAt) - +new Date(a.updatedAt);
      }),
    [leads],
  );
  const archivedCount = leads.filter((l) => l.archived).length;
  const filtered = sorted.filter((l) => {
    if (filter === "Archived") return l.archived;
    if (l.archived) return false;
    if (filter === "Unread" && !l.unread) return false;
    if (filter === "Favourites" && !l.favorite) return false;
    return l.name.toLowerCase().includes(query.toLowerCase()) || l.handle.toLowerCase().includes(query.toLowerCase());
  });
  const selected = leads.find((l) => l.id === selectedId) ?? null;
  const suggestions = selected?.canMessage ? suggestReplies(selected) : null;
  const pinnedMessages = selected?.messages.filter((m) => m.pinned) ?? [];
  const unreadCount = leads.filter((l) => l.unread).length;
  const newTodayCount = leads.filter((l) => l.status === "New Lead").length;
  const bookedCount = leads.filter((l) => l.status === "Call Booked" || l.status === "Won").length;

  const update = (id: string, patch: Partial<Lead> | ((l: Lead) => Lead)) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? (typeof patch === "function" ? patch(l) : { ...l, ...patch }) : l)));
  };

  const selectLead = (lead: Lead) => {
    setSelectedId(lead.id);
    setMobileView("thread");
  };

  // Auto-select the first lead once the store has hydrated on the client — deferred to an
  // effect (rather than a useState initializer) so server and client render the same "no
  // selection" markup on first paint and hydration doesn't mismatch on seeded random ids.
  useEffect(() => {
    if (selectedId === null && leads.length > 0) setSelectedId(leads[0].id);
  }, [selectedId, leads]);

  // Whichever lead is open — including the initially-selected one — is considered read.
  useEffect(() => {
    if (selected?.unread) update(selected.id, { unread: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Cmd/Ctrl+1..3 fills the draft with the matching AI suggestion, mirroring the shortcut hints shown on each card.
  useEffect(() => {
    if (!suggestions) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !/^[1-9]$/.test(e.key)) return;
      const idx = Number(e.key) - 1;
      if (idx >= suggestions.length) return;
      e.preventDefault();
      setDraft(suggestions[idx].text);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [suggestions]);

  const send = (kind: "dm" | "comment", attachment?: LeadAttachment) => {
    if (!selected || (!draft.trim() && !attachment)) return;
    const text = draft.trim();
    update(selected.id, (l) => ({
      ...l,
      messages: [...l.messages, { id: uid(), from: "you", kind, text, time: "Just now", attachment }],
      updatedAt: new Date().toISOString(),
      status: l.status === "New Lead" ? "In Contact" : l.status,
    }));
    setDraft("");
    setPendingFile(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return toast.error("Attachments must be under 5MB");
    const reader = new FileReader();
    reader.onload = () => setPendingFile({ name: file.name, size: file.size, type: file.type, url: reader.result as string });
    reader.readAsDataURL(file);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const targetLeadId = selected?.id;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          if (!targetLeadId) return;
          update(targetLeadId, (l) => ({
            ...l,
            messages: [...l.messages, { id: uid(), from: "you", kind: "dm", text: "", time: "Just now", attachment: { name: "Voice message", size: blob.size, type: blob.type, url: reader.result as string, durationSec } }],
            updatedAt: new Date().toISOString(),
            status: l.status === "New Lead" ? "In Contact" : l.status,
          }));
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      setRecordingSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Couldn't access your microphone", { description: "Check your browser's mic permission for this site." });
    }
  };
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  }, []);

  const setStatus = (status: LeadStatus) => {
    if (!selected) return;
    update(selected.id, (l) => ({
      ...l,
      status,
      messages: [...l.messages, { id: uid(), from: "system", text: `Status update: ${status}`, time: "Just now" }],
      updatedAt: new Date().toISOString(),
    }));
    toast.success(`${selected.name} moved to ${status}`);
  };

  const assign = (memberId: string) => selected && update(selected.id, { assignedTo: memberId });

  const addTag = () => {
    if (!selected || !tagInput.trim()) return;
    update(selected.id, (l) => ({ ...l, tags: [...l.tags, tagInput.trim()] }));
    setTagInput("");
  };
  const removeTag = (tag: string) => selected && update(selected.id, (l) => ({ ...l, tags: l.tags.filter((t) => t !== tag) }));

  const togglePinMessage = (messageId: string) => {
    if (!selected) return;
    const msg = selected.messages.find((m) => m.id === messageId);
    update(selected.id, (l) => ({ ...l, messages: l.messages.map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m)) }));
    toast.success(msg?.pinned ? "Message unpinned" : "Message pinned");
  };
  const deleteMessage = (messageId: string) => {
    if (!selected) return;
    update(selected.id, (l) => ({ ...l, messages: l.messages.filter((m) => m.id !== messageId) }));
    toast.success("Message deleted");
  };

  const toggleThreadFlag = (lead: Lead, key: "pinned" | "muted" | "favorite" | "archived", messages: [string, string]) => {
    const next = !lead[key];
    update(lead.id, { [key]: next } as Partial<Lead>);
    toast.success(next ? messages[0] : messages[1]);
  };
  const toggleUnread = (lead: Lead) => {
    update(lead.id, { unread: !lead.unread });
    toast.success(lead.unread ? "Marked as read" : "Marked as unread");
  };
  const clearChat = (leadId: string) => {
    update(leadId, { messages: [] });
    toast.success("Chat cleared");
    setClearingId(null);
  };
  const deleteLead = (leadId: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    if (selectedId === leadId) setSelectedId(null);
    toast.success("Lead deleted");
    setDeletingId(null);
  };
  const clearingLead = leads.find((l) => l.id === clearingId) ?? null;
  const deletingLead = leads.find((l) => l.id === deletingId) ?? null;

  return (
    <DashboardLayout title="Lead Inbox">
      <div className={cn("flex flex-wrap items-center justify-between gap-3", mobileView === "list" ? "" : "hidden lg:flex")}>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Inbox className="h-6 w-6 text-primary" /> Lead Inbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Everyone who commented, dropped a handle, or DM'd you — in one place.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card h-[calc(100dvh-212px)] lg:h-[calc(100dvh-210px)] lg:min-h-[560px] lg:grid-cols-[300px_1fr_320px]">
        {/* Thread list */}
        <div className={cn("flex min-h-0 flex-col border-border lg:border-r", mobileView === "list" ? "flex" : "hidden lg:flex")}>
          <div className="shrink-0 space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search leads…" className="h-9 w-full rounded-lg border border-border bg-accent/20 pl-8 pr-3 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(["All", "Unread", "Favourites"] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn("rounded-lg px-2.5 py-1 text-xs font-medium", filter === f ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground")}>
                    {f}{f === "Unread" && unreadCount > 0 ? ` [${unreadCount}]` : ""}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1" title="Total leads"><Inbox className="h-3 w-3" />{leads.length}</span>
                <span className="flex items-center gap-1" title="New — awaiting reply"><Flag className="h-3 w-3 text-brand-amber" />{newTodayCount}</span>
                <span className="flex items-center gap-1" title="Booked / Won"><MessageCircleReply className="h-3 w-3 text-success" />{bookedCount}</span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.map((lead) => {
              const ChannelIcon = channelIcon[lead.channel];
              const last = lead.messages[lead.messages.length - 1];
              return (
                <div
                  key={lead.id}
                  className={cn("group relative flex w-full items-start gap-2.5 border-b border-border p-3 hover:bg-accent/40", selected?.id === lead.id && "bg-accent/60")}
                >
                  <button onClick={() => selectLead(lead)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                    <div className="relative shrink-0">
                      <img src={lead.avatar} alt={lead.name} className="h-9 w-9 rounded-full object-cover" />
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border"><ChannelIcon className="h-2.5 w-2.5" /></span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        {lead.pinned && <Pin className="h-3 w-3 shrink-0 fill-current text-muted-foreground" />}
                        <p className={cn("truncate text-sm", lead.unread ? "font-semibold" : "font-medium")}>{lead.name}</p>
                        {lead.favorite && <Star className="h-3 w-3 shrink-0 fill-current text-brand-amber" />}
                        {lead.muted && <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        {lead.unread && !lead.muted && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{last?.text ?? "No messages yet"}</p>
                      <span className={cn("mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium", statusColor[lead.status])}>{lead.status}</span>
                    </div>
                  </button>
                  <LeadThreadActions
                    lead={lead}
                    onTogglePin={() => toggleThreadFlag(lead, "pinned", ["Chat pinned", "Chat unpinned"])}
                    onToggleMute={() => toggleThreadFlag(lead, "muted", ["Notifications muted", "Notifications unmuted"])}
                    onToggleUnread={() => toggleUnread(lead)}
                    onToggleFavorite={() => toggleThreadFlag(lead, "favorite", ["Added to favourites", "Removed from favourites"])}
                    onToggleArchive={() => toggleThreadFlag(lead, "archived", ["Chat archived", "Chat unarchived"])}
                    onClearChat={() => setClearingId(lead.id)}
                    onDelete={() => setDeletingId(lead.id)}
                  />
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {filter === "Archived" ? "No archived chats." : "No leads match this filter."}
              </p>
            )}
            {filter !== "Archived" && archivedCount > 0 && (
              <button onClick={() => setFilter("Archived")} className="flex w-full items-center justify-center gap-1.5 border-t border-border p-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground">
                <Archive className="h-3.5 w-3.5" /> {archivedCount} archived chat{archivedCount > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className={cn("flex min-h-0 min-w-0 flex-col", mobileView === "thread" ? "flex" : "hidden lg:flex")}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">Select a lead to see the conversation.</div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-border p-3">
                <button onClick={() => setMobileView("list")} className="text-muted-foreground hover:text-foreground lg:hidden"><ChevronLeft className="h-5 w-5" /></button>
                <img src={selected.avatar} alt={selected.name} className="h-8 w-8 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{selected.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{selected.handle}</p>
                </div>
                <button onClick={() => setMobileView("profile")} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent lg:hidden">Details</button>
              </div>

              {pinnedMessages.length > 0 && (
                <div className="shrink-0 border-b border-border bg-accent/20 px-4 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />
                    {pinnedMessages.length} pinned message{pinnedMessages.length > 1 ? "s" : ""}
                  </div>
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                    {pinnedMessages.map((m) => (
                      <div key={m.id} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs">
                        <span className="max-w-[160px] truncate text-muted-foreground">{m.text || m.attachment?.name || "Attachment"}</span>
                        <button onClick={() => togglePinMessage(m.id)} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {selected.messages.map((m) => {
                  if (m.from === "system") {
                    return <p key={m.id} className="my-2 text-center text-xs text-muted-foreground">{m.text}</p>;
                  }
                  const isYou = m.from === "you";
                  return (
                    <div key={m.id} className={cn("group flex", isYou ? "justify-end" : "justify-start")}>
                      <div className={cn("relative max-w-[80%] rounded-xl py-2.5 text-sm", isYou ? "bg-primary pl-3.5 pr-7 text-primary-foreground" : "bg-accent pl-7 pr-3.5")}>
                        {m.pinned && <Pin className={cn("absolute -top-1.5 h-3 w-3 rotate-45 fill-current", isYou ? "-left-1.5 text-primary" : "-right-1.5 text-muted-foreground")} />}
                        <div className={cn("absolute top-1.5", isYou ? "right-1.5" : "left-1.5")}>
                          <MessageActions pinned={!!m.pinned} onPin={() => togglePinMessage(m.id)} onDelete={() => deleteMessage(m.id)} isYou={isYou} />
                        </div>
                        {m.kind === "comment" && <p className={cn("mb-1 text-[10px] font-medium uppercase tracking-wide", isYou ? "text-primary-foreground/70" : "text-muted-foreground")}>Comment reply</p>}
                        {m.attachment && (
                          m.attachment.type.startsWith("image/") ? (
                            <img src={m.attachment.url} alt={m.attachment.name} className={cn("max-h-52 w-full max-w-52 rounded-lg object-cover", m.text && "mb-2")} />
                          ) : m.attachment.type.startsWith("audio/") ? (
                            <div className={cn("flex items-center gap-2", m.text && "mb-2")}>
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <audio controls src={m.attachment.url} className="h-8 max-w-[200px]" />
                              {m.attachment.durationSec != null && <span className={cn("text-[10px]", isYou ? "text-primary-foreground/70" : "text-muted-foreground")}>{formatDuration(m.attachment.durationSec)}</span>}
                            </div>
                          ) : (
                            <a
                              href={m.attachment.url}
                              download={m.attachment.name}
                              className={cn("flex items-center gap-2 rounded-lg p-2", m.text && "mb-2", isYou ? "bg-white/10" : "bg-card")}
                            >
                              <FileText className="h-6 w-6 shrink-0" />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium">{m.attachment.name}</p>
                                <p className={cn("text-[10px]", isYou ? "text-primary-foreground/70" : "text-muted-foreground")}>{formatBytes(m.attachment.size)}</p>
                              </div>
                            </a>
                          )
                        )}
                        {m.text}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!selected.canMessage ? (
                <div className="shrink-0 border-t border-border p-4">
                  <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p>Instagram/YouTube policy doesn't allow starting a DM first — {selected.name} needs to message you before you can reply directly. You can still reply to their public comment below.</p>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply to their comment…" className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary" />
                    <button onClick={() => send("comment")} className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Send className="h-4 w-4" /></button>
                  </div>
                </div>
              ) : (
                <div className="shrink-0 border-t border-border p-4">
                  {suggestions ? (
                    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                      {suggestions.map((s, i) => (
                        <div
                          key={s.label}
                          className="w-60 shrink-0 rounded-lg bg-gradient-to-br from-primary via-brand-purple to-brand-amber p-[1.5px] shadow-[0_0_14px_-3px_var(--color-primary)]"
                        >
                          <button
                            onClick={() => setDraft(s.text)}
                            className="h-full w-full rounded-[6px] bg-card p-2.5 text-left hover:bg-accent"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1 text-xs font-semibold text-primary"><Sparkles className="h-3 w-3" /> {s.label}</span>
                              <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">⌘{i + 1}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.text}</p>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {QUICK_REPLIES.map((q) => (
                        <button key={q.label} onClick={() => setDraft(q.text)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground">{q.label}</button>
                      ))}
                    </div>
                  )}
                  {pendingFile && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-accent/20 p-2">
                      {pendingFile.type.startsWith("image/") ? (
                        <img src={pendingFile.url} alt={pendingFile.name} className="h-10 w-10 shrink-0 rounded object-cover" />
                      ) : (
                        <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{pendingFile.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatBytes(pendingFile.size)}</p>
                      </div>
                      <button type="button" onClick={() => setPendingFile(null)} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  <form onSubmit={(e) => { e.preventDefault(); send("dm", pendingFile ?? undefined); }} className="flex items-center gap-1.5">
                    <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
                    <div className="flex shrink-0 items-center">
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={recording} title="Attach a file" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => (recording ? stopRecording() : startRecording())} title={recording ? "Stop recording" : "Record a voice message"} className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", recording ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                        {recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
                      </button>
                    </div>
                    {recording && <span className="shrink-0 font-mono text-xs text-destructive">{formatDuration(recordingSeconds)}</span>}
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={recording ? "Recording…" : "Write a message…"} disabled={recording} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary disabled:opacity-60" />
                    <button type="submit" disabled={recording || (!draft.trim() && !pendingFile)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"><Send className="h-4 w-4" /></button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>

        {/* Profile */}
        <div className={cn("min-h-0 flex-col border-border lg:flex lg:border-l", mobileView === "profile" ? "flex" : "hidden")}>
          {!selected ? (
            <div className="hidden flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground lg:flex">No lead selected.</div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <button onClick={() => setMobileView("thread")} className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"><ChevronLeft className="h-4 w-4" /> Back to conversation</button>

              <div className="flex items-center gap-3">
                <img src={selected.avatar} alt={selected.name} className="h-12 w-12 rounded-full object-cover" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{selected.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{selected.handle} · {selected.channel}</p>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={selected.status} onValueChange={(v) => setStatus(v as LeadStatus)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-muted-foreground">Assigned to</label>
                <Select value={selected.assignedTo || "unassigned"} onValueChange={(v) => assign(v === "unassigned" ? "" : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-4">
                <label className="text-xs font-medium text-muted-foreground">Tags</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selected.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-muted-foreground">
                      {tag}
                      <button onClick={() => removeTag(tag)}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())} placeholder="Add tag" className="h-7 w-20 rounded-md border border-border bg-accent/10 px-2 text-xs outline-none focus:border-primary" />
                    <button onClick={addTag} className="text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Captured from</p>
                <p className="mt-1 text-sm font-medium">{selected.sourceVideo}</p>
                <p className="mt-1 text-sm italic text-muted-foreground">"{selected.sourceComment}"</p>
              </div>

              {(selected.painPoints.length > 0 || selected.desiredOutcomes.length > 0) && (
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" /> Tubi Summary</p>
                    <span className="text-[10px] text-muted-foreground">{selected.summaryAge}</span>
                  </div>
                  {selected.painPoints.length > 0 && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1 text-xs font-medium"><AlertTriangle className="h-3 w-3 text-warning" /> Pain Points</p>
                      <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                        {selected.painPoints.map((p, i) => <li key={i} className="flex gap-1.5"><span>·</span>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {selected.desiredOutcomes.length > 0 && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1 text-xs font-medium"><Flag className="h-3 w-3 text-success" /> Desired Outcomes</p>
                      <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                        {selected.desiredOutcomes.map((p, i) => <li key={i} className="flex gap-1.5"><span>·</span>{p}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!clearingLead}
        onOpenChange={(v) => !v && setClearingId(null)}
        title={`Clear chat with ${clearingLead?.name}?`}
        description="This deletes every message in this conversation. The lead itself stays in your inbox."
        confirmLabel="Clear chat"
        onConfirm={() => clearingLead && clearChat(clearingLead.id)}
      />
      <ConfirmDialog
        open={!!deletingLead}
        onOpenChange={(v) => !v && setDeletingId(null)}
        title={`Delete ${deletingLead?.name}?`}
        description="This removes the lead and its entire conversation history. This cannot be undone."
        confirmLabel="Delete lead"
        onConfirm={() => deletingLead && deleteLead(deletingLead.id)}
      />
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/leads")({
  component: LeadInbox,
});
