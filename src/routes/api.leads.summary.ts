import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { generateLeadSummary } from "@/lib/server/ai-generation";

const bodySchema = z.object({ leadId: z.string().uuid() });

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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/leads/summary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "leads");
          const input = bodySchema.parse(await parseJson(request));
          const { data: lead, error: leadError } = await client
            .from("leads")
            .select("id, name")
            .eq("id", input.leadId)
            .maybeSingle();
          if (leadError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!lead) return json({ error: "NOT_FOUND" }, { status: 404 });
          const { data: messages, error: messagesError } = await client
            .from("lead_messages")
            .select("from_who, text")
            .eq("lead_id", input.leadId)
            .order("created_at", { ascending: true });
          if (messagesError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const summary = await generateLeadSummary({
            leadName: lead.name ?? "This lead",
            messages: (messages ?? []).map((m) => ({
              from: m.from_who as "lead" | "you" | "system",
              text: m.text as string,
            })),
          });

          const generatedAt = new Date().toISOString();
          const { error: updateError } = await client
            .from("leads")
            .update({ ai_summary: summary, ai_summary_generated_at: generatedAt })
            .eq("id", input.leadId);
          if (updateError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          return json({ data: { ...summary, generatedAt } });
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
          console.error("Lead summary generation failed");
          return json({ error: "AI_PROVIDER_FAILED" }, { status: 502 });
        }
      },
    },
  },
});
