import { useEffect, useState } from "react";
import { Search, MoreHorizontal, Check, PlayCircle, PauseCircle, Pencil, Building2 } from "lucide-react";
import { toast } from "sonner";
import { StatCard, Tag } from "@/components/ui-bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useTenants, TENANT_PLAN_PRICE, TENANT_PLAN_LIMITS,
  type Tenant, type TenantPlan, type TenantStatus,
} from "@/lib/stores";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const statusColor: Record<TenantStatus, string> = {
  Active: "bg-success/15 text-success",
  Trial: "bg-brand-blue/15 text-brand-blue",
  "Past Due": "bg-warning/15 text-warning",
  Suspended: "bg-destructive/15 text-destructive",
};
const planColor: Record<TenantPlan, string> = { Starter: "neutral", Pro: "blue", Scale: "purple" };

export function OrganizationsSection() {
  const [tenants, setTenants] = useTenants();
  const log = useAuditLogger();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Tenant | null>(null);

  const filtered = tenants.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()) || t.owner.toLowerCase().includes(query.toLowerCase()));
  const totalSeats = tenants.reduce((a, t) => a + t.seatsUsed, 0);
  const totalStorage = tenants.reduce((a, t) => a + t.storageUsedGb, 0);

  const toggleSuspend = (t: Tenant) => {
    const next: TenantStatus = t.status === "Suspended" ? "Active" : "Suspended";
    setTenants((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    log(next === "Suspended" ? "Suspended organization" : "Reactivated organization", "Organizations", t.name);
    toast.success(next === "Suspended" ? `Suspended ${t.name}` : `Reactivated ${t.name}`);
  };
  const changePlan = (t: Tenant, plan: TenantPlan) => {
    const limits = TENANT_PLAN_LIMITS[plan];
    setTenants((prev) => prev.map((x) => (x.id === t.id ? { ...x, plan, mrr: TENANT_PLAN_PRICE[plan], seatsLimit: limits.seats, storageQuotaGb: limits.storageGb } : x)));
    log(`Changed plan to ${plan}`, "Organizations", t.name);
    toast.success(`${t.name} moved to the ${plan} plan`);
  };
  const saveEdit = (t: Tenant) => {
    setTenants((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    log("Updated organization details", "Organizations", t.name);
    toast.success(`${t.name} updated`);
    setEditing(null);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every workspace on the platform — seats, storage quotas, subscriptions, and branding.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Building2 className="h-5 w-5" />} value={String(tenants.length)} label="Organizations" />
        <StatCard icon={<Building2 className="h-5 w-5" />} value={String(totalSeats)} label="Seats in Use" />
        <StatCard icon={<Building2 className="h-5 w-5" />} value={`${totalStorage} GB`} label="Storage in Use" />
        <StatCard icon={<Building2 className="h-5 w-5" />} value={String(tenants.filter((t) => t.status === "Trial").length)} label="On Trial" />
      </div>

      <div className="relative mt-5 max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search organizations…" className="h-9 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 pl-9 pr-3 text-sm outline-none focus:border-primary" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filtered.map((t) => (
          <div key={t.id} className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <img src={t.avatar} alt={t.name} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.domain ?? t.owner}</p>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="shrink-0 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(t)}><Pencil className="mr-2 h-4 w-4" /> Edit details</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => toggleSuspend(t)} className={t.status === "Suspended" ? undefined : "text-destructive focus:text-destructive"}>
                    {t.status === "Suspended" ? <PlayCircle className="mr-2 h-4 w-4" /> : <PauseCircle className="mr-2 h-4 w-4" />}
                    {t.status === "Suspended" ? "Reactivate" : "Suspend"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Change plan</DropdownMenuLabel>
                  {(Object.keys(TENANT_PLAN_PRICE) as TenantPlan[]).map((p) => (
                    <DropdownMenuItem key={p} onSelect={() => changePlan(t, p)}>
                      <span className="mr-2 flex h-4 w-4 items-center justify-center">{t.plan === p && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                      {p} — ${TENANT_PLAN_PRICE[p]}/mo
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Tag label={t.plan} color={planColor[t.plan]} />
              <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[t.status]}`}>{t.status}</span>
              <span className="text-xs text-muted-foreground">joined {t.joined}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <QuotaBar label="Seats" used={t.seatsUsed} total={t.seatsLimit} />
              <QuotaBar label="Storage" used={t.storageUsedGb} total={t.storageQuotaGb} unit="GB" />
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">No organizations match your search.</p>}
      </div>

      <EditOrgDialog open={!!editing} org={editing} onOpenChange={(v) => !v && setEditing(null)} onSave={saveEdit} />
    </div>
  );
}

function QuotaBar({ label, used, total, unit = "" }: { label: string; used: number; total: number; unit?: string }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>{label}</span><span>{used}{unit} / {total}{unit}</span></div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EditOrgDialog({ open, org, onOpenChange, onSave }: { open: boolean; org: Tenant | null; onOpenChange: (v: boolean) => void; onSave: (t: Tenant) => void }) {
  const [form, setForm] = useState<Tenant | null>(null);
  useEffect(() => { if (open) setForm(org); }, [open, org]);
  if (!form) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Organization</DialogTitle>
          <DialogDescription>Branding, domain, and quota overrides for {org?.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Organization name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Custom domain</Label><Input value={form.domain ?? ""} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="e.g. creator.io" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Seat limit</Label><Input type="number" min={form.seatsUsed} value={form.seatsLimit} onChange={(e) => setForm({ ...form, seatsLimit: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Storage quota (GB)</Label><Input type="number" min={form.storageUsedGb} value={form.storageQuotaGb} onChange={(e) => setForm({ ...form, storageQuotaGb: Number(e.target.value) })} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
