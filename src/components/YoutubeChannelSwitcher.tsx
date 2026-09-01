import { useEffect, useMemo, useState } from "react";
import { Youtube } from "lucide-react";
import { useLocalStore, writeStore } from "@/lib/local-store";

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

  if (loading || !activeChannel) return null;

  const needsReauth = activeChannel.last_sync_status === "reauth_required";

  const switchChannel = (channelId: string) => {
    if (channelId === activeChannelId) return;
    writeStore(ACTIVE_YOUTUBE_CHANNEL_KEY, channelId);
    window.location.reload();
  };

  return (
    <label
      title={needsReauth ? "YouTube authorization needs to be renewed" : undefined}
      className={`flex max-w-[220px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${needsReauth ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border bg-accent/30"}`}
    >
      {activeChannel.thumbnail ? (
        <img src={activeChannel.thumbnail} alt="" className="h-6 w-6 rounded-full object-cover" />
      ) : (
        <Youtube className="h-4 w-4 shrink-0 text-brand-red" />
      )}
      <span className="sr-only">Active YouTube channel</span>
      <select
        aria-label="Active YouTube channel"
        value={activeChannel.id}
        onChange={(event) => switchChannel(event.target.value)}
        className="min-w-0 flex-1 origin-left scale-[0.8] bg-transparent font-semibold outline-none sm:scale-100"
      >
        {channels.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.channel_name}
            {channel.channel_handle ? ` · ${channel.channel_handle}` : ""}
            {channel.last_sync_status === "reauth_required" ? " · Reconnect needed" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
