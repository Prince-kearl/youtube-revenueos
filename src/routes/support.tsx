import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LifeBuoy, Send, MessageCircle, CheckCircle2, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProfile, useSupportTickets, type TicketPriority, type TicketStatus } from "@/lib/stores";
import { uid } from "@/lib/local-store";

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
  const [profile] = useProfile();
  const [tickets, setTickets] = useSupportTickets();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("Medium");

  const mine = tickets
    .filter((t) => t.email === profile.email || t.requester === profile.name)
    .sort((a, b) => +new Date(b.created) - +new Date(a.created));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return toast.error("Please fill in both the subject and the details");
    const today = new Date().toISOString().slice(0, 10);
    setTickets((prev) => [
      {
        id: uid(),
        subject,
        message,
        org: `${profile.name} — This Workspace`,
        requester: profile.name,
        email: profile.email,
        priority,
        status: "Open",
        source: "App",
        created: today,
        lastReply: today,
      },
      ...prev,
    ]);
    setSubject("");
    setMessage("");
    setPriority("Medium");
    toast.success("Your report was sent to the Tubify team", { description: "We'll follow up by email — track status below." });
  };

  return (
    <DashboardLayout title="Support">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><LifeBuoy className="h-7 w-7 text-primary" /> Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">Report a problem or send feedback — it goes straight to the Tubify team.</p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={<MessageCircle className="h-5 w-5" />} value={String(mine.length)} label="Your Reports" />
        <StatCard icon={<Clock3 className="h-5 w-5" />} value={String(mine.filter((t) => t.status !== "Resolved").length)} label="In Progress" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} value={String(mine.filter((t) => t.status === "Resolved").length)} label="Resolved" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="font-semibold">Report a problem</h3>
          <p className="mt-1 text-sm text-muted-foreground">Bug, billing issue, or anything else — tell us what's going on.</p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Comment automation replied twice" required maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">What's happening?</Label>
              <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="The more detail the better — what you expected, what happened instead, and when." required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["Low", "Medium", "High", "Urgent"] as const).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <button type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Send className="h-4 w-4" /> Send Report
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-border bg-card lg:col-span-3">
          <h3 className="p-5 pb-0 font-semibold">Your reports</h3>
          <div className="mt-3">
            {mine.length === 0 && <p className="p-5 pt-2 text-sm text-muted-foreground">Nothing reported yet — anything you send will show up here with its status.</p>}
            {mine.map((t) => (
              <div key={t.id} className="border-t border-border p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{t.subject}</p>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${priorityColor[t.priority]}`}>{t.priority}</span>
                  <span className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[t.status]}`}>{t.status}</span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{t.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">Sent {t.created} · last update {t.lastReply}</p>
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
