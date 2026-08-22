import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, TrendingUp, Users, DollarSign, MoreHorizontal, User, Calendar, Pencil, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard, Tag } from "@/components/ui-bits";
import { DealDialog, ConfirmDialog } from "@/components/modals";
import { useDeals, DEAL_STAGES, DealStage, Deal, stageColor } from "@/lib/stores";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/brand-deals")({
  component: BrandDeals,
});

function BrandDeals() {
  const [deals, setDeals] = useDeals();
  const [editing, setEditing] = useState<Deal | null>(null);
  const [creating, setCreating] = useState<{ open: boolean; stage?: DealStage }>({ open: false });
  const [deleting, setDeleting] = useState<Deal | null>(null);

  const stats = useMemo(() => {
    const pipeline = deals.reduce((a, d) => a + d.value, 0);
    const active = deals.filter((d) => d.stage !== "Completed").length;
    const closed = deals.filter((d) => d.stage === "Completed").reduce((a, d) => a + d.value, 0);
    const avg = deals.length ? pipeline / deals.length : 0;
    return { pipeline, active, closed, avg };
  }, [deals]);

  const stagesGrouped = DEAL_STAGES.map((name) => {
    const items = deals.filter((d) => d.stage === name);
    return { name, color: stageColor[name], count: items.length, total: `$${sum(items).toLocaleString()}`, deals: items };
  });

  const save = (d: Deal) => setDeals((prev) => (prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? d : x)) : [d, ...prev]));
  const remove = (d: Deal) => { setDeals((prev) => prev.filter((x) => x.id !== d.id)); toast.success("Deal deleted"); };

  return (
    <DashboardLayout title="Brand Deals">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Deal Board</h1>
          <p className="mt-1 text-sm text-muted-foreground">CRM-style pipeline for sponsorship management</p>
        </div>
        <button onClick={() => setCreating({ open: true })} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Deal
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <StatCard icon={<TrendingUp className="h-5 w-5" />} value={fmtK(stats.pipeline)} label="Pipeline Value" />
        <StatCard icon={<Users className="h-5 w-5" />} value={String(stats.active)} label="Active Deals" />
        <StatCard icon={<DollarSign className="h-5 w-5" />} value={fmtK(stats.closed)} label="Closed Revenue" />
        <StatCard icon={<MoreHorizontal className="h-5 w-5" />} value={fmtK(stats.avg)} label="Avg Deal Size" />
      </div>

      <div className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {stagesGrouped.map((stage) => (
          <div key={stage.name} className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
                <span className="text-sm font-semibold">{stage.name}</span>
                <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">{stage.count}</span>
              </div>
              <span className="text-xs text-muted-foreground">{stage.total}</span>
            </div>

            <div className="space-y-3">
              {stage.deals.map((d) => (
                <div key={d.id} className="relative rounded-xl card-gradient-outline p-4">
                  <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{d.company}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />{d.contact || "—"}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(d)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDeleting(d)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="flex items-center gap-1 font-bold text-brand-green">
                      <DollarSign className="h-4 w-4" />{d.value.toLocaleString()}
                    </span>
                    {d.tag && <Tag label={d.tag} />}
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Progress</span><span className="font-medium text-foreground">{d.progress}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                      <div className="h-full rounded-full" style={{ width: `${d.progress}%`, background: d.progress === 100 ? "var(--color-brand-amber)" : "var(--color-brand-green)" }} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Next action</p>
                      <p className="text-xs font-medium">{d.action || "—"}</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />{d.date}
                    </span>
                  </div>
                </div>
              ))}

              <button onClick={() => setCreating({ open: true, stage: stage.name })} className="flex w-full items-center justify-center gap-2 rounded-[var(--button-radius)] border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                <Plus className="h-4 w-4" /> Add deal
              </button>
            </div>
          </div>
        ))}
      </div>

      <DealDialog open={creating.open} onOpenChange={(v) => setCreating({ open: v })} defaultStage={creating.stage} onSave={save} />
      <DealDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} onSave={save} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.company}?`}
        description="This removes the deal from the pipeline. This cannot be undone."
        onConfirm={() => { if (deleting) remove(deleting); setDeleting(null); }}
      />
    </DashboardLayout>
  );
}

const sum = (arr: Deal[]) => arr.reduce((a, d) => a + d.value, 0);
const fmtK = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`);
