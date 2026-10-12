import { createFileRoute } from "@tanstack/react-router";
import { handleRevenueVideosRequest } from "@/lib/server/revenue-videos";
import { revenueReadContext } from "@/lib/server/revenue-visibility";

// Per-video revenue from STORED data (video_daily_stats) — see src/lib/server/revenue-videos.ts
// for the contract. No YouTube call is made here or anywhere below it. The workspace always
// comes from the signed-in session, never from the request.
//
// Whether the caller may see amounts is decided once, by revenueReadContext. A member who may
// not still gets each video's views and watch time, with revenue, RPM and revenue share withheld
// and `visibility.revenue` set to "hidden".
export const Route = createFileRoute("/api/revenue/videos")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleRevenueVideosRequest(request, {
          getContext: revenueReadContext,
          now: () => new Date(),
        }),
    },
  },
});
