import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { topVideosByClicks } from "@/lib/server/click-attribution";
import { PagedReadError, readAllRows } from "@/lib/server/paged-read";

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
// rows rather than reaching for a database function for a one-off report.
//
// Counting. These are TOTAL clicks (one per click event), not unique visitors. Every click
// event of the destination is read, page by page (see lib/server/paged-read.ts): a single read
// stops at the API's row cap without saying so, which would both undercount and mis-rank. A
// failed page fails the request — a partial count is never returned.
//
// Attribution. A click counts towards the video recorded ON THE CLICK when it was made, so
// pointing a tracked link at a different video later does not move its earlier clicks.
//
// Scope. The destination must belong to the caller's workspace, and row-level security (via
// tracking_links.workspace_id) limits the click events to that workspace's own as well. A
// destination that is unknown or another workspace's answers exactly like one with no clicks.
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
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));

          const { data: destination, error: destinationError } = await client
            .from("destinations")
            .select("id")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (destinationError)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (!destination) return withCookies(json({ data: [] }), setCookieHeaders);

          let events: Array<{ video_id: string | null }>;
          try {
            // Ordered by the primary key so pages never overlap or skip.
            events = await readAllRows<{ video_id: string | null }>((from, to) =>
              client
                .from("link_click_events")
                .select("video_id")
                .eq("destination_id", id)
                .not("video_id", "is", null)
                .order("id", { ascending: true })
                .range(from, to),
            );
          } catch (error) {
            if (!(error instanceof PagedReadError)) throw error;
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }

          const top = topVideosByClicks(events, 3);
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
