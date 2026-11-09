import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "./supabase";
import { setYoutubeQuotaRecorder, type DataApiCall } from "./youtube-quota";

// Stores every YouTube Data API request as a youtube_quota_events row with source 'api' — the
// measured usage the reply allowance, the Comments page and the admin quota panel read
// (youtube-quota.ts). Installed once, by the server entry (src/server.ts), so it is active for
// every request whichever route runs first.
//
// A request is credited to a channel of the connection whose token made it (all channels of a
// connection belong to one workspace, so per-workspace totals are exact). A request with an
// unknown token (the OAuth callback's first, unregistered token) is stored without a channel: it
// still counts towards the app's total. Only the operation, its units and the HTTP status are
// stored — never a token, URL or response.

const CHANNEL_CACHE_MS = 10 * 60_000;
const channelByConnection = new Map<string, { channelId: string | null; at: number }>();

async function channelOf(service: SupabaseClient, connectionId: string): Promise<string | null> {
  const cached = channelByConnection.get(connectionId);
  if (cached && Date.now() - cached.at < CHANNEL_CACHE_MS) return cached.channelId;
  const { data } = await service
    .from("youtube_channels")
    .select("id")
    .eq("connection_id", connectionId)
    .limit(1)
    .maybeSingle();
  const channelId = (data?.id as string | undefined) ?? null;
  channelByConnection.set(connectionId, { channelId, at: Date.now() });
  return channelId;
}

/** Stores one call. Exported for tests; the server installs it with installYoutubeQuotaRecorder. */
export async function recordYoutubeApiCall(
  service: SupabaseClient,
  call: DataApiCall,
): Promise<void> {
  const channelId = call.connectionId ? await channelOf(service, call.connectionId) : null;
  const ok = call.status >= 200 && call.status < 400;
  await service.from("youtube_quota_events").insert({
    channel_id: channelId,
    operation: call.operation,
    quota_units: call.units,
    succeeded: ok,
    error_code: ok ? null : `HTTP_${call.status}`,
    source: "api",
  });
}

let installed = false;

/** Starts recording every Data API request (idempotent). */
export function installYoutubeQuotaRecorder(): void {
  if (installed) return;
  installed = true;
  let service: SupabaseClient | null = null;
  setYoutubeQuotaRecorder(async (call) => {
    service ??= createServiceSupabaseClient();
    await recordYoutubeApiCall(service, call);
  });
}

/** Test helper. */
export function resetYoutubeQuotaRecorderCache(): void {
  channelByConnection.clear();
}
