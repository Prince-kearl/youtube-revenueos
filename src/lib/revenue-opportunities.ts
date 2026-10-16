// Revenue opportunities for ONE video (Phase 2C, V1): a few specific, evidence-backed next steps,
// worked out by fixed rules from data Tubify already holds. Two kinds, never mixed:
//
//   * PERFORMANCE opportunities — findings from this video's own data (the rules below), with
//     evidence and a priority;
//   * GETTING STARTED recommendations (Phase 2C-1) — setup steps for a creator who does not yet
//     have the data those findings need. They state no finding, carry no evidence and no
//     priority, and are never presented as something the data revealed.
// Pure: no I/O, no AI — the same facts
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
  /** The video asked about (its YouTube id, as requested) — only used to point actions at it. */
  youtubeVideoId: string;
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
  /** "insufficient_data": nothing is stored for the video, so its links were not looked at. */
  links:
    | { status: "checked"; currentLinks: number; clicks: number }
    | { status: "restricted" | "unavailable" | "insufficient_data" };
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
    | { status: "restricted" | "unavailable" | "insufficient_data" };
  /**
   * What the caller's role may set up — from the role's features and the WORKSPACE, never from
   * this video, so it is the same for any video id (Getting Started recommendations for a video
   * with nothing stored therefore look the same as for an unknown one).
   */
  setup: {
    /** The role has link tracking (which both lists and creates tracked links). */
    linkTracking: boolean;
    /** The role has the lead-magnet feature; and whether the workspace has any lead magnet yet
     * (null when that could not be read — then nothing is said). */
    leadCapture: { enabled: boolean; workspaceHasLeadMagnet: boolean | null };
    /** The role has brand deals (which lets it record deals). */
    brandDeals: boolean;
  };
}

export type GettingStartedType =
  "track_viewer_interest" | "explore_lead_capture" | "prepare_sponsorship_attribution";

/** A setup step. Not a finding: no evidence, no priority, no claim about the video's results. */
export interface GettingStartedRecommendation {
  type: GettingStartedType;
  title: string;
  explanation: string;
  nextStep: string;
  action: { label: string; href: string };
}

/** Whether performance opportunities could be looked for at all:
 *   found              at least one was found
 *   none               the video has enough data and nothing stood out
 *   insufficient_data  nothing is stored for the video, or it has too few views for the rules
 *                      (most of them need OPPORTUNITY_RULES.MIN_VIEWS views, and some need
 *                      tracked links, linked deals or comparable videos as well) */
export type PerformanceStatus = "found" | "none" | "insufficient_data";

export interface OpportunityResult {
  /** Performance opportunities (unchanged since V1). */
  opportunities: Opportunity[];
  /** At most MAX_GETTING_STARTED setup steps, never repeating a performance opportunity. */
  gettingStarted: GettingStartedRecommendation[];
  performance: PerformanceStatus;
  checks: OpportunityChecks;
}

export const MAX_GETTING_STARTED = 3;

/**
 * Where a tracked-link action goes (Phase 2D-1): the Link Tracking page with this video as its
 * context — `create` opens the existing creation dialog with the video chosen; without it, the
 * page lists this video's links. The page re-checks the video on the server: an id that is not
 * a video of the workspace gets no context at all.
 */
export function trackedLinksHref(
  youtubeVideoId: string,
  options: { create?: boolean } = {},
): string {
  const params = new URLSearchParams({ video: youtubeVideoId });
  if (options.create) params.set("create", "1");
  return `/link-tracking?${params.toString()}`;
}

/**
 * The Getting Started steps (pure). Each needs the role to have the feature its action leads to,
 * and is left out when it is already done, when a performance opportunity covers the same action,
 * or when it cannot be known whether it is done.
 *
 *   track_viewer_interest            link tracking; the video has no tracked link and no clicks
 *                                    (or nothing is stored for it); no link opportunity found
 *   explore_lead_capture             the lead-magnet feature; the workspace has no lead magnet
 *   prepare_sponsorship_attribution  brand deals; no deal is linked to the video (or nothing is
 *                                    stored for it); "link a sponsorship" was not found
 */
