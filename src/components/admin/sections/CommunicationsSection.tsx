import { useEffect, useState } from "react";
import { Megaphone, Plus, Send, Mail, Bell, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/ui-bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAnnouncements, type Announcement, type AnnouncementChannel, type AnnouncementStatus } from "@/lib/stores";
import { uid } from "@/lib/local-store";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const channelIcon: Record<AnnouncementChannel, typeof Mail> = { "In-app": Bell, Email: Mail, Push: Smartphone };
const statusColor: Record<AnnouncementStatus, string> = {
  Draft: "bg-accent text-muted-foreground",
  Scheduled: "bg-warning/15 text-warning",
  Sent: "bg-success/15 text-success",
};

export function CommunicationsSection() {
  const [items, setItems] = useAnnouncements();
  const log = useAuditLogger();
  const [creating, setCreating] = useState(false);

  const send = (a: Announcement) => {
    setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "Sent", date: new Date().toISOString().slice(0, 10) } : x)));
    log("Sent announcement", "Communications", a.title);
    toast.success(`"${a.title}" sent to ${a.audience}`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Communications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Announcements, email campaigns, and in-app broadcasts.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Announcement
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Megaphone className="h-5 w-5" />} value={String(items.length)} label="Total Announcements" />
        <StatCard icon={<Send className="h-5 w-5" />} value={String(items.filter((a) => a.status === "Sent").length)} label="Sent" />
        <StatCard icon={<Bell className="h-5 w-5" />} value={String(items.filter((a) => a.status === "Scheduled").length)} label="Scheduled" />
        <StatCard icon={<Mail className="h-5 w-5" />} value={String(items.filter((a) => a.status === "Draft").length)} label="Drafts" />
      </div>

      <div className="relative mt-5 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {items.map((a) => {
          const Icon = channelIcon[a.channel];
          return (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-0">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground"><Icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{a.audience} · {a.channel} · {a.date}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[a.status]}`}>{a.status}</span>
                {a.status !== "Sent" && (
                  <button onClick={() => send(a)} className="flex items-center gap-1 rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"><Send className="h-3.5 w-3.5" /> Send now</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CreateAnnouncementDialog open={creating} onOpenChange={setCreating} onCreate={(a) => { setItems((prev) => [a, ...prev]); log("Created announcement", "Communications", a.title); }} />
    </div>
  );
}

function CreateAnnouncementDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (a: Announcement) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("All Users");
  const [channel, setChannel] = useState<AnnouncementChannel>("In-app");

  useEffect(() => { if (open) { setTitle(""); setBody(""); setAudience("All Users"); setChannel("In-app"); } }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Title is required");
    onCreate({ id: uid(), title, body, audience, channel, status: "Draft", date: "—" });
    onOpenChange(false);
    toast.success("Announcement drafted");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Announcement</DialogTitle>
          <DialogDescription>Saved as a draft — send it from the list once ready.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Message</Label><Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["All Users", "Trial Users", "Starter Plan", "Pro Plan", "Scale Plan"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as AnnouncementChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["In-app", "Email", "Push"] as const).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save Draft</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
