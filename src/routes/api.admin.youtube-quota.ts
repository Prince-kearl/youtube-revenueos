import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { QUOTA_RESERVE_UNITS } from "@/lib/server/comment-reply-queue";
import {
  QUOTA_CRITICAL_RATIO,
  QUOTA_WARNING_RATIO,
  YOUTUBE_DAILY_QUOTA_UNITS,
  quotaDayKey,
  quotaDayStart,
  quotaLevel,
} from "@/lib/server/youtube-quota";

// The app's YouTube Data API quota, for the admin console: today's measured usage against the
// project's 10,000 units, by operation and by workspace, and the last 7 days. "Today" is Google's
// quota day, midnight to midnight Pacific time (youtube-quota.ts).
//
// Admin only (manage_integrations, checked on the server before anything is read). Returns totals
// and workspace names only: no user, channel, token or request detail. Read through
// youtube_quota_usage (202611090001), which only the service role can execute.

const DAYS = 7;
const TOP_WORKSPACES = 10;

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

type UsageRow = {
  day: string;
  operation: string;
  workspace_id: string | null;
  units: number | string;
  calls: number | string;
  failed: number | string;
};

export const Route = createFileRoute("/api/admin/youtube-quota")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requirePermission(request, "manage_integrations");
          const service = createServiceSupabaseClient();
          const now = new Date();
          const todayKey = quotaDayKey(now);
          const from = quotaDayStart(new Date(now.getTime() - (DAYS - 1) * 86_400_000));
          const { data, error } = await service.rpc("youtube_quota_usage", {
            p_from: from.toISOString(),
            p_to: new Date(now.getTime() + 60_000).toISOString(),
          });
          if (error) {
            // Not applied yet: say so instead of showing an empty, reassuring panel.
            if (error.code === "42883" || error.code === "PGRST202")
              return json({ error: "QUOTA_ACCOUNTING_NOT_AVAILABLE" }, { status: 503 });
            console.error("[youtube-quota] usage read", { code: error.code ?? null });
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          const rows = ((data ?? []) as UsageRow[]).map((r) => ({
            day: String(r.day).slice(0, 10),
            operation: r.operation,
            workspaceId: r.workspace_id,
            units: Number(r.units),
            calls: Number(r.calls),
            failed: Number(r.failed),
          }));
          const today = rows.filter((r) => r.day === todayKey);

          const byOperation = new Map<string, { units: number; calls: number; failed: number }>();
          const byWorkspace = new Map<string | null, number>();
          for (const r of today) {
            const op = byOperation.get(r.operation) ?? { units: 0, calls: 0, failed: 0 };
            op.units += r.units;
            op.calls += r.calls;
            op.failed += r.failed;
            byOperation.set(r.operation, op);
            byWorkspace.set(r.workspaceId, (byWorkspace.get(r.workspaceId) ?? 0) + r.units);
          }
          const units = today.reduce((sum, r) => sum + r.units, 0);

          const ranked = [...byWorkspace]
            .filter(([id]) => id !== null)
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_WORKSPACES) as [string, number][];
          const { data: names } = ranked.length
            ? await service
                .from("workspaces")
                .select("id, name")
                .in(
                  "id",
                  ranked.map(([id]) => id),
                )
            : { data: [] as { id: string; name: string | null }[] };
          const nameOf = new Map((names ?? []).map((w) => [w.id as string, w.name as string]));

          const days: { day: string; units: number }[] = [];
          for (let i = DAYS - 1; i >= 0; i--) {
            const key = quotaDayKey(new Date(now.getTime() - i * 86_400_000));
            days.push({
              day: key,
              units: rows.filter((r) => r.day === key).reduce((sum, r) => sum + r.units, 0),
            });
          }
          const nextReset = quotaDayStart(new Date(quotaDayStart(now).getTime() + 26 * 3_600_000));

          return json({
            data: {
              limit: YOUTUBE_DAILY_QUOTA_UNITS,
              warnAt: YOUTUBE_DAILY_QUOTA_UNITS * QUOTA_WARNING_RATIO,
              criticalAt: YOUTUBE_DAILY_QUOTA_UNITS * QUOTA_CRITICAL_RATIO,
              replyReserve: QUOTA_RESERVE_UNITS,
              resetsAt: nextReset.toISOString(),
              today: {
                units,
                calls: today.reduce((sum, r) => sum + r.calls, 0),
                failed: today.reduce((sum, r) => sum + r.failed, 0),
                level: quotaLevel(units),
              },
              byOperation: [...byOperation]
                .map(([operation, v]) => ({ operation, ...v }))
                .sort((a, b) => b.units - a.units),
              byWorkspace: ranked.map(([id, wsUnits]) => ({
                workspaceId: id,
                name: nameOf.get(id) ?? null,
                units: wsUnits,
              })),
              unattributedUnits: byWorkspace.get(null) ?? 0,
              days,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