export function gettingStartedFor(
  input: Pick<OpportunityInputs, "links" | "deals" | "setup" | "youtubeVideoId">,
  performanceTypes: ReadonlySet<OpportunityType>,
): GettingStartedRecommendation[] {
  const steps: GettingStartedRecommendation[] = [];
  const { links, deals, setup } = input;
  const videoKnown = links.status === "checked";

  const linkCovered = (
    ["add_tracked_link", "links_without_clicks", "review_link_offer"] as const
  ).some((type) => performanceTypes.has(type));
  const linksDone = links.status === "checked" && (links.currentLinks > 0 || links.clicks > 0);
  if (
    setup.linkTracking &&
    !linkCovered &&
    !linksDone &&
    links.status !== "unavailable" &&
    links.status !== "restricted"
  )
    steps.push({
      type: "track_viewer_interest",
      title: "Start measuring viewer interest",
      explanation: videoKnown
        ? "This video has no tracked link yet. A tracked link in its description shows how many viewers click through to your offer — interest you can't see in YouTube's own numbers."
        : "A tracked link in a video's description shows how many viewers click through to your offer — interest you can't see in YouTube's own numbers.",
      nextStep:
        "Create a tracked link for something you mention in this video and put it in the description.",
      action: {
        label: "Create a tracked link",
        href: trackedLinksHref(input.youtubeVideoId, { create: true }),
      },
    });

  if (setup.leadCapture.enabled && setup.leadCapture.workspaceHasLeadMagnet === false)
    steps.push({
      type: "explore_lead_capture",
      title: "Offer viewers something to sign up for",
      explanation:
        "A free resource — a checklist, template or guide — lets interested viewers leave their email, so you can reach them again outside YouTube.",
      nextStep: "Create a lead magnet, then share it from your videos with a tracked link.",
      action: { label: "Create a lead magnet", href: "/freebie" },
    });

  const dealsDone = deals.status === "checked" && deals.linkedAny > 0;
  if (
    setup.brandDeals &&
    !performanceTypes.has("link_sponsorship") &&
    !dealsDone &&
    deals.status !== "unavailable" &&
    deals.status !== "restricted"
  )
    steps.push({
      type: "prepare_sponsorship_attribution",
      title: "Get ready to attribute sponsorships",
      explanation:
        "When a video is part of a sponsorship, record the deal in Brand Deals and link it to the video, so its agreed value is shown here. This doesn't mean a sponsorship exists — only that it would be counted.",
      nextStep: "Record your sponsorships in Brand Deals as you agree them.",
      action: { label: "Open Brand Deals", href: "/brand-deals" },
    });

  return steps.slice(0, MAX_GETTING_STARTED);
}

// ---------- small, exact helpers ----------

const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b);

/** Median of a non-empty list. */
export function median(values: readonly number[]): number {
  return medianOfSorted(ascending(values));
}

/** Median of a non-empty list already in ascending order — without its element at `skip`, if
 * one is given (the list is not copied). */
function medianOfSorted(sorted: readonly number[], skip = -1): number {
  const at = (k: number) => (skip < 0 || k < skip ? sorted[k] : sorted[k + 1]);
  const length = sorted.length - (skip < 0 ? 0 : 1);
  const middle = Math.floor(length / 2);
  return length % 2 ? at(middle) : (at(middle - 1) + at(middle)) / 2;
}

/** Index of the first element ≥ value in an ascending list. */
function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The p-th percentile by nearest rank (0 < p ≤ 100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  return percentileOfSorted(ascending(values), p);
}

