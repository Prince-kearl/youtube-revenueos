// Tracked-link activity for ONE video: which tracked links are on it now, and the clicks that
// were recorded for it in a period.
//
//   video (public YouTube id)  →  the workspace's own video row
//     →  tracking_links.video_id       the links CURRENTLY on the video
//     →  link_click_events.video_id    the clicks ATTRIBUTED to the video when they were made
//
// These are two different facts and are never derived from one another. A click belongs to the
// video recorded ON THE CLICK (the redirect copies it from the link at that moment), so pointing
// a link at another video later moves none of its earlier clicks: they stay with this video and
// are reported under "links no longer on this video".
//
// Everything here is ACTIVITY. Nothing in this file reads, returns or infers money: a click is
// not a sale, and no table connects a click to a commission or a payment.
//
// Counting.
//   * clicks           one per click event.
//   * unique visitors  distinct `privacy_id` (the redirect's one-year cookie), counted ACROSS the
//                      video — a visitor who used two of its links is one visitor. Clicks with no
//                      visitor id count as clicks and towards no visitor, the same convention as
//                      the tracking_link_stats view (count(distinct privacy_id) ignores NULL).
//   * the total is the sum of the links' clicks plus the "no longer on this video" clicks.
//
// Completeness. The database API returns at most a fixed number of rows per request, so every
// row read is paged (lib/server/paged-read.ts) and a failed page fails the whole request. The
// number of clicks is first taken as an exact count — a number, no rows — and the per-visitor
// read is refused above MAX_CLICK_EVENTS rather than left running or cut short: the response
// then carries the exact click total and says, explicitly, that the breakdown is unavailable.
//
// Period. Clicks are timestamped in UTC as they happen, with no reporting delay; YouTube's
// revenue is reported per Pacific-time day, a few days late. The period here is the last `days`
// UTC calendar days, today included, and the response states its exact bounds so the page can
// print them instead of implying it is the same window as the revenue figures.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PagedReadError, readAllRows } from "./paged-read";

export const LINK_ACTIVITY_DAYS = [90, 180, 365] as const;
export type LinkActivityDays = (typeof LINK_ACTIVITY_DAYS)[number];

/** Above this many clicks in the period the per-visitor read is not attempted. */
export const MAX_CLICK_EVENTS = 50_000;

const querySchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  days: z.coerce
    .number()
    .refine((value): value is LinkActivityDays =>
      (LINK_ACTIVITY_DAYS as readonly number[]).includes(value),
    ),
});

export interface LinkActivityQuery {
  youtubeVideoId: string;
  days: LinkActivityDays;
}

export class LinkActivityValidationError extends Error {}

/** A read failed. No partial figures are returned. */
export class LinkActivityReadError extends Error {
  constructor(readonly operation: string) {
    super(`VIDEO_LINK_ACTIVITY:${operation}`);
  }
}

export function parseLinkActivityQuery(url: URL): LinkActivityQuery {
  const parsed = querySchema.safeParse({
    videoId: url.searchParams.get("videoId"),
    days: url.searchParams.get("days"),
  });
  if (!parsed.success) throw new LinkActivityValidationError();
  return { youtubeVideoId: parsed.data.videoId, days: parsed.data.days };
}

export interface LinkActivityPeriod {
  days: LinkActivityDays;
  /** First and last UTC calendar day covered (the last is today). */
  startDate: string;
  endDate: string;
  /** The exact instants counted: `from` is 00:00 UTC on startDate, `to` is the time of the request. */
  from: string;
  to: string;
  timezone: "UTC";
}

/** The last `days` UTC calendar days, today included. */
export function linkActivityPeriod(days: LinkActivityDays, now: Date): LinkActivityPeriod {
  const endDate = now.toISOString().slice(0, 10);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    days,
    startDate: start.toISOString().slice(0, 10),
    endDate,
    from: start.toISOString(),
    to: now.toISOString(),
    timezone: "UTC",
  };
}

export interface LinkActivityLink {
  id: string;
  slug: string;
  status: string;
  destination: { name: string; url: string } | null;
  /** Clicks made through this link, attributed to this video, in the period. Null when the
   * breakdown is unavailable. */
  clicks: number | null;
  uniqueVisitors: number | null;
}

