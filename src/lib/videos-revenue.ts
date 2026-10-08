// Videos page revenue: turns the canonical revenue API responses into what the Videos table's
// Revenue, Status and Change columns display.
//
//   Videos page  →  GET /api/revenue/videos?videoIds=<the page's videos>  →  stored revenue data
//
// The list itself (title, thumbnail, views, likes, duration) still comes from YouTube. For each
// page of that list this asks the canonical API about exactly those videos — two requests per
// page, never one per video — and maps the answers:
//
//   Revenue  the video's stored earnings over the last 365 days
//   Change   the video's views over the last 28 days against the 28 before
//   Status   a label derived from those two, per page, as it always was
//
// Nothing here calculates revenue or a percentage: both arrive calculated from the canonical
// layer. A reported $0 is "$0"; revenue that is not available, and a video with nothing stored,
// are "—" and never "$0". CPM is deliberately absent, and RPM is not offered in its place.

import { UNAVAILABLE, formatUsd, type RevenueFigure } from "@/lib/dashboard-revenue";
import type { RevenueVideosResponse } from "@/lib/server/revenue-videos";

/** Revenue is shown for a trailing year — the window this column has always covered. */
export const VIDEOS_REVENUE_DAYS = 365;
/** The trend compares the last four weeks with the four before, using the canonical
 * equal-length-period comparison. */
export const VIDEOS_CHANGE_DAYS = 28;
/** The canonical videos endpoint accepts at most this many ids per request. */
export const VIDEOS_MAX_IDS_PER_REQUEST = 100;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface VideosRevenueRequest {
  /** The YouTube video ids this pair of requests covers. */
  ids: string[];
  /** Revenue for the last VIDEOS_REVENUE_DAYS days. */
  revenueUrl: string;
  /** Activity for the last VIDEOS_CHANGE_DAYS days, with its canonical change. */
  changeUrl: string;
}

/**
 * The canonical requests for one page of the Videos list: its videos' ids, in groups of at most
 * 100 (a page is 50, so normally a single group). Ids that are not shaped like YouTube video ids
 * are left out rather than sent. `demoIds` is for the local demo preview only, whose placeholder
 * ids are answered inside the page and never reach the API.
 */
export function videosRevenueRequests(
  channelId: string | null,
  youtubeVideoIds: string[],
  options: { demoIds?: boolean } = {},
): VideosRevenueRequest[] {
  const ids = [
    ...new Set(
      youtubeVideoIds.filter(
        (id) =>
          typeof id === "string" && (options.demoIds ? id.length > 0 : YOUTUBE_VIDEO_ID.test(id)),
      ),
    ),
  ];
  const scope = channelId ? `&channelId=${encodeURIComponent(channelId)}` : "";
  const requests: VideosRevenueRequest[] = [];
  for (let start = 0; start < ids.length; start += VIDEOS_MAX_IDS_PER_REQUEST) {
    const group = ids.slice(start, start + VIDEOS_MAX_IDS_PER_REQUEST);
    const query = `&limit=${VIDEOS_MAX_IDS_PER_REQUEST}&videoIds=${group.join(",")}${scope}`;
    requests.push({
      ids: group,
      revenueUrl: `/api/revenue/videos?days=${VIDEOS_REVENUE_DAYS}${query}`,
      changeUrl: `/api/revenue/videos?days=${VIDEOS_CHANGE_DAYS}${query}`,
    });
  }
  return requests;
}

// ---------- view model ----------

export type VideoStatusLabel =
  "Top Performer" | "High Revenue" | "Growing" | "Declining" | "Steady";

export type VideoChange =
  /** The canonical percentage change in views. */
  | { kind: "percent"; percent: number }
  /** Views in the recent period and none in the one before: nothing to compare against. */
  | { kind: "new" }
  /** No recent activity is stored, or the change is not known. */
  | { kind: "none" };

export interface VideoRevenueCell {
  /** Stored earnings over the last year. */
  revenue: RevenueFigure;
  /** Days with reported / unreported revenue among the video's stored days. */
  knownDays: number;
  unknownDays: number;
  change: VideoChange;
  status: VideoStatusLabel | null;
  /** False when the canonical catalogue no longer lists the video. The Videos page lists what
   * YouTube returns right now, so this only ever lags; it is carried, not asserted. */
  currentlyListed: boolean | null;
}

export interface VideosRevenuePage {
  /** Keyed by YouTube video id. A video that is absent has nothing stored for the period. */
  cells: Map<string, VideoRevenueCell>;
  /** The newest day stored data covers (YYYY-MM-DD), or null when nothing is stored. */
  dataThrough: string | null;
}

