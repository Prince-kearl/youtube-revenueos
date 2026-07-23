import { useState } from "react";
import { LifeBuoy, MessageCircle, CheckCircle2, BookOpen, Eye } from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/ui-bits";
import { useSupportTickets, useKbArticles, type SupportTicket, type TicketStatus, type TicketPriority } from "@/lib/stores";
import { useAuditLogger } from "../useAuditLogger";

const statusColor: Record<TicketStatus, string> = {
  Open: "bg-destructive/15 text-destructive",
  Pending: "bg-warning/15 text-warning",
  Resolved: "bg-success/15 text-success",
};
const priorityColor: Record<TicketPriority, string> = {
  Low: "bg-accent text-muted-foreground",
  Medium: "bg-brand-blue/15 text-brand-blue",
  High: "bg-warning/15 text-warning",
  Urgent: "bg-destructive/15 text-destructive",
};
const sourceColor: Record<string, string> = {
  App: "bg-brand-purple/15 text-brand-purple",
  "Landing Page": "bg-brand-amber/15 text-brand-amber",
};

export function SupportSection() {
  const [tickets, setTickets] = useSupportTickets();
  const [kb] = useKbArticles();
  const log = useAuditLogger();
  const [statusFilter, setStatusFilter] = useState<"All" | TicketStatus>("All");

  const filtered = statusFilter === "All" ? tickets : tickets.filter((t) => t.status === statusFilter);

  const resolve = (t: SupportTicket) => {
    setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "Resolved", lastReply: new Date().toISOString().slice(0, 10) } : x)));
    log("Resolved ticket", "Support", t.subject);
    toast.success(`Marked "${t.subject}" as resolved`);
  };
  const impersonateFromTicket = (t: SupportTicket) => {
    log("Impersonated user from ticket", "Support", `${t.requester} (${t.org})`);
    toast(`Impersonating ${t.requester} to troubleshoot — logged to the audit trail`, { icon: "🕵️" });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Support</h1>
      <p className="mt-1 text-sm text-muted-foreground">Tickets, bug reports, and the knowledge base.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<LifeBuoy className="h-5 w-5" />} value={String(tickets.length)} label="Total Tickets" />
        <StatCard icon={<MessageCircle className="h-5 w-5" />} value={String(tickets.filter((t) => t.status === "Open").length)} label="Open" />
        <StatCard icon={<MessageCircle className="h-5 w-5" />} value={String(tickets.filter((t) => t.priority === "Urgent").length)} label="Urgent" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} value={String(tickets.filter((t) => t.status === "Resolved").length)} label="Resolved" />
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {(["All", "Open", "Pending", "Resolved"] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{s}</button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card">
        {filtered.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{t.subject}</p>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${priorityColor[t.priority]}`}>{t.priority}</span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${sourceColor[t.source]}`}>{t.source}</span>
              </div>
              <p className="mt-1 max-w-xl truncate text-sm text-muted-foreground">{t.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.requester} · {t.email} · {t.org} · opened {t.created} · last reply {t.lastReply}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[t.status]}`}>{t.status}</span>
              <button onClick={() => impersonateFromTicket(t)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"><Eye className="h-3.5 w-3.5" /> Impersonate</button>
              {t.status !== "Resolved" && <button onClick={() => resolve(t)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/10"><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</button>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No tickets match this filter.</p>}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Knowledge Base</h3>
      <div className="mt-3 rounded-xl border border-border bg-card">
        {kb.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 border-b border-border p-4 last:border-0">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-muted-foreground"><BookOpen className="h-4 w-4" /></span>
              <div><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.category} · updated {a.updated}</p></div>
            </div>
            <span className="text-xs text-muted-foreground">{a.views.toLocaleString()} views</span>
          </div>
        ))}
      </div>
    </div>
  );
}
