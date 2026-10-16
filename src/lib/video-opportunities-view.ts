// Video details → Revenue opportunities: the request, and what the block says about the checks.
// Pure. The opportunities themselves — wording, evidence, priority — come from the API as they
// are (lib/revenue-opportunities.ts); nothing is recalculated here.

import type {
  CheckStatus,
  OpportunityChecks,
  OpportunityPriority,
} from "@/lib/revenue-opportunities";
import { VIDEO_REVENUE_RANGE_DAYS, type VideoRevenueRange } from "@/lib/video-revenue-overview";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The request for one video's opportunities, over the page's range. Null when the id cannot be
 * a YouTube video id. `demo` is for the local demo preview only. */
export function videoOpportunitiesUrl(
  youtubeVideoId: string,
  range: VideoRevenueRange,
  options: { demo?: boolean } = {},
): string | null {
  const valid = options.demo ? youtubeVideoId.length > 0 : YOUTUBE_VIDEO_ID.test(youtubeVideoId);
  if (!valid) return null;
  return `/api/videos/opportunities?videoId=${encodeURIComponent(youtubeVideoId)}&days=${VIDEO_REVENUE_RANGE_DAYS[range]}`;
}

export const PRIORITY_LABEL: Record<OpportunityPriority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

export const OPPORTUNITIES_INTRO =
  "Suggestions worked out from this video's stored YouTube data, tracked links and linked deals — never from estimates.";

export const OPPORTUNITIES_EMPTY =
  "Nothing stands out for this video right now. We'll suggest something when its data points to a clear next step.";

export const OPPORTUNITIES_INSUFFICIENT =
  "There isn't enough stored data for this video in this period to suggest anything yet.";

const AREA_LABEL: Record<keyof OpportunityChecks, string> = {
  audience: "Views",
  links: "Tracked links",
  sponsorships: "Brand deals",
  revenue: "Revenue per view",
};

const STATUS_NOTE: Record<Exclude<CheckStatus, "checked">, string> = {
  insufficient_data: "not enough data yet",
  restricted: "not available for your role",
  hidden: "hidden by your workspace's settings",
  unavailable: "couldn't be checked just now",
};

/** One line per area that was NOT checked, saying why — so an empty list is never mistaken for
 * "everything is fine". Empty when every area was checked. */
export function uncheckedAreas(checks: OpportunityChecks): string[] {
  return (Object.keys(AREA_LABEL) as Array<keyof OpportunityChecks>)
    .filter((area) => checks[area] !== "checked")
    .map(
      (area) =>
        `${AREA_LABEL[area]}: ${STATUS_NOTE[checks[area] as Exclude<CheckStatus, "checked">]}`,
    );
}
