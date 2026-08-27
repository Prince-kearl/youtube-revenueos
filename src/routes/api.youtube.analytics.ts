import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import {
  aggregateYoutubeAnalyticsByMonth,
  queryYoutubeAnalytics,
  type YoutubeAnalyticsPayload,
} from "@/lib/server/google-oauth";
import { createServiceSupabaseClient } from "@/lib/server/supabase";

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metrics: z.string().min(1),
  dimensions: z.string().optional(),
  filters: z.string().optional(),
  sort: z.string().optional(),
  maxResults: z.coerce.number().int().positive().max(200).optional(),
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
          const requestedChannelId = url.searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const input = querySchema.parse(Object.fromEntries(url.searchParams));

          let channelQuery = client
            .from("youtube_channels")
            .select(
              "id, youtube_channel_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry",
            )
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channel, error } = await channelQuery.limit(1).maybeSingle();
          if (error || !channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const accessToken = await getValidAccessToken(client, channel);
          const requestedDimensions = input.dimensions?.split(",").filter(Boolean);
          const normalizedDimensions = requestedDimensions?.map((dimension) =>
            dimension === "trafficSourceType" ? "insightTrafficSourceType" : dimension,
          );
          const wantsMonthlyRows = normalizedDimensions?.includes("month") ?? false;
          const isOptionalBreakdown =
            normalizedDimensions?.some((dimension) =>
              ["video", "insightTrafficSourceType"].includes(dimension),
            ) ?? false;
          if (
            wantsMonthlyRows &&
            normalizedDimensions?.some((dimension) => dimension !== "month")
          ) {
            return json(
              {
                error: "VALIDATION_ERROR",
                message: "The month dimension cannot be combined with another dimension.",
              },
              { status: 422 },
            );
          }
          const metrics = input.metrics.split(",").filter(Boolean);
          const dimensions = wantsMonthlyRows ? ["day"] : normalizedDimensions;
          let report: YoutubeAnalyticsPayload | null = null;
          let revenueAvailable = metrics.includes("estimatedRevenue");
          try {
            report = (await queryYoutubeAnalytics(accessToken, {
              channelId: channel.youtube_channel_id,
              startDate: input.startDate,
              endDate: input.endDate,
              metrics,
              dimensions,
              filters: input.filters,
              sort: input.sort,
              maxResults: input.maxResults,
            })) as YoutubeAnalyticsPayload;
          } catch (error) {
            if (!isOptionalBreakdown || !metrics.includes("estimatedRevenue")) throw error;
            revenueAvailable = false;
            try {
              report = (await queryYoutubeAnalytics(accessToken, {
                channelId: channel.youtube_channel_id,
                startDate: input.startDate,
                endDate: input.endDate,
                metrics: metrics.filter((metric) => metric !== "estimatedRevenue"),
                dimensions,
                filters: input.filters,
                sort: input.sort,
                maxResults: input.maxResults,
              })) as YoutubeAnalyticsPayload;
            } catch {
              report = null;
            }
          }
          const normalizedReport =
            report && wantsMonthlyRows ? aggregateYoutubeAnalyticsByMonth(report) : report;

          await client
            .from("youtube_channels")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", channel.id);

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
          if (!normalizedReport && isOptionalBreakdown) {
            return json({
              data: null,
              meta: {
                source: "youtube_analytics_api",
                available: false,
                revenueAvailable,
                fetchedAt: new Date().toISOString(),
              },
            });
          }
          return json({
            data: normalizedReport,
            meta: {
              source: "youtube_analytics_api",
              available: true,
              revenueAvailable,
              fetchedAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          const message = error instanceof Error ? error.message : "";
          if (
            /YOUTUBE_.*:401$/.test(message) ||
            /GOOGLE_TOKEN_REQUEST_FAILED:(400|401)$/.test(message)
          ) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          console.error("YouTube Analytics query failed", {
            reason: message.match(/:(\d{3})(?::|$)/)?.[1] ?? message.split(":")[0].slice(0, 80),
            timestamp: new Date().toISOString(),
          });
          return json({ error: "YOUTUBE_ANALYTICS_ERROR" }, { status: 502 });
        }
      },
    },
  },
});
