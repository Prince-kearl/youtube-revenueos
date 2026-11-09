import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { YOUTUBE_DAILY_QUOTA_UNITS, quotaDayStart } from "@/lib/server/youtube-quota";

// The channel's measured YouTube Data API usage today (youtube-quota.ts): every request made for
// it since midnight Pacific time, when Google resets the quota. 10,000 units/day is Google's
// default quota for the app's project, shared by every channel.

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

export const Route = createFileRoute("/api/youtube/quota")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(
            request,
            "comment_automation",
          );
          const requestedChannelId = new URL(request.url).searchParams.get("channelId");
          let channelQuery = client
            .from("youtube_channels")
            .select("id")
            .eq("workspace_id", workspaceId)
            .not("connection_id", "is", null)
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ data: { used: 0, max: YOUTUBE_DAILY_QUOTA_UNITS } });

          const { data, error } = await client
            .from("youtube_quota_events")
            .select("quota_units")
            .eq("channel_id", channel.id)
            .eq("source", "api")
            .gte("created_at", quotaDayStart().toISOString());
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const used = (data ?? []).reduce((sum, row) => sum + (row.quota_units as number), 0);
          return json({ data: { used, max: YOUTUBE_DAILY_QUOTA_UNITS } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
