import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createServiceSupabaseClient } from "@/lib/server/supabase";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(1).max(4000),
});

// The public landing-page contact form — the one place a support ticket is created by someone
// with no session at all, so it goes through the service-role client rather than RLS.
export const Route = createFileRoute("/api/support/contact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const input = contactSchema.parse(await request.json());
          const service = createServiceSupabaseClient();
          const { error } = await service.from("support_tickets").insert({
            user_id: null,
            workspace_id: null,
            requester_name: input.name,
            requester_email: input.email,
            subject: input.message.length > 60 ? `${input.message.slice(0, 57)}…` : input.message,
            message: input.message,
            priority: "Medium",
            status: "Open",
            source: "Landing Page",
          });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: { ok: true } }, { status: 201 });
        } catch (error) {
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
