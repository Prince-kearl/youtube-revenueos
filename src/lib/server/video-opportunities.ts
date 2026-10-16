// Gathers the facts the revenue-opportunity rules (lib/revenue-opportunities.ts) need for one of
// the caller's videos, from the services the video page already uses — nothing is recalculated:
//
//   views, RPM, availability   buildRevenueVideos (stored YouTube data, this workspace, one period)
//   tracked links and clicks   loadVideoLinkActivity           (only with the link_tracking feature)
//   linked deals and stages    loadVideoDeals + deal_videos     (only with the brand_deals feature)
//
// Every read is the caller's own, scoped to their workspace; amounts are read only through the
// caller's MoneyReader (resolveRevenueAccess), so a caller who may not see revenue gets activity
// only and no rule that uses revenue. A part that cannot be read is reported as unavailable and
// its rules do not run — it never fails the whole answer, and never turns into a zero.

import type { WorkspaceContext } from "./workspace";
import { workspaceFeatureStatus } from "./workspace";
import { resolveRevenueAccess, revenueReadMode } from "./revenue-visibility";
import { buildRevenueVideos, type RevenueVideosQuery } from "./revenue-videos";
import { resolveRevenuePeriod } from "./revenue-summary";
import { loadVideoLinkActivity, type LinkActivityDays } from "./video-link-activity";
import { loadVideoDeals } from "./video-deals";
import { readAllRows } from "./paged-read";
import {
  evaluateOpportunities,
  type OpportunityInputs,
  type OpportunityResult,
} from "@/lib/revenue-opportunities";
import {
  REVENUE_HIDDEN,
  REVENUE_VISIBLE,
  type RevenueVisibilityMarker,
} from "@/lib/revenue-visibility";

export interface VideoOpportunitiesResponse {
  data: OpportunityResult & {
    period: { days: number; startDate: string; endDate: string };
  };
  visibility: RevenueVisibilityMarker;
}

const FINANCIAL_STAGES = new Set(["contracted", "completed"]);

/** Whether the workspace has any lead magnet (id only). */
async function workspaceHasLeadMagnet(
  client: WorkspaceContext["client"],
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("lead_magnets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);
  if (error) throw new Error("READ_LEAD_MAGNETS");
  return (data ?? []).length > 0;
}

/** Contracted or completed deals of the workspace that are linked to no video. Stages and ids
 * only — no value. */
async function unlinkedContractedDeals(
  client: WorkspaceContext["client"],
  workspaceId: string,
): Promise<number> {
  const deals = await readAllRows<{ id: string; stage: string }>((from, to) =>
    client
      .from("deals")
      .select("id, stage")
      .eq("workspace_id", workspaceId)
      .in("stage", [...FINANCIAL_STAGES])
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (deals.length === 0) return 0;
  const links = await readAllRows<{ deal_id: string; video_id: string }>((from, to) =>
    client
      .from("deal_videos")
      .select("deal_id, video_id")
      .eq("workspace_id", workspaceId)
      .order("deal_id", { ascending: true })
      .order("video_id", { ascending: true })
      .range(from, to),
  );
  const linked = new Set(links.map((link) => link.deal_id));
  return deals.filter((deal) => !linked.has(deal.id)).length;
}

export async function loadVideoOpportunities(
  ctx: WorkspaceContext,
  youtubeVideoId: string,
  days: LinkActivityDays,
  today: string,
): Promise<VideoOpportunitiesResponse> {
  const access = await resolveRevenueAccess(ctx);
  const readCtx = {
    client: ctx.client,
    workspaceId: ctx.workspaceId,
    revenue: revenueReadMode(access),
  };

  // Every video of the workspace over one period: this video's figures and the comparison set.
  // (A failure here fails the request: without it no rule can run.)
  const query: RevenueVideosQuery = {
    ...resolveRevenuePeriod({ days }, today),
    channelId: null,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
    sort: "views",
    direction: "desc",
    videoIds: null,
  };
  const revenue = await buildRevenueVideos(readCtx, query, { today });
  const item = revenue.videos.find((video) => video.youtubeVideoId === youtubeVideoId) ?? null;
  const visible = access.canView && revenue.visibility.revenue !== "hidden";

  const inputs: OpportunityInputs = {
    youtubeVideoId,
    periodDays: days,
    video: item
      ? {
          views: item.views,
          rpm: visible ? item.rpm : null,
          availability: item.dataQuality.availability,
        }
      : null,
    workspace: revenue.videos.map((video) => ({
      isThisVideo: video === item,
      views: video.views,
      rpm: visible ? video.rpm : null,
      availability: video.dataQuality.availability,
    })),
    revenueVisible: visible,
    links: { status: "insufficient_data" },
    deals: { status: "insufficient_data" },
    setup: {
      linkTracking: false,
      leadCapture: { enabled: false, workspaceHasLeadMagnet: null },
      brandDeals: false,
    },
  };

  // What the caller's role may use, and whether the workspace has a lead magnet: facts about the
  // role and the workspace, read the same way for any video id.
  const [linksFeature, dealsFeature, leadFeature] = await Promise.all([
    workspaceFeatureStatus(ctx, "link_tracking"),
    workspaceFeatureStatus(ctx, "brand_deals"),
    workspaceFeatureStatus(ctx, "freebie"),
  ]);
  let hasLeadMagnet: boolean | null = null;
  if (leadFeature === "enabled")
    hasLeadMagnet = await workspaceHasLeadMagnet(ctx.client, ctx.workspaceId).catch(() => null);
  inputs.setup = {
    linkTracking: linksFeature === "enabled",
    leadCapture: { enabled: leadFeature === "enabled", workspaceHasLeadMagnet: hasLeadMagnet },
    brandDeals: dealsFeature === "enabled",
  };
  if (linksFeature !== "enabled") inputs.links = { status: "restricted" };
  if (dealsFeature !== "enabled") inputs.deals = { status: "restricted" };

  // Only for a video of this workspace: an unknown or foreign id reads nothing about any video.
  if (item) {
    if (linksFeature !== "enabled") inputs.links = { status: "restricted" };
    else {
      try {
        const activity = await loadVideoLinkActivity(ctx.client, ctx.workspaceId, {
          youtubeVideoId,
          days,
        });
        inputs.links = {
          status: "checked",
          currentLinks: activity.links.length,
          clicks: activity.totals.clicks,
        };
      } catch {
        inputs.links = { status: "unavailable" };
      }
    }

    if (dealsFeature !== "enabled") inputs.deals = { status: "restricted" };
    else {
      try {
        // Stages only: the attribution amounts are not needed, so no MoneyReader is passed.
        const linked = await loadVideoDeals(ctx.client, ctx.workspaceId, youtubeVideoId, {
          canView: false,
          money: null,
        });
        const linkedContracted = linked.deals.filter((deal) =>
          FINANCIAL_STAGES.has(deal.stage),
        ).length;
        inputs.deals = {
          status: "checked",
          linkedContracted,
          linkedAny: linked.deals.length,
          unlinkedContracted:
            linked.deals.length === 0 && access.canWrite
              ? await unlinkedContractedDeals(ctx.client, ctx.workspaceId)
              : 0,
          canLink: access.canWrite,
        };
      } catch {
        inputs.deals = { status: "unavailable" };
      }
    }
  }

  return {
    data: {
      ...evaluateOpportunities(inputs),
      period: {
        days,
        startDate: revenue.period.startDate,
        endDate: revenue.period.endDate,
      },
    },
    visibility: visible ? REVENUE_VISIBLE : REVENUE_HIDDEN,
  };
}
