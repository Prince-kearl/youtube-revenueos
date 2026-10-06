// Video → tracked link → click attribution.
//
// A tracked link already knows which video (and campaign) it was created for. A click can only
// ever be attributed through the link it came through — there is no other signal — so everything
// here copies from the link and nothing is inferred. A link with no video produces a click with
// no video; that is the honest answer, not a gap to fill in.

type MaybeOne<T> = T | T[] | null | undefined;

function one<T>(value: MaybeOne<T>): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export interface TrackedLinkAttributionSource {
  id: string;
  destination_id: string;
  video_id: string | null;
  campaign_id: string | null;
  // The link's video row, embedded so the channel comes from the same lookup. PostgREST types an
  // embedded many-to-one as an array without generated types, hence MaybeOne.
  video?: MaybeOne<{ channel_id: string | null }>;
}

export interface ClickAttribution {
  link_id: string;
  destination_id: string;
  video_id: string | null;
  channel_id: string | null;
  campaign_id: string | null;
}

/** The attribution columns for a new click, taken from the link it was made through. */
export function clickAttributionFromLink(link: TrackedLinkAttributionSource): ClickAttribution {
  return {
    link_id: link.id,
    destination_id: link.destination_id,
    video_id: link.video_id ?? null,
    // A channel is only known through the video; a link without a video has no channel either.
    channel_id: link.video_id ? (one(link.video)?.channel_id ?? null) : null,
    campaign_id: link.campaign_id ?? null,
  };
}

export interface StoredClickAttribution {
  link_id: string;
  video_id: string | null;
  channel_id: string | null;
  campaign_id: string | null;
}

/**
 * The rule the historical backfill applies (the SQL in
 * 202610060001_revenue_data_foundation.sql implements exactly this): fill only columns that are
 * currently empty, only from the click's own link, and never overwrite a value already recorded.
 * Returns the columns to set, or null when there is nothing that can be determined.
 */
export function backfillClickAttribution(
  click: StoredClickAttribution,
  link: TrackedLinkAttributionSource | null,
): Partial<Pick<StoredClickAttribution, "video_id" | "channel_id" | "campaign_id">> | null {
  if (!link || link.id !== click.link_id) return null;
  const fromLink = clickAttributionFromLink(link);
  const patch: Partial<Pick<StoredClickAttribution, "video_id" | "channel_id" | "campaign_id">> =
    {};
  if (click.video_id === null && fromLink.video_id) patch.video_id = fromLink.video_id;
  if (click.channel_id === null && fromLink.channel_id) patch.channel_id = fromLink.channel_id;
  if (click.campaign_id === null && fromLink.campaign_id) patch.campaign_id = fromLink.campaign_id;
  return Object.keys(patch).length ? patch : null;
}

/** Videos ranked by how many clicks they sent, most first. Clicks with no video are not counted
 * towards any video. */
export function topVideosByClicks(
  clicks: Array<{ video_id: string | null }>,
  limit: number,
): Array<{ videoId: string; clicks: number }> {
  const counts = new Map<string, number>();
  for (const click of clicks) {
    if (!click.video_id) continue;
    counts.set(click.video_id, (counts.get(click.video_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([videoId, clicks]) => ({ videoId, clicks }));
}
