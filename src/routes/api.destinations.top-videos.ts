import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";

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

// Top 3 videos (by click count) that sent traffic to one destination — aggregated here in JS
// rather than a SQL view/RPC, matching how this codebase already aggregates YouTube Analytics
// rows (see aggregateYoutubeAnalyticsByMonth in google-oauth.ts) rather than reaching for a
// database function for a one-off report. link_click_events.destination_id + video_id are both
// direct columns already (no join needed); RLS (via tracking_links.workspace_id) scopes the read
// to this workspace's own click events without any extra filtering here.
export const Route = createFileRoute("/api/destinations/top-videos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, setCookieHeaders } = await getWorkspaceContext(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));

          const { data: events, error: eventsError } = await client
            .from("link_click_events")
            .select("video_id")
            .eq("destination_id", id)
            .not("video_id", "is", null);
          if (eventsError)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );

          const counts = new Map<string, number>();
          for (const row of events ?? []) {
            const videoId = row.video_id as string;
            counts.set(videoId, (counts.get(videoId) ?? 0) + 1);
          }
          const topIds = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([videoId]) => videoId);

          if (topIds.length === 0) return withCookies(json({ data: [] }), setCookieHeaders);

          const { data: videos, error: videosError } = await client
            .from("videos")
            .select("id, title, thumbnail")
            .in("id", topIds);
          if (videosError)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );

          const byId = new Map((videos ?? []).map((v) => [v.id as string, v]));
          const data = topIds
            .filter((videoId) => byId.has(videoId))
            .map((videoId) => {
              const video = byId.get(videoId)!;
              return {
                id: videoId,
                title: video.title as string,
                thumbnail: video.thumbnail as string | null,
                clicks: counts.get(videoId) ?? 0,
              };
            });
          return withCookies(json({ data }), setCookieHeaders);
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
