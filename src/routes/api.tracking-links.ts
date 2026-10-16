import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { resolveLinkOrigin, buildShortUrl } from "@/lib/server/short-links";
import { PagedReadError, readAllRows } from "@/lib/server/paged-read";
import { VideoDealsReadError, resolveWorkspaceVideoIds } from "@/lib/server/video-deals";

const createLinkSchema = z.object({
  destinationId: z.string().uuid(),
  videoId: z.string().uuid().nullable().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/i, "Use only letters, numbers, and dashes")
    .min(2)
    .max(40)
    .nullable()
    .optional(),
});

const updateLinkSchema = z.object({
  destinationId: z.string().uuid().optional(),
  videoId: z.string().uuid().nullable().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/i, "Use only letters, numbers, and dashes")
    .min(2)
    .max(40)
    .optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const idSchema = z.string().uuid();
/** A YouTube video id, as the video page uses it (`?video=` on GET). */
const youtubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

function withCookies(response: Response, setCookieHeaders: string[]) {
  return applySetCookies(response, setCookieHeaders);
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

function randomSlug(): string {
  return Math.random().toString(36).slice(2, 8);
}

type SupabaseClientLike = Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"];

/** The destination must belong to THIS workspace. Row-level security alone would also accept a
 * destination of another workspace the caller belongs to; such a destination gets the same 404 as
 * one that does not exist, and nothing about it is returned. */
async function assertOwnedDestination(
  client: SupabaseClientLike,
  workspaceId: string,
  destinationId: string,
) {
  const { data, error } = await client
    .from("destinations")
    .select("id")
    .eq("id", destinationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "DESTINATION_NOT_FOUND" }, { status: 404 });
}

/** The video must be on one of THIS workspace's channels. Row-level security alone would also
 * accept a video of another workspace the caller belongs to, which must never be attached to a
 * link of this one; such a video gets the same 404 as one that does not exist. */
async function assertOwnedVideo(client: SupabaseClientLike, workspaceId: string, videoId: string) {
  const { data: video, error } = await client
    .from("videos")
    .select("id, channel_id")
    .eq("id", videoId)
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!video) throw json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
  const { data: channel, error: channelError } = await client
    .from("youtube_channels")
    .select("id")
    .eq("id", video.channel_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (channelError) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!channel) throw json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
}

/**
 * The video page's context (`?video=<YouTube id>`): this workspace's own video with that id, or
 * null. An unknown id and another workspace's video are the same null — no title or other detail
 * of anything outside the workspace is ever returned.
 */
async function workspaceVideoContext(
  client: SupabaseClientLike,
  workspaceId: string,
  youtubeVideoId: string,
): Promise<{ id: string; youtubeVideoId: string; title: string } | null> {
  let ids: string[];
  try {
    ids = await resolveWorkspaceVideoIds(client, workspaceId, youtubeVideoId);
  } catch (error) {
    if (error instanceof VideoDealsReadError)
      throw json({ error: "DATABASE_ERROR" }, { status: 500 });
    throw error;
  }
  if (ids.length === 0) return null;
  const { data, error } = await client
    .from("videos")
    .select("id, title")
    .eq("id", ids[0])
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return data ? { id: data.id as string, youtubeVideoId, title: data.title as string } : null;
}

const linkColumns =
  "id, slug, status, clicks, created_at, updated_at, destination:destinations(id,name,url), video:videos(id,title)";

// Link ids per stats request: keeps the request URL short however many links there are.
const STATS_CHUNK = 100;

/**
 * Adds each link's unique-visitor count (distinct visitors, from tracking_link_stats — not the
 * same thing as `clicks`, the total).
 *
 * `strict`: a failed stats read throws PagedReadError instead of being shown as 0 unique
 * visitors. The list uses it; the response to a single edit keeps the earlier lenient behaviour,
 * because the edit itself has already succeeded by then.
 */
async function withStats(
  client: SupabaseClientLike,
  links: Record<string, unknown>[],
  options: { strict?: boolean } = {},
) {
  const ids = links.map((link) => link.id as string);
  if (ids.length === 0) return links;
  const stats: Record<string, unknown>[] = [];
  try {
    for (let start = 0; start < ids.length; start += STATS_CHUNK) {
      const chunk = ids.slice(start, start + STATS_CHUNK);
      stats.push(
        ...(await readAllRows<Record<string, unknown>>((from, to) =>
          client
            .from("tracking_link_stats")
            .select("link_id, total_clicks, unique_clicks")
            .in("link_id", chunk)
            .order("link_id", { ascending: true })
            .range(from, to),
        )),
      );
    }
  } catch (error) {
    if (options.strict || !(error instanceof PagedReadError)) throw error;
    stats.length = 0;
  }
  const byId = new Map(stats.map((row) => [row.link_id as string, row]));
  return links.map((link) => ({
    ...link,
    uniqueClicks: (byId.get(link.id as string)?.unique_clicks as number | undefined) ?? 0,
  }));
}

function withShortUrls(links: Record<string, unknown>[], origin: string) {
  return links.map((link) => ({ ...link, shortUrl: buildShortUrl(origin, link.slug as string) }));
}

