import { createFileRoute } from "@tanstack/react-router";

// Revenue visibility is now selected per teammate when they are invited. Keep this retired route
// explicit so stale clients cannot continue changing workspace-wide role flags that no longer
// control access.
// requirePlan: false — even unsubscribed workspaces should receive the migration notice.
function retired() {
  return new Response(JSON.stringify({ error: "REVENUE_VISIBILITY_MOVED_TO_INVITES" }), {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

export const Route = createFileRoute("/api/workspace/revenue-visibility")({
  server: { handlers: { GET: retired, PATCH: retired } },
});
