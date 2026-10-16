// Revenue opportunities for ONE video (Phase 2C, V1): a few specific, evidence-backed next steps,
// worked out by fixed rules from data Tubify already holds. Pure: no I/O, no AI — the same facts
// always give the same opportunities, and every rule below is unit-tested.
//
// What the rules may use, and what they may not:
//   * views and RPM from STORED YouTube data, for one period, compared only with the same
//     workspace's other videos over the SAME days. YouTube revenue is in USD only.
//   * tracked-link clicks — interest, never sales, conversions or income;
//   * which brand deals are linked and their stage — a contracted deal is agreed, not paid.
//   * Missing data is never read as zero: without enough of it a rule simply does not fire, and
//     the response says which checks could not be made.
//   * A caller who may not see revenue gets no rule that uses revenue, and no wording, evidence
//     or priority derived from it.
//
// Thresholds (each tested; change them here):
//
//   MIN_VIEWS = 1,000           RPM is revenue per 1,000 views: below that one video's RPM, and
//                               "strong audience", are too noisy to act on.
//   MIN_COMPARABLE = 5          Relative claims ("more than most of this workspace's videos") need at least
//                               five other videos to compare with; otherwise no relative claim.
//   strong audience             views ≥ MIN_VIEWS and ≥ the median of the workspace's videos
//                               with views in the period (with fewer than MIN_COMPARABLE such
//                               videos: views ≥ MIN_VIEWS alone, and no ranking is claimed).
//   top quarter                 views ≥ the 75th percentile (nearest rank) of those videos,
//                               with at least MIN_COMPARABLE of them.
//   MIN_CLICKS = 25             link clicks in the period before they count as a pattern worth
//                               reviewing — below that, a handful of visitors decide it.
//   LOW_RPM_RATIO = 0.5         this video's RPM ≤ half the median RPM of the comparable videos;
//   HIGH_RPM_RATIO = 1.5        or ≥ one and a half times it. Comparable = the workspace's OTHER
//                               videos whose revenue is KNOWN for every stored day of the period
//                               ("complete" or "provisional") and ≥ MIN_VIEWS views; this video
//                               must have known revenue too. "provisional" only means the newest
//                               few days may still be revised by YouTube — the default period
//                               always ends inside that window — so such opportunities are marked
//                               provisional. "partial" or "unavailable" revenue is never compared.

export const OPPORTUNITY_RULES = {
  MIN_VIEWS: 1_000,
  MIN_COMPARABLE: 5,
  MIN_CLICKS: 25,
  LOW_RPM_RATIO: 0.5,
  HIGH_RPM_RATIO: 1.5,
} as const;

export type OpportunityType =
  | "investigate_low_rpm"
  | "add_tracked_link"
  | "links_without_clicks"
  | "review_link_offer"
  | "repeat_high_rpm"
  | "link_sponsorship"
  | "sponsored_video_for_pitch";

export type OpportunityPriority = "high" | "medium" | "low";

export interface Opportunity {
  type: OpportunityType;
  title: string;
  /** Why it was generated, in one or two sentences. */
  explanation: string;
  /** The facts it rests on, as shown to the user. */
  evidence: Array<{ label: string; value: string }>;
  /** The concrete next step. */
  nextStep: string;
  /** Where to do it; an in-page anchor ("#…") or an app path. Null when there is nowhere to go. */
  action: { label: string; href: string } | null;
  priority: OpportunityPriority;
  /** "provisional": rests on days YouTube may still revise. */
  dataStatus: "complete" | "provisional";
}

/** Whether a group of rules could run, and if not, why. */
export type CheckStatus =
  | "checked"
  | "insufficient_data"
  /** The caller's role does not have the feature. */
  | "restricted"
  /** The caller may not see revenue. */
  | "hidden"
  /** The data could not be read just now. */
  | "unavailable";

export interface OpportunityChecks {
  audience: CheckStatus;
  links: CheckStatus;
  sponsorships: CheckStatus;
  revenue: CheckStatus;
}

export type VideoAvailability = "complete" | "provisional" | "partial" | "unavailable";

/** Revenue known for every stored day of the period (the newest days may still be revised). */
const revenueKnown = (availability: VideoAvailability) =>
  availability === "complete" || availability === "provisional";

export interface OpportunityInputs {
  /** Length of the period every figure covers. */
  periodDays: number;
  /** This video's stored figures for the period; null when nothing is stored for it (unknown,
   * another workspace's, or not synced yet — indistinguishable on purpose). */
  video: { views: number; rpm: number | null; availability: VideoAvailability } | null;
  /** The workspace's videos over the same period (this one included). */
  workspace: Array<{
    isThisVideo: boolean;
    views: number;
    rpm: number | null;
    availability: VideoAvailability;
  }>;
  /** Whether the caller may see revenue. */
  revenueVisible: boolean;
  links:
    | { status: "checked"; currentLinks: number; clicks: number }
    | { status: "restricted" | "unavailable" };
  deals:
    | {
        status: "checked";
        /** Contracted or completed deals linked to this video. */
        linkedContracted: number;
        /** Any deal linked to this video. */
        linkedAny: number;
        /** Contracted or completed deals in the workspace linked to no video at all. */
        unlinkedContracted: number;
        /** The caller may link deals. */
        canLink: boolean;
      }
    | { status: "restricted" | "unavailable" };
}