function changeOf(video: RevenueVideosResponse["videos"][number] | undefined): VideoChange {
  if (!video) return { kind: "none" };
  const { percent, previous, current } = video.change.views;
  if (percent !== null) return { kind: "percent", percent };
  if ((current ?? 0) > 0 && (previous ?? 0) === 0) return { kind: "new" };
  return { kind: "none" };
}

/**
 * One page's canonical answers → what each row shows. `change` is the 28-day response; it may be
 * null (that request failed) without affecting revenue.
 *
 * Status keeps the page's long-standing rule — the page's best video is "Top Performer", the
 * rest of the top quarter by revenue is "High Revenue", then the trend decides between Growing,
 * Declining and Steady — applied to canonical figures. Videos are ranked by revenue only when at
 * least one of them has actually earned something; otherwise by views, and nothing is called
 * "High Revenue" on the strength of $0.
 */
export function mapVideosRevenuePage(
  revenue: RevenueVideosResponse,
  change: RevenueVideosResponse | null,
): VideosRevenuePage {
  const recent = new Map(
    (change?.videos ?? []).flatMap((video) =>
      video.youtubeVideoId ? [[video.youtubeVideoId, video] as const] : [],
    ),
  );
  const listed = revenue.videos.filter((video) => video.youtubeVideoId);
  const earning = listed.some((video) => (video.revenue.usd ?? 0) > 0);
  const ranked = [...listed].sort(
    (a, b) =>
      (earning ? (b.revenue.usd ?? 0) - (a.revenue.usd ?? 0) : 0) ||
      b.views - a.views ||
      a.youtubeVideoId!.localeCompare(b.youtubeVideoId!),
  );
  const topQuarter = Math.max(1, Math.ceil(ranked.length * 0.25));

  const cells = new Map<string, VideoRevenueCell>();
  ranked.forEach((video, rank) => {
    const trend = changeOf(recent.get(video.youtubeVideoId!));
    const percent = trend.kind === "percent" ? trend.percent : null;
    const status: VideoStatusLabel =
      rank === 0
        ? "Top Performer"
        : earning && rank < topQuarter
          ? "High Revenue"
          : percent !== null && percent >= 5
            ? "Growing"
            : percent !== null && percent <= -5
              ? "Declining"
              : "Steady";
    cells.set(video.youtubeVideoId!, {
      revenue: {
        text: formatUsd(video.revenue.usd),
        usd: video.revenue.usd,
        partial: video.revenue.availability === "partial",
        available: video.revenue.usd !== null,
      },
      knownDays: video.revenue.knownDays,
      unknownDays: video.revenue.unknownDays,
      change: trend,
      status,
      currentlyListed: video.currentlyListed,
    });
  });
  // A video with recent activity but nothing in the revenue response cannot occur (28 days lie
  // inside the 365), so the revenue response alone decides which videos have a cell.
  return { cells, dataThrough: revenue.dataQuality.freshness.latestStoredDay };
}

/** Adds a newly loaded page's cells to those already shown. */
export function mergeVideosRevenue(
  current: VideosRevenuePage,
  next: VideosRevenuePage,
): VideosRevenuePage {
  return {
    cells: new Map([...current.cells, ...next.cells]),
    dataThrough:
      current.dataThrough && next.dataThrough
        ? current.dataThrough > next.dataThrough
          ? current.dataThrough
          : next.dataThrough
        : (current.dataThrough ?? next.dataThrough),
  };
}

export const EMPTY_VIDEOS_REVENUE: VideosRevenuePage = { cells: new Map(), dataThrough: null };

/** What the Revenue cell prints for a row: the stored amount, or "—" when there is none. */
export function videoRevenueText(page: VideosRevenuePage, youtubeVideoId: string): string {
  return page.cells.get(youtubeVideoId)?.revenue.text ?? UNAVAILABLE;
}

/** One line under the table saying what the Revenue and Change columns cover and how current
 * they are — the stored figures trail YouTube by a few days and that is not hidden. */
export function describeVideosRevenue(page: VideosRevenuePage): string {
  const through = page.dataThrough
    ? ` through ${new Date(`${page.dataThrough}T00:00:00Z`).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })}`
    : "";
  return (
    `Revenue is estimated YouTube revenue for the last ${VIDEOS_REVENUE_DAYS} days${through}. ` +
    `Change compares views in the last ${VIDEOS_CHANGE_DAYS} days with the ${VIDEOS_CHANGE_DAYS} before. ` +
    `The most recent days can still change.`
  );
}
