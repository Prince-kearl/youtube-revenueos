import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

// The admin user directory's state and maintenance (see api.admin.users.directory.ts).
//
// Every action is driven from here one bounded batch per request: the loop below keeps calling
// until the server says `done`, and can be stopped at any time. Progress lives in the database,
// so closing the tab or losing the connection mid-way loses nothing — the next run resumes.
// Only a Superadmin sees the buttons; the server enforces the same rule.

type DirectoryStatus = {
  status: "pending" | "backfilling" | "complete" | "failed";
  processed: number;
  startedAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  syncFailures24h: number;
  canMaintain: boolean;
};

type Drift = {
  checked: number;
  missing: number;
  staleEmail: number;
  staleProfile: number;
  staleStatus: number;
};

const STATUS_LABEL: Record<DirectoryStatus["status"], string> = {
  pending: "Not built yet",
  backfilling: "Being built",
  complete: "Complete",
  failed: "Build stopped by an error",
};

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/users/directory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || !json.data) throw new Error(json.error ?? "REQUEST_FAILED");
  return json.data;
}

export function UserDirectoryMaintenance({ onComplete }: { onComplete?: () => void }) {
  const [state, setState] = useState<DirectoryStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState<null | "backfill" | "check" | "repair">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [drift, setDrift] = useState<Drift | null>(null);
  const stopRef = useRef(false);

  const loadStatus = async () => {
    try {
      const response = await fetch("/api/admin/users/directory", { cache: "no-store" });
      const json = (await response.json()) as { data?: DirectoryStatus };
      if (!response.ok || !json.data) throw new Error();
      setState(json.data);
      setLoadFailed(false);
      return json.data;
    } catch {
      setLoadFailed(true);
      return null;
    }
  };
  useEffect(() => {
    void loadStatus();
  }, []);

  const runBackfill = async () => {
    stopRef.current = false;
    setRunning("backfill");
    try {
      for (;;) {
        if (stopRef.current) break;
        const step = await post<{ status: string; totalProcessed: number; done: boolean }>({
          action: "backfill",
        });
        setProgress(`${step.totalProcessed.toLocaleString()} accounts processed`);
        if (step.status === "failed") {
          toast.error("A batch failed. Nothing was lost — try again to resume.");
          break;
        }
        if (step.done) {
          toast.success("The user directory is complete.");
          onComplete?.();
          break;
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "ROLE_REQUIRED"
          ? "Only a Superadmin can do this."
          : "That didn't work. Try again to resume.",
      );
    } finally {
      setRunning(null);
      await loadStatus();
    }
  };

  const runPass = async (action: "check" | "repair") => {
    stopRef.current = false;
    setRunning(action);
    const totals = {
      checked: 0,
      missing: 0,
      staleEmail: 0,
      staleProfile: 0,
      staleStatus: 0,
      inserted: 0,
      updated: 0,
    };
    let after: string | null = null;
    try {
      for (;;) {
        if (stopRef.current) break;
        const window: {
          checked: number;
          missing?: number;
          staleEmail?: number;
          staleProfile?: number;
          staleStatus?: number;
          inserted?: number;
          updated?: number;
          nextAfter: string | null;
          done: boolean;
        } = await post({ action, after });
        totals.checked += window.checked;
        totals.missing += window.missing ?? 0;
        totals.staleEmail += window.staleEmail ?? 0;
        totals.staleProfile += window.staleProfile ?? 0;
        totals.staleStatus += window.staleStatus ?? 0;
        totals.inserted += window.inserted ?? 0;
        totals.updated += window.updated ?? 0;
        setProgress(
          `${totals.checked.toLocaleString()} accounts ${action === "check" ? "checked" : "reviewed"}`,
        );
        if (window.done || !window.nextAfter) break;
        after = window.nextAfter;
      }
      if (action === "check") setDrift(totals);
      else {
        toast.success(`Repaired: ${totals.inserted} added, ${totals.updated} corrected.`);
        setDrift(null);
      }
    } catch {
      toast.error("That didn't work. Run it again — each batch is safe to repeat.");
    } finally {
      setRunning(null);
      await loadStatus();
    }
  };

  if (loadFailed)
    return (
      <p className="text-sm text-muted-foreground">Couldn&apos;t load the directory status.</p>
    );
  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const driftTotal = drift
    ? drift.missing + drift.staleEmail + drift.staleProfile + drift.staleStatus
    : 0;
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Directory</dt>
        <dd className="font-medium">{STATUS_LABEL[state.status]}</dd>
        <dt className="text-muted-foreground">Accounts processed</dt>
        <dd>{state.processed.toLocaleString()}</dd>
        {state.completedAt && (
          <>
            <dt className="text-muted-foreground">Completed</dt>
            <dd>{new Date(state.completedAt).toLocaleString()}</dd>
          </>
        )}
        {state.lastErrorCode && (
          <>
            <dt className="text-muted-foreground">Last error</dt>
            <dd className="font-mono text-xs">{state.lastErrorCode}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Sync failures (24 h)</dt>
        <dd className={state.syncFailures24h ? "font-medium text-warning" : ""}>
          {state.syncFailures24h}
        </dd>
      </dl>

      {drift && (
        <p className={driftTotal ? "text-warning" : "text-muted-foreground"}>
          Checked {drift.checked.toLocaleString()} accounts: {drift.missing} missing,{" "}
          {drift.staleEmail} with an outdated email, {drift.staleProfile} with an outdated name or
          role, {drift.staleStatus} with an outdated status.
        </p>
      )}
      {progress && running && <p className="text-muted-foreground">{progress}…</p>}

      {state.canMaintain ? (
        <div className="flex flex-wrap gap-2">
          {state.status !== "complete" && (
            <button
              type="button"
              disabled={!!running}
              onClick={() => void runBackfill()}
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {state.status === "pending" ? "Build directory" : "Resume building"}
            </button>
          )}
          {state.status === "complete" && (
            <>
              <button
                type="button"
                disabled={!!running}
                onClick={() => void runPass("check")}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
              >
                Check for drift
              </button>
              <button
                type="button"
                disabled={!!running}
                onClick={() => void runPass("repair")}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
              >
                Repair
              </button>
            </>
          )}
          {running && (
            <button
              type="button"
              onClick={() => (stopRef.current = true)}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            disabled={!!running}
            onClick={() => void loadStatus()}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      ) : (
        state.status !== "complete" && (
          <p className="text-muted-foreground">
            A Superadmin needs to build the directory before users can be listed.
          </p>
        )
      )}
    </div>
  );
}
