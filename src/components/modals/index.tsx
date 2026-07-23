import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DEAL_STAGES, DealStage, Deal, Destination, TrackLink, CommentRule, Campaign, DEST_COLORS, DEST_ICONS,
  TeamMember, TeamRole,
} from "@/lib/stores";
import { uid } from "@/lib/local-store";

// ---------- Deal ----------
export function DealDialog({
  open, onOpenChange, initial, defaultStage, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Deal | null;
  defaultStage?: DealStage;
  onSave: (deal: Deal) => void;
}) {
  const [form, setForm] = useState<Deal>({
    id: "", company: "", contact: "", value: 0, tag: "", stage: defaultStage ?? "Prospect",
    progress: 0, action: "", date: "",
  });
  useEffect(() => {
    if (open) {
      setForm(
        initial ?? {
          id: uid(), company: "", contact: "", value: 0, tag: "", stage: defaultStage ?? "Prospect",
          progress: 0, action: "", date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        },
      );
    }
  }, [open, initial, defaultStage]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim()) return toast.error("Company name is required");
    if (form.value < 0) return toast.error("Value must be positive");
    onSave({ ...form, id: form.id || uid() });
    onOpenChange(false);
    toast.success(initial ? "Deal updated" : "Deal created");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Deal" : "New Brand Deal"}</DialogTitle>
          <DialogDescription>Track sponsorships in the CRM pipeline.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Company"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required maxLength={80} /></Field>
          <Field label="Contact"><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Value (USD)"><Input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></Field>
            <Field label="Tag"><Input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="SaaS" /></Field>
          </div>
          <Field label="Stage">
            <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v as DealStage })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DEAL_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Progress %"><Input type="number" min={0} max={100} value={form.progress} onChange={(e) => setForm({ ...form, progress: Math.min(100, Math.max(0, Number(e.target.value))) })} /></Field>
            <Field label="Next action date"><Input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} placeholder="Jan 15" /></Field>
          </div>
          <Field label="Next action"><Input value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder="Send media kit" /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initial ? "Save" : "Create Deal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Destination ----------
