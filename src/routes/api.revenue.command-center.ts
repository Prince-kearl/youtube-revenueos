import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { loadCommandCenter } from "@/lib/server/command-center";
import { LINK_ACTIVITY_DAYS, type LinkActivityDays } from "@/lib/server/video-link-activity";

// GET /api/revenue/command-center?days=<90|180|365>
//
// The Revenue command center on the dashboard: YouTube revenue, sponsorships and tracked-link
// activity side by side (never added together), a few opportunities across the workspace's
// videos, and the videos to look at — see lib/server/command-center.ts. Read-only.
//
// Who: any active member of the workspace. Each part then needs what its data needs — link
// tracking, brand deals, or the right to see revenue — and a part the caller may not use is left
// out (and marked as such). The workspace always comes from the caller's membership.

const querySchema = z.object({
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

export const Route = createFileRoute("/api/revenue/command-center")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          const respond = (body: unknown, init?: ResponseInit) =>
            applySetCookies(json(body, init), ctx.setCookieHeaders);
          const parsed = querySchema.safeParse({
            days: new URL(request.url).searchParams.get("days") ?? "90",
          });
          if (!parsed.success) return respond({ error: "VALIDATION_ERROR" }, { status: 422 });
          try {
            return respond(await loadCommandCenter(ctx, parsed.data.days, new Date()));
          } catch {
            // The revenue figures could not be read: a failure, never an empty overview.
            console.error("Revenue command center failed");
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
