import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";

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

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

// Real insights computed from real workspace data (deals, leads, videos) — no invented metrics
// like "CPM trend" or "$/view" that would require re-running full YouTube Analytics aggregation
// just for this page; Analytics/Dashboard already own that.
export const Route = createFileRoute("/api/reports/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(request, "reports");

          const now = new Date();
          const periodStart = new Date(now);
          periodStart.setUTCDate(periodStart.getUTCDate() - 30);
          const priorStart = new Date(periodStart);
          priorStart.setUTCDate(priorStart.getUTCDate() - 30);

          const [dealsRes, leadsRes, videosRes, channelsRes] = await Promise.all([
            client
              .from("deals")
              .select("value, stage, closed_at, created_at")
              .eq("workspace_id", workspaceId),
            client.from("leads").select("created_at").eq("workspace_id", workspaceId),
            client.from("videos").select("id, published_at, channel_id"),
            client.from("youtube_channels").select("id").eq("workspace_id", workspaceId),
          ]);
          if (dealsRes.error || leadsRes.error || videosRes.error || channelsRes.error) {
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          const deals = dealsRes.data ?? [];
          const leads = leadsRes.data ?? [];
          const channelIds = new Set((channelsRes.data ?? []).map((c) => c.id as string));
          const videos = (videosRes.data ?? []).filter((v) =>
            channelIds.has(v.channel_id as string),
          );

          const closedRevenue = (start: Date, end: Date) =>
            deals
              .filter((d) => {
                if (d.stage !== "completed" || !d.closed_at) return false;
                const closed = new Date(d.closed_at as string);
                return closed >= start && closed < end;
              })
              .reduce((a, d) => a + Number(d.value ?? 0), 0);

          const revenueThisPeriod = closedRevenue(periodStart, now);
          const revenuePriorPeriod = closedRevenue(priorStart, periodStart);
          const activePipeline = deals
            .filter((d) => d.stage !== "completed")
            .reduce((a, d) => a + Number(d.value ?? 0), 0);

          const countInRange = (rows: { created_at: string }[], start: Date, end: Date) =>
            rows.filter((r) => {
              const created = new Date(r.created_at);
              return created >= start && created < end;
            }).length;

          const leadsThisPeriod = countInRange(leads, periodStart, now);
          const leadsPriorPeriod = countInRange(leads, priorStart, periodStart);

          const videosThisPeriod = videos.filter((v) => {
            if (!v.published_at) return false;
            const published = new Date(v.published_at as string);
            return published >= periodStart && published < now;
          }).length;

          const dealsClosedThisPeriod = deals.filter((d) => {
            if (d.stage !== "completed" || !d.closed_at) return false;
            const closed = new Date(d.closed_at as string);
            return closed >= periodStart && closed < now;
          }).length;

          return json({
            data: {
              periodLabel: "Past 30 days",
              revenueThisPeriod,
              revenueChangePct: pctChange(revenueThisPeriod, revenuePriorPeriod),
              activePipeline,
              leadsThisPeriod,
              leadsChangePct: pctChange(leadsThisPeriod, leadsPriorPeriod),
              videosThisPeriod,
              dealsClosedThisPeriod,
              totals: { deals: deals.length, leads: leads.length, videos: videos.length },
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