export function DestinationDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Destination | null;
  onSave: (d: Destination) => void;
}) {
  const [form, setForm] = useState<Destination>({
    id: "", name: "", tag: "Course", tagColor: "purple", icon: "cart", url: "",
    clicks: "0", cvr: "0%", revenue: "N/A",
  });
  useEffect(() => {
    if (open) {
      setForm(initial ?? {
        id: uid(), name: "", tag: "Course", tagColor: "purple", icon: "cart", url: "",
        clicks: "0", cvr: "0%", revenue: "N/A",
      });
    }
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    try { new URL(form.url); } catch { return toast.error("Please enter a valid URL"); }
    onSave({ ...form, id: form.id || uid() });
    onOpenChange(false);
    toast.success(initial ? "Destination updated" : "Destination added");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Destination" : "Add Destination"}</DialogTitle>
          <DialogDescription>Track a conversion link across your channel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} /></Field>
          <Field label="Destination URL"><Input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" required /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tag"><Input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} /></Field>
            <Field label="Color">
              <Select value={form.tagColor} onValueChange={(v) => setForm({ ...form, tagColor: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEST_COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Icon">
              <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEST_ICONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initial ? "Save" : "Add"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Link ----------
export function LinkDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; initial?: TrackLink | null; onSave: (l: TrackLink) => void;
}) {
  const [full, setFull] = useState("");
  const [source, setSource] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setFull(/^https?:\/\//.test(initial.full) ? initial.full : `https://${initial.full}`);
      setSource(initial.source === "Untagged" ? "" : initial.source);
      setSlug(initial.short.replace(/^rvos\.io\//, ""));
    } else {
      setFull(""); setSource(""); setSlug("");
    }
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!full.trim()) return toast.error("Destination URL is required");
    try { new URL(full); } catch { return toast.error("Please enter a valid URL"); }
    const s = slug.trim() || initial?.short.replace(/^rvos\.io\//, "") || Math.random().toString(36).slice(2, 8);
    onSave({
      id: initial?.id ?? uid(),
      short: `rvos.io/${s}`,
      full: full.replace(/^https?:\/\//, ""),
      source: source || "Untagged",
      clicks: initial?.clicks ?? "0",
      unique: initial?.unique ?? "0",
      conversions: initial?.conversions ?? "0",
      cvr: initial?.cvr ?? "0%",
      revenue: initial?.revenue ?? "N/A",
      change: initial?.change ?? "0%",
      up: initial?.up ?? true,
    });
    onOpenChange(false);
    toast.success(initial ? "Link updated" : "Link created");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Tracking Link" : "Create Tracking Link"}</DialogTitle>
          <DialogDescription>{initial ? "Update the destination, source, or slug." : "Generate a short URL that captures clicks and conversions."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Destination URL"><Input type="url" value={full} onChange={(e) => setFull(e.target.value)} placeholder="https://…" required /></Field>
          <Field label="Source video (optional)"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="How I Made $100K…" /></Field>
          <Field label="Custom slug (optional)"><Input value={slug} onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, ""))} placeholder="course" /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initial ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Rule ----------
export function RuleDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; initial?: CommentRule | null; onSave: (r: CommentRule) => void;
}) {
  const [form, setForm] = useState<CommentRule>({
    id: "", type: "Keyword trigger", icon: "message", color: "purple", active: true,
    match: "", reply: "", fired: 0, video: "",
  });
  useEffect(() => {
    if (open) {
      setForm(initial ?? {
        id: uid(), type: "Keyword trigger", icon: "message", color: "purple", active: true,
        match: "", reply: "", fired: 0, video: "",
      });
    }
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.type.trim()) return toast.error("Rule name is required");
    if (!form.match.trim()) return toast.error("Trigger condition is required");
    if (!form.reply.trim()) return toast.error("Auto-reply is required");
    onSave({ ...form, id: form.id || uid() });
    onOpenChange(false);
    toast.success(initial ? "Rule updated" : "Rule created");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Rule" : "New Comment Rule"}</DialogTitle>
          <DialogDescription>Auto-reply to comments matching this trigger.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Rule name"><Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v as CommentRule["icon"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="message">Keyword</SelectItem>
                  <SelectItem value="at">@ handle</SelectItem>
                  <SelectItem value="help">Question (AI)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Color">
              <Select value={form.color} onValueChange={(v) => setForm({ ...form, color: v as CommentRule["color"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purple">Purple</SelectItem>
                  <SelectItem value="blue">Blue</SelectItem>
                  <SelectItem value="green">Green</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Trigger condition"><Textarea value={form.match} onChange={(e) => setForm({ ...form, match: e.target.value })} rows={2} maxLength={300} /></Field>
          <Field label="Auto-reply"><Textarea value={form.reply} onChange={(e) => setForm({ ...form, reply: e.target.value })} rows={3} maxLength={500} /></Field>
          <Field label="Video (optional)"><Input value={form.video} onChange={(e) => setForm({ ...form, video: e.target.value })} maxLength={120} /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initial ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Campaign ----------
export function CampaignDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; initial?: Campaign | null; onSave: (c: Campaign) => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Campaign["status"]>("Draft");
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setStatus(initial?.status ?? "Draft");
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Campaign name is required");
    onSave({
      id: initial?.id ?? uid(),
      name,
      sent: initial?.sent ?? "0",
      open: initial?.open ?? "0%",
      click: initial?.click ?? "0%",
      status,
    });
    onOpenChange(false);
    toast.success(initial ? "Campaign updated" : "Campaign created");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          <DialogDescription>{initial ? "Update the campaign name or status." : "Create an email broadcast or drip step."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as Campaign["status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Scheduled">Scheduled</SelectItem>
                <SelectItem value="Sending">Sending</SelectItem>
                <SelectItem value="Sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initial ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Team ----------
const TEAM_ROLES: TeamRole[] = ["Owner", "Manager", "Setter", "Editor"];

export function TeamMemberDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; initial?: TeamMember | null; onSave: (m: TeamMember) => void;
}) {
  const [form, setForm] = useState<TeamMember>({
    id: "", name: "", email: "", avatar: "", role: "Setter", commission: 0, leadShare: 0, status: "Invited",
  });
  useEffect(() => {
    if (open) {
      setForm(
        initial ?? {
          id: uid(), name: "", email: "",
          avatar: `https://i.pravatar.cc/64?img=${Math.floor(Math.random() * 70) + 1}`,
          role: "Setter", commission: 10, leadShare: 0, status: "Invited",
        },
      );
    }
  }, [open, initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.email.trim()) return toast.error("Email is required");
    if (form.leadShare < 0 || form.leadShare > 100) return toast.error("Lead share must be 0–100%");
    onSave({ ...form, id: form.id || uid() });
    onOpenChange(false);
    toast.success(initial ? "Team member updated" : "Invite sent");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Team Member" : "Invite Team Member"}</DialogTitle>
          <DialogDescription>Assign a role, lead share, and commission for the pipeline.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required maxLength={120} /></Field>
          <Field label="Role">
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as TeamRole })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TEAM_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lead share %"><Input type="number" min={0} max={100} value={form.leadShare} onChange={(e) => setForm({ ...form, leadShare: Number(e.target.value) })} /></Field>
            <Field label="Commission %"><Input type="number" min={0} max={100} value={form.commission} onChange={(e) => setForm({ ...form, commission: Number(e.target.value) })} /></Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initial ? "Save" : "Send Invite"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Confirm ----------
export function ConfirmDialog({
  open, onOpenChange, title, description, onConfirm, confirmLabel = "Delete", destructive = true,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string;
  onConfirm: () => void; confirmLabel?: string; destructive?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
