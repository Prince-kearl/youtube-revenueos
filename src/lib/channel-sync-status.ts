// What a connected channel's sync status means, in plain words, for the YouTube Integration
// panel in Settings — never a bare internal state like "Partially synced". Each status says what
// happened and, where something did not finish, offers "Try again" (a sync of just that channel).
// Pure, so every case is unit-tested.

export type SyncTone = "ok" | "info" | "warn" | "error";

export interface ChannelSyncView {
  tone: SyncTone;
  text: string;
  /** Show a "Try again" button that syncs this channel. */
  retry: boolean;
}

const PART_NAMES: Record<string, string> = {
  videos: "videos",
  comments: "comments",
  chapters: "chapters",
};

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", or a date for anything older. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function listParts(error: string | null | undefined): string | null {
  const parts = (error ?? "")
    .split(",")
    .map((part) => PART_NAMES[part.trim()])
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function channelSyncView(
  channel: {
    last_sync_status?: string | null;
    last_sync_error?: string | null;
    last_synced_at?: string | null;
  },
  now: Date = new Date(),
): ChannelSyncView {
  const when = channel.last_synced_at ? relativeTime(channel.last_synced_at, now) : null;
  switch (channel.last_sync_status) {
    case "syncing":
      return { tone: "info", text: "Updating your channel data…", retry: false };
    case "reauth_required":
      return {
        tone: "error",
        text: "YouTube access has expired — reconnect this channel to keep it up to date",
        retry: false,
      };
    case "failed":
      return {
        tone: "error",
        text: when
          ? `The last update didn’t finish — your data is from ${when}`
          : "The first update didn’t finish yet",
        retry: true,
      };
    case "partial": {
      const parts = listParts(channel.last_sync_error);
      return {
        tone: "warn",
        text: parts
          ? `Up to date${when ? ` (${when})` : ""}, except ${parts} — YouTube didn’t send them this time`
          : `Mostly up to date${when ? ` (${when})` : ""} — a few details didn’t come through`,
        retry: true,
      };
    }
    default:
      return when
        ? { tone: "ok", text: `Connected · up to date as of ${when}`, retry: false }
        : { tone: "info", text: "Connected · getting your channel data ready", retry: true };
  }
}
