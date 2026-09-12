import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FlatKpiCard } from "@/components/KpiTrendCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlowingEffect } from "@/components/ui/glowing-effect";

type TicketStatus = "Open" | "Pending" | "Resolved";
type TicketPriority = "Low" | "Medium" | "High" | "Urgent";

interface MyTicket {
  id: string;
  subject: string;
  message: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
}

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

function Support() {
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("Medium");
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = async () => {
    try {
      const res = await fetch("/api/support/tickets");
      if (!res.ok) return;
      const { data } = await res.json();
      setTickets(data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim())
      return toast.error("Please fill in both the subject and the details");
    setSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, priority }),
      });
      if (!res.ok) {
        toast.error("Couldn't send your report — please try again");
        return;
      }
      const { data } = await res.json();
      setTickets((prev) => [data, ...prev]);
      setSubject("");
      setMessage("");
      setPriority("Medium");
      toast.success("Your report was sent to the Tubify team", {
        description: "We'll follow up by email — track status below.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout title="Support">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <LifeBuoy className="h-7 w-7 text-primary" /> Support
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Report a problem or send feedback — it goes straight to the Tubify team.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FlatKpiCard title="Your Reports" value={String(tickets.length)} />
        <FlatKpiCard
          title="In Progress"
          value={String(tickets.filter((t) => t.status !== "Resolved").length)}
        />
        <FlatKpiCard
          title="Resolved"
          value={String(tickets.filter((t) => t.status === "Resolved").length)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="font-semibold">Report a problem</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Bug, billing issue, or anything else — tell us what's going on.
          </p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Comment automation replied twice"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">What's happening?</Label>
              <Textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="The more detail the better — what you expected, what happened instead, and when."
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["Low", "Medium", "High", "Urgent"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> {submitting ? "Sending…" : "Send Report"}
            </button>
          </form>
        </div>

        <div className="relative rounded-xl card-gradient-outline lg:col-span-3">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="p-5 pb-0 font-semibold">Your reports</h3>
          <div className="mt-3">
            {loading && (
              <p className="p-5 pt-2 text-sm text-muted-foreground">Loading your reports…</p>
            )}
            {!loading && tickets.length === 0 && (
              <p className="p-5 pt-2 text-sm text-muted-foreground">
                Nothing reported yet — anything you send will show up here with its status.
              </p>
            )}
            {tickets.map((t) => (
              <div key={t.id} className="border-t border-border p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{t.subject}</p>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${priorityColor[t.priority]}`}
                  >
                    {t.priority}
                  </span>
                  <span
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[t.status]}`}
                  >
                    {t.status}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{t.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Sent {t.created_at.slice(0, 10)} · last update {t.updated_at.slice(0, 10)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/support")({
  component: Support,
});
