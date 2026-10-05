import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Youtube } from "lucide-react";

interface DiscoveredChannel {
  channelId: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  subscriberCount: number;
}

// Shown when a Google OAuth identity has account-level access to more than one YouTube channel
// (a legacy Brand Account manager, most commonly) — never auto-picks one, since silently choosing
// for the person is exactly the bug this whole feature exists to fix.
export function YoutubeChannelPicker({
  connectionIds,
  onAdded,
  onDismiss,
}: {
  connectionIds: string[];
  onAdded: () => void;
  onDismiss?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [channelsByConnection, setChannelsByConnection] = useState<
    Array<{ connectionId: string; channel: DiscoveredChannel }>
  >([]);
  const [addingChannelId, setAddingChannelId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const results: Array<{ connectionId: string; channel: DiscoveredChannel }> = [];
      for (const connectionId of connectionIds) {
        try {
          const response = await fetch(
            `/api/youtube/connections?discover=${encodeURIComponent(connectionId)}`,
          );
          const body = (await response.json()) as { data?: DiscoveredChannel[] };
          if (response.ok && body.data) {
            for (const channel of body.data) results.push({ connectionId, channel });
          }
        } catch {
          // best-effort per connection — a failed discovery on one connection shouldn't hide
          // results from another
        }
      }
      if (!cancelled) {
        setChannelsByConnection(results);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionIds]);

  const addChannel = async (connectionId: string, channelId: string) => {
    setAddingChannelId(channelId);
    try {
      const response = await fetch("/api/youtube/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, channelId }),
      });
      if (!response.ok) throw new Error("ADD_FAILED");
      setChannelsByConnection((current) =>
        current.filter((row) => row.channel.channelId !== channelId),
      );
      toast.success("YouTube channel connected");
      onAdded();
    } catch {
      toast.error("Couldn't connect that channel. Try again.");
    } finally {
      setAddingChannelId(null);
    }
  };

  if (!loading && channelsByConnection.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">More channels are available on this Google account</p>
          <p className="text-sm text-muted-foreground">
            Choose which channel(s) to connect to this workspace.
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Checking for available channels…</p>
      ) : (
        <div className="space-y-3">
          {channelsByConnection.map(({ connectionId, channel }) => (
            <div
              key={channel.channelId}
              className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                {channel.thumbnail ? (
                  <img
                    referrerPolicy="no-referrer"
                    src={channel.thumbnail}
                    alt={channel.title}
                    className="h-10 w-10 shrink-0 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-red text-white">
                    <Youtube className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{channel.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {channel.subscriberCount.toLocaleString()} subscribers
                  </p>
                </div>
              </div>
              <button
                onClick={() => addChannel(connectionId, channel.channelId)}
                disabled={addingChannelId === channel.channelId}
                className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {addingChannelId === channel.channelId ? "Connecting…" : "Connect this channel"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
