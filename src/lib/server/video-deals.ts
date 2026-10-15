// Brand deals linked to ONE video, and how much of each deal's contracted value is attributed to
// it (Phase 2B-2).
//
//   video (public YouTube id)  →  the workspace's own video row(s)
//     →  deal_videos               the deals linked to it
//     →  deals                     name, stage, currency (never the value — see below)
//     →  deal_videos (per deal)    every video each deal is linked to, for the split
//
// Attribution. A deal's value is split EQUALLY across all the videos it is linked to, in integer
// cents: each video gets floor(cents / n), and the first `cents mod n` videos — ordered by when
// they were linked, then by video id — get one cent more. So the shares always add up exactly to
// the deal's value and the same links always give the same shares. Nothing is stored: the split
// is computed here on every read, so it cannot drift from the deal.
//
// What counts. Only deals in a financial stage ("contracted" or "completed") carry an attributed
// amount; deals still in the pipeline are listed with their name and stage and no amount. A
// contracted amount is what was AGREED — "completed" is a pipeline stage, not a payment, and
// nothing here knows whether any money was received. Currencies are never combined or converted.
//
// Money. A deal's value is not readable on a member's session at all. It is read only through
// the caller's MoneyReader, which exists only for a caller who may see revenue and is bound to
// their workspace. For anyone else every amount is null — hidden, never zero.
//
// Isolation. Every query is filtered by the caller's workspace explicitly, on top of row-level
// security. A video id that is unknown or belongs to another workspace gets exactly the answer a
// video of the caller's own with no deals gets.
//
// Completeness. Every read is paged until an empty page (lib/server/paged-read.ts), and long id
// lists are sent in chunks, so nothing is silently cut short; a failed read fails the request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PagedReadError, readAllRows } from "./paged-read";
import type { RevenueAccess } from "./revenue-visibility";
import {
  REVENUE_HIDDEN,
  REVENUE_VISIBLE,
  isFinancialDealStage,
  type RevenueVisibilityMarker,
} from "@/lib/revenue-visibility";

// ---------- input ----------

const youtubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

/** POST body. Strict: anything else (a workspace, a value, a share…) fails validation. */
export const linkBodySchema = z
  .object({ videoId: youtubeVideoId, dealId: z.string().uuid() })
  .strict();

export class VideoDealsValidationError extends Error {}

/** A read failed. No partial figures are returned. */
export class VideoDealsReadError extends Error {
  constructor(readonly operation: string) {
    super(`VIDEO_DEALS:${operation}`);
  }
}

/** The YouTube video id of a GET (`?videoId=`). */
export function parseVideoQuery(url: URL): string {
  const parsed = youtubeVideoId.safeParse(url.searchParams.get("videoId"));
  if (!parsed.success) throw new VideoDealsValidationError();
  return parsed.data;
}

/** The video and deal of a DELETE (`?videoId=&dealId=`). */
export function parseLinkQuery(url: URL): { videoId: string; dealId: string } {
  const parsed = z.object({ videoId: youtubeVideoId, dealId: z.string().uuid() }).safeParse({
    videoId: url.searchParams.get("videoId"),
    dealId: url.searchParams.get("dealId"),
  });
  if (!parsed.success) throw new VideoDealsValidationError();
  return parsed.data;
}

// ---------- money arithmetic (integer cents) ----------

/** The largest deal value the deals API accepts (api.deals.ts), in cents. */
export const MAX_DEAL_CENTS = 100_000_000 * 100;

/**
 * A stored deal value (numeric(14,2), which the API returns as a number or a numeric string) in
 * integer cents, or null when it is not a valid amount. Never guesses: anything negative, not
 * finite, or beyond what the column can hold is null.
 */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const cents = Math.round(number * 100);
  // numeric(14,2): at most 12 digits before the point.
  return Number.isSafeInteger(cents) && cents < 1e14 ? cents : null;
}

/** Integer cents as an amount with at most two decimals (3334 → 33.34). */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

export interface LinkRow {
  deal_id: string;
  video_id: string;
  created_at: string;
}

