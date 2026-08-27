import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

const settingsSchema = z.object({
  auto_sync_videos: z.boolean(),
  import_analytics: z.boolean(),
  sync_comments: z.boolean(),
  import_chapters: z.boolean(),
});

const defaults = {
  auto_sync_videos: true,
  import_analytics: true,
  sync_comments: false,
  import_chapters: true,
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

async function getOwnedChannel(
  client: Awaited<ReturnType<typeof requireSessionUser>>["client"],
  requestedChannelId?: string | null,
) {
  let query = client
    .from("youtube_channels")
    .select("id")
    .order("connected_at", { ascending: false });
  if (requestedChannelId) query = query.eq("id", requestedChannelId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error("DATABASE_ERROR");
  return data;
}

export const Route = createFileRoute("/api/youtube/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const requestedChannelId = new URL(request.url).searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const channel = await getOwnedChannel(client, requestedChannelId);
          if (!channel) {
            return requestedChannelId
              ? json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 })
              : json({ data: null, status: "not_connected" });
          }
          const { data, error } = await client
            .from("youtube_integration_settings")
            .select("auto_sync_videos, import_analytics, sync_comments, import_chapters")
            .eq("channel_id", channel.id)
            .maybeSingle();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: { ...defaults, ...(data ?? {}) }, status: "connected" });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const requestedChannelId = new URL(request.url).searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const channel = await getOwnedChannel(client, requestedChannelId);
          if (!channel) return json({ error: "YOUTUBE_NOT_CONNECTED" }, { status: 409 });
          const input = settingsSchema.parse(await request.json());
          const { data, error } = await client
            .from("youtube_integration_settings")
            .upsert({ channel_id: channel.id, ...input }, { onConflict: "channel_id" })
            .select("auto_sync_videos, import_analytics, sync_comments, import_chapters")
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data, status: "connected" });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
