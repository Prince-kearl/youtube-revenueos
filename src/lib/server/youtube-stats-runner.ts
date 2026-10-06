// Entry points the routes call to run the stored revenue-data sync (youtube-stats-sync.ts) with
// the real API and store. Both are safe to call at any time, any number of times: work is
// bounded, resumable and idempotent, and neither ever throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";
import {
  describeSyncError,
  runChannelSync,
  runSyncBatch,
  type ChannelSyncResult,
} from "./youtube-stats-sync";
import { buildChannelSyncContext, listSyncableChannelIds } from "./youtube-stats-store";

const DEFAULT_TIME_BUDGET_MS = 40_000;

/** How long one cron invocation may keep working. Deliberately configurable: the host's function
 * time limit depends on the hosting plan, which this code cannot know. */
export function statsSyncTimeBudgetMs(): number {
  const configured = Number(getServerEnv("STATS_SYNC_TIME_BUDGET_MS"));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIME_BUDGET_MS;
}

/** One bounded unit of work for one channel. */
export async function runRevenueDataSync(
  service: SupabaseClient,
  channelRowId: string,
): Promise<ChannelSyncResult> {
  try {
    return await runChannelSync(await buildChannelSyncContext(service, channelRowId));
  } catch (error) {
    console.error("Revenue data sync could not start", {
      channelId: channelRowId,
      reason: describeSyncError(error),
    });
    return {
      channelId: channelRowId,
      status: "failed",
      requestsUsed: 0,
      catalogue: null,
      stats: null,
      error: describeSyncError(error),
    };
  }
}

/** Bounded work across channels until `deadline` (epoch ms). */
export async function runRevenueDataBatch(
  service: SupabaseClient,
  deadline: number,
): Promise<{ results: ChannelSyncResult[]; skipped: number; error: string | null }> {
  try {
    const batch = await runSyncBatch(
      {
        listChannelIds: () => listSyncableChannelIds(service),
        contextFor: (channelId) => buildChannelSyncContext(service, channelId),
        now: () => Date.now(),
      },
      deadline,
    );
    for (const result of batch.results) {
      if (result.status === "failed") {
        console.error("Revenue data sync failed for channel", {
          channelId: result.channelId,
          reason: result.error,
        });
      }
    }
    return { ...batch, error: null };
  } catch (error) {
    console.error("Revenue data sync batch could not run", { reason: describeSyncError(error) });
    return { results: [], skipped: 0, error: describeSyncError(error) };
  }
}
