import { createFileRoute } from "@tanstack/react-router";
import { handleRevenueVideosRequest } from "@/lib/server/revenue-videos";
import { getWorkspaceContext } from "@/lib/server/workspace";

// Per-video revenue from STORED data (video_daily_stats) — see src/lib/server/revenue-videos.ts
// for the contract. No YouTube call is made here or anywhere below it. The workspace always
// comes from the signed-in session, never from the request.
export const Route = createFileRoute("/api/revenue/videos")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleRevenueVideosRequest(request, {
          getContext: getWorkspaceContext,
          now: () => new Date(),
        }),
    },
  },
});
