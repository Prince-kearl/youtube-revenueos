import { useEffect, useState } from "react";
import { CheckCircle2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { FlatKpiCard } from "@/components/KpiTrendCard";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

type TicketStatus = "Open" | "Pending" | "Resolved";
type TicketPriority = "Low" | "Medium" | "High" | "Urgent";
type TicketSource = "App" | "Landing Page";

interface AdminTicket {
  id: string;
  subject: string;
  message: string;
  org: string;
  requester_name: string;
  requester_email: string;
  priority: TicketPriority;
  status: TicketStatus;
  source: TicketSource;
  created_at: string;
  updated_at: string;
}

// Static reference content for the Knowledge Base list — real Tubify feature docs, authored like
// Roadmap/Changelog rather than backed by per-viewer analytics. No "views" counter: nothing
// public renders these articles yet, so a view count would just be invented data.
const kbArticles = [
  { id: "kb1", title: "Connecting your YouTube channel", category: "Getting Started" },
  { id: "kb2", title: "How link attribution and yt_ref tracking works", category: "Growth" },
  { id: "kb3", title: "Setting up comment automation rules", category: "Comments" },
  { id: "kb4", title: "Inviting teammates and splitting lead commission", category: "Team" },
];

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
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const log = useAuditLogger();
  const [statusFilter, setStatusFilter] = useState<"All" | TicketStatus>("All");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/support/tickets");
        if (!res.ok) return;
        const { data } = await res.json();
        setTickets(data ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered =
    statusFilter === "All" ? tickets : tickets.filter((t) => t.status === statusFilter);

  const resolve = async (t: AdminTicket) => {
    const res = await fetch(`/api/admin/support/tickets?id=${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Resolved" }),
    });
    if (!res.ok) {
      toast.error("Couldn't update this ticket");
      return;
    }
    setTickets((prev) =>
      prev.map((x) =>
        x.id === t.id ? { ...x, status: "Resolved", updated_at: new Date().toISOString() } : x,
      ),
    );
    log("Resolved ticket", "Support", t.subject);
    toast.success(`Marked "${t.subject}" as resolved`);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Support</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tickets, bug reports, and the knowledge base.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FlatKpiCard title="Total Tickets" value={String(tickets.length)} />
        <FlatKpiCard
          title="Open"
          value={String(tickets.filter((t) => t.status === "Open").length)}
        />
        <FlatKpiCard
          title="Urgent"
          value={String(tickets.filter((t) => t.priority === "Urgent").length)}
        />
        <FlatKpiCard
          title="Resolved"
          value={String(tickets.filter((t) => t.status === "Resolved").length)}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {(["All", "Open", "Pending", "Resolved"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-[var(--button-radius)] px-3 py-1.5 text-xs font-medium ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="relative mt-4 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {loading && (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading tickets…</p>
        )}
        {!loading &&
          filtered.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">{t.subject}</p>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${priorityColor[t.priority]}`}
                  >
                    {t.priority}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${sourceColor[t.source]}`}
                  >
                    {t.source}
                  </span>
                </div>
                <p className="mt-1 max-w-xl truncate text-sm text-muted-foreground">{t.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.requester_name} · {t.requester_email} · {t.org} · opened{" "}
                  {t.created_at.slice(0, 10)} · last reply {t.updated_at.slice(0, 10)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[t.status]}`}
                >
                  {t.status}
                </span>
                {t.status !== "Resolved" && (
                  <button
                    onClick={() => resolve(t)}
                    className="flex items-center gap-1 rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/10"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        {!loading && filtered.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No tickets match this filter.
          </p>
        )}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Knowledge Base</h3>
      <div className="relative mt-3 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {kbArticles.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 border-b border-border p-4 last:border-0"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-muted-foreground">
                <BookOpen className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.category}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