export const Route = createFileRoute("/api/tracking-links")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "link_tracking",
          );
          // `?video=<YouTube id>` (from a video's page): only that video's links, and the video
          // itself so the page can name it — resolved here, inside this workspace, never trusted.
          const url = new URL(request.url);
          const rawVideo = url.searchParams.get("video");
          let video: Awaited<ReturnType<typeof workspaceVideoContext>> | undefined;
          if (rawVideo !== null) {
            const parsed = youtubeVideoIdSchema.safeParse(rawVideo);
            if (!parsed.success)
              return withCookies(
                json({ error: "VALIDATION_ERROR" }, { status: 422 }),
                setCookieHeaders,
              );
            video = await workspaceVideoContext(client, workspaceId, parsed.data);
            // Not a video of this workspace: no links, and nothing about it.
            if (!video) return withCookies(json({ data: [], video: null }), setCookieHeaders);
          }

          // Every link and every link's stats are read, page by page: a single read stops at
          // the API's row cap, which would drop links — and their clicks — from the totals. A
          // failed page fails the request rather than showing partial or zeroed counts.
          let withStatsData: Record<string, unknown>[];
          try {
            const links = await readAllRows<Record<string, unknown>>((from, to) => {
              let query = client
                .from("tracking_links")
                .select(linkColumns)
                .eq("workspace_id", workspaceId);
              if (video) query = query.eq("video_id", video.id);
              return (
                query
                  .order("created_at", { ascending: false })
                  // Unique tie-breaker, so pages never overlap or skip.
                  .order("id", { ascending: true })
                  .range(from, to)
              );
            });
            withStatsData = await withStats(client, links, { strict: true });
          } catch (error) {
            if (!(error instanceof PagedReadError)) throw error;
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
          const origin = await resolveLinkOrigin(client, workspaceId, new URL(request.url).origin);
          return withCookies(
            json({
              data: withShortUrls(withStatsData, origin),
              ...(video ? { video } : {}),
            }),
            setCookieHeaders,
          );
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "link_tracking",
          );
          const input = createLinkSchema.parse(await parseJson(request));
          await assertOwnedDestination(client, workspaceId, input.destinationId);
          if (input.videoId) await assertOwnedVideo(client, workspaceId, input.videoId);

          let slug = input.slug?.toLowerCase() ?? randomSlug();
          let attempt = 0;

          while (true) {
            const { data, error } = await client
              .from("tracking_links")
              .insert({
                user_id: user.id,
                workspace_id: workspaceId,
                destination_id: input.destinationId,
                video_id: input.videoId ?? null,
                slug,
                tracking_code: crypto.randomUUID(),
              })
              .select(linkColumns)
              .single();
            if (!error) {
              const origin = await resolveLinkOrigin(
                client,
                workspaceId,
                new URL(request.url).origin,
              );
              return withCookies(
                json(
                  { data: withShortUrls([{ ...data, uniqueClicks: 0 }], origin)[0] },
                  { status: 201 },
                ),
                setCookieHeaders,
              );
            }
            const isSlugCollision = error.code === "23505" && error.message.includes("slug");
            if (isSlugCollision && !input.slug && attempt < 5) {
              slug = randomSlug();
              attempt += 1;
              continue;
            }
            if (isSlugCollision) {
              return withCookies(json({ error: "SLUG_TAKEN" }, { status: 409 }), setCookieHeaders);
            }
            const isDuplicateLink =
              error.code === "23505" && error.message.includes("tracking_links_video_destination");
            if (isDuplicateLink) {
              return withCookies(
                json({ error: "LINK_ALREADY_EXISTS" }, { status: 409 }),
                setCookieHeaders,
              );
            }
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "link_tracking",
          );
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const input = updateLinkSchema.parse(await parseJson(request));
          if (input.destinationId)
            await assertOwnedDestination(client, workspaceId, input.destinationId);
          if (input.videoId) await assertOwnedVideo(client, workspaceId, input.videoId);

          const update: Record<string, unknown> = {};
          if (input.destinationId) update.destination_id = input.destinationId;
          if (input.videoId !== undefined) update.video_id = input.videoId;
          if (input.slug) update.slug = input.slug.toLowerCase();
          if (input.status) update.status = input.status;

          const { data, error } = await client
            .from("tracking_links")
            .update(update)
            .eq("id", id)
            .select(linkColumns)
            .single();
          if (error) {
            const notFound = error.code === "PGRST116";
            const duplicateLink =
              error.code === "23505" && error.message.includes("tracking_links_video_destination");
            const slugTaken = error.code === "23505" && !duplicateLink;
            return withCookies(
              json(
                {
                  error: notFound
                    ? "NOT_FOUND"
                    : duplicateLink
                      ? "LINK_ALREADY_EXISTS"
                      : slugTaken
                        ? "SLUG_TAKEN"
                        : "DATABASE_ERROR",
                },
                { status: notFound ? 404 : slugTaken || duplicateLink ? 409 : 500 },
              ),
              setCookieHeaders,
            );
          }
          const [withStatsData] = await withStats(client, [data]);
          const origin = await resolveLinkOrigin(client, workspaceId, new URL(request.url).origin);
          return withCookies(
            json({ data: withShortUrls([withStatsData], origin)[0] }),
            setCookieHeaders,
          );
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "link_tracking",
          );
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const { error } = await client.from("tracking_links").delete().eq("id", id);
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          return withCookies(json({ success: true }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
