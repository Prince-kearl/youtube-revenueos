import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { goToNextOnboardingStep } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { DEAL_STAGES, DealStage, Deal, Campaign } from "@/lib/stores";
import { uid } from "@/lib/local-store";

// Destinations are backed by the real /api/destinations table (see api.destinations.ts), not a
// local mock store — this type mirrors that DB row shape, including the icon/color/category
// columns. category splits the Destinations page into two sections: "conversion" (course/
// newsletter/coaching/affiliate/lead-magnet links — the only kind that existed before) and
// "social" (the creator's own social profiles).
export type Destination = {
  id: string;
  name: string;
  type: string;
  url: string;
  description: string | null;
  status: "active" | "archived";
  icon: string;
  color: string;
  category: "conversion" | "social";
};
export type DestinationInput = Omit<Destination, "id">;
export const DEST_CATEGORIES = ["conversion", "social"] as const;
export const CONVERSION_ICONS = ["cart", "trend", "cursor", "link", "external"] as const;
export const SOCIAL_ICONS = [
  "instagram",
  "tiktok",
  "x",
  "facebook",
  "youtube",
  "linkedin",
] as const;
export const DEST_ICONS = [...CONVERSION_ICONS, ...SOCIAL_ICONS] as const;
export const DEST_COLORS = ["purple", "green", "blue", "amber", "red"] as const;