export interface VideoLinkActivity {
  period: LinkActivityPeriod;
  /** "complete": every figure below is exact. "unavailable": only `totals.clicks` is known (too
   * many clicks in the period to count visitors here) — every other figure is null, not zero. */
  breakdown: "complete" | "unavailable";
  totals: {
    /** Clicks attributed to this video in the period. */
    clicks: number;
    /** Distinct visitors across the whole video in the period. */
    uniqueVisitors: number | null;
    /** Clicks that carried no visitor id: counted as clicks, towards no visitor. */
    clicksWithoutVisitorId: number | null;
  };
  /** The tracked links on this video NOW, newest first. */
  links: LinkActivityLink[];
  /** Clicks attributed to this video from links that are no longer on it. */
  formerLinks: { links: number; clicks: number; uniqueVisitors: number } | null;
  limits: { maxClickEvents: number };
}

/** What GET /api/videos/link-activity returns: the activity, with each link's short URL. */
export type VideoLinkActivityResponse = Omit<VideoLinkActivity, "links"> & {
  links: Array<LinkActivityLink & { shortUrl: string }>;
};

interface LinkRow {
  id: string;
  slug: string;
  status: string;
  video_id: string | null;
  destination_id: string;
  created_at: string;
}
interface ClickRow {
  link_id: string;
  privacy_id: string | null;
}

const CHUNK = 100;
const chunks = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) =>
    items.slice(index * CHUNK, (index + 1) * CHUNK),
  );

async function paged<T>(
  operation: string,
  readPage: Parameters<typeof readAllRows>[0],
): Promise<T[]> {
  try {
    return await readAllRows<T>(readPage);
  } catch (error) {
    if (!(error instanceof PagedReadError)) throw error;
    console.error("Video link activity read failed", { operation, code: error.code });
    throw new LinkActivityReadError(operation);
  }
}

function emptyActivity(period: LinkActivityPeriod): VideoLinkActivity {
  return {
    period,
    breakdown: "complete",
    totals: { clicks: 0, uniqueVisitors: 0, clicksWithoutVisitorId: 0 },
    links: [],
    formerLinks: null,
    limits: { maxClickEvents: MAX_CLICK_EVENTS },
  };
}

/**
 * Link activity for the caller's own video.
 *
 * `client` is the caller's own session and `workspaceId` their active membership — both from
 * the server's authentication, never from the request. Every read is filtered by that workspace
 * (and row-level security applies underneath), so a video id that is unknown, or belongs to
 * another workspace, resolves to nothing and gets exactly the answer of a video with no links.
 */
