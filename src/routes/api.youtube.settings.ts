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

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

async function getOwnedChannel(client: Awaited<ReturnType<typeof requireSessionUser>>["client"]) {
  const { data, error } = await client
    .from("youtube_channels")
    .select("id")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("DATABASE_ERROR");
  return data;
}

export const Route = createFileRoute("/api/youtube/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const channel = await getOwnedChannel(client);
          if (!channel) return json({ data: null, status: "not_connected" });
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
          const channel = await getOwnedChannel(client);
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
