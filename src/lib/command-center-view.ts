// Dashboard → Revenue command center: the request and the wording. Pure. Every figure comes from
// the API as it is (lib/server/command-center.ts); nothing is added up here, and nothing from one
// source is ever combined with another.

import { formatVideoRevenue } from "@/lib/video-revenue-overview";
import { formatDealAmount } from "@/lib/video-brand-deals";

export const COMMAND_CENTER_RANGES = { "3M": 90, "6M": 180, "12M": 365 } as const;
export type CommandCenterRange = keyof typeof COMMAND_CENTER_RANGES;

export function commandCenterUrl(range: CommandCenterRange): string {
  return `/api/revenue/command-center?days=${COMMAND_CENTER_RANGES[range]}`;
}

export const HIDDEN = "Hidden";
export const NO_FIGURE = "—";

/** YouTube estimated revenue (USD) as the tile shows it — never a zero for "unknown". */
export function youtubeRevenueText(revenue: number | null, availability: string): string {
  if (availability === "hidden") return HIDDEN;
  if (revenue === null || availability === "unavailable") return NO_FIGURE;
  return formatVideoRevenue(revenue);
}

export function youtubeRevenueNote(availability: string, days: number): string {
  if (availability === "hidden") return "Revenue is hidden by your workspace's settings.";
  if (availability === "unavailable")
    return `YouTube hasn't reported revenue for the last ${days} days yet.`;
  if (availability === "partial")
    return `Estimated by YouTube · last ${days} days · some days aren't reported yet, so this may be incomplete.`;
  return `Estimated by YouTube · last ${days} days of stored data.`;
}

/** One currency's sponsorship line: agreed values (or "Hidden"), never payments. */
export function sponsorshipText(row: {
  currency: string;
  attributed: number | null;
  unattributed: number | null;
  attributedDeals: number;
  unattributedDeals: number;
}): { attributed: string; unattributed: string } {
  const amount = (value: number | null) =>
    value === null ? HIDDEN : formatDealAmount(value, row.currency);
  const deals = (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`;
  return {
    attributed: `${amount(row.attributed)} linked to videos (${deals(row.attributedDeals)})`,
    unattributed: `${amount(row.unattributed)} not linked to a video yet (${deals(row.unattributedDeals)})`,
  };
}

export const SPONSORSHIP_NOTE = "Agreed deal values — not payments received.";

export const CLICKS_NOTE = "Clicks show interest, not income.";

export const RESTRICTED_NOTE = "Not included for your role or plan.";
export const UNAVAILABLE_NOTE = "Couldn't be loaded — try refreshing.";

export const NOTHING_TO_DO =
  "Nothing needs attention right now. Suggestions appear here when your videos' data points to a clear next step.";

export const COMMAND_CENTER_INTRO = "The most useful things to do next, based on your videos.";

// ---------- the "For you" feed ----------

/** The short label each kind of suggestion carries on its card. */
export const INSIGHT_LABEL: Record<string, string> = {
  investigate_low_rpm: "Revenue check",
  add_tracked_link: "Link opportunity",
  links_without_clicks: "Link check",
  review_link_offer: "Clicks to review",
  repeat_high_rpm: "Winning format",
  link_sponsorship: "Sponsorship",
  sponsored_video_for_pitch: "Pitch idea",
};

export function insightLabel(type: string): string {
  return INSIGHT_LABEL[type] ?? "Suggestion";
}

/** The key a dismissed card is remembered by: the same suggestion, for the same video. */
export function insightKey(insight: { type: string; video: { youtubeVideoId: string } }): string {
  return `${insight.type}@${insight.video.youtubeVideoId}`;
}

/** How long a dismissed card stays hidden on this device (it comes back if it still applies). */
export const DISMISS_FOR_MS = 30 * 86_400_000;

/** The suggestions still to show: those not dismissed in the last 30 days, in their order. */
export function visibleInsights<T extends { type: string; video: { youtubeVideoId: string } }>(
  insights: T[],
  dismissed: Record<string, number>,
  now: number,
): T[] {
  return insights.filter((insight) => {
    const at = dismissed[insightKey(insight)];
    return !(typeof at === "number" && now - at < DISMISS_FOR_MS);
  });
}

/** A video's YouTube thumbnail (medium size). */
export function videoThumbnailUrl(youtubeVideoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/mqdefault.jpg`;
}
