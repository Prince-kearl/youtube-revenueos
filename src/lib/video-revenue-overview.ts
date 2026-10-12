// Video details → Revenue overview, from the canonical per-video revenue API.
//
//   Video page  →  GET /api/revenue/videos?days=<n>&videoIds=<this video>  →  stored revenue data
//
// Pure: no React, no fetch. It turns one response into exactly what the Revenue overview section
// prints, so every figure on that section — and every decision about which of its states applies
// — is made here and is unit-tested. Nothing in this file calculates revenue: the amount, RPM,
// the split by source, the change against the previous period, the period itself and the
// freshness all come from the endpoint as they are.
//
// Three different things must never be shown as one another:
//
//   $0.00    YouTube reported zero for the period
//   —        there is no figure (not reported, or nothing stored)
//   Hidden   there is a figure and this viewer may not see it
//
// And an absent video is not a zero: when the endpoint returns no row for the video, the
// `requested` entry says whether that is because its history has not been imported yet, because
// nothing is stored for this period, or because the video is not known here at all.

import type {
  RequestedVideoStatus,
  RevenueVideoItem,
  RevenueVideosResponse,
} from "@/lib/server/revenue-videos";
import { revenueDataNotice, revenueDataNoticeText } from "@/lib/dashboard-revenue";
import {
  HIDDEN_AMOUNT_TEXT,
  REVENUE_HIDDEN_MESSAGE,
  isRevenueHidden,
} from "@/lib/revenue-visibility";

// ---------- request ----------

/** The page's range control → the stored period asked for. The API decides the actual dates
 * (it ends at the newest day YouTube is expected to have reported) and returns them. */
export const VIDEO_REVENUE_RANGE_DAYS = { "3M": 90, "6M": 180, "12M": 365 } as const;
export type VideoRevenueRange = keyof typeof VIDEO_REVENUE_RANGE_DAYS;

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The request for one video's revenue, or null when the id cannot be a YouTube video id (the
 * endpoint would reject it). `demo` is for the local demo preview only, whose sample ids are not
 * real YouTube ids. No channel is named: the video is found on whichever of the workspace's
 * connected channels it belongs to. */
export function videoRevenueUrl(
  youtubeVideoId: string,
  range: VideoRevenueRange,
  options: { demo?: boolean } = {},
): string | null {
  const valid = options.demo ? youtubeVideoId.length > 0 : YOUTUBE_VIDEO_ID.test(youtubeVideoId);
  if (!valid) return null;
  return `/api/revenue/videos?days=${VIDEO_REVENUE_RANGE_DAYS[range]}&videoIds=${encodeURIComponent(youtubeVideoId)}`;
}

// ---------- view model ----------

export type VideoRevenueState =
  /** YouTube reported revenue above zero for the whole of the video's stored days. */
  | "reported"
  /** YouTube reported exactly zero. */
  | "zero"
  /** Revenue was reported for some of the video's stored days and not for others. */
  | "partial"
  /** The video has stored days in the period, none of them with revenue. */
  | "unavailable"
  /** The video is known, but its daily history has never been imported. */
  | "history_pending"
  /** The video is known and its history is imported; nothing is stored for this period. */
  | "no_data_in_period"
  /** Nothing is known about this video here (see RequestedVideoStatus: "unknown"). */
  | "unknown_video"
  /** The workspace has no connected channel. */
  | "not_connected"
  /** The viewer may not see amounts. */
  | "hidden";

export interface VideoRevenueSource {
  key: "ads" | "premium" | "other";
  label: string;
  /** e.g. "$8.20". */
  text: string;
  usd: number;
  /** True when this part was reported for only some of the days. */
  partial: boolean;
}

