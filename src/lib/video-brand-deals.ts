// Video details → Revenue sources → Brand deals, from the per-video deals API.
//
//   Video page  →  GET    /api/videos/deals?videoId=<this video>
//                  POST   /api/videos/deals            { videoId, dealId }
//                  DELETE /api/videos/deals?videoId=&dealId=
//
// Pure: no React, no fetch. It turns one response into exactly what the Brand deals block prints.
// Every amount is the endpoint's own figure, formatted — nothing is added up here except per
// currency, never across currencies, and never with YouTube revenue.
//
// Words matter here, because three different things could be read into one number:
//   * an attributed sponsorship value is this video's equal share of what a deal was AGREED for;
//   * it is not money received — payments are not tracked at all yet;
//   * it does not follow the page's period selector — a deal is not a daily figure.

import type { VideoDealsResponse, DealStage } from "@/lib/server/video-deals";

// ---------- requests ----------

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The GET for one video's linked deals. Null when the id cannot be a YouTube video id. `demo`
 * is for the local demo preview only, whose sample ids are not real YouTube ids. */
export function videoDealsUrl(
  youtubeVideoId: string,
  options: { demo?: boolean } = {},
): string | null {
  const valid = options.demo ? youtubeVideoId.length > 0 : YOUTUBE_VIDEO_ID.test(youtubeVideoId);
  if (!valid) return null;
  return `/api/videos/deals?videoId=${encodeURIComponent(youtubeVideoId)}`;
}

/** Link a deal to the video. */
export function linkDealRequest(youtubeVideoId: string, dealId: string): [string, RequestInit] {
  return [
    "/api/videos/deals",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: youtubeVideoId, dealId }),
    },
  ];
}

/** Unlink a deal from the video. */
export function unlinkDealRequest(youtubeVideoId: string, dealId: string): [string, RequestInit] {
  const query = new URLSearchParams({ videoId: youtubeVideoId, dealId });
  return [`/api/videos/deals?${query.toString()}`, { method: "DELETE" }];
}

// ---------- wording ----------

export const BRAND_DEALS_AMOUNT_LABEL = "Attributed sponsorship value";

export const BRAND_DEALS_SPLIT_NOTE =
  "A deal's agreed value is split equally across every video it is linked to. Only contracted and completed deals are counted.";

export const BRAND_DEALS_PERIOD_NOTE =
  "Not filtered by the selected period: a deal counts in full whenever it was agreed.";

export const BRAND_DEALS_PAYMENTS_NOTE =
  "Payment tracking isn't available yet, so these are agreed amounts, not money received.";

export const BRAND_DEALS_SEPARATE_NOTE =
  "Kept separate from YouTube revenue, and each currency is shown on its own.";

export const BRAND_DEALS_EMPTY_NOTE = "No brand deals are linked to this video yet.";

export const BRAND_DEALS_RESTRICTED_NOTE = "Brand deals aren't available for your role.";

export const BRAND_DEALS_HIDDEN_NOTE = "Deal amounts are hidden by your workspace's settings.";

/** Shown where an amount is withheld from the viewer — never a zero. */
export const HIDDEN_AMOUNT = "Hidden";

export const NOT_CONTRACTED_LABEL = "Not contracted";

const STAGE_LABEL: Record<DealStage, string> = {
  prospect: "Prospect",
  pitched: "Pitched",
  negotiating: "Negotiating",
  contracted: "Contracted",
  completed: "Completed",
};

// ---------- formatting ----------

/** An amount in its own currency ("$1,234.50", "€250.00"); a code the browser does not know is
 * printed beside the number instead of being guessed at. */
export function formatDealAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}

// ---------- view model ----------

export interface BrandDealRowView {
  id: string;
  name: string;
  stageLabel: string;
  /** Contracted or completed: its share counts as attributed sponsorship value. */
  contracted: boolean;
  currency: string;
  /** "1 of 3 linked videos" — so the split is visible on the row. */
  splitLabel: string;
  /** This video's share, formatted; "Hidden" when withheld; "Not contracted" for a pipeline deal. */
  attributed: string;
  /** The deal's whole agreed value, formatted; "Hidden" when withheld. */
  dealValue: string;
}

