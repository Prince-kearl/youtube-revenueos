import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import {
  fetchAuthorizedYoutubeChannel,
  fetchRecentYoutubeVideos,
  queryYoutubeAnalytics,
  type YoutubeChannelSummary,
} from "@/lib/server/google-oauth";

const querySchema = z.object({ channelId: z.string().uuid().optional() });

type AnalyticsPayload = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function analyticsRows(payload: unknown): Array<Record<string, string | number>> {
  const report = payload as AnalyticsPayload;
  const headers = report.columnHeaders?.map((header) => header.name) ?? [];
  return (report.rows ?? []).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? 0])));
}

function channelUrl(channel: YoutubeChannelSummary): string | null {
  return channel.handle ? `https://www.youtube.com/${channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`}` : null;
}

export const Route = createFileRoute("/api/youtube/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
          let channelQuery = client
            .from("youtube_channels")
            .select("id, youtube_channel_id, channel_name, channel_handle, thumbnail, subscriber_count, token_expiry")
            .order("connected_at", { ascending: false });
          if (input.channelId) channelQuery = channelQuery.eq("id", input.channelId);
          const { data: channelRow, error: channelError } = await channelQuery.limit(1).maybeSingle();

          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channelRow) return json({ data: null, status: "not_connected" });

          const serviceClient = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await serviceClient
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channelRow.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const accessToken = await getValidAccessToken(serviceClient, secretRow);
          const channel = await fetchAuthorizedYoutubeChannel(accessToken);
          const videos = await fetchRecentYoutubeVideos(accessToken, channel.uploadsPlaylistId);

          const startDate = new Date();
          startDate.setUTCMonth(startDate.getUTCMonth() - 12);
          const endDate = new Date();
          let analytics: AnalyticsPayload | null = null;
          try {
            analytics = (await queryYoutubeAnalytics(accessToken, {
              channelId: channel.channelId,
              startDate: isoDate(startDate),
              endDate: isoDate(endDate),
              metrics: ["views", "estimatedRevenue", "subscribersGained", "watchTimeMinutes"],
              dimensions: ["month"],
            })) as AnalyticsPayload;
          } catch {
            analytics = null;
          }

          await client.from("youtube_channels").update({ last_synced_at: new Date().toISOString() }).eq("id", channelRow.id);
          return json({
            status: "connected",
            data: {
              channel: { ...channel, url: channelUrl(channel) },
              videos,
              analytics: analyticsRows(analytics),
              fetchedAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const message = error instanceof Error ? error.message : "";
          if (message.includes("YOUTUBE_") && message.includes(":401")) {
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          }
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