// ---------- Deal ----------
export function DealDialog({
  open,
  onOpenChange,
  initial,
  defaultStage,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Deal | null;
  defaultStage?: DealStage;
  onSave: (deal: Deal) => void;
}) {
  const [form, setForm] = useState<Deal>({
    id: "",
    company: "",
    contact: "",
    value: 0,
    tag: "",
    stage: defaultStage ?? "Prospect",
    progress: 0,
    action: "",
    date: "",
  });
  useEffect(() => {
    if (open) {
      setForm(
        initial ?? {
          id: uid(),
          company: "",
          contact: "",
          value: 0,
          tag: "",
          stage: defaultStage ?? "Prospect",
          progress: 0,
          action: "",
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
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
          <Field label="Company">
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              required
              maxLength={80}
            />
          </Field>
          <Field label="Contact">
            <Input
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              maxLength={80}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Value (USD)">
              <Input
                type="number"
                min={0}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              />
            </Field>
            <Field label="Tag">
              <Input
                value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                placeholder="SaaS"
              />
            </Field>
          </div>
          <Field label="Stage">
            <Select
              value={form.stage}
              onValueChange={(v) => setForm({ ...form, stage: v as DealStage })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Progress %">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.progress}
                onChange={(e) =>
                  setForm({ ...form, progress: Math.min(100, Math.max(0, Number(e.target.value))) })
                }
              />
            </Field>
            <Field label="Next action date">
              <Input
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                placeholder="Jan 15"
              />
            </Field>
          </div>
          <Field label="Next action">
            <Input
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
              placeholder="Send media kit"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{initial ? "Save" : "Create Deal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Destination ----------
const emptyDestinationForm = (
  category: Destination["category"] = "conversion",
): DestinationInput => ({
  name: "",
  type: "",
  url: "",
  description: "",
  status: "active",
  icon: category === "social" ? SOCIAL_ICONS[0] : CONVERSION_ICONS[0],
  color: "purple",
  category,
});

export function DestinationDialog({
  open,
  onOpenChange,
  initial,
  defaultCategory,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Destination | null;
  defaultCategory?: Destination["category"];
  onSave: (input: DestinationInput, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<DestinationInput>(emptyDestinationForm(defaultCategory));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              name: initial.name,
              type: initial.type,
              url: initial.url,
              description: initial.description ?? "",
              status: initial.status,
              icon: initial.icon,
              color: initial.color,
              category: initial.category,
            }
          : emptyDestinationForm(defaultCategory),
      );
    }
  }, [open, initial, defaultCategory]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.type.trim()) return toast.error("Type is required");
    try {
      new URL(form.url);
    } catch {
      return toast.error("Please enter a valid URL");
    }
    setSaving(true);
    try {
      await onSave(form, initial?.id);
      onOpenChange(false);
      toast.success(initial ? "Destination updated" : "Destination added");
    } catch {
      toast.error("We couldn’t save that destination. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Destination" : "Add Destination"}</DialogTitle>
          <DialogDescription>
            {form.category === "social"
              ? "Track clicks to one of your social profiles."
              : "Track a conversion link across your channel."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Category">
            <div className="grid grid-cols-2 gap-2">
              {DEST_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      category: cat,
                      icon: cat === "social" ? SOCIAL_ICONS[0] : CONVERSION_ICONS[0],
                    }))
                  }
                  className={cn(
                    "rounded-full border px-3 py-2 text-sm font-medium capitalize transition-colors",
                    form.category === cat
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={60}
            />
          </Field>
          <Field label="Destination URL">
            <Input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              required
            />
          </Field>
          <Field label="Type">
            <Input
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              placeholder={
                form.category === "social"
                  ? "Instagram, TikTok, X…"
                  : "Course, Newsletter, Affiliate…"
              }
              maxLength={40}
              required
            />
          </Field>
          <Field label="Description (optional)">
            <Textarea
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              maxLength={2000}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as Destination["status"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Color">
              <Select value={form.color} onValueChange={(v) => setForm({ ...form, color: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEST_COLORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Icon">
              <Select
                key={form.category}
                value={form.icon}
                onValueChange={(v) => setForm({ ...form, icon: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(form.category === "social" ? SOCIAL_ICONS : CONVERSION_ICONS).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={saving}>
              {saving ? "Saving…" : initial ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Link ----------
// Tracking links are backed by the real /api/tracking-links table — destination is required (a
// link has to point somewhere real), video is an optional reference to one of the user's already-
// saved videos (public.videos, not the live YouTube list), and clicks/uniqueClicks are read-only
// numbers computed server-side from real redirect traffic, never editable here.
export type TrackLink = {
  id: string;
  slug: string;
  shortUrl: string;
  status: "active" | "archived";
  clicks: number;
  uniqueClicks: number;
  destination: { id: string; name: string; url: string } | null;
  video: { id: string; title: string } | null;
};
export type TrackLinkInput = {
  destinationId: string;
  videoId?: string | null;
  slug?: string | null;
  status?: "active" | "archived";
};

export function LinkDialog({
  open,
  onOpenChange,
  initial,
  destinations,
  videos,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: TrackLink | null;
  destinations: { id: string; name: string }[];
  videos: { id: string; title: string }[];
  onSave: (input: TrackLinkInput, id?: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [destinationId, setDestinationId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDestinationId(initial.destination?.id ?? "");
      setVideoId(initial.video?.id ?? "");
      setSlug(initial.slug);
      setStatus(initial.status);
    } else {
      setDestinationId(destinations[0]?.id ?? "");
      setVideoId("");
      setSlug("");
      setStatus("active");
    }
  }, [open, initial, destinations]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationId) return toast.error("Choose a destination");
    setSaving(true);
    try {
      await onSave(
        { destinationId, videoId: videoId || null, slug: slug.trim() || null, status },
        initial?.id,
      );
      onOpenChange(false);
      toast.success(initial ? "Link updated" : "Link created");
      if (!initial) void goToNextOnboardingStep(navigate, "link");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn’t save that link. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Tracking Link" : "Create Tracking Link"}</DialogTitle>
          <DialogDescription>
            {initial
              ? "Update the destination, video, or slug."
              : "Generate a short link that captures real clicks."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Destination">
            {destinations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No destinations yet — add one on the Destinations page first.
              </p>
            ) : (
              <Select value={destinationId} onValueChange={setDestinationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a destination" />
                </SelectTrigger>
                <SelectContent>
                  {destinations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Video (optional)">
            {videos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved videos yet — add one from Analyze Video to link one here.
              </p>
            ) : (
              <Select
                value={videoId || "none"}
                onValueChange={(v) => setVideoId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No video" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {videos.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Custom slug (optional)">
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, ""))}
              placeholder="course"
            />
          </Field>
          {initial && (
            <Field label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as "active" | "archived")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="rounded-full"
              disabled={saving || destinations.length === 0}
            >
              {saving ? "Saving…" : initial ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Rule ----------
// Comment rules are backed by the real /api/comment-rules table, matched against comments fetched
// live from YouTube — icon/color are derived from triggerType (not user-chosen) so the same
// trigger type always reads the same way across the page, rather than being an arbitrary style
// pick disconnected from what the rule actually does.
export type CommentRule = {
  id: string;
  name: string;
  trigger_type: "keyword" | "handle" | "question";
  keywords: string[];
  reply_template: string;
  active: boolean;
  video: { id: string; title: string } | null;
  firedCount: number;
};
export type CommentRuleInput = {
  name: string;
  triggerType: "keyword" | "handle" | "question";
  keywords: string[];
  replyTemplate: string;
  videoId?: string | null;
  active?: boolean;
};

export function RuleDialog({
  open,
  onOpenChange,
  initial,
  videos,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: CommentRule | null;
  videos: { id: string; title: string }[];
  onSave: (input: CommentRuleInput, id?: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<CommentRule["trigger_type"]>("keyword");
  const [keywordsText, setKeywordsText] = useState("");
  const [replyTemplate, setReplyTemplate] = useState("");
  const [videoId, setVideoId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setTriggerType(initial.trigger_type);
      setKeywordsText(initial.keywords.join(", "));
      setReplyTemplate(initial.reply_template);
      setVideoId(initial.video?.id ?? "");
    } else {
      setName("");
      setTriggerType("keyword");
      setKeywordsText("");
      setReplyTemplate("");
      setVideoId("");
    }
  }, [open, initial]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Rule name is required");
    const keywords = keywordsText
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (triggerType === "keyword" && keywords.length === 0) {
      return toast.error("Add at least one keyword");
    }
    if (!replyTemplate.trim()) return toast.error("Auto-reply is required");
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          triggerType,
          keywords,
          replyTemplate: replyTemplate.trim(),
          videoId: videoId || null,
        },
        initial?.id,
      );
      onOpenChange(false);
      toast.success(initial ? "Rule updated" : "Rule created");
      if (!initial) void goToNextOnboardingStep(navigate, "comments");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn’t save that rule. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Rule" : "New Comment Rule"}</DialogTitle>
          <DialogDescription>Auto-reply to comments matching this trigger.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Rule name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="Trigger type">
            <Select
              value={triggerType}
              onValueChange={(v) => setTriggerType(v as CommentRule["trigger_type"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">Keyword match</SelectItem>
                <SelectItem value="handle">@ handle detected</SelectItem>
                <SelectItem value="question">Ends in a question</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {triggerType === "keyword" && (
            <Field label="Keywords (comma-separated)">
              <Input
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder="link, info, send me, how do I get"
              />
            </Field>
          )}
          <Field label="Auto-reply">
            <Textarea
              value={replyTemplate}
              onChange={(e) => setReplyTemplate(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </Field>
          <Field label="Video (optional — applies to all videos if unset)">
            {videos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved videos yet.</p>
            ) : (
              <Select
                value={videoId || "none"}
                onValueChange={(v) => setVideoId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All videos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All videos</SelectItem>
                  {videos.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={saving}>
              {saving ? "Saving…" : initial ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Campaign ----------
export function CampaignDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Campaign | null;
  onSave: (c: Campaign) => void;
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
          <DialogDescription>
            {initial
              ? "Update the campaign name or status."
              : "Create an email broadcast or drip step."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as Campaign["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Scheduled">Scheduled</SelectItem>
                <SelectItem value="Sending">Sending</SelectItem>
                <SelectItem value="Sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{initial ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Team member invites are now real (see src/routes/team.tsx, backed by workspace_members) —
// the mock TeamMemberDialog that used to live here was removed along with useTeam in stores.ts.

// ---------- Confirm ----------
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = "Delete",
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  onConfirm: () => void;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              "rounded-full",
              destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
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
