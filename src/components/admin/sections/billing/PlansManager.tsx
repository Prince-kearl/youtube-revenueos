import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Check,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/modals";

type PlanPrice = {
  id: string;
  billing_interval: "month" | "year";
  amount_cents: number;
  stripe_price_id: string | null;
  is_active: boolean;
};
type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currency: string;
  features: string[];
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  stripe_product_id: string | null;
  updated_at: string;
  plan_prices: PlanPrice[];
};
type AuditEntry = {
  id: string;
  action: string;
  plan_name: string | null;
  created_at: string;
  admin: { name: string | null; email: string | null } | null;
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function activePrice(plan: Plan, interval: "month" | "year"): PlanPrice | undefined {
  return plan.plan_prices.find((p) => p.billing_interval === interval && p.is_active);
}

function isSynced(plan: Plan): boolean {
  const month = activePrice(plan, "month");
  const year = activePrice(plan, "year");
  return Boolean(plan.stripe_product_id && month?.stripe_price_id && year?.stripe_price_id);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function PriceCell({
  plan,
  interval,
  currentPrice,
  priceEdit,
  setPriceEdit,
  onConfirm,
  onStartEdit,
}: {
  plan: Plan;
  interval: "month" | "year";
  currentPrice: PlanPrice | undefined;
  priceEdit: { planId: string; interval: "month" | "year"; value: string } | null;
  setPriceEdit: (
    value:
      | { planId: string; interval: "month" | "year"; value: string }
      | null
      | ((
          prev: { planId: string; interval: "month" | "year"; value: string } | null,
        ) => { planId: string; interval: "month" | "year"; value: string } | null),
  ) => void;
  onConfirm: (plan: Plan) => void;
  onStartEdit: (plan: Plan, interval: "month" | "year") => void;
}) {
  const isEditingThis = priceEdit?.planId === plan.id && priceEdit.interval === interval;

  if (isEditingThis) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          step="0.01"
          autoFocus
          value={priceEdit.value}
          onChange={(e) =>
            setPriceEdit((prev) => (prev ? { ...prev, value: e.target.value } : prev))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(plan);
            if (e.key === "Escape") setPriceEdit(null);
          }}
          className="h-7 w-20 text-xs"
        />
        <button
          onClick={() => onConfirm(plan)}
          className="text-success hover:text-success/80"
          aria-label={`Save ${interval === "month" ? "monthly" : "annual"} price`}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setPriceEdit(null)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {currentPrice ? money(currentPrice.amount_cents) : "—"}
      <button
        onClick={() => onStartEdit(plan, interval)}
        className="text-muted-foreground hover:text-primary"
        aria-label={`Edit ${interval === "month" ? "monthly" : "annual"} price`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    plan_created: "Created plan",
    plan_edited: "Edited plan",
    plan_activated: "Activated plan",
    plan_deactivated: "Deactivated plan",
    plan_imported_from_env: "Imported legacy plan",
    price_changed_month: "Changed monthly price",
    price_changed_year: "Changed annual price",
  };
  return labels[action] ?? action;
}

export function PlansManager() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [priceEdit, setPriceEdit] = useState<{
    planId: string;
    interval: "month" | "year";
    value: string;
  } | null>(null);
  const [priceConfirm, setPriceConfirm] = useState<{
    plan: Plan;
    interval: "month" | "year";
    amountCents: number;
  } | null>(null);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    Promise.all([
      fetch("/api/admin/plans", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/plans/audit", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([plansBody, auditBody]) => {
        if (!plansBody.data) throw new Error();
        setPlans(plansBody.data);
        setAuditLog(auditBody.data ?? []);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const toggleField = async (plan: Plan, field: "isActive" | "isPublic") => {
    const key = field === "isActive" ? "is_active" : "is_public";
    const nextValue = !plan[key];
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, [key]: nextValue } : p)));
    try {
      const response = await fetch(`/api/admin/plans?id=${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: nextValue }),
      });
      if (!response.ok) throw new Error();
      toast.success(
        `${plan.name} ${field === "isActive" ? (nextValue ? "activated" : "deactivated") : nextValue ? "made public" : "made private"}`,
      );
      load();
    } catch {
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, [key]: !nextValue } : p)));
      toast.error("Couldn't update that plan. Please try again.");
    }
  };

  const importLegacy = async () => {
    setImporting(true);
    try {
      const response = await fetch("/api/admin/plans/seed-legacy", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "IMPORT_FAILED");
      const results: Array<{ slug: string; status: string; reason?: string }> =
        body.data?.results ?? [];
      const created = results.filter((r) => r.status === "created").length;
      const failed = results.filter((r) => r.status === "failed");
      const skipped = results.filter((r) => r.status === "skipped");

      if (created > 0) {
        toast.success(`Imported ${created} existing plan${created === 1 ? "" : "s"} from Stripe`);
      } else if (failed.length > 0) {
        // Surface the real reason instead of a generic "nothing happened" — env vars missing or a
        // Stripe lookup failure look identical to "already imported" unless we say which it was.
        toast.error(
          `Import failed: ${failed.map((r) => `${r.slug} (${r.reason ?? "unknown error"})`).join(", ")}`,
        );
      } else if (skipped.length === results.length && results.length > 0) {
        toast("All plans were already imported previously.");
      } else {
        toast("No plans to import.");
      }
      load();
    } catch {
      toast.error("Couldn't import existing plans. Check your Stripe configuration.");
    } finally {
      setImporting(false);
    }
  };

  const startPriceEdit = (plan: Plan, interval: "month" | "year") => {
    const current = activePrice(plan, interval);
    setPriceEdit({
      planId: plan.id,
      interval,
      value: current ? (current.amount_cents / 100).toFixed(2) : "",
    });
  };

  const confirmPriceEdit = (plan: Plan) => {
    if (!priceEdit || priceEdit.planId !== plan.id) return;
    const amountCents = Math.round(Number(priceEdit.value) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      toast.error("Enter a valid price");
      return;
    }
    setPriceConfirm({ plan, interval: priceEdit.interval, amountCents });
    setPriceEdit(null);
  };

  const submitPriceChange = async (target: {
    plan: Plan;
    interval: "month" | "year";
    amountCents: number;
  }) => {
    try {
      const response = await fetch("/api/admin/plans/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: target.plan.id,
          billingInterval: target.interval,
          amountCents: target.amountCents,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "PRICE_CHANGE_FAILED");
      toast.success(
        `New ${target.interval === "month" ? "monthly" : "annual"} price created for ${target.plan.name}`,
      );
      load();
    } catch {
      toast.error("Couldn't create the new price. Please try again.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Plans</h3>
          <p className="text-xs text-muted-foreground">
            Manage Tubify's real subscription plans and Stripe pricing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === "ready" && plans.length === 0 && (
            <button
              onClick={() => void importLegacy()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {importing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Import existing plans
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Create Plan
          </button>
        </div>
      </div>

      {status === "loading" && <p className="mt-4 text-sm text-muted-foreground">Loading plans…</p>}

      {status === "error" && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load plans.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && plans.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No plans yet. Import your existing Starter/Pro/Scale plans from Stripe, or create a new
          one.
        </div>
      )}

      {status === "ready" && plans.length > 0 && (
        <>
          {/* Mobile: stacked cards — the 8-column table doesn't fit a phone width, and forcing a
              horizontal scroll to see Active/Public/Stripe status hides state admins need at a glance. */}
          <div className="mt-4 space-y-3 sm:hidden">
            {plans.map((plan) => {
              const month = activePrice(plan, "month");
              const year = activePrice(plan, "year");
              const synced = isSynced(plan);
              return (
                <div key={plan.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">{plan.slug}</p>
                    </div>
                    <button
                      onClick={() => setEditing(plan)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label="Edit plan"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Monthly
                      </p>
                      <div className="mt-0.5 text-sm">
                        <PriceCell
                          plan={plan}
                          interval="month"
                          currentPrice={month}
                          priceEdit={priceEdit}
                          setPriceEdit={setPriceEdit}
                          onConfirm={confirmPriceEdit}
                          onStartEdit={startPriceEdit}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Annual
                      </p>
                      <div className="mt-0.5 text-sm">
                        <PriceCell
                          plan={plan}
                          interval="year"
                          currentPrice={year}
                          priceEdit={priceEdit}
                          setPriceEdit={setPriceEdit}
                          onConfirm={confirmPriceEdit}
                          onStartEdit={startPriceEdit}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={plan.is_active}
                        onCheckedChange={() => void toggleField(plan, "isActive")}
                        aria-label="Active"
                      />
                      Active
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={plan.is_public}
                        onCheckedChange={() => void toggleField(plan, "isPublic")}
                        aria-label="Public"
                      />
                      Public
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${synced ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                    >
                      {synced ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      {synced ? "Synced" : "Action required"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Updated {new Date(plan.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: full table */}
          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Monthly</th>
                  <th className="px-3 py-3 font-medium">Annual</th>
                  <th className="px-3 py-3 font-medium">Active</th>
                  <th className="px-3 py-3 font-medium">Public</th>
                  <th className="px-3 py-3 font-medium">Stripe</th>
                  <th className="px-3 py-3 font-medium">Updated</th>
                  <th className="px-3 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {plans.map((plan) => {
                  const month = activePrice(plan, "month");
                  const year = activePrice(plan, "year");
                  const synced = isSynced(plan);
                  return (
                    <tr key={plan.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">{plan.slug}</p>
                      </td>
                      <td className="px-3 py-3">
                        <PriceCell
                          plan={plan}
                          interval="month"
                          currentPrice={month}
                          priceEdit={priceEdit}
                          setPriceEdit={setPriceEdit}
                          onConfirm={confirmPriceEdit}
                          onStartEdit={startPriceEdit}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <PriceCell
                          plan={plan}
                          interval="year"
                          currentPrice={year}
                          priceEdit={priceEdit}
                          setPriceEdit={setPriceEdit}
                          onConfirm={confirmPriceEdit}
                          onStartEdit={startPriceEdit}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={plan.is_active}
                          onCheckedChange={() => void toggleField(plan, "isActive")}
                          aria-label="Active"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={plan.is_public}
                          onCheckedChange={() => void toggleField(plan, "isPublic")}
                          aria-label="Public"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${synced ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                        >
                          {synced ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {synced ? "Synced" : "Action required"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {new Date(plan.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => setEditing(plan)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Edit plan"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {auditLog.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent plan changes
          </h4>
          <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {auditLog.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span>
                  <span className="font-medium text-foreground">{actionLabel(entry.action)}</span>
                  {entry.plan_name ? ` · ${entry.plan_name}` : ""}
                  {entry.admin?.name ? ` · by ${entry.admin.name}` : ""}
                </span>
                <span>{new Date(entry.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <CreatePlanDialog open={creating} onOpenChange={setCreating} onCreated={load} />
      <EditPlanDialog plan={editing} onOpenChange={(v) => !v && setEditing(null)} onSaved={load} />
      <ConfirmDialog
        open={!!priceConfirm}
        onOpenChange={(v) => !v && setPriceConfirm(null)}
        title={
          priceConfirm
            ? `Change ${priceConfirm.plan.name}'s ${priceConfirm.interval === "month" ? "monthly" : "annual"} price to ${money(priceConfirm.amountCents)}?`
            : ""
        }
        description="Changing this price will create a new Stripe Price. Existing subscribers will keep their current price unless they are explicitly migrated."
        confirmLabel="Create New Price"
        destructive={false}
        onConfirm={() => {
          if (priceConfirm) void submitPriceChange(priceConfirm);
          setPriceConfirm(null);
        }}
      />
    </div>
  );
}

function CreatePlanDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [monthly, setMonthly] = useState("");
  const [annual, setAnnual] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setDescription("");
      setMonthly("");
      setAnnual("");
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Plan name is required");
    if (!slug.trim()) return toast.error("Slug is required");
    const monthlyCents = Math.round(Number(monthly) * 100);
    const annualCents = Math.round(Number(annual) * 100);
    if (!Number.isFinite(monthlyCents) || monthlyCents <= 0)
      return toast.error("Enter a valid monthly price");
    if (!Number.isFinite(annualCents) || annualCents <= 0)
      return toast.error("Enter a valid annual price");

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          description: description.trim() || null,
          monthlyPriceCents: monthlyCents,
          annualPriceCents: annualCents,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "CREATE_FAILED");
      toast.success(`${name} plan created`);
      onOpenChange(false);
      onCreated();
    } catch (error) {
      const code = error instanceof Error ? error.message : "CREATE_FAILED";
      const messages: Record<string, string> = {
        SLUG_ALREADY_EXISTS: "That slug is already in use.",
        STRIPE_PRODUCT_CREATE_FAILED:
          "Couldn't create the Stripe Product. Check your Stripe configuration.",
        STRIPE_PRICE_CREATE_FAILED:
          "Couldn't create the Stripe Prices. Check your Stripe configuration.",
      };
      toast.error(messages[code] ?? "Couldn't create the plan. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Plan</DialogTitle>
          <DialogDescription>
            Creates a real Stripe Product and both monthly/annual Prices.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Growth"
              required
            />
          </Field>
          <Field label="Slug">
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="growth"
              required
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly price (USD)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="49.00"
                required
              />
            </Field>
            <Field label="Annual price (USD)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={annual}
                onChange={(e) => setAnnual(e.target.value)}
                placeholder="490.00"
                required
              />
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
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Creating…" : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPlanDialog({
  plan,
  onOpenChange,
  onSaved,
}: {
  plan: Plan | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (plan) {
      setName(plan.name);
      setDescription(plan.description ?? "");
      setSortOrder(plan.sort_order);
    }
  }, [plan]);

  if (!plan) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/plans?id=${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          sortOrder,
        }),
      });
      if (!response.ok) throw new Error();
      toast.success("Plan updated");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Couldn't save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!plan} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {plan.name}</DialogTitle>
          <DialogDescription>
            Pricing is changed separately — use the edit icon next to a price in the table.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </Field>
          <Field label="Sort order">
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
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
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
