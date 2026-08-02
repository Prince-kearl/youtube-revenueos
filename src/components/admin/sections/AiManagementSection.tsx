import { useEffect, useState } from "react";
import { Sparkles, Star, Pencil, Flag, Check, X, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/ui-bits";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  useAiModels, usePromptTemplates, useModerationQueue,
  type AiModelConfig, type PromptTemplate, type ModerationItem, type ModerationStatus,
} from "@/lib/stores";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const modStatusColor: Record<ModerationStatus, string> = {
  Pending: "bg-warning/15 text-warning",
  Approved: "bg-success/15 text-success",
  Removed: "bg-destructive/15 text-destructive",
};

export function AiManagementSection() {
  const [models, setModels] = useAiModels();
  const [prompts, setPrompts] = usePromptTemplates();
  const [queue, setQueue] = useModerationQueue();
  const log = useAuditLogger();
  const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(null);

  const totalCost = models.filter((m) => m.enabled).reduce((a, m) => a + m.costPer1kTokens, 0);
  const pending = queue.filter((q) => q.status === "Pending").length;

  const toggleModel = (m: AiModelConfig) => {
    setModels((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)));
    log(m.enabled ? "Disabled AI model" : "Enabled AI model", "AI Management", m.name);
    toast.success(`${m.name} ${m.enabled ? "disabled" : "enabled"}`);
  };
  const setDefault = (m: AiModelConfig) => {
    setModels((prev) => prev.map((x) => ({ ...x, isDefault: x.id === m.id })));
    log("Set default AI model", "AI Management", m.name);
    toast.success(`${m.name} is now the default model`);
  };
  const savePrompt = (p: PromptTemplate) => {
    setPrompts((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    log("Updated prompt template", "AI Management", p.name);
    toast.success(`"${p.name}" saved`);
    setEditingPrompt(null);
  };
  const moderate = (item: ModerationItem, status: ModerationStatus) => {
    setQueue((prev) => prev.map((x) => (x.id === item.id ? { ...x, status } : x)));
    log(`${status} content`, "Content Moderation", `${item.type} — ${item.org}`);
    toast.success(`${item.type} from ${item.org} ${status.toLowerCase()}`);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">AI Management</h1>
      <p className="mt-1 text-sm text-muted-foreground">Models, prompts, cost, and content moderation for every AI feature.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Sparkles className="h-5 w-5" />} value={String(models.filter((m) => m.enabled).length)} label="Enabled Models" />
        <StatCard icon={<DollarSign className="h-5 w-5" />} value={`$${totalCost.toFixed(3)}`} label="Blended Cost / 1K Tokens" />
        <StatCard icon={<Sparkles className="h-5 w-5" />} value="214.6K" label="Generations This Month" />
        <StatCard icon={<Flag className="h-5 w-5" />} value={String(pending)} label="Pending Moderation" />
      </div>

      <h3 className="mt-6 text-sm font-semibold">AI Models</h3>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {models.map((m) => (
          <div key={m.id} className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start justify-between">
              <div>
                <p className="flex items-center gap-1.5 font-semibold">{m.name} {m.isDefault && <Star className="h-3.5 w-3.5 fill-brand-amber text-brand-amber" />}</p>
                <p className="text-xs text-muted-foreground">{m.provider}</p>
              </div>
              <Switch checked={m.enabled} onCheckedChange={() => toggleModel(m)} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-accent/30 p-3 text-center text-xs">
              <div><p className="text-muted-foreground">Token Limit</p><p className="mt-0.5 font-semibold">{m.tokenLimit.toLocaleString()}</p></div>
              <div><p className="text-muted-foreground">Rate Limit</p><p className="mt-0.5 font-semibold">{m.rateLimitPerMin}/min</p></div>
              <div><p className="text-muted-foreground">Temperature</p><p className="mt-0.5 font-semibold">{m.temperature}</p></div>
              <div><p className="text-muted-foreground">Cost / 1K</p><p className="mt-0.5 font-semibold">${m.costPer1kTokens.toFixed(3)}</p></div>
            </div>
            {!m.isDefault && m.enabled && (
              <button onClick={() => setDefault(m)} className="mt-3 w-full rounded-[var(--button-radius)] border border-border py-1.5 text-xs font-medium hover:bg-accent">Set as default</button>
            )}
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Prompt Templates</h3>
      <div className="relative mt-3 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {prompts.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 border-b border-border p-4 last:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.module} · updated {p.updated}</p>
            </div>
            <button onClick={() => setEditingPrompt(p)} className="flex shrink-0 items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"><Pencil className="h-3.5 w-3.5" /> Edit</button>
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Content Moderation Queue</h3>
      <div className="relative mt-3 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {queue.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{item.type}</span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${modStatusColor[item.status]}`}>{item.status}</span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{item.preview}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.org} · {item.reason} · {item.date}</p>
            </div>
            {item.status === "Pending" && (
              <div className="flex shrink-0 gap-1.5">
                <button onClick={() => moderate(item, "Approved")} className="flex items-center gap-1 rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/10"><Check className="h-3.5 w-3.5" /> Approve</button>
                <button onClick={() => moderate(item, "Removed")} className="flex items-center gap-1 rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"><X className="h-3.5 w-3.5" /> Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <PromptDialog open={!!editingPrompt} prompt={editingPrompt} onOpenChange={(v) => !v && setEditingPrompt(null)} onSave={savePrompt} />
    </div>
  );
}

function PromptDialog({ open, prompt, onOpenChange, onSave }: { open: boolean; prompt: PromptTemplate | null; onOpenChange: (v: boolean) => void; onSave: (p: PromptTemplate) => void }) {
  const [form, setForm] = useState<PromptTemplate | null>(null);
  useEffect(() => { if (open) setForm(prompt); }, [open, prompt]);
  if (!form) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Prompt Template</DialogTitle>
          <DialogDescription>Used by {form.module}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, updated: new Date().toISOString().slice(0, 10) }); }} className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Template</Label><Textarea rows={5} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
