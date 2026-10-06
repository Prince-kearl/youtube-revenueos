import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { topVideosByClicks } from "@/lib/server/click-attribution";

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
// database function for a one-off report. RLS (via tracking_links.workspace_id) scopes the read
// to this workspace's own click events without any extra filtering here.
//
// This relies on link_click_events.video_id, which the redirect route (r.$slug.ts) only started
// writing with the revenue-data-foundation change — before that every click had a NULL video and
// this endpoint could never return anything. Clicks made through a link that has no video are,
// correctly, not counted towards any video.
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

          const top = topVideosByClicks(
            (events ?? []).map((row) => ({ video_id: row.video_id as string | null })),
            3,
          );
          const counts = new Map(top.map((entry) => [entry.videoId, entry.clicks]));
          const topIds = top.map((entry) => entry.videoId);

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
