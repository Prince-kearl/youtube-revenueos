// The Revenue command center (Phase 3A): one workspace-level answer to "how are my videos doing
// financially, where does the money come from, what deserves attention, and what can I do next".
//
// Nothing here is a new calculation. It gathers, once per request and for one period:
//
//   YouTube estimated revenue   buildRevenueSummary   (channel-level, USD, stored data)
//   per-video views / revenue   buildRevenueVideos    (the same rows the video pages use)
//   tracked links and clicks    tracking_links, link_click_events (counts only; clicks are
//                               interest, never income)
//   sponsorships                deals + deal_videos   (agreed values, never payments)
//
// and runs the EXISTING opportunity rules (lib/revenue-opportunities.ts) for every video, with
// the same inputs a video page would build, then keeps a few — so a suggestion here is exactly the
// suggestion that video's own page shows.
//
// Kept apart, never added together: YouTube revenue (USD, for the period), contracted sponsorship
// value (per currency, not tied to a period), and clicks (a count).
//
// Access: the caller's workspace only (every read filters by it). Amounts come only through the
// caller's MoneyReader; a member who may not see revenue gets activity and counts, no amounts,
// no revenue rules, and lists ordered by views — never by anything derived from revenue. Each
// part needs its feature (link tracking, brand deals); a part the role may not use is "restricted"
// and nothing of it is read.

import type { WorkspaceContext } from "./workspace";
import { workspaceFeatureStatus } from "./workspace";
import { resolveRevenueAccess, revenueReadMode } from "./revenue-visibility";
import { buildRevenueVideos, type RevenueVideosQuery } from "./revenue-videos";
import {
  buildRevenueSummary,
  parseRevenueSummaryQuery,
  resolveRevenuePeriod,
} from "./revenue-summary";
import { linkActivityPeriod, MAX_CLICK_EVENTS, type LinkActivityDays } from "./video-link-activity";
import { centsToAmount, toCents } from "./video-deals";
import { PagedReadError, readAllRows } from "./paged-read";
import {
  evaluateOpportunities,
  type CheckStatus,
  type GettingStartedRecommendation,
  type Opportunity,
  type OpportunityInputs,
  type OpportunityPriority,
  type OpportunityResult,
  workspaceComparisons,
} from "@/lib/revenue-opportunities";
import {
  REVENUE_HIDDEN,
  REVENUE_VISIBLE,
  type RevenueVisibilityMarker,
} from "@/lib/revenue-visibility";

// ---------- the response ----------

export interface VideoRef {
  youtubeVideoId: string;
  title: string | null;
}

export interface CommandCenterResponse {
  data: {
    status: "connected" | "not_connected";
    period: { days: number; startDate: string; endDate: string };
    /** YouTube estimated revenue for the period, channel-level, USD. */
    youtube: {
      revenue: number | null;
      availability: "available" | "partial" | "unavailable" | "hidden";
      views: number;
    };
    /** Contracted and completed deals, by currency. Agreed values, not payments; not limited to
     * the period. Null amounts when hidden. */
    sponsorships:
      | {
          status: "checked";
          byCurrency: SponsorshipCurrencyRow[];
          payments: { tracked: false };
        }
      | { status: Exclude<CheckStatus, "checked" | "hidden"> };
    /** Tracked links and the clicks recorded on them in the period (UTC days, up to now). */
    links:
      | {
          status: "checked";
          links: number;
          linksOnVideos: number;
          videosWithLinks: number;
          clicks: number;
          period: { startDate: string; endDate: string };
        }
      | { status: Exclude<CheckStatus, "checked" | "hidden"> };
    /** A few performance opportunities across the workspace, each for one video. */
    opportunities: Array<Opportunity & { video: VideoRef }>;
    /** A few setup steps; `video` only where the step is about one video. */
    gettingStarted: Array<GettingStartedRecommendation & { video: VideoRef | null }>;
    /** The workspace's most-viewed videos in the period. */
    videos: CommandCenterVideo[];
    /** Videos with stored data in the period. */
    videoCount: number;
  };
  visibility: RevenueVisibilityMarker;
}

export interface SponsorshipCurrencyRow {
  currency: string;
  /** Agreed value of contracted/completed deals linked to at least one video. */
  attributed: number | null;
  /** Agreed value of contracted/completed deals linked to no video yet. */
  unattributed: number | null;
  attributedDeals: number;
  unattributedDeals: number;
}

