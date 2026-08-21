import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import { queryYoutubeAnalytics } from "@/lib/server/google-oauth";
import { createServiceSupabaseClient } from "@/lib/server/supabase";

const querySchema = z.object({
  channelId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metrics: z.string().min(1),
  dimensions: z.string().optional(),
});

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export const Route = createFileRoute("/api/youtube/analytics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const url = new URL(request.url);
          const input = querySchema.parse(Object.fromEntries(url.searchParams));

          const { data: channel, error } = await client
            .from("youtube_channels")
            .select("id, youtube_channel_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", input.channelId)
            .single();
          if (error || !channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const accessToken = await getValidAccessToken(client, channel);
          const report = await queryYoutubeAnalytics(accessToken, {
            channelId: channel.youtube_channel_id,
            startDate: input.startDate,
            endDate: input.endDate,
            metrics: input.metrics.split(","),
            dimensions: input.dimensions?.split(","),
          });

          await client.from("youtube_channels").update({ last_synced_at: new Date().toISOString() }).eq("id", channel.id);

          const service = createServiceSupabaseClient();
          await service.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "reports.query",
            quota_units: 1,
            succeeded: true,
          });

          // These are directly measured YouTube Analytics figures, not platform-side attribution —
          // callers must not blend this with click/lead/deal-derived numbers without labeling both.
          return json({ data: report, meta: { source: "youtube_analytics_api", fetchedAt: new Date().toISOString() } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError) return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "YOUTUBE_ANALYTICS_ERROR" }, { status: 502 });
        }
      },
    },
  },
});
