// Video details → Revenue sources, from the per-video link-activity API.
//
//   Video page  →  GET /api/videos/link-activity?videoId=<this video>&days=<n>
//
// Pure: no React, no fetch. It turns one response into exactly what the Revenue sources section
// prints. Nothing here is money and nothing here is calculated: clicks and visitors are the
// endpoint's own counts, formatted. The section's one reference to revenue is a pointer to the
// Revenue overview above it, never a figure.
//
// Three things are kept apart, because they are different facts:
//
//   links on this video now               (may have no clicks yet)
//   clicks attributed to this video       (by the video recorded on each click)
//   clicks from links since moved away    (still this video's clicks; shown as their own row)

import type { VideoLinkActivityResponse } from "@/lib/server/video-link-activity";
import { VIDEO_REVENUE_RANGE_DAYS, type VideoRevenueRange } from "@/lib/video-revenue-overview";

// ---------- request ----------

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The request for one video's link activity, over the same range choices as the Revenue
 * overview (90, 180, 365 days). Null when the id cannot be a YouTube video id. `demo` is for the
 * local demo preview only, whose sample ids are not real YouTube ids. */
export function videoLinkActivityUrl(
  youtubeVideoId: string,
  range: VideoRevenueRange,
  options: { demo?: boolean } = {},
): string | null {
  const valid = options.demo ? youtubeVideoId.length > 0 : YOUTUBE_VIDEO_ID.test(youtubeVideoId);
  if (!valid) return null;
  return `/api/videos/link-activity?videoId=${encodeURIComponent(youtubeVideoId)}&days=${VIDEO_REVENUE_RANGE_DAYS[range]}`;
}

// ---------- wording ----------

export const SOURCES_YOUTUBE_NOTE =
  "Estimated YouTube revenue for this video is shown in the Revenue overview above.";

/** Shown with every click figure. */
export const SOURCES_CLICKS_NOTE =
  "Clicks show interest, not income. Tubify has not verified sales or commissions from these links.";

export const SOURCES_NOT_CONNECTED_NOTE =
  "Affiliate commissions, sales and leads are not yet linked to individual videos in Tubify.";

export const SOURCES_EMPTY_NOTE =
  "No tracked links for this video yet. Add one to see how many viewers click through from its description.";

export const SOURCES_RESTRICTED_NOTE = "Tracked-link activity isn't available for your role.";

export const SOURCES_FORMER_LINKS_LABEL = "From links no longer on this video";

/** Why these dates are not the Revenue overview's. */
export const SOURCES_PERIOD_NOTE =
  "Link activity is counted in UTC, up to now. YouTube revenue above is reported per Pacific-time day and a few days late, so the two periods do not match exactly.";

// ---------- view model ----------

export interface RevenueSourceLinkView {
  id: string;
  /** The destination's name, or the short link's slug when the destination is not available. */
  title: string;
  destinationUrl: string | null;
  shortUrl: string;
  /** Null for an active link; "Archived" (etc.) otherwise. */
  statusLabel: string | null;
  /** "1,204", or "—" when the breakdown is unavailable. Never a made-up zero. */
  clicks: string;
  uniqueVisitors: string;
}

export interface VideoRevenueSourcesView {
  /** "activity": there are links and/or clicks to show. "empty": neither. */
  state: "activity" | "empty";
  /** "15 Jul 2026 – 12 Oct 2026 (UTC)". */
  periodLabel: string;
  periodDays: number;
  /** Clicks attributed to this video in the period. */
  clicks: string;
  /** Distinct visitors across the whole video; "—" when it could not be counted. */
  uniqueVisitors: string;
  links: RevenueSourceLinkView[];
  /** Clicks attributed to this video from links that have since been moved off it. */
  formerLinks: { label: string; detail: string; clicks: string; uniqueVisitors: string } | null;
  /** Said when there are clicks but no link is on the video now. */
  noCurrentLinksNote: string | null;
  /** Things the reader should know about these counts; empty when there is nothing to add. */
  notes: string[];
}

export const NO_COUNT = "—";

const count = (value: number | null) =>
  value === null || !Number.isFinite(value) ? NO_COUNT : value.toLocaleString("en-US");

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const plural = (value: number, one: string, many: string) => (value === 1 ? one : many);

const STATUS_LABEL: Record<string, string> = { archived: "Archived" };

/** One response → the Revenue sources section's link activity. */
export function mapVideoRevenueSources(
  response: VideoLinkActivityResponse,
): VideoRevenueSourcesView {
  const { period, totals, links, formerLinks, breakdown, limits } = response;
  const notes: string[] = [];
  if (breakdown === "unavailable")
    notes.push(
      `This video has more than ${limits.maxClickEvents.toLocaleString("en-US")} clicks in this period, so unique visitors and per-link figures aren't shown here. The click total is exact.`,
    );
  if (totals.clicksWithoutVisitorId)
    notes.push(
      `${count(totals.clicksWithoutVisitorId)} ${plural(totals.clicksWithoutVisitorId, "click", "clicks")} carried no visitor id and ${plural(totals.clicksWithoutVisitorId, "is", "are")} not counted towards unique visitors.`,
    );
  if (links.length > 1 && totals.uniqueVisitors !== null && totals.uniqueVisitors > 0)
    notes.push(
      "Unique visitors are counted once across the whole video, so the links' own visitor counts can add up to more.",
    );

  return {
    state: links.length === 0 && totals.clicks === 0 ? "empty" : "activity",
    periodLabel: `${dayLabel(period.startDate)} – ${dayLabel(period.endDate)} (UTC)`,
    periodDays: period.days,
    clicks: count(totals.clicks),
    uniqueVisitors: count(totals.uniqueVisitors),
    links: links.map((link) => ({
      id: link.id,
      title: link.destination?.name ?? link.slug,
      destinationUrl: link.destination?.url ?? null,
      shortUrl: link.shortUrl,
      statusLabel: link.status === "active" ? null : (STATUS_LABEL[link.status] ?? "Not active"),
      clicks: count(link.clicks),
      uniqueVisitors: count(link.uniqueVisitors),
    })),
    formerLinks: formerLinks
      ? {
          label: SOURCES_FORMER_LINKS_LABEL,
          detail: `${count(formerLinks.links)} ${plural(formerLinks.links, "link", "links")} that pointed at this video when the clicks were made`,
          clicks: count(formerLinks.clicks),
          uniqueVisitors: count(formerLinks.uniqueVisitors),
        }
      : null,
    noCurrentLinksNote:
      links.length === 0 && totals.clicks > 0 ? "No tracked link is on this video now." : null,
    notes,
  };
}