/** A timestamp as microseconds since the epoch, keeping the database's sub-millisecond digits
 * (which Date would drop), so links made in the same millisecond still order correctly. */
function microseconds(timestamp: string): number {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return Number.MAX_SAFE_INTEGER;
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? "";
  const sub = Number((fraction + "000000").slice(3, 6));
  return ms * 1000 + sub;
}

/** Links in the order the remainder cents are given out: linked first, then by video id. */
export function inAllocationOrder<T extends { video_id: string; created_at: string }>(
  links: readonly T[],
): T[] {
  return [...links].sort((a, b) => {
    const byTime = microseconds(a.created_at) - microseconds(b.created_at);
    if (byTime !== 0) return byTime;
    return a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0;
  });
}

/**
 * Splits `totalCents` equally across `links` (one per video): every video gets
 * floor(total / n) cents and the first `total mod n` in allocation order get one more. The
 * result always adds up to exactly `totalCents`.
 */
export function allocateEqualCents(
  totalCents: number,
  links: readonly { video_id: string; created_at: string }[],
): Map<string, number> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0)
    throw new RangeError("allocateEqualCents: total must be a non-negative integer of cents");
  const shares = new Map<string, number>();
  const ordered = inAllocationOrder(links);
  const count = ordered.length;
  if (count === 0) return shares;
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  ordered.forEach((link, index) => shares.set(link.video_id, base + (index < remainder ? 1 : 0)));
  return shares;
}

// ---------- the response ----------

export type DealStage = "prospect" | "pitched" | "negotiating" | "contracted" | "completed";

export type DealAttribution =
  /** This video's equal share of the deal's contracted value. */
  | { status: "contracted"; amount: number }
  /** A pipeline deal: listed, but no amount is attributed. */
  | { status: "not_contracted" }
  /** The caller may not see amounts. */
  | { status: "hidden" };

export interface VideoDealView {
  id: string;
  name: string;
  stage: DealStage;
  /** Three-letter code as stored (trimmed, upper-case), or "UNKNOWN". */
  currency: string;
  /** How many videos the deal is linked to in total — the divisor of the split. */
  linkedVideoCount: number;
  /** When this video was linked to the deal. */
  linkedAt: string;
  /** The deal's whole contracted value; null when hidden from the caller. */
  dealValue: number | null;
  attribution: DealAttribution;
}

export interface VideoDealsPayload {
  /** The linked deals, in the order they were linked to this video. */
  deals: VideoDealView[];
  /** Attributed contracted value per currency (contracted and completed deals only); null when
   * hidden from the caller, an empty list when no linked deal is contracted. */
  contractedByCurrency: Array<{ currency: string; amount: number; dealCount: number }> | null;
  /** Payments are not tracked: nothing here is money received or paid. */
  payments: { tracked: false };
  /** Deals are not limited to the page's date range. */
  period: { filtered: false };
}

export interface VideoDealsResponse {
  data: VideoDealsPayload;
  visibility: RevenueVisibilityMarker;
  permissions: { canLink: boolean };
}

export function emptyVideoDeals(access: Pick<RevenueAccess, "canView">): VideoDealsPayload {
  return {
    deals: [],
    contractedByCurrency: access.canView ? [] : null,
    payments: { tracked: false },
    period: { filtered: false },
  };
}

export function videoDealsResponse(
  payload: VideoDealsPayload,
  access: Pick<RevenueAccess, "canView" | "canWrite">,
): VideoDealsResponse {
  return {
    data: payload,
    visibility: access.canView ? REVENUE_VISIBLE : REVENUE_HIDDEN,
    permissions: { canLink: access.canWrite },
  };
}

// ---------- reads ----------

/** Ids per `in (…)` filter, so a request URL never grows without bound. */
const IN_CHUNK = 100;

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

async function paged<T>(
  operation: string,
  readPage: Parameters<typeof readAllRows>[0],
): Promise<T[]> {
  try {
    return await readAllRows<T>(readPage);
  } catch (error) {
    if (error instanceof PagedReadError) throw new VideoDealsReadError(operation);
    throw error;
  }
}

