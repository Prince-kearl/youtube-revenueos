import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

// 10,000 units/day is Google's default YouTube Data API v3 quota per project — not a number this
// app can query per-user, so it's a documented constant rather than a fabricated one.
const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;

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
          const { client } = await requireSessionUser(request);
          const requestedChannelId = new URL(request.url).searchParams.get("channelId");
          let channelQuery = client
            .from("youtube_channels")
            .select("id")
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ data: { used: 0, max: YOUTUBE_DAILY_QUOTA_UNITS } });

          const startOfDayUtc = new Date();
          startOfDayUtc.setUTCHours(0, 0, 0, 0);
          const { data, error } = await client
            .from("youtube_quota_events")
            .select("quota_units")
            .eq("channel_id", channel.id)
            .eq("succeeded", true)
            .gte("created_at", startOfDayUtc.toISOString());
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
