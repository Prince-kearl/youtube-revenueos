import { createFileRoute } from "@tanstack/react-router";
import { handleRevenueSummaryRequest } from "@/lib/server/revenue-summary";
import { getWorkspaceContext, requireWorkspaceFeature } from "@/lib/server/workspace";

// Revenue summary from STORED data (channel_daily_stats / video_daily_stats) — see
// src/lib/server/revenue-summary.ts for the contract. No YouTube call is made here or anywhere
// below it. The workspace always comes from the signed-in session, never from the request.
export const Route = createFileRoute("/api/revenue/summary")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleRevenueSummaryRequest(request, {
          getContext: getWorkspaceContext,
          // Deal values follow the same gate as the Brand Deals page itself, so a role that
          // cannot open that page does not get its numbers through this endpoint either.
          canViewDeals: (req) =>
            requireWorkspaceFeature(req, "brand_deals").then(
              () => true,
              () => false,
            ),
          now: () => new Date(),
        }),
    },
  },
});