/** The caller's own video rows for a YouTube video id: only rows on the workspace's channels. */
export async function resolveWorkspaceVideoIds(
  client: SupabaseClient,
  workspaceId: string,
  youtubeVideoId: string,
): Promise<string[]> {
  const channels = await paged<{ id: string }>("READ_CHANNELS", (from, to) =>
    client
      .from("youtube_channels")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const videoIds: string[] = [];
  for (const group of chunks(channels.map((channel) => channel.id))) {
    const videos = await paged<{ id: string }>("READ_VIDEO", (from, to) =>
      client
        .from("videos")
        .select("id")
        .eq("youtube_video_id", youtubeVideoId)
        .in("channel_id", group)
        .order("id", { ascending: true })
        .range(from, to),
    );
    videoIds.push(...videos.map((video) => video.id));
  }
  return [...new Set(videoIds)].sort();
}

/** Whether `dealId` is a deal of the caller's workspace. Reads no value. */
export async function isWorkspaceDeal(
  client: SupabaseClient,
  workspaceId: string,
  dealId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new VideoDealsReadError("READ_DEAL");
  return data !== null;
}

interface DealRow {
  id: string;
  name: string;
  stage: DealStage;
  currency: string | null;
}

function normaliseCurrency(currency: string | null | undefined): string {
  return (currency ?? "").trim().toUpperCase() || "UNKNOWN";
}

/**
 * The deals linked to one of the caller's videos, with the attribution the caller may see.
 * Amounts come only from `access.money`.
 */
export async function loadVideoDeals(
  client: SupabaseClient,
  workspaceId: string,
  youtubeVideoId: string,
  access: Pick<RevenueAccess, "canView" | "money">,
): Promise<VideoDealsPayload> {
  const videoIds = await resolveWorkspaceVideoIds(client, workspaceId, youtubeVideoId);
  if (videoIds.length === 0) return emptyVideoDeals(access);
  const ownVideo = new Set(videoIds);

  // The links on this video.
  const videoLinks: LinkRow[] = [];
  for (const group of chunks(videoIds))
    videoLinks.push(
      ...(await paged<LinkRow>("READ_VIDEO_LINKS", (from, to) =>
        client
          .from("deal_videos")
          .select("deal_id, video_id, created_at")
          .eq("workspace_id", workspaceId)
          .in("video_id", group)
          .order("deal_id", { ascending: true })
          .order("video_id", { ascending: true })
          .range(from, to),
      )),
    );
  const dealIds = [...new Set(videoLinks.map((link) => link.deal_id))].sort();
  if (dealIds.length === 0) return emptyVideoDeals(access);

  // The deals (no value), and EVERY video each of them is linked to — the divisor of the split.
  const deals = new Map<string, DealRow>();
  const linksByDeal = new Map<string, LinkRow[]>();
  for (const group of chunks(dealIds)) {
    const rows = await paged<DealRow>("READ_DEALS", (from, to) =>
      client
        .from("deals")
        .select("id, name, stage, currency")
        .eq("workspace_id", workspaceId)
        .in("id", group)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) deals.set(row.id, row);
    const links = await paged<LinkRow>("READ_DEAL_LINKS", (from, to) =>
      client
        .from("deal_videos")
        .select("deal_id, video_id, created_at")
        .eq("workspace_id", workspaceId)
        .in("deal_id", group)
        .order("deal_id", { ascending: true })
        .order("video_id", { ascending: true })
        .range(from, to),
    );
    for (const link of links) {
      const list = linksByDeal.get(link.deal_id) ?? [];
      list.push(link);
      linksByDeal.set(link.deal_id, list);
    }
  }

  // Values, only for a caller who may see them.
  let values: Map<string, number | null> | null = null;
  if (access.canView && access.money) {
    values = new Map();
    try {
      for (const group of chunks(dealIds))
        for (const [id, value] of await access.money.dealValues(group)) values.set(id, value);
    } catch {
      throw new VideoDealsReadError("READ_DEAL_VALUES");
    }
  }

  const views: VideoDealView[] = [];
  const totals = new Map<string, { cents: number; dealCount: number }>();
  for (const dealId of dealIds) {
    const deal = deals.get(dealId);
    if (!deal) continue; // A link always has its deal (foreign key); nothing to show without it.
    const allLinks = linksByDeal.get(dealId) ?? [];
    const thisVideoLinks = allLinks.filter((link) => ownVideo.has(link.video_id));
    if (thisVideoLinks.length === 0) continue;
    const linkedAt = inAllocationOrder(thisVideoLinks)[0].created_at;
    const currency = normaliseCurrency(deal.currency);

    // A pipeline deal carries no attributed amount for anyone (its stage, which every caller
    // here can see, already says so). A contracted one carries an amount only for a caller who
    // may see it: for anyone else it is "hidden", never 0.
    let dealValue: number | null = null;
    let attribution: DealAttribution = isFinancialDealStage(deal.stage)
      ? { status: "hidden" }
      : { status: "not_contracted" };
    if (values) {
      const cents = toCents(values.get(dealId));
      // A deal always has a value (the column is NOT NULL); one that cannot be read as an amount
      // fails the request rather than being shown as something it is not.
      if (cents === null) throw new VideoDealsReadError("INVALID_DEAL_VALUE");
      dealValue = centsToAmount(cents);
      if (isFinancialDealStage(deal.stage)) {
        const shares = allocateEqualCents(cents, allLinks);
        const share = thisVideoLinks.reduce(
          (sum, link) => sum + (shares.get(link.video_id) ?? 0),
          0,
        );
        attribution = { status: "contracted", amount: centsToAmount(share) };
        const total = totals.get(currency) ?? { cents: 0, dealCount: 0 };
        total.cents += share;
        total.dealCount += 1;
        totals.set(currency, total);
      }
    }

    views.push({
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      currency,
      linkedVideoCount: allLinks.length,
      linkedAt,
      dealValue,
      attribution,
    });
  }

  views.sort(
    (a, b) => microseconds(a.linkedAt) - microseconds(b.linkedAt) || (a.id < b.id ? -1 : 1),
  );
  return {
    deals: views,
    contractedByCurrency: values
      ? [...totals.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, total]) => ({
            currency,
            amount: centsToAmount(total.cents),
            dealCount: total.dealCount,
          }))
      : null,
    payments: { tracked: false },
    period: { filtered: false },
  };
}

