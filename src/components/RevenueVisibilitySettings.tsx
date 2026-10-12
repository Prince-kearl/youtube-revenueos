import { useEffect, useId, useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ErrorState, ListLoadingState } from "@/components/ui-bits";
import {
  CONFIGURABLE_REVENUE_ROLES,
  type ConfigurableRevenueRole,
  type RevenueVisibilitySettings as Settings,
} from "@/lib/revenue-visibility";

// The workspace's Revenue Visibility controls (Team page). Shown to owners and managers; the
// server decides who may actually change anything, and decides again on every request.
//
// A toggle only moves once the server has confirmed the change: nothing here is optimistic, so a
// failed save can never leave a switch showing something that was not stored.

type VisibilityData = Settings & { canView: boolean; canManage: boolean; available: boolean };
type VisibilityResponse = { data?: VisibilityData; error?: string };

const ROLE_COPY: Record<ConfigurableRevenueRole, { title: string; label: string }> = {
  editor: { title: "Editors", label: "Allow editors to view revenue" },
  setter: { title: "Setters", label: "Allow setters to view revenue" },
};

function saveErrorMessage(error: string | undefined): string {
  if (error === "CANNOT_MANAGE_REVENUE_VISIBILITY")
    return "You don't have permission to change revenue visibility.";
  if (error === "REVENUE_VISIBILITY_UNAVAILABLE")
    return "Revenue visibility can't be changed right now. Please try again later.";
  return "Couldn't save that change. Nothing was updated.";
}

export function RevenueVisibilitySettings({ className }: { className?: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; data: VisibilityData }
  >({ status: "loading" });
  const [saving, setSaving] = useState<ConfigurableRevenueRole | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch("/api/workspace/revenue-visibility", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as VisibilityResponse;
        if (!response.ok || !body.data) throw new Error();
        if (!cancelled) setState({ status: "ready", data: body.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  // Only people who can change the setting see the card at all.
  if (state.status === "ready" && !state.data.canManage) return null;

  const change = async (role: ConfigurableRevenueRole, next: boolean) => {
    if (state.status !== "ready" || saving) return;
    setSaving(role);
    try {
      const response = await fetch("/api/workspace/revenue-visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [role]: next }),
      });
      const body = (await response.json().catch(() => ({}))) as VisibilityResponse;
      if (!response.ok || !body.data) throw new Error(body.error ?? "SAVE_FAILED");
      // Show what the server says is now stored, not what was asked for.
      setState({ status: "ready", data: body.data });
      const plural = ROLE_COPY[role].title.toLowerCase();
      toast.success(
        body.data[role]
          ? `${ROLE_COPY[role].title} can now view revenue`
          : `Revenue is now hidden from ${plural}`,
      );
    } catch (error) {
      toast.error(saveErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-border bg-card p-5 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground"
          aria-hidden="true"
        >
          <Eye className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-semibold">
            Revenue Visibility
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which team roles can view financial amounts in this workspace. Owners and
            managers always can.
          </p>
        </div>
      </div>

      {state.status === "loading" && (
        <ListLoadingState label="Loading revenue visibility" rows={2} className="mt-4" />
      )}

      {state.status === "error" && (
        <ErrorState
          className="mt-4"
          title="We couldn't load revenue visibility"
          description="Nothing was changed. Please try again."
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      )}

      {state.status === "ready" && (
        <>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {CONFIGURABLE_REVENUE_ROLES.map((role) => {
              const id = `${headingId}-${role}`;
              const busy = saving === role;
              return (
                <li key={role} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{ROLE_COPY[role].title}</p>
                    <label htmlFor={id} className="text-sm text-muted-foreground">
                      {ROLE_COPY[role].label}
                    </label>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground" aria-live="polite">
                      {busy ? "Saving…" : state.data[role] ? "On" : "Off"}
                    </span>
                    <Switch
                      id={id}
                      checked={state.data[role]}
                      disabled={saving !== null || !state.data.available}
                      onCheckedChange={(next) => void change(role, next)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {!state.data.available && (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              Revenue visibility isn't available to change yet. Revenue stays hidden from editors
              and setters.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            This covers revenue and deal amounts only. It does not give anyone access to private
            team compensation, which stays hidden regardless.
          </p>
        </>
      )}
    </section>
  );
}
