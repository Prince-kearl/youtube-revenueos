import { createFileRoute } from "@tanstack/react-router";
import { getWorkspaceContext } from "@/lib/server/workspace";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

// Real completion state for the dashboard's Getting Started checklist — a count-only check
// against each step's real table, scoped by RLS to the caller's workspace exactly like every
// other route, no separate workspace_id filtering needed here.
export const Route = createFileRoute("/api/onboarding/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await getWorkspaceContext(request);
          const [channels, videos, rules, links] = await Promise.all([
            client.from("youtube_channels").select("id", { count: "exact", head: true }),
            client.from("videos").select("id", { count: "exact", head: true }),
            client.from("comment_automation_rules").select("id", { count: "exact", head: true }),
            client.from("tracking_links").select("id", { count: "exact", head: true }),
          ]);
          return json({
            data: {
              channel: (channels.count ?? 0) > 0,
              video: (videos.count ?? 0) > 0,
              comments: (rules.count ?? 0) > 0,
              link: (links.count ?? 0) > 0,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