export async function loadVideoLinkActivity(
  client: SupabaseClient,
  workspaceId: string,
  query: LinkActivityQuery,
  now: Date = new Date(),
): Promise<VideoLinkActivity> {
  const period = linkActivityPeriod(query.days, now);

  // The video, within the workspace's own channels.
  const channels = await paged<{ id: string }>("READ_CHANNELS", (from, to) =>
    client
      .from("youtube_channels")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (channels.length === 0) return emptyActivity(period);
  const videos = await paged<{ id: string; channel_id: string }>("READ_VIDEO", (from, to) =>
    client
      .from("videos")
      .select("id, channel_id")
      .eq("youtube_video_id", query.youtubeVideoId)
      .in(
        "channel_id",
        channels.map((channel) => channel.id),
      )
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (videos.length === 0) return emptyActivity(period);
  const videoIds = videos.map((video) => video.id);
  // A click carries its video's channel as well (the redirect, and the historical backfill, set
  // the two together, and a video never changes channel). Filtering on both lets the click reads
  // use the existing (channel_id, video_id, clicked_at) index.
  const videoChannelIds = [...new Set(videos.map((video) => video.channel_id))];
  const isThisVideo = (id: string | null) => id !== null && videoIds.includes(id);

  // The links on the video now.
  const linkColumns = "id, slug, status, video_id, destination_id, created_at";
  const currentLinks = await paged<LinkRow>("READ_LINKS", (from, to) =>
    client
      .from("tracking_links")
      .select(linkColumns)
      .eq("workspace_id", workspaceId)
      .in("video_id", videoIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );

  // How many clicks the period holds: an exact count, no rows.
  const counted = await client
    .from("link_click_events")
    .select("id", { count: "exact", head: true })
    .in("channel_id", videoChannelIds)
    .in("video_id", videoIds)
    .gte("clicked_at", period.from)
    .lte("clicked_at", period.to);
  if (counted.error || typeof counted.count !== "number") {
    console.error("Video link activity read failed", {
      operation: "COUNT_CLICKS",
      code: counted.error?.code,
    });
    throw new LinkActivityReadError("COUNT_CLICKS");
  }

  const destinationsOf = async (links: LinkRow[]) => {
    const ids = [...new Set(links.map((link) => link.destination_id))];
    const rows: Array<{ id: string; name: string; url: string }> = [];
    for (const chunk of chunks(ids))
      rows.push(
        ...(await paged<{ id: string; name: string; url: string }>(
          "READ_DESTINATIONS",
          (from, to) =>
            client
              .from("destinations")
              .select("id, name, url")
              .eq("workspace_id", workspaceId)
              .in("id", chunk)
              .order("id", { ascending: true })
              .range(from, to),
        )),
      );
    return new Map(rows.map((row) => [row.id, { name: row.name, url: row.url }]));
  };
  const destinations = await destinationsOf(currentLinks);
  const describe = (link: LinkRow, clicks: number | null, uniqueVisitors: number | null) => ({
    id: link.id,
    slug: link.slug,
    status: link.status,
    destination: destinations.get(link.destination_id) ?? null,
    clicks,
    uniqueVisitors,
  });

  if (counted.count > MAX_CLICK_EVENTS)
    return {
      period,
      breakdown: "unavailable",
      totals: { clicks: counted.count, uniqueVisitors: null, clicksWithoutVisitorId: null },
      links: currentLinks.map((link) => describe(link, null, null)),
      formerLinks: null,
      limits: { maxClickEvents: MAX_CLICK_EVENTS },
    };

  // Every click attributed to the video in the period: its link and its visitor, nothing else.
  // Ordered by the primary key so pages never overlap or skip.
  const clicks =
    counted.count === 0
      ? []
      : await paged<ClickRow>("READ_CLICKS", (from, to) =>
          client
            .from("link_click_events")
            .select("link_id, privacy_id")
            .in("channel_id", videoChannelIds)
            .in("video_id", videoIds)
            .gte("clicked_at", period.from)
            .lte("clicked_at", period.to)
            .order("id", { ascending: true })
            .range(from, to),
        );

  // The links those clicks came through that are not on the video any more — looked up within
  // the workspace, so a click whose link is not this workspace's is counted nowhere.
  const current = new Map(currentLinks.map((link) => [link.id, link]));
  const otherIds = [...new Set(clicks.map((click) => click.link_id))].filter(
    (id) => !current.has(id),
  );
  const former = new Set<string>();
  for (const chunk of chunks(otherIds)) {
    const rows = await paged<LinkRow>("READ_FORMER_LINKS", (from, to) =>
      client
        .from("tracking_links")
        .select(linkColumns)
        .eq("workspace_id", workspaceId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) if (!isThisVideo(row.video_id)) former.add(row.id);
  }

  const tally = () => ({ clicks: 0, visitors: new Set<string>() });
  const perLink = new Map<string, ReturnType<typeof tally>>();
  const formerTally = tally();
  const all = tally();
  let withoutVisitorId = 0;
  for (const click of clicks) {
    const bucket = current.has(click.link_id)
      ? (perLink.get(click.link_id) ?? perLink.set(click.link_id, tally()).get(click.link_id)!)
      : former.has(click.link_id)
        ? formerTally
        : null;
    if (!bucket) continue;
    bucket.clicks += 1;
    all.clicks += 1;
    if (click.privacy_id) {
      bucket.visitors.add(click.privacy_id);
      all.visitors.add(click.privacy_id);
    } else withoutVisitorId += 1;
  }

  return {
    period,
    breakdown: "complete",
    totals: {
      clicks: all.clicks,
      uniqueVisitors: all.visitors.size,
      clicksWithoutVisitorId: withoutVisitorId,
    },
    links: currentLinks.map((link) =>
      describe(link, perLink.get(link.id)?.clicks ?? 0, perLink.get(link.id)?.visitors.size ?? 0),
    ),
    formerLinks:
      formerTally.clicks > 0
        ? {
            links: former.size,
            clicks: formerTally.clicks,
            uniqueVisitors: formerTally.visitors.size,
          }
        : null,
    limits: { maxClickEvents: MAX_CLICK_EVENTS },
  };
}
