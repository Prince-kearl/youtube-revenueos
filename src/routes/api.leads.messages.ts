import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

const idSchema = z.string().uuid();

const createMessageSchema = z.object({
  leadId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/leads/messages")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const leadId = idSchema.parse(new URL(request.url).searchParams.get("leadId"));
          const { data, error } = await client
            .from("lead_messages")
            .select("*")
            .eq("lead_id", leadId)
            .order("created_at", { ascending: true });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Logs a manually-written note (e.g. "emailed them the pricing PDF") — this never sends
      // anything to Instagram/Email, since this app has no integration with either. Real YouTube
      // comment replies are logged automatically by api.comment-rules.replies.ts instead.
      POST: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const input = createMessageSchema.parse(await parseJson(request));
          const { data: lead, error: leadError } = await client
            .from("leads")
            .select("id")
            .eq("id", input.leadId)
            .maybeSingle();
          if (leadError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!lead) return json({ error: "NOT_FOUND" }, { status: 404 });
          const { data, error } = await client
            .from("lead_messages")
            .insert({ lead_id: input.leadId, from_who: "you", kind: "note", text: input.text })
            .select()
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          await client
            .from("leads")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", input.leadId);
          return json({ data }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const body = z.object({ pinned: z.boolean() }).parse(await parseJson(request));
          const { data, error } = await client
            .from("lead_messages")
            .update({ pinned: body.pinned })
            .eq("id", id)
            .select()
            .single();
          if (error) {
            const notFound = error.code === "PGRST116";
            return json(
              { error: notFound ? "NOT_FOUND" : "DATABASE_ERROR" },
              { status: notFound ? 404 : 500 },
            );
          }
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const url = new URL(request.url);
          const leadId = url.searchParams.get("leadId");
          const id = url.searchParams.get("id");
          if (leadId && !id) {
            // Clear the whole thread for a lead.
            const { error } = await client
              .from("lead_messages")
              .delete()
              .eq("lead_id", idSchema.parse(leadId));
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            return json({ success: true });
          }
          const { error } = await client
            .from("lead_messages")
            .delete()
            .eq("id", idSchema.parse(id));
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ success: true });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