export interface CommandCenterVideo {
  youtubeVideoId: string;
  title: string | null;
  views: number;
  /** YouTube estimated revenue for the period (USD); null when hidden or not reported. */
  revenue: number | null;
  revenueAvailability: "complete" | "provisional" | "partial" | "unavailable";
  /** Null when the caller may not use that feature, or it could not be read. */
  trackedLinks: number | null;
  clicks: number | null;
  linkedDeals: number | null;
  /** How many performance opportunities this video has. */
  opportunities: number;
}

export const MAX_OPPORTUNITIES = 5;
export const MAX_PER_TYPE = 2;
export const MAX_VIDEOS = 8;

// ---------- pure parts ----------

const FINANCIAL = new Set(["contracted", "completed"]);
const PRIORITY: Record<OpportunityPriority, number> = { high: 0, medium: 1, low: 2 };

function currencyOf(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase() || "UNKNOWN";
}

/**
 * Contracted and completed deals by currency: attributed (linked to at least one video) or not.
 * Each deal is counted once, whatever number of videos it is linked to — the per-video shares of
 * one deal add up to its value, so summing deals (not shares) can never double count. `values`
 * null: the caller may not see amounts, so only counts are given.
 */
export function sponsorshipsByCurrency(
  deals: ReadonlyArray<{ id: string; stage: string; currency: string | null }>,
  linkedDealIds: ReadonlySet<string>,
  values: ReadonlyMap<string, number | null> | null,
): SponsorshipCurrencyRow[] {
  const rows = new Map<
    string,
    { a: number; u: number; ad: number; ud: number; unknown: boolean }
  >();
  for (const deal of deals) {
    if (!FINANCIAL.has(deal.stage)) continue;
    const currency = currencyOf(deal.currency);
    const row = rows.get(currency) ?? { a: 0, u: 0, ad: 0, ud: 0, unknown: false };
    const cents = values ? toCents(values.get(deal.id)) : null;
    if (values && cents === null) row.unknown = true;
    if (linkedDealIds.has(deal.id)) {
      row.ad += 1;
      row.a += cents ?? 0;
    } else {
      row.ud += 1;
      row.u += cents ?? 0;
    }
    rows.set(currency, row);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, row]) => ({
      currency,
      // An amount that could not be read makes the total unknown, never smaller.
      attributed: values && !row.unknown ? centsToAmount(row.a) : null,
      unattributed: values && !row.unknown ? centsToAmount(row.u) : null,
      attributedDeals: row.ad,
      unattributedDeals: row.ud,
    }));
}

/**
 * A few opportunities across the workspace, from each video's own result: highest priority
 * first, then the video with more views; at most MAX_PER_TYPE of one kind and MAX_OPPORTUNITIES
 * in all. Views decide ties for everyone — never revenue — so the order says nothing about
 * amounts a member may not see.
 */
export function pickWorkspaceOpportunities(
  perVideo: ReadonlyArray<{ video: VideoRef & { views: number }; result: OpportunityResult }>,
): Pick<CommandCenterResponse["data"], "opportunities" | "gettingStarted"> {
  const all = perVideo.flatMap(({ video, result }) =>
    result.opportunities.map((opportunity) => ({ opportunity, video })),
  );
  all.sort(
    (a, b) =>
      PRIORITY[a.opportunity.priority] - PRIORITY[b.opportunity.priority] ||
      b.video.views - a.video.views ||
      a.video.youtubeVideoId.localeCompare(b.video.youtubeVideoId),
  );
  const perType = new Map<string, number>();
  const opportunities: CommandCenterResponse["data"]["opportunities"] = [];
  for (const { opportunity, video } of all) {
    if (opportunities.length >= MAX_OPPORTUNITIES) break;
    const used = perType.get(opportunity.type) ?? 0;
    if (used >= MAX_PER_TYPE) continue;
    perType.set(opportunity.type, used + 1);
    opportunities.push({
      ...opportunity,
      video: { youtubeVideoId: video.youtubeVideoId, title: video.title },
    });
  }

  // Setup steps: each kind once. "Start measuring viewer interest" is about one video — the most
  // viewed one that needs it — and is left out when a performance opportunity already asks for a
  // tracked link; the other two are about the workspace, not a video.
  const byViews = [...perVideo].sort(
    (a, b) =>
      b.video.views - a.video.views || a.video.youtubeVideoId.localeCompare(b.video.youtubeVideoId),
  );
  const linkAsked = opportunities.some((o) =>
    ["add_tracked_link", "links_without_clicks", "review_link_offer"].includes(o.type),
  );
  const gettingStarted: CommandCenterResponse["data"]["gettingStarted"] = [];
  for (const type of [
    "track_viewer_interest",
    "explore_lead_capture",
    "prepare_sponsorship_attribution",
  ] as const) {
    if (type === "track_viewer_interest" && linkAsked) continue;
    for (const { video, result } of byViews) {
      const step = result.gettingStarted.find((s) => s.type === type);
      if (!step) continue;
      gettingStarted.push({
        ...step,
        video:
          type === "track_viewer_interest"
            ? { youtubeVideoId: video.youtubeVideoId, title: video.title }
            : null,
      });
      break;
    }
  }
  return { opportunities, gettingStarted };
}

