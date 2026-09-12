import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Lock,
  CheckSquare,
  Square,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/modals";

type AppRole = "user" | "editor" | "setter" | "manager" | "owner" | "superadmin";
type RoleAccessRow = {
  id: string;
  role: AppRole;
  enabled: boolean;
  updated_at: string;
};
type Feature = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  navigation_label: string | null;
  route: string | null;
  is_active: boolean;
  is_system_feature: boolean;
  sort_order: number;
  role_feature_access: RoleAccessRow[];
};
type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  created_at: string;
  admin: { name: string | null; email: string | null } | null;
};

const ROLES: Array<{ id: AppRole; label: string }> = [
  { id: "user", label: "User" },
  { id: "editor", label: "Editor" },
  { id: "setter", label: "Setter" },
  { id: "manager", label: "Manager" },
  { id: "owner", label: "Owner" },
  { id: "superadmin", label: "Superadmin" },
];

function accessFor(feature: Feature, role: AppRole): boolean {
  return feature.role_feature_access.find((r) => r.role === role)?.enabled ?? true;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    feature_enabled: "Enabled feature",
    feature_disabled: "Disabled feature",
    feature_bulk_change: "Bulk feature change",
  };
  return labels[action] ?? action;
}

export function FeatureManagementSection() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [features, setFeatures] = useState<Feature[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [view, setView] = useState<"matrix" | "role">("matrix");
  const [roleView, setRoleView] = useState<AppRole>("user");
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<{
    role: AppRole;
    action: "enable_all" | "disable_all" | "reset_defaults";
  } | null>(null);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    Promise.all([
      fetch("/api/admin/features", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/audit", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([featuresBody, auditBody]) => {
        if (!featuresBody.data) throw new Error();
        setFeatures(featuresBody.data);
        setAuditLog(
          (auditBody.data ?? []).filter((e: AuditEntry) => e.action.startsWith("feature_")),
        );
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const categories = useMemo(
    () => ["all", ...new Set(features.map((f) => f.category))],
    [features],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return features.filter((f) => {
      if (category !== "all" && f.category !== category) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
    });
  }, [features, search, category]);

  const toggle = async (feature: Feature, role: AppRole) => {
    const current = accessFor(feature, role);
    const next = !current;
    const key = `${feature.id}-${role}`;
    if (feature.is_system_feature && role === "superadmin" && !next) {
      toast.error(
        `${feature.name} can't be disabled for Superadmin — it's a protected system feature.`,
      );
      return;
    }
    setTogglingKey(key);
    setFeatures((prev) =>
      prev.map((f) =>
        f.id !== feature.id
          ? f
          : {
              ...f,
              role_feature_access: f.role_feature_access.some((r) => r.role === role)
                ? f.role_feature_access.map((r) => (r.role === role ? { ...r, enabled: next } : r))
                : [...f.role_feature_access, { id: "temp", role, enabled: next, updated_at: "" }],
            },
      ),
    );
    try {
      const response = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, featureId: feature.id, enabled: next }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "TOGGLE_FAILED");
      load();
    } catch (error) {
      // Revert the optimistic update on failure.
      setFeatures((prev) =>
        prev.map((f) =>
          f.id !== feature.id
            ? f
            : {
                ...f,
                role_feature_access: f.role_feature_access.map((r) =>
                  r.role === role ? { ...r, enabled: current } : r,
                ),
              },
        ),
      );
      const code = error instanceof Error ? error.message : "TOGGLE_FAILED";
      toast.error(
        code === "CANNOT_DISABLE_SYSTEM_FEATURE_FOR_ADMIN"
          ? `${feature.name} can't be disabled for Superadmin — it's a protected system feature.`
          : "Couldn't update that feature. Please try again.",
      );
    } finally {
      setTogglingKey(null);
    }
  };

  const runBulk = async () => {
    if (!bulkConfirm) return;
    try {
      const response = await fetch("/api/admin/features/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulkConfirm),
      });
      if (!response.ok) throw new Error();
      toast.success(`Updated features for ${bulkConfirm.role}`);
      load();
    } catch {
      toast.error("Couldn't apply that bulk change. Please try again.");
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Feature Management</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Control which features are available to each role. Changes take effect immediately for every
        user's next request — no redeploy needed.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search features…"
            className="pl-9"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-[var(--input-radius)] border border-border bg-background px-3 text-sm"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All categories" : c}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 rounded-full border border-border p-1">
          <button
            onClick={() => setView("matrix")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${view === "matrix" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Matrix
          </button>
          <button
            onClick={() => setView("role")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${view === "role" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Role View
          </button>
        </div>
      </div>

      {status === "loading" && (
        <p className="mt-4 text-sm text-muted-foreground">Loading features…</p>
      )}

      {status === "error" && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load features.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && view === "matrix" && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Feature</th>
                <th className="px-3 py-3 font-medium">Category</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="px-3 py-3 text-center font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-card">
              {filtered.map((feature) => (
                <tr key={feature.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{feature.name}</p>
                    <p className="text-xs text-muted-foreground">{feature.route ?? feature.key}</p>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{feature.category}</td>
                  {ROLES.map((r) => {
                    const locked = feature.is_system_feature && r.id === "superadmin";
                    return (
                      <td key={r.id} className="px-3 py-3 text-center">
                        {locked ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                            title="Protected system feature — always on for Superadmin"
                          >
                            <Lock className="h-3.5 w-3.5" /> Always on
                          </span>
                        ) : (
                          <Switch
                            checked={accessFor(feature, r.id)}
                            onCheckedChange={() => void toggle(feature, r.id)}
                            disabled={togglingKey === `${feature.id}-${r.id}`}
                            aria-label={`${feature.name} for ${r.label}`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={2 + ROLES.length}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No features match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {status === "ready" && view === "role" && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-full border border-border p-1">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRoleView(r.id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium ${roleView === r.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setBulkConfirm({ role: roleView, action: "enable_all" })}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <ToggleRight className="h-3.5 w-3.5" /> Enable all
              </button>
              <button
                onClick={() => setBulkConfirm({ role: roleView, action: "disable_all" })}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <ToggleLeft className="h-3.5 w-3.5" /> Disable all
              </button>
              <button
                onClick={() => setBulkConfirm({ role: roleView, action: "reset_defaults" })}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reset to defaults
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border">
            {filtered.map((feature) => {
              const enabled = accessFor(feature, roleView);
              const locked = feature.is_system_feature && roleView === "superadmin";
              return (
                <button
                  key={feature.id}
                  onClick={() => !locked && void toggle(feature, roleView)}
                  disabled={locked || togglingKey === `${feature.id}-${roleView}`}
                  className="flex w-full items-center justify-between gap-3 border-b border-border p-4 text-left last:border-0 hover:bg-accent/40 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    {enabled ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{feature.name}</p>
                      <p className="text-xs text-muted-foreground">{feature.category}</p>
                    </div>
                  </div>
                  {locked && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> Protected
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {auditLog.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent changes
          </h4>
          <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {auditLog.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span>
                  <span className="font-medium text-foreground">{actionLabel(entry.action)}</span>
                  {entry.target ? ` · ${entry.target}` : ""}
                  {entry.admin?.name ? ` · by ${entry.admin.name}` : ""}
                </span>
                <span>{new Date(entry.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!bulkConfirm}
        onOpenChange={(v) => !v && setBulkConfirm(null)}
        title={
          bulkConfirm
            ? `${bulkConfirm.action === "enable_all" ? "Enable" : bulkConfirm.action === "disable_all" ? "Disable" : "Reset"} all features for ${bulkConfirm.role}?`
            : ""
        }
        description={
          bulkConfirm?.action === "disable_all"
            ? "Protected system features (like Dashboard) stay on regardless."
            : undefined
        }
        confirmLabel="Confirm"
        destructive={bulkConfirm?.action === "disable_all"}
        onConfirm={() => {
          void runBulk();
          setBulkConfirm(null);
        }}
      />
    </div>
  );
}
