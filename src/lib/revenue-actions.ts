// Revenue actions and what came of them (Phase 3B-1). Pure: where an action leads, and how the
// state of a video's setup is worded — from persisted data only.
//
// Four things are kept apart and never worded as one another:
//
//   action available     a suggestion with a button (lib/revenue-opportunities.ts decides it)
//   action completed     the thing now exists in the workspace's data: a tracked link on the
//                        video, a deal linked to it — nothing else counts (opening or closing a
//                        dialog never does)
//   activity observed    clicks recorded on tracked links — interest, never income
//   financial outcome    never claimed here: a linked deal's value is agreed, not confirmed as
//                        paid, and clicks are not earnings
//
// A suggestion disappears because the rules, run again on the persisted data, no longer find it —
// never because it was clicked.

import { VIDEO_REVENUE_RANGE_DAYS, type VideoRevenueRange } from "@/lib/video-revenue-overview";
import { splitActionHref } from "@/lib/link-tracking-context";

// ---------- the video page's period, from the URL ----------

export interface VideoPageSearch {
  /** The period the page opens with (the command center passes its own). */
  range?: VideoRevenueRange;
}

/** `?range=3M|6M|12M` on a video page; anything else is no period at all (the page's default). */
export function videoPageSearch(search: Record<string, unknown>): VideoPageSearch {
  const range = search.range;
  return typeof range === "string" && Object.keys(VIDEO_REVENUE_RANGE_DAYS).includes(range)
    ? { range: range as VideoRevenueRange }
    : {};
}

/** The video page's period for a figure over `days` (90, 180, 365), so a link from the command
 * center opens the video over the same days; any other length opens the page's default. */
export function rangeForDays(days: number): VideoRevenueRange | undefined {
  return (Object.keys(VIDEO_REVENUE_RANGE_DAYS) as VideoRevenueRange[]).find(
    (range) => VIDEO_REVENUE_RANGE_DAYS[range] === days,
  );
}

// ---------- where a command-center action leads ----------

/** The id of the Brand deals block on a video page (the "Link a deal" target). */
export const BRAND_DEALS_ANCHOR = "brand-deals";

export type ActionTarget =
  | { kind: "page"; to: string; search: Record<string, string> | undefined }
  | {
      kind: "video";
      videoId: string;
      search: { range?: VideoRevenueRange };
      hash: string | undefined;
    };

/**
 * An opportunity's action as a link from OUTSIDE the video's page. The rules word in-page actions
 * as "#brand-deals" (a block of the video page); from the command center that is the video's own
 * page, at that block and for the same period — so the creator lands on the existing workflow,
 * with the video it is about.
 */
export function actionTarget(
  href: string,
  youtubeVideoId: string,
  range: VideoRevenueRange | undefined,
): ActionTarget {
  if (href.startsWith("#"))
    return {
      kind: "video",
      videoId: youtubeVideoId,
      search: range ? { range } : {},
      hash: href.slice(1) || undefined,
    };
  const { to, search } = splitActionHref(href);
  // The video's links: "Back to video" there returns to the same period.
  if (to === "/link-tracking" && search?.video && range)
    return { kind: "page", to, search: { ...search, range } };
  return { kind: "page", to, search };
}

// ---------- a video's setup and activity, as the command center lists it ----------

export const NOT_SET_UP = "None yet";
export const NOT_INCLUDED = "—";

export interface VideoProgressInput {
  trackedLinks: number | null;
  clicks: number | null;
  linkedDeals: number | null;
}

export interface VideoProgress {
  /** Action completed or not: whether the video has a tracked link at all. */
  trackedLinks: { state: "completed" | "none" | "unknown"; text: string };
  /** Activity observed: clicks on its links in the period (never income). */
  clicks: { state: "observed" | "none" | "unknown"; text: string };
  /** Action completed or not: whether any deal is linked (agreed value, not payment). */
  deals: { state: "completed" | "none" | "unknown"; text: string };
}

const count = (n: number) => n.toLocaleString("en-US");

/** A null figure is a part the caller may not use or that could not be read: never "none". */
export function videoProgress(video: VideoProgressInput): VideoProgress {
  return {
    trackedLinks:
      video.trackedLinks === null
        ? { state: "unknown", text: NOT_INCLUDED }
        : video.trackedLinks === 0
          ? { state: "none", text: NOT_SET_UP }
          : { state: "completed", text: count(video.trackedLinks) },
    clicks:
      video.clicks === null
        ? { state: "unknown", text: NOT_INCLUDED }
        : video.clicks === 0
          ? { state: "none", text: "0" }
          : { state: "observed", text: count(video.clicks) },
    deals:
      video.linkedDeals === null
        ? { state: "unknown", text: NOT_INCLUDED }
        : video.linkedDeals === 0
          ? { state: "none", text: NOT_SET_UP }
          : { state: "completed", text: count(video.linkedDeals) },
  };
}

export const PROGRESS_NOTE =
  "Tracked links and linked deals show what is set up for each video. Clicks show interest, not income; a linked deal's value is agreed, not confirmed as paid.";

// ---------- the Link Tracking page opened from a video ----------

export interface LinkContextProgress {
  /** The action is completed: the video has at least one tracked link (any status). */
  completed: boolean;
  text: string;
  /** Activity observed on those links, or null when there is none yet. */
  activity: string | null;
}

/**
 * The persisted state of "add a tracked link" for the video in context, from the links the server
 * listed for it — the same links the video's suggestions count. Clicks are all the clicks recorded
 * on those links so far, not a period's, and never income.
 */
export function linkContextProgress(links: ReadonlyArray<{ clicks: number }>): LinkContextProgress {
  if (links.length === 0)
    return {
      completed: false,
      text: "This video has no tracked link yet.",
      activity: null,
    };
  const clicks = links.reduce((sum, link) => sum + link.clicks, 0);
  return {
    completed: true,
    text: `This video has ${count(links.length)} tracked ${links.length === 1 ? "link" : "links"}.`,
    activity:
      clicks > 0
        ? `${count(clicks)} ${clicks === 1 ? "click" : "clicks"} recorded on ${links.length === 1 ? "it" : "them"} so far — interest, not income.`
        : "No clicks recorded yet.",
  };
}
