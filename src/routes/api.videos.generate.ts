import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { generateVideoDescription } from "@/lib/server/ai-generation";

const inputSchema = z.object({
  channelId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  currentDescription: z.string().trim().max(12_000).nullable().optional(),
  transcript: z.string().trim().max(30_000).nullable().optional(),
  destinations: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        url: z.string().url().max(2_048),
      }),
    )
    .max(12)
    .optional(),
});

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

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/videos/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const input = inputSchema.parse(await parseJson(request));
          const { data: channel, error: channelError } = await client
            .from("youtube_channels")
            .select("id")
            .eq("id", input.channelId)
            .maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const description = await generateVideoDescription({
            title: input.title,
            currentDescription: input.currentDescription,
            transcript: input.transcript,
            destinations: input.destinations,
          });
          return json({ data: { description } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (error instanceof Error && error.message === "AI_PROVIDER_NOT_CONFIGURED") {
            return json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
          }
          if (error instanceof Error && error.message.startsWith("AI_PROVIDER_FAILED:")) {
            return json({ error: "AI_PROVIDER_FAILED" }, { status: 502 });
          }
          console.error("Video description generation failed");
          return json({ error: "AI_PROVIDER_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