// ---------- reads ----------

const CHUNK = 100;
const chunks = <T>(items: readonly T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK),
  );

type Client = WorkspaceContext["client"];

async function readLinks(
  client: Client,
  workspaceId: string,
  period: { from: string; to: string },
) {
  const links = await readAllRows<{ id: string; video_id: string | null }>((from, to) =>
    client
      .from("tracking_links")
      .select("id, video_id")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  // Clicks in the period: an exact count first (a number, no rows) …
  let clicks = 0;
  for (const group of chunks(links.map((l) => l.id))) {
    const { count, error } = await client
      .from("link_click_events")
      .select("id", { count: "exact", head: true })
      .in("link_id", group)
      .gte("clicked_at", period.from)
      .lte("clicked_at", period.to);
    if (error || count === null) throw new PagedReadError(error?.code);
    clicks += count;
  }
  // … then, unless there are too many to read, each click's video (as recorded on the click).
  let perVideo: Map<string, number> | null = null;
  if (clicks <= MAX_CLICK_EVENTS) {
    perVideo = new Map();
    for (const group of chunks(links.map((l) => l.id))) {
      const events = await readAllRows<{ id: number; video_id: string | null }>((from, to) =>
        client
          .from("link_click_events")
          .select("id, video_id")
          .in("link_id", group)
          .gte("clicked_at", period.from)
          .lte("clicked_at", period.to)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const event of events)
        if (event.video_id) perVideo.set(event.video_id, (perVideo.get(event.video_id) ?? 0) + 1);
    }
  }
  return { links, clicks, perVideo };
}

async function readDeals(client: Client, workspaceId: string) {
  const deals = await readAllRows<{ id: string; stage: string; currency: string | null }>(
    (from, to) =>
      client
        .from("deals")
        .select("id, stage, currency")
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .range(from, to),
  );
  const links = await readAllRows<{ deal_id: string; video_id: string }>((from, to) =>
    client
      .from("deal_videos")
      .select("deal_id, video_id")
      .eq("workspace_id", workspaceId)
      .order("deal_id", { ascending: true })
      .order("video_id", { ascending: true })
      .range(from, to),
  );
  return { deals, links };
}

// ---------- the whole answer ----------

/** The two revenue readers (replaceable in tests, to show they run side by side). */
export interface CommandCenterRevenueReaders {
  buildRevenueSummary: typeof buildRevenueSummary;
  buildRevenueVideos: typeof buildRevenueVideos;
}

const REVENUE_READERS: CommandCenterRevenueReaders = { buildRevenueSummary, buildRevenueVideos };

/**
 * YouTube: the channel-level total and every video, over the same period as the video pages.
 * The two reads are independent (same caller, same period, same day; neither changes anything the
 * other reads), so they run side by side. A failure of either fails the whole answer, as when they
 * ran one after the other: without them nothing else in the command center means anything.
 */
export async function readYoutubeRevenue(
  readCtx: Parameters<typeof buildRevenueSummary>[0],
  days: LinkActivityDays,
  today: string,
  readers: CommandCenterRevenueReaders = REVENUE_READERS,
) {
  const query: RevenueVideosQuery = {
    ...resolveRevenuePeriod({ days }, today),
    channelId: null,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
    sort: "views",
    direction: "desc",
    videoIds: null,
  };
  const [summary, revenue] = await Promise.all([
    readers.buildRevenueSummary(
      readCtx,
      parseRevenueSummaryQuery(new URL(`https://local.invalid/?days=${days}`), today),
      { today, includeDeals: false },
    ),
    readers.buildRevenueVideos(readCtx, query, { today }),
  ]);
  return { summary, revenue };
}

export async function loadCommandCenter(
  ctx: WorkspaceContext,
  days: LinkActivityDays,
  now: Date,
): Promise<CommandCenterResponse> {
  const today = now.toISOString().slice(0, 10);
  const access = await resolveRevenueAccess(ctx);
  const visible = access.canView;
  const readCtx = {
    client: ctx.client,
    workspaceId: ctx.workspaceId,
    revenue: revenueReadMode(access),
  };

  const [linksFeature, dealsFeature, leadFeature] = await Promise.all([
    workspaceFeatureStatus(ctx, "link_tracking"),
    workspaceFeatureStatus(ctx, "brand_deals"),
    workspaceFeatureStatus(ctx, "freebie"),
  ]);

  const { summary, revenue } = await readYoutubeRevenue(readCtx, days, today);
  const period = { days, startDate: revenue.period.startDate, endDate: revenue.period.endDate };
  const youtubeRevenue = summary.earned.revenue;
  const youtube: CommandCenterResponse["data"]["youtube"] = {
    revenue: visible ? youtubeRevenue.usd : null,
    availability: !visible
      ? "hidden"
      : (youtubeRevenue.availability as "available" | "partial" | "unavailable"),
    views: summary.earned.views,
  };

  // Tracked links (link tracking only).
  const clickPeriod = linkActivityPeriod(days, now);
  let links: CommandCenterResponse["data"]["links"] = { status: "restricted" };
  let linksPerVideo: Map<string, number> | null = null;
  let clicksPerVideo: Map<string, number> | null = null;
  if (linksFeature === "enabled") {
    try {
      const read = await readLinks(ctx.client, ctx.workspaceId, clickPeriod);
      linksPerVideo = new Map();
      for (const link of read.links)
        if (link.video_id)
          linksPerVideo.set(link.video_id, (linksPerVideo.get(link.video_id) ?? 0) + 1);
      clicksPerVideo = read.perVideo;
      links = {
        status: "checked",
        links: read.links.length,
        linksOnVideos: read.links.filter((l) => l.video_id).length,
        videosWithLinks: linksPerVideo.size,
        clicks: read.clicks,
        period: { startDate: clickPeriod.startDate, endDate: clickPeriod.endDate },
      };
    } catch {
      links = { status: "unavailable" };
    }
  }

  // Sponsorships (brand deals only). Stages and links on the caller's session; amounts only
  // through the MoneyReader.
  let sponsorships: CommandCenterResponse["data"]["sponsorships"] = { status: "restricted" };
  let dealsPerVideo: Map<string, { any: number; contracted: number }> | null = null;
  let unlinkedContracted = 0;
  if (dealsFeature === "enabled") {
    try {
      const read = await readDeals(ctx.client, ctx.workspaceId);
      const stageOf = new Map(read.deals.map((d) => [d.id, d.stage]));
      const linked = new Set(read.links.map((l) => l.deal_id));
      dealsPerVideo = new Map();
      for (const link of read.links) {
        const entry = dealsPerVideo.get(link.video_id) ?? { any: 0, contracted: 0 };
        entry.any += 1;
        if (FINANCIAL.has(stageOf.get(link.deal_id) ?? "")) entry.contracted += 1;
        dealsPerVideo.set(link.video_id, entry);
      }
      unlinkedContracted = read.deals.filter(
        (d) => FINANCIAL.has(d.stage) && !linked.has(d.id),
      ).length;
      let values: Map<string, number | null> | null = null;
      if (visible && access.money) {
        values = new Map();
        const ids = read.deals.filter((d) => FINANCIAL.has(d.stage)).map((d) => d.id);
        for (const group of chunks(ids))
          for (const [id, value] of await access.money.dealValues(group)) values.set(id, value);
      }
      sponsorships = {
        status: "checked",
        byCurrency: sponsorshipsByCurrency(read.deals, linked, values),
        payments: { tracked: false },
      };
    } catch {
      sponsorships = { status: "unavailable" };
    }
  }

  let workspaceHasLeadMagnet: boolean | null = null;
  if (leadFeature === "enabled") {
    const { data, error } = await ctx.client
      .from("lead_magnets")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .limit(1);
    workspaceHasLeadMagnet = error ? null : (data ?? []).length > 0;
  }

  // The existing rules, once per video, with the inputs its own page would build. The workspace
  // list is built once and the comparisons in it sorted once (the same for every video); only
  // "which one is this video" changes from call to call. Without that, every call would filter
  // and sort the whole workspace again — time growing with the square of the number of videos.
  const items = revenue.videos.filter((v) => v.youtubeVideoId);
  const workspace = revenue.videos.map((v) => ({
    isThisVideo: false,
    views: v.views,
    rpm: visible ? v.rpm : null,
    availability: v.dataQuality.availability,
  }));
  const shared = workspaceComparisons(workspace);
  const entryOf = new Map(revenue.videos.map((v, i) => [v, workspace[i]]));
  const perVideo = items.map((item) => {
    const own = entryOf.get(item)!;
    const inputs: OpportunityInputs = {
      youtubeVideoId: item.youtubeVideoId as string,
      periodDays: days,
      video: {
        views: item.views,
        rpm: visible ? item.rpm : null,
        availability: item.dataQuality.availability,
      },
      workspace,
      revenueVisible: visible,
      links:
        linksFeature !== "enabled"
          ? { status: "restricted" }
          : !linksPerVideo || !clicksPerVideo
            ? { status: "unavailable" }
            : {
                status: "checked",
                currentLinks: linksPerVideo.get(item.videoId) ?? 0,
                clicks: clicksPerVideo.get(item.videoId) ?? 0,
              },
      deals:
        dealsFeature !== "enabled"
          ? { status: "restricted" }
          : !dealsPerVideo
            ? { status: "unavailable" }
            : {
                status: "checked",
                linkedContracted: dealsPerVideo.get(item.videoId)?.contracted ?? 0,
                linkedAny: dealsPerVideo.get(item.videoId)?.any ?? 0,
                unlinkedContracted: access.canWrite ? unlinkedContracted : 0,
                canLink: access.canWrite,
              },
      setup: {
        linkTracking: linksFeature === "enabled",
        leadCapture: { enabled: leadFeature === "enabled", workspaceHasLeadMagnet },
        brandDeals: dealsFeature === "enabled",
      },
    };
    // Marked for this call only: the rules read the list synchronously and keep no reference.
    own.isThisVideo = true;
    let result: OpportunityResult;
    try {
      result = evaluateOpportunities(inputs, shared);
    } finally {
      own.isThisVideo = false;
    }
    return {
      item,
      video: {
        youtubeVideoId: item.youtubeVideoId as string,
        title: item.title,
        views: item.views,
      },
      result,
    };
  });

  const picked = pickWorkspaceOpportunities(perVideo);
  const videos: CommandCenterVideo[] = [...perVideo]
    .sort(
      (a, b) =>
        b.item.views - a.item.views || a.video.youtubeVideoId.localeCompare(b.video.youtubeVideoId),
    )
    .slice(0, MAX_VIDEOS)
    .map(({ item, video, result }) => ({
      youtubeVideoId: video.youtubeVideoId,
      title: item.title,
      views: item.views,
      revenue: visible ? item.revenue.usd : null,
      revenueAvailability: item.dataQuality.availability,
      trackedLinks: linksPerVideo ? (linksPerVideo.get(item.videoId) ?? 0) : null,
      clicks: clicksPerVideo ? (clicksPerVideo.get(item.videoId) ?? 0) : null,
      linkedDeals: dealsPerVideo ? (dealsPerVideo.get(item.videoId)?.any ?? 0) : null,
      opportunities: result.opportunities.length,
    }));

  return {
    data: {
      status: summary.status,
      period,
      youtube,
      sponsorships,
      links,
      ...picked,
      videos,
      videoCount: items.length,
    },
    visibility: visible ? REVENUE_VISIBLE : REVENUE_HIDDEN,
  };
}
