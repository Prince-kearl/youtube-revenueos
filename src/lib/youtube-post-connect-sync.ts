// Right after a channel is connected or reconnected (?youtube=connected / already_connected),
// sync it once instead of leaving it "Not synced yet" until the nightly job: the stored history
// that revenue, reports and the dashboard read is brought up to date straight away.
//
// Only channels the server reports as never synced are synced — exactly the ones a connect or a
// renewed authorization just (re)attached — one at a time, through the same per-channel route as
// "Sync now" (POST /api/youtube/sync, which checks the workspace and plan itself). Best effort: a
// failure here changes nothing, and the nightly job still runs.

import { youtubeSyncToast, type YoutubeSyncResponse } from "./youtube-sync-toast";

export const POST_CONNECT_STATUSES = new Set(["connected", "already_connected"]);

type ChannelRow = { id: string; channel_name?: string; last_sync_status?: string };

export async function syncNewlyConnectedChannels(
  notify: (kind: "success" | "error", message: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  let channels: ChannelRow[] = [];
  try {
    const response = await fetcher("/api/youtube/channels", { cache: "no-store" });
    if (!response.ok) return 0;
    channels = ((await response.json()) as { data?: ChannelRow[] }).data ?? [];
  } catch {
    return 0;
  }
  const fresh = channels.filter((channel) => channel.last_sync_status === "never_synced");
  let synced = 0;
  for (const channel of fresh) {
    try {
      const response = await fetcher(
        `/api/youtube/sync?channelId=${encodeURIComponent(channel.id)}`,
        { method: "POST" },
      );
      if (!response.ok) continue;
      const result = youtubeSyncToast((await response.json()) as YoutubeSyncResponse);
      synced += 1;
      notify(
        result.kind,
        result.kind === "error"
          ? result.message
          : `${channel.channel_name ?? "Channel"}: ${result.message.toLowerCase()}`,
      );
    } catch {
      // Best effort — the nightly sync still runs.
    }
  }
  return synced;
}