function percentileOfSorted(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** Whether a video of the workspace counts towards the RPM comparison. */
const rpmComparable = (v: { views: number; rpm: number | null; availability: VideoAvailability }) =>
  revenueKnown(v.availability) && v.views >= OPPORTUNITY_RULES.MIN_VIEWS && v.rpm !== null;

/**
 * The workspace-wide lists the rules compare a video with, sorted once. They are the same for
 * every video of one workspace and period, so a caller evaluating many videos together (the
 * command center) builds them once and passes them to every call instead of having each call
 * filter and sort the whole workspace again. The result is identical either way, provided this
 * video's entry in the workspace has the same figures as `input.video` (with the shared lists,
 * the rules take this video's own figures from `input.video`).
 */
export interface WorkspaceComparisons {
  /** Views of the workspace's videos with any views, ascending. */
  views: number[];
  /** RPMs of the workspace's videos that count towards the RPM comparison, ascending. */
  rpm: number[];
}

export function workspaceComparisons(
  workspace: OpportunityInputs["workspace"],
): WorkspaceComparisons {
  return {
    views: workspace
      .filter((v) => v.views > 0)
      .map((v) => v.views)
      .sort((a, b) => a - b),
    rpm: workspace
      .filter(rpmComparable)
      .map((v) => v.rpm as number)
      .sort((a, b) => a - b),
  };
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

export function evaluateOpportunities(
  input: OpportunityInputs,
  shared?: WorkspaceComparisons,
): OpportunityResult {
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
    // Nothing is stored for this video: no rule can run, and nothing about it is said. Only
    // setup steps that depend on the role and the workspace — never on the video — are offered.
    return {
      opportunities: [],
      gettingStarted: gettingStartedFor(input, new Set()),
      performance: "insufficient_data",
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
  const viewed = shared
    ? shared.views
    : input.workspace.filter((v) => v.views > 0).map((v) => v.views);
  const ranked = viewed.length >= MIN_COMPARABLE;
  // (The shared list is sorted already; read from it as it is.)
  const medianViews = !ranked ? null : shared ? medianOfSorted(viewed) : median(viewed);
  const topQuarterViews = !ranked
    ? null
    : shared
      ? percentileOfSorted(viewed, 75)
      : percentile(viewed, 75);
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
        action: {
          label: "Add a tracked link",
          href: trackedLinksHref(input.youtubeVideoId, { create: true }),
        },
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
        action: {
          label: "Review this video's links",
          href: trackedLinksHref(input.youtubeVideoId),
        },
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
        action: {
          label: "Review this video's links",
          href: trackedLinksHref(input.youtubeVideoId),
        },
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
    // The workspace's OTHER videos. From the shared (sorted) list, this video's own RPM is left
    // out where it stands — one entry with its value — without copying the list.
    let comparableCount: number;
    let typicalRpm: () => number;
    if (shared) {
      const sorted = shared.rpm;
      const at = rpmComparable(video) ? lowerBound(sorted, video.rpm as number) : -1;
      const skip = at >= 0 && sorted[at] === video.rpm ? at : -1;
      comparableCount = sorted.length - (skip < 0 ? 0 : 1);
      typicalRpm = () => medianOfSorted(sorted, skip);
    } else {
      const comparableRpm = input.workspace
        .filter((v) => !v.isThisVideo && rpmComparable(v))
        .map((v) => v.rpm as number);
      comparableCount = comparableRpm.length;
      typicalRpm = () => median(comparableRpm);
    }
    const usable =
      revenueKnown(video.availability) &&
      video.views >= MIN_VIEWS &&
      video.rpm !== null &&
      comparableCount >= MIN_COMPARABLE;
    if (usable) {
      checks.revenue = "checked";
      const rpm = video.rpm as number;
      const typical = typicalRpm();
      const rpmEvidence = [
        { label: `RPM, last ${days} days`, value: usd(rpm) },
        {
          label: `Median RPM of ${count(comparableCount)} other workspace videos, same days`,
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
  return {
    opportunities: found,
    gettingStarted: gettingStartedFor(input, new Set(found.map((o) => o.type))),
    performance:
      found.length > 0 ? "found" : video.views < MIN_VIEWS ? "insufficient_data" : "none",
    checks,
  };
}
