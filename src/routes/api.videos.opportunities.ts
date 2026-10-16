import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { loadVideoOpportunities } from "@/lib/server/video-opportunities";
import { LINK_ACTIVITY_DAYS, type LinkActivityDays } from "@/lib/server/video-link-activity";
import { isoDay } from "@/lib/server/youtube-stats-sync";

// GET /api/videos/opportunities?videoId=<YouTube video id>&days=<90|180|365>
//
// Revenue opportunities for one of the caller's videos: a few specific next steps, each with the
// evidence it rests on (lib/revenue-opportunities.ts for the rules, lib/server/video-
// opportunities.ts for the data). Read-only.
//
// Who: any active member of the workspace. Each group of rules then needs what its data needs —
// link rules the link_tracking feature, deal rules the brand_deals feature, revenue rules the
// right to see revenue — and a group the caller may not use is left out and reported as such.
//
// A video id that is unknown, or belongs to another workspace, gets the same answer as one of the
// caller's videos with nothing stored for the period: no opportunities, "insufficient data".

const querySchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  days: z.coerce
    .number()
    .refine((value): value is LinkActivityDays =>
      (LINK_ACTIVITY_DAYS as readonly number[]).includes(value),
    ),
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

export const Route = createFileRoute("/api/videos/opportunities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          const respond = (body: unknown, init?: ResponseInit) =>
            applySetCookies(json(body, init), ctx.setCookieHeaders);
          const url = new URL(request.url);
          const parsed = querySchema.safeParse({
            videoId: url.searchParams.get("videoId"),
            days: url.searchParams.get("days"),
          });
          if (!parsed.success) return respond({ error: "VALIDATION_ERROR" }, { status: 422 });
          try {
            return respond(
              await loadVideoOpportunities(
                ctx,
                parsed.data.videoId,
                parsed.data.days,
                isoDay(new Date()),
              ),
            );
          } catch {
            // The video figures could not be read: a failure, never an empty list.
            console.error("Video opportunities failed");
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
