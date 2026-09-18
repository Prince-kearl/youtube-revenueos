import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { resolveLinkOrigin, buildShortUrl } from "@/lib/server/short-links";

// Powers AI Lab's "auto-generate a tracking link per destination" flow (see ai-lab.tsx): given a
// saved video and the destinations the creator wants featured, returns one real tracking_links
// row per destination — reusing whatever already exists for that (video, destination) pair rather
// than creating a fresh one on every regenerate, thanks to the unique constraint added alongside
// this endpoint (see 202609260001_link_automation_and_custom_domain.sql).
const ensureSchema = z.object({
  videoId: z.string().uuid(),
  destinationIds: z.array(z.string().uuid()).min(1).max(12),
});

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

const linkColumns = "id, slug, destination_id, video_id";

export const Route = createFileRoute("/api/tracking-links/ensure")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "link_tracking",
          );
          const input = ensureSchema.parse(await parseJson(request));

          const { data: video, error: videoError } = await client
            .from("videos")
            .select("id")
            .eq("id", input.videoId)
            .maybeSingle();
          if (videoError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!video) return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });

          const { data: destinations, error: destinationsError } = await client
            .from("destinations")
            .select("id")
            .in("id", input.destinationIds)
            .eq("workspace_id", workspaceId);
          if (destinationsError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const ownedIds = new Set((destinations ?? []).map((d) => d.id as string));

          const origin = await resolveLinkOrigin(client, workspaceId, new URL(request.url).origin);
          const results: { destinationId: string; slug: string; shortUrl: string }[] = [];

          for (const destinationId of input.destinationIds) {
            if (!ownedIds.has(destinationId)) continue;

            const { data: existing, error: existingError } = await client
              .from("tracking_links")
              .select(linkColumns)
              .eq("video_id", input.videoId)
              .eq("destination_id", destinationId)
              .maybeSingle();
            if (existingError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            if (existing) {
              results.push({
                destinationId,
                slug: existing.slug,
                shortUrl: buildShortUrl(origin, existing.slug),
              });
              continue;
            }

            let created: { slug: string } | null = null;
            for (let attempt = 0; attempt < 5 && !created; attempt++) {
              const slug = randomSlug();
              const { data: inserted, error: insertError } = await client
                .from("tracking_links")
                .insert({
                  user_id: user.id,
                  workspace_id: workspaceId,
                  destination_id: destinationId,
                  video_id: input.videoId,
                  slug,
                  tracking_code: crypto.randomUUID(),
                })
                .select(linkColumns)
                .single();
              if (!insertError) {
                created = inserted;
                break;
              }
              const isSlugCollision =
                insertError.code === "23505" && insertError.message.includes("slug");
              if (isSlugCollision) continue;
              // Another request created this (video, destination) pair concurrently — reuse it.
              const isRaceOnPair =
                insertError.code === "23505" &&
                insertError.message.includes("tracking_links_video_destination");
              if (isRaceOnPair) {
                const { data: reread } = await client
                  .from("tracking_links")
                  .select(linkColumns)
                  .eq("video_id", input.videoId)
                  .eq("destination_id", destinationId)
                  .maybeSingle();
                if (reread) created = reread;
                break;
              }
              return json({ error: "DATABASE_ERROR" }, { status: 500 });
            }
            if (!created) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            results.push({
              destinationId,
              slug: created.slug,
              shortUrl: buildShortUrl(origin, created.slug),
            });
          }

          return json({ data: results });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