export interface OpportunityResult {
  opportunities: Opportunity[];
  checks: OpportunityChecks;
}

// ---------- small, exact helpers ----------

/** Median of a non-empty list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The p-th percentile by nearest rank (0 < p ≤ 100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

const count = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

const PRIORITY_RANK: Record<OpportunityPriority, number> = { high: 0, medium: 1, low: 2 };
const TYPE_ORDER: OpportunityType[] = [
  "investigate_low_rpm",
  "add_tracked_link",
  "links_without_clicks",
  "review_link_offer",
  "repeat_high_rpm",
  "link_sponsorship",
  "sponsored_video_for_pitch",
];

// ---------- the rules ----------

export function evaluateOpportunities(input: OpportunityInputs): OpportunityResult {
  const { MIN_VIEWS, MIN_COMPARABLE, MIN_CLICKS, LOW_RPM_RATIO, HIGH_RPM_RATIO } =
    OPPORTUNITY_RULES;
  const days = input.periodDays;
  const checks: OpportunityChecks = {
    audience: "insufficient_data",
    links: input.links.status === "checked" ? "checked" : input.links.status,
    sponsorships: input.deals.status === "checked" ? "checked" : input.deals.status,
    revenue: input.revenueVisible ? "insufficient_data" : "hidden",
  };
  const video = input.video;
  if (!video) {
    // Nothing is stored for this video: no rule can run, and nothing about it is said.
    return {
      opportunities: [],
      checks: {
        audience: "insufficient_data",
        links: checks.links === "checked" ? "insufficient_data" : checks.links,
        sponsorships: checks.sponsorships === "checked" ? "insufficient_data" : checks.sponsorships,
        revenue: input.revenueVisible ? "insufficient_data" : "hidden",
      },
    };
  }
  const dataStatus: Opportunity["dataStatus"] =
    video.availability === "provisional" ? "provisional" : "complete";

  // ----- audience: how this video's views compare with the workspace's other videos -----
  const viewed = input.workspace.filter((v) => v.views > 0).map((v) => v.views);
  const ranked = viewed.length >= MIN_COMPARABLE;
  const medianViews = ranked ? median(viewed) : null;
  const topQuarterViews = ranked ? percentile(viewed, 75) : null;
  const strongAudience =
    video.views >= MIN_VIEWS && (medianViews === null || video.views >= medianViews);
  const topQuarter =
    topQuarterViews !== null && video.views >= MIN_VIEWS && video.views >= topQuarterViews;
  checks.audience = "checked";
  const viewsEvidence = {
    label: `Views, last ${days} days (stored YouTube data)`,
    value: count(video.views),
  };
  const rankEvidence = {
    label: "Compared with this workspace's videos",
    value: !ranked
      ? `Not ranked — fewer than ${MIN_COMPARABLE} of the workspace's videos have views in this period`
      : topQuarter
        ? `Top quarter of the workspace's ${count(viewed.length)} videos`
        : video.views >= (medianViews ?? Infinity)
          ? `Above the median of the workspace's ${count(viewed.length)} videos`
          : `Below the median of the workspace's ${count(viewed.length)} videos`,
  };

  const found: Opportunity[] = [];

  // ----- tracked links (interest, never income) -----
  if (input.links.status === "checked") {
    const { currentLinks, clicks } = input.links;
    if (currentLinks === 0 && clicks === 0 && strongAudience) {
      found.push({
        type: "add_tracked_link",
        title: "Measure what viewers do after this video",
        explanation: `This video drew ${count(video.views)} views in the last ${days} days but has no tracked link, so Tubify can't see whether viewers act on an offer. That isn't evidence it earns nothing beyond YouTube — only that nothing is measured.`,
        evidence: [
          viewsEvidence,
          rankEvidence,
          { label: "Tracked links on this video", value: "None" },
        ],
        nextStep:
          "Add a tracked link to the offer, lead magnet or product you mention in this video.",
        action: { label: "Add a tracked link", href: "/link-tracking" },
        priority: topQuarter ? "high" : "medium",
        dataStatus,
      });
    } else if (currentLinks > 0 && clicks === 0 && video.views >= MIN_VIEWS) {
      found.push({
        type: "links_without_clicks",
        title: "This video's links aren't being clicked",
        explanation: `${plural(currentLinks, "tracked link is", "tracked links are")} on this video, but none was clicked in the last ${days} days while the video drew ${count(video.views)} views. Viewers may not be seeing the link, or the offer may not fit them.`,
        evidence: [
          viewsEvidence,
          { label: "Tracked links on this video", value: count(currentLinks) },
          { label: `Link clicks, last ${days} days (UTC)`, value: "0" },
        ],
        nextStep:
          "Check where the link appears and how you introduce it — description position, pinned comment, on-screen mention.",
        action: { label: "Review tracked links", href: "/link-tracking" },
        priority: "medium",
        dataStatus,
      });
    } else if (clicks >= MIN_CLICKS) {
      found.push({
        type: "review_link_offer",
        title: "Viewers are clicking through from this video",
        explanation: `Its tracked links were clicked ${count(clicks)} times in the last ${days} days. Clicks show interest, not sales: check that the offer behind the link matches what this audience came for.`,
        evidence: [
          { label: `Link clicks, last ${days} days (UTC)`, value: count(clicks) },
          viewsEvidence,
        ],
        nextStep:
          "Review the destination and call to action, and reuse this video's format for your next promotion.",
        action: { label: "Review tracked links", href: "/link-tracking" },
        priority: "medium",
        dataStatus,
      });
    }
  }

  // ----- sponsorships (agreed, never paid) -----
  if (input.deals.status === "checked") {
    const { linkedContracted, linkedAny, unlinkedContracted, canLink } = input.deals;
    if (linkedAny === 0 && unlinkedContracted > 0 && canLink) {
      found.push({
        type: "link_sponsorship",
        title: "Was this video part of a sponsorship?",
        explanation: `${plural(unlinkedContracted, "contracted deal in your workspace isn't", "contracted deals in your workspace aren't")} linked to any video yet. If one of them covered this video, linking it attributes its agreed value here.`,
        evidence: [
          { label: "Deals linked to this video", value: "None" },
          { label: "Contracted deals not linked to any video", value: count(unlinkedContracted) },
        ],
        nextStep: "Link the existing deal that covered this video — don't create a new one.",
        action: { label: "Link a deal", href: "#brand-deals" },
        priority: "low",
        dataStatus,
      });
    }
    if (linkedContracted > 0 && topQuarter) {
      found.push({
        type: "sponsored_video_for_pitch",
        title: "Use this sponsored video in your next pitch",
        explanation: `This video carries ${plural(linkedContracted, "contracted sponsorship", "contracted sponsorships")} and is in the top quarter of this workspace's videos by views over the last ${days} days. A contracted deal is agreed, not confirmed as paid.`,
        evidence: [
          viewsEvidence,
          rankEvidence,
          { label: "Contracted deals linked", value: count(linkedContracted) },
        ],
        nextStep: "Use its views and audience as evidence when you pitch similar sponsors.",
        action: { label: "Open Brand Deals", href: "/brand-deals" },
        priority: "low",
        dataStatus,
      });
    }
  }

  // ----- YouTube revenue per view (only for a caller who may see revenue) -----
  if (input.revenueVisible) {
    const comparableRpm = input.workspace
      .filter(
        (v) =>
          !v.isThisVideo && revenueKnown(v.availability) && v.views >= MIN_VIEWS && v.rpm !== null,
      )
      .map((v) => v.rpm as number);
    const usable =
      revenueKnown(video.availability) &&
      video.views >= MIN_VIEWS &&
      video.rpm !== null &&
      comparableRpm.length >= MIN_COMPARABLE;
    if (usable) {
      checks.revenue = "checked";
      const rpm = video.rpm as number;
      const typical = median(comparableRpm);
      const rpmEvidence = [
        { label: `RPM, last ${days} days`, value: usd(rpm) },
        {
          label: `Median RPM of ${count(comparableRpm.length)} other workspace videos, same days`,
          value: usd(typical),
        },
        viewsEvidence,
      ];
      if (typical > 0 && rpm <= typical * LOW_RPM_RATIO && strongAudience) {
        found.push({
          type: "investigate_low_rpm",
          title: "This video earns less per view than most of this workspace's videos",
          explanation: `Its YouTube RPM was ${usd(rpm)}, against a median of ${usd(typical)} for this workspace's other videos with known revenue for the same days. Topic, audience location, length and ad breaks all affect RPM — this shows the gap, not its cause.`,
          evidence: rpmEvidence,
          nextStep:
            "Compare it with your higher-RPM videos: ad breaks, length, topic and where its viewers are.",
          action: { label: "Compare in Analytics", href: "/analytics" },
          priority: "high",
          dataStatus,
        });
      } else if (typical > 0 && rpm >= typical * HIGH_RPM_RATIO) {
        found.push({
          type: "repeat_high_rpm",
          title: "A format worth repeating",
          explanation: `Its YouTube RPM was ${usd(rpm)}, well above the median of ${usd(typical)} for this workspace's other videos over the same days. Something about this video — topic, audience or ad setup — earned more per view; the comparison doesn't prove which.`,
          evidence: rpmEvidence,
          nextStep: "Note what this video did differently and try it in an upcoming upload.",
          action: { label: "Compare in Analytics", href: "/analytics" },
          priority: "medium",
          dataStatus,
        });
      }
    }
  }

  found.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type),
  );
  return { opportunities: found, checks };
}
