import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { resolveLinkOrigin, buildShortUrl } from "@/lib/server/short-links";

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

async function assertOwnedDestination(client: SupabaseClientLike, destinationId: string) {
  const { data, error } = await client
    .from("destinations")
    .select("id")
    .eq("id", destinationId)
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "DESTINATION_NOT_FOUND" }, { status: 404 });
}

async function assertOwnedVideo(client: SupabaseClientLike, videoId: string) {
  const { data, error } = await client.from("videos").select("id").eq("id", videoId).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
}

const linkColumns =
  "id, slug, status, clicks, created_at, updated_at, destination:destinations(id,name,url), video:videos(id,title)";

async function withStats(client: SupabaseClientLike, links: Record<string, unknown>[]) {
  const ids = links.map((link) => link.id as string);
  if (ids.length === 0) return links;
  const { data: stats } = await client
    .from("tracking_link_stats")
    .select("link_id, total_clicks, unique_clicks")
    .in("link_id", ids);
  const byId = new Map((stats ?? []).map((row) => [row.link_id as string, row]));
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
          const { data, error } = await client
            .from("tracking_links")
            .select(linkColumns)
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          const withStatsData = await withStats(client, data ?? []);
          const origin = await resolveLinkOrigin(client, workspaceId, new URL(request.url).origin);
          return withCookies(
            json({ data: withShortUrls(withStatsData, origin) }),
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
          await assertOwnedDestination(client, input.destinationId);
          if (input.videoId) await assertOwnedVideo(client, input.videoId);

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
          if (input.destinationId) await assertOwnedDestination(client, input.destinationId);
          if (input.videoId) await assertOwnedVideo(client, input.videoId);

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
