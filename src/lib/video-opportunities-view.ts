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

/** Performance opportunities were looked for and none stood out. */
export const OPPORTUNITIES_EMPTY = "Nothing stands out in this video's data right now.";

/** Performance opportunities could not be looked for: too little data. No promise of when. */
export const OPPORTUNITIES_INSUFFICIENT =
  "Performance insights need more data than this video has in this period. They compare it with this workspace's other videos once it has enough views and reported revenue, and some also need tracked links or linked deals.";

export const GETTING_STARTED_INTRO =
  "Setup steps, not findings: they help Tubify measure what this video earns beyond YouTube.";

/** Neither performance opportunities nor setup steps. */
export const OPPORTUNITIES_NOTHING = "There's nothing to suggest for this video right now.";

const AREA_LABEL: Record<keyof OpportunityChecks, string> = {
  audience: "Views",
  links: "Tracked links",
  sponsorships: "Brand deals",
  revenue: "Revenue per view",
};

const STATUS_NOTE: Record<Exclude<CheckStatus, "checked">, string> = {
  /** Too little stored data (also what an unknown video gets — on purpose). */
  insufficient_data: "not enough data yet",
  /** The feature is switched off for the caller's role, or for everyone. */
  restricted: "not included for your role or plan",
  /** The caller may not see revenue. */
  hidden: "hidden by your workspace's revenue settings",
  /** A read failed just now. */
  unavailable: "couldn't be loaded — try refreshing",
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
