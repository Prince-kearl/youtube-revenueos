import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { generateContentAnalysis } from "@/lib/server/ai-generation";

const inputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(12_000).nullable().optional(),
  transcript: z.string().trim().max(30_000).nullable().optional(),
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

export const Route = createFileRoute("/api/videos/analyze-content")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Session-gated (not tied to a specific owned channel) so this also works for public
          // videos from other channels, matching "content analysis works for any public video,
          // private analytics/saving does not" from the rest of this page.
          await requireSessionUser(request);
          const input = inputSchema.parse(await parseJson(request));
          const analysis = await generateContentAnalysis(input);
          return json({ data: analysis });
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
          console.error("Video content analysis failed");
          return json({ error: "AI_PROVIDER_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