export interface BrandDealsView {
  state: "empty" | "deals";
  /** Amounts are withheld from this viewer. */
  hidden: boolean;
  canLink: boolean;
  /** Contracted and completed deals first, then the pipeline, each in the order they were linked. */
  deals: BrandDealRowView[];
  /** Attributed value per currency. Null when hidden; empty when no linked deal is contracted. */
  totals: Array<{ currency: string; amount: string; dealLabel: string }> | null;
  /** Ids of the deals already linked (the link dialog leaves them out). */
  linkedIds: string[];
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** One response (GET, or the refreshed payload of a POST or DELETE) → the Brand deals block. */
export function mapVideoBrandDeals(response: VideoDealsResponse): BrandDealsView {
  const hidden = response.visibility.revenue === "hidden";
  const rows = response.data.deals.map((deal): BrandDealRowView => {
    const contracted = deal.stage === "contracted" || deal.stage === "completed";
    let attributed: string;
    if (deal.attribution.status === "contracted")
      attributed = formatDealAmount(deal.attribution.amount, deal.currency);
    else if (deal.attribution.status === "hidden") attributed = HIDDEN_AMOUNT;
    else attributed = NOT_CONTRACTED_LABEL;
    return {
      id: deal.id,
      name: deal.name,
      stageLabel: STAGE_LABEL[deal.stage] ?? deal.stage,
      contracted,
      currency: deal.currency,
      splitLabel:
        deal.linkedVideoCount === 1
          ? "Linked to this video only"
          : `1 of ${plural(deal.linkedVideoCount, "linked video", "linked videos")}`,
      attributed,
      dealValue:
        deal.dealValue === null ? HIDDEN_AMOUNT : formatDealAmount(deal.dealValue, deal.currency),
    };
  });
  // Stable: within each group the API's order (when the deal was linked) is kept.
  const deals = [...rows.filter((r) => r.contracted), ...rows.filter((r) => !r.contracted)];
  const totals = response.data.contractedByCurrency;
  return {
    state: deals.length === 0 ? "empty" : "deals",
    hidden,
    canLink: response.permissions.canLink,
    deals,
    totals:
      hidden || totals === null
        ? null
        : totals.map((total) => ({
            currency: total.currency,
            amount: formatDealAmount(total.amount, total.currency),
            dealLabel: `from ${plural(total.dealCount, "contracted deal", "contracted deals")}`,
          })),
    linkedIds: response.data.deals.map((deal) => deal.id),
  };
}

// ---------- the link dialog ----------

export interface LinkableDeal {
  id: string;
  name: string;
  stageLabel: string;
  contracted: boolean;
}

/** The workspace's deals (GET /api/deals) that are not linked to this video yet, by name. */
export function linkableDeals(
  deals: ReadonlyArray<{ id: string; name: string; stage: string }>,
  linkedIds: readonly string[],
): LinkableDeal[] {
  const linked = new Set(linkedIds);
  return deals
    .filter((deal) => !linked.has(deal.id))
    .map((deal) => ({
      id: deal.id,
      name: deal.name,
      stageLabel: STAGE_LABEL[deal.stage as DealStage] ?? deal.stage,
      contracted: deal.stage === "contracted" || deal.stage === "completed",
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** What to tell the user when linking or unlinking did not work. */
export function mutationErrorMessage(status: number, error: unknown): string {
  if (status === 403 && error === "REVENUE_HIDDEN")
    return "Only members who can see deal amounts can link or unlink deals.";
  if (status === 403) return "Brand deals aren't available for your role.";
  if (status === 404) return "That deal or video is no longer available. Refresh and try again.";
  if (status === 409) return "That deal changed while you were linking it. Refresh and try again.";
  return "Couldn't update this video's brand deals. Please try again.";
}
