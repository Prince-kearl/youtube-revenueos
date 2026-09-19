import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Youtube } from "lucide-react";
import { useLocalStore, writeStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";

export type ConnectedYoutubeChannel = {
  id: string;
  youtube_channel_id: string;
  channel_name: string;
  channel_handle: string | null;
  thumbnail: string | null;
  subscriber_count: number;
  view_count?: number;
  video_count?: number;
  last_sync_status?: string;
};

export const ACTIVE_YOUTUBE_CHANNEL_KEY = "yroos.activeYoutubeChannelId";

export function YoutubeChannelSwitcher() {
  const [channels, setChannels] = useState<ConnectedYoutubeChannel[]>([]);
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/youtube/channels", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: ConnectedYoutubeChannel[] };
        if (!response.ok) throw new Error("channels_failed");
        return body.data ?? [];
      })
      .then((items) => {
        setChannels(items);
        if (
          items.length &&
          (!activeChannelId || !items.some((item) => item.id === activeChannelId))
        ) {
          writeStore(ACTIVE_YOUTUBE_CHANNEL_KEY, items[0].id);
        }
      })
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [activeChannelId]);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? channels[0],
    [activeChannelId, channels],
  );

  if (loading) return null;

  const switchChannel = (channelId: string) => {
    if (channelId === activeChannelId) return;
    writeStore(ACTIVE_YOUTUBE_CHANNEL_KEY, channelId);
    window.location.reload();
  };

  // Returns the browser here after Google's consent screen instead of always bouncing to
  // Settings — connecting another channel from this dropdown shouldn't strand you on a page you
  // didn't ask to visit. Each channel still needs its own real OAuth grant (Google ties one
  // access token to one selected brand account; there is no API to list every channel a Google
  // login manages without content-owner/CMS partner access this app doesn't have), so this can't
  // skip Google's screen — it just avoids the extra trip through Settings on either side of it.
  const connectHref = `/api/youtube/auth?returnTo=${encodeURIComponent(window.location.pathname)}`;

  // A plain button list, not a native <select> — a <select> with only one or two options renders
  // as a full-screen wheel picker on mobile Safari (confusingly, since there's barely anything to
  // pick from), and its options aren't independently styleable, so a channel needing reconnection
  // couldn't be flagged inline the way it can be here.
  return (
    <div className="space-y-1">
      {channels.length > 0 && (
        <div role="listbox" aria-label="Active YouTube channel" className="space-y-1">
          {channels.map((channel) => {
            const active = channel.id === activeChannel?.id;
            const needsReauth = channel.last_sync_status === "reauth_required";
            return (
              <button
                key={channel.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => switchChannel(channel.id)}
                title={needsReauth ? "YouTube authorization needs to be renewed" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                  needsReauth
                    ? "border-destructive/50 bg-destructive/10 text-destructive"
                    : active
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-accent/30 hover:bg-accent",
                )}
              >
                {channel.thumbnail ? (
                  <img
                    src={channel.thumbnail}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <Youtube className="h-4 w-4 shrink-0 text-brand-red" />
                )}
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {channel.channel_name}
                  {channel.channel_handle ? ` · ${channel.channel_handle}` : ""}
                  {needsReauth ? " · Reconnect needed" : ""}
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
      <a
        href={connectHref}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        Connect another channel
      </a>
    </div>
  );
}