export interface VideoRevenueOverviewView {
  state: VideoRevenueState;
  /** "$12.40", "$0.00", "—" or "Hidden". */
  headline: string;
  /** True only when `headline` is a real amount (reported, zero or partial). */
  hasAmount: boolean;
  /** One sentence saying what the headline is, or why there is none. */
  note: string;
  /** The stored period the figures cover, from the API: "10 Oct 2025 – 9 Oct 2026". */
  periodLabel: string;
  periodDays: number;
  /** "$4.12" per 1,000 views — null whenever the API did not supply an RPM. */
  rpm: string | null;
  /** Change in revenue against the previous period of equal length — null unless both periods'
   * revenue is fully known and the API supplied a percentage. */
  change: { text: string; positive: boolean; comparedWith: string } | null;
  /** Ads / YouTube Premium / Other, only the parts YouTube reported. Empty when there is no
   * amount to break down, or no part was reported. */
  sources: VideoRevenueSource[];
  /** Said under the sources when they do not tell the whole story; null otherwise. */
  sourcesNote: string | null;
  /** How current the stored data is; "" when nothing is stored. */
  freshnessNote: string;
  /** Said when the period is not fully covered by stored data; null otherwise. */
  completenessNote: string | null;
}

/** What the figure covers and what it leaves out. Shown under every state that has a figure. */
export const VIDEO_REVENUE_SCOPE_NOTE =
  "YouTube estimated revenue for this video. Brand deals, affiliate commissions and tracked-link activity are not included.";

/** Why the dates here differ from the activity cards on the same page. */
export const VIDEO_REVENUE_PERIOD_NOTE =
  "Revenue is from stored YouTube data, which YouTube reports a few days late. The activity figures below are live and run to today.";

export const NO_FIGURE = "—";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Always two decimals: one video's revenue is often a few dollars, and "$0.00" must be
 * recognisably a reported zero. A null is "—", never a zero. */
