import { createFileRoute } from "@tanstack/react-router";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { buildShortUrl, resolveLinkOrigin } from "@/lib/server/short-links";
import {
  LinkActivityReadError,
  LinkActivityValidationError,
  loadVideoLinkActivity,
  parseLinkActivityQuery,
  type VideoLinkActivityResponse,
} from "@/lib/server/video-link-activity";

// GET /api/videos/link-activity?videoId=<YouTube video id>&days=<90|180|365>
//
// Tracked-link ACTIVITY for one of the caller's videos: the links on it now and the clicks
// recorded for it in the period (see lib/server/video-link-activity.ts). Read-only, and it
// carries no money of any kind — which is why it has nothing to do with revenue visibility.
//
// Who: an active workspace member whose role has the link_tracking feature, exactly as the
// tracked-links API requires. Anyone else is refused before anything is read.
//
// A video id that is unknown, or belongs to another workspace, gets the same answer as one of
// the caller's own videos that has no links: nothing here says which it was.

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

export const Route = createFileRoute("/api/videos/link-activity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "link_tracking",
          );
          const respond = (body: unknown, init?: ResponseInit) =>
            applySetCookies(json(body, init), setCookieHeaders);
          let query;
          try {
            query = parseLinkActivityQuery(new URL(request.url));
          } catch (error) {
            if (!(error instanceof LinkActivityValidationError)) throw error;
            return respond({ error: "VALIDATION_ERROR" }, { status: 422 });
          }
          try {
            const activity = await loadVideoLinkActivity(client, workspaceId, query);
            const origin = activity.links.length
              ? await resolveLinkOrigin(client, workspaceId, new URL(request.url).origin)
              : "";
            const data: VideoLinkActivityResponse = {
              ...activity,
              links: activity.links.map((link) => ({
                ...link,
                shortUrl: buildShortUrl(origin, link.slug),
              })),
            };
            return respond({ data });
          } catch (error) {
            // A failed read is a failure: never an empty or partial answer.
            if (!(error instanceof LinkActivityReadError)) throw error;
            return respond({ error: "DATABASE_ERROR" }, { status: 500 });
          }
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
