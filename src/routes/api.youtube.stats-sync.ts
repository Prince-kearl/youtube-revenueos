import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";
import { runRevenueDataBatch, statsSyncTimeBudgetMs } from "@/lib/server/youtube-stats-runner";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export const Route = createFileRoute("/api/youtube/stats-sync")({
  server: {
    handlers: {
      // Dedicated trigger for the stored revenue-data sync (catalogue → channel daily totals →
      // per-video daily rows). The daily /api/youtube/sync cron already runs one bounded batch;
      // this endpoint lets a scheduler run additional batches so large backfills finish sooner.
      // Each call does a bounded amount of work, picks up where the last one stopped, and is safe
      // to call concurrently or repeatedly. Same CRON_SECRET bearer check as the existing cron.
      GET: async ({ request }) => {
        const cronSecret = getServerEnv("CRON_SECRET");
        if (!cronSecret || request.headers.get("Authorization") !== `Bearer ${cronSecret}`)
          return json({ error: "AUTH_REQUIRED" }, { status: 401 });
        const service = createServiceSupabaseClient();
        return json(await runRevenueDataBatch(service, Date.now() + statsSyncTimeBudgetMs()));
      },
    },
  },
});