export function formatVideoRevenue(usd: number | null): string {
  return usd === null || !Number.isFinite(usd) ? NO_FIGURE : money.format(usd);
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function periodLabelOf(period: { startDate: string; endDate: string }): string {
  return `${dayLabel(period.startDate)} – ${dayLabel(period.endDate)}`;
}

const days = (count: number) => `${count} day${count === 1 ? "" : "s"}`;

const SOURCE_LABEL = { ads: "Ads", premium: "YouTube Premium", other: "Other" } as const;

/** The reported parts of the split. Ads and Premium are listed whenever YouTube reported them.
 * "Other" is the API's own residual — computed there only from days where the total, ads and
 * Premium are all known — and is listed only when it is fully known and is a real positive
 * amount; a residual that rounds to nothing, is negative, or covers only part of the period
 * says nothing reliable and is left out. */
function sourcesOf(item: RevenueVideoItem): VideoRevenueSource[] {
  const sources: VideoRevenueSource[] = [];
  for (const key of ["ads", "premium"] as const) {
    const amount = key === "ads" ? item.split.ad : item.split.premium;
    if (amount.usd === null) continue;
    sources.push({
      key,
      label: SOURCE_LABEL[key],
      text: formatVideoRevenue(amount.usd),
      usd: amount.usd,
      partial: amount.availability === "partial",
    });
  }
  const other = item.split.other;
  if (other.usd !== null && other.availability === "available" && other.usd >= 0.005)
    sources.push({
      key: "other",
      label: SOURCE_LABEL.other,
      text: formatVideoRevenue(other.usd),
      usd: other.usd,
      partial: false,
    });
  return sources;
}

function freshnessNoteOf(response: RevenueVideosResponse, item: RevenueVideoItem | null): string {
  const { freshness } = response.dataQuality;
  if (!freshness.latestStoredDay) return "";
  const unsettled = item
    ? item.dataQuality.incompleteTrend
    : freshness.provisionalDays.length > 0 || freshness.pendingDays.length > 0;
  const notice = revenueDataNotice(response.dataQuality);
  return (
    `Stored data through ${dayLabel(freshness.latestStoredDay)}` +
    (unsettled ? " · the most recent days can still change" : "") +
    (notice ? ` · ${revenueDataNoticeText(notice)}` : "")
  );
}

function completenessNoteOf(response: RevenueVideosResponse): string | null {
  const missing = response.dataQuality.freshness.missingDays.length;
  return missing > 0
    ? `${days(missing)} in this period ${missing === 1 ? "has" : "have"} no stored data yet, so this may not be the whole period.`
    : null;
}

const NOTHING_TO_BREAK_DOWN = { sources: [], sourcesNote: null, rpm: null, change: null };

/**
 * One response → the Revenue overview for `youtubeVideoId`.
 *
 * The order of the checks matters: a hidden response says nothing else about the video's money
 * (not even whether there is any), and an absent video is explained by `requested`, never
 * assumed to be zero.
 */
export function mapVideoRevenueOverview(
  response: RevenueVideosResponse,
  youtubeVideoId: string,
): VideoRevenueOverviewView {
  const base = {
    periodLabel: periodLabelOf(response.period),
    periodDays: response.period.days,
  };
  const item = response.videos.find((video) => video.youtubeVideoId === youtubeVideoId) ?? null;

  if (isRevenueHidden(response))
    return {
      ...base,
      ...NOTHING_TO_BREAK_DOWN,
      state: "hidden",
      headline: HIDDEN_AMOUNT_TEXT,
      hasAmount: false,
      note: `${REVENUE_HIDDEN_MESSAGE}.`,
      freshnessNote: "",
      completenessNote: null,
    };

  const noFigure = (state: VideoRevenueState, note: string): VideoRevenueOverviewView => ({
    ...base,
    ...NOTHING_TO_BREAK_DOWN,
    state,
    headline: NO_FIGURE,
    hasAmount: false,
    note,
    freshnessNote: freshnessNoteOf(response, item),
    completenessNote: completenessNoteOf(response),
  });

  if (response.status === "not_connected")
    return noFigure("not_connected", "Connect a YouTube channel to see this video's revenue.");

  if (!item) {
    const requested: RequestedVideoStatus | undefined = response.requested?.find(
      (entry) => entry.youtubeVideoId === youtubeVideoId,
    );
    if (!requested || requested.status === "unknown")
      return noFigure("unknown_video", "No stored revenue data was found for this video.");
    const delisted =
      requested.currentlyListed === false ? " YouTube no longer lists this video." : "";
    if (!requested.historyLoaded)
      return noFigure(
        "history_pending",
        `This video's revenue history hasn't been imported yet. It will appear after a sync.${delisted}`,
      );
    return noFigure(
      "no_data_in_period",
      `Nothing is stored for this video in this period.${delisted}`,
    );
  }

  const { usd, knownDays, unknownDays } = item.revenue;
  if (usd === null)
    return noFigure(
      "unavailable",
      "YouTube has not reported revenue for this video in this period.",
    );

  const partial = item.dataQuality.availability === "partial";
  const state: VideoRevenueState = partial ? "partial" : usd === 0 ? "zero" : "reported";
  const note = partial
    ? `Reported for ${knownDays} of ${days(knownDays + unknownDays)} with activity. The amount covers those days only.`
    : usd === 0
      ? "YouTube reported $0.00 for this period."
      : "Estimated by YouTube for this period.";

  // A comparison is offered only when both periods are fully known; the API already withholds
  // the percentage when the previous amount is zero or unknown.
  const { percent } = item.change.revenue;
  const comparable =
    !partial &&
    item.revenue.availability === "available" &&
    item.previous.revenue.availability === "available" &&
    percent !== null;
  const sources = usd === 0 ? [] : sourcesOf(item);
  const breakdownIncomplete =
    sources.some((source) => source.partial) ||
    (usd !== 0 && (item.split.ad.usd === null || item.split.premium.usd === null));

  return {
    ...base,
    state,
    headline: formatVideoRevenue(usd),
    hasAmount: true,
    note,
    rpm: item.rpm === null ? null : formatVideoRevenue(item.rpm),
    change: comparable
      ? {
          text: `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`,
          positive: percent >= 0,
          comparedWith: periodLabelOf(response.previousPeriod),
        }
      : null,
    sources,
    sourcesNote:
      usd === 0
        ? null
        : sources.length === 0
          ? "YouTube did not report a breakdown by source for this period."
          : breakdownIncomplete
            ? "YouTube reported the breakdown for only part of this period, so the sources may not add up to the total."
            : null,
    freshnessNote: freshnessNoteOf(response, item),
    completenessNote: completenessNoteOf(response),
  };
}