// ---------- writes (service role, after the route's checks) ----------

/** The database refused the link (it no longer passes the workspace check, or the deal or video
 * was deleted meanwhile). */
export class LinkRefusedError extends Error {}

/** A write failed for any other reason. */
export class VideoDealsWriteError extends Error {}

const REFUSED_CODES = new Set(["23514", "23503"]);

/**
 * Links a deal and a video of `workspaceId`. A repeat of an existing link changes nothing.
 * `workspaceId` and `userId` must come from the caller's membership, never from the request.
 */
export async function insertDealVideoLink(
  service: SupabaseClient,
  link: { dealId: string; videoId: string; workspaceId: string; userId: string },
): Promise<{ created: boolean }> {
  const { data, error } = await service
    .from("deal_videos")
    .upsert(
      {
        deal_id: link.dealId,
        video_id: link.videoId,
        workspace_id: link.workspaceId,
        created_by: link.userId,
      },
      { onConflict: "deal_id,video_id", ignoreDuplicates: true },
    )
    .select("deal_id");
  if (error) {
    if (REFUSED_CODES.has(error.code ?? "")) throw new LinkRefusedError();
    throw new VideoDealsWriteError();
  }
  return { created: Array.isArray(data) && data.length > 0 };
}

/** Removes the link between a deal and a video of `workspaceId`, if there is one. */
export async function deleteDealVideoLink(
  service: SupabaseClient,
  link: { dealId: string; videoId: string; workspaceId: string },
): Promise<{ removed: boolean }> {
  const { data, error } = await service
    .from("deal_videos")
    .delete()
    .eq("deal_id", link.dealId)
    .eq("video_id", link.videoId)
    .eq("workspace_id", link.workspaceId)
    .select("deal_id");
  if (error) throw new VideoDealsWriteError();
  return { removed: Array.isArray(data) && data.length > 0 };
}
