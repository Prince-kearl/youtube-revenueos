import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";

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

// The real, addressable email audience: leads with an email on file. There is no separate
// "subscribers" list in this app — a campaign's audience is whichever real leads have an email,
// computed live here rather than snapshotted, so it's never stale.
export const Route = createFileRoute("/api/email/audience")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "email");
          const { data, error } = await client
            .from("leads")
            .select("id, name, email, platform, status, created_at")
            .not("email", "is", null)
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
