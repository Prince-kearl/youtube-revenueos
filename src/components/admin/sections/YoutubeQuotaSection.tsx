import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, ListLoadingState } from "@/components/ui-bits";
import { buttonSecondary } from "@/lib/button-styles";
import { cn } from "@/lib/utils";

// The app's YouTube Data API quota (api.admin.youtube-quota.ts): today's measured usage against
// the project's 10,000 units, what it was spent on and by which workspaces, and the last 7 days.
// Google resets the quota at midnight Pacific time.

type QuotaData = {
  limit: number;
  warnAt: number;
  criticalAt: number;
  replyReserve: number;
  resetsAt: string;
  today: { units: number; calls: number; failed: number; level: "ok" | "warning" | "critical" };
  byOperation: { operation: string; units: number; calls: number; failed: number }[];
  byWorkspace: { workspaceId: string; name: string | null; units: number }[];
  unattributedUnits: number;
  days: { day: string; units: number }[];
};

const n = (value: number) => value.toLocaleString();

function untilText(iso: string): string {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const LEVEL_STYLE = {
  ok: { bar: "bg-success", text: "text-success", label: "Healthy" },
  warning: { bar: "bg-warning", text: "text-warning", label: "Over 70% used" },
  critical: { bar: "bg-destructive", text: "text-destructive", label: "Over 90% used" },
} as const;

export function YoutubeQuotaSection() {
  const [state, setState] = useState<"loading" | "ready" | "error" | "not_available">("loading");
  const [data, setData] = useState<QuotaData | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setState("loading");
    fetch("/api/admin/youtube-quota", { cache: "no-store", signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: QuotaData;
          error?: string;
        };
        if (body.error === "QUOTA_ACCOUNTING_NOT_AVAILABLE") return setState("not_available");
        if (!response.ok || !body.data) throw new Error();
        setData(body.data);
        setState("ready");
      })
      .catch(() => {
        if (!signal?.aborted) setState("error");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">YouTube API quota</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every YouTube Data API request Tubify makes draws on one daily allowance shared by all
            users. Google resets it at midnight Pacific time.
          </p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </div>

      {state === "loading" && <ListLoadingState className="mt-6" label="Loading quota usage" />}
      {state === "error" && (
        <ErrorState
          className="mt-6"
          title="We couldn't load quota usage"
          description="Nothing was changed. Try again in a moment."
          onRetry={() => load()}
        />
      )}
      {state === "not_available" && (
        <EmptyState
          className="mt-6"
          illustration="chart"
          title="Quota tracking isn't set up yet"
          description="The database update that records YouTube API usage hasn't been applied on this server."
        />
      )}

      {state === "ready" && data && (
        <>
          <section
            className="mt-6 rounded-2xl border border-border bg-card p-5"
            data-testid="quota-today"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Today</h2>
              <span className={cn("text-sm font-semibold", LEVEL_STYLE[data.today.level].text)}>
                {LEVEL_STYLE[data.today.level].label}
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold tracking-tight">
              {n(data.today.units)}{" "}
              <span className="text-base font-medium text-muted-foreground">
                of {n(data.limit)} units
              </span>
            </p>
            <div
              className="relative mt-3 h-3 overflow-hidden rounded-full bg-accent"
              role="progressbar"
              aria-label="Share of today's quota used"
              aria-valuemin={0}
              aria-valuemax={data.limit}
              aria-valuenow={data.today.units}
            >
              <div
                className={cn("h-full rounded-full", LEVEL_STYLE[data.today.level].bar)}
                style={{ width: `${Math.min(100, (data.today.units / data.limit) * 100)}%` }}
              />
              {[data.warnAt, data.criticalAt].map((mark) => (
                <span
                  key={mark}
                  aria-hidden="true"
                  className="absolute top-0 h-full w-px bg-foreground/30"
                  style={{ left: `${(mark / data.limit) * 100}%` }}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {n(data.today.calls)} requests
              {data.today.failed ? `, ${n(data.today.failed)} failed` : ""} · warnings at{" "}
              {n(data.warnAt)} and {n(data.criticalAt)} · comment replies stop with{" "}
              {n(data.replyReserve)} left · resets in {untilText(data.resetsAt)}
            </p>
            {data.today.level !== "ok" && (
              <p
                role="status"
                className={cn(
                  "mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm",
                  data.today.level === "critical"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning",
                )}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {data.today.level === "critical"
                  ? "Close to the daily limit. When it is reached, YouTube refuses every request (syncs, comments, replies) until midnight Pacific time."
                  : "Usage is high today. Check which operations and workspaces are using it below."}
              </p>
            )}
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">By operation (today)</h2>
              {data.byOperation.length ? (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 text-left font-medium">Operation</th>
                      <th className="pb-2 text-right font-medium">Requests</th>
                      <th className="pb-2 text-right font-medium">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byOperation.map((op) => (
                      <tr key={op.operation} className="border-t border-border">
                        <td className="py-2 font-mono text-xs">{op.operation}</td>
                        <td className="py-2 text-right">
                          {n(op.calls)}
                          {op.failed ? (
                            <span className="text-destructive"> ({n(op.failed)} failed)</span>
                          ) : null}
                        </td>
                        <td className="py-2 text-right font-medium">{n(op.units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState size="sm" illustration="chart" title="No requests yet today" />
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">By workspace (today)</h2>
              {data.byWorkspace.length || data.unattributedUnits ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {data.byWorkspace.map((w) => (
                    <li key={w.workspaceId} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">{w.name ?? "Untitled workspace"}</span>
                      <span className="shrink-0 font-medium">
                        {n(w.units)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({Math.round((w.units / Math.max(1, data.today.units)) * 100)}%)
                        </span>
                      </span>
                    </li>
                  ))}
                  {data.unattributedUnits > 0 && (
                    <li className="flex items-center justify-between gap-3 text-muted-foreground">
                      <span>Not tied to a workspace (connecting, sign-in)</span>
                      <span className="shrink-0">{n(data.unattributedUnits)}</span>
                    </li>
                  )}
                </ul>
              ) : (
                <EmptyState size="sm" illustration="chart" title="No requests yet today" />
              )}
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">Last 7 days</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {data.days.map((d) => (
                <li key={d.day} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3">
                  <span className="text-xs text-muted-foreground">{d.day}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-accent">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (d.units / data.limit) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right text-xs font-medium">{n(d.units)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
