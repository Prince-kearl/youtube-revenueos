import { useEffect, useState } from "react";

/**
 * The channel a page's canonical revenue requests should be scoped to.
 *
 * Pages that show one channel at a time pass the active channel to the live YouTube routes, and
 * when none is selected those routes fall back to the most recently connected channel. The
 * canonical revenue API has no such fallback — without a channel it returns every connected
 * channel together — so this resolves the same default (the first entry of
 * /api/youtube/channels, which is ordered most recently connected first) and the revenue shown
 * stays in step with the rest of the page.
 *
 * Returns `undefined` while the default is still being looked up (do not request yet), a channel
 * id once known, or `null` when the workspace has no connected channel.
 */
export function useRevenueChannelId(activeChannelId: string | null): string | null | undefined {
  const [defaultChannelId, setDefaultChannelId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (activeChannelId) return;
    const controller = new AbortController();
    fetch("/api/youtube/channels", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { data?: Array<{ id?: string }> };
        setDefaultChannelId(response.ok ? (body.data?.[0]?.id ?? null) : null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDefaultChannelId(null);
      });
    return () => controller.abort();
  }, [activeChannelId]);

  return activeChannelId ?? defaultChannelId;
}
