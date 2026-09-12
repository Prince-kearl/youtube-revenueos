import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

const createSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]),
});

// The creator's own ticket history — a signed-in user only ever sees/creates their own tickets
// (support_tickets_owner_read/insert RLS enforces this too). Admin-wide visibility across every
// customer lives in api.admin.support.tickets.ts instead.
export const Route = createFileRoute("/api/support/tickets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const { data, error } = await client
            .from("support_tickets")
            .select("id, subject, message, priority, status, source, created_at, updated_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const input = createSchema.parse(await request.json());

          const { data: profile } = await client
            .from("profiles")
            .select("name, email")
            .eq("id", user.id)
            .maybeSingle();

          // Every real account has a workspace (see handle_new_user()), but a ticket should still
          // send even if that lookup somehow comes back empty — support shouldn't be gated on it.
          const workspaceId = await getWorkspaceContext(request)
            .then((ctx) => ctx.workspaceId)
            .catch(() => null);

          const { data: ticket, error } = await client
            .from("support_tickets")
            .insert({
              user_id: user.id,
              workspace_id: workspaceId,
              requester_name: profile?.name ?? user.email?.split("@")[0] ?? "Unknown",
              requester_email: profile?.email ?? user.email ?? "",
              subject: input.subject,
              message: input.message,
              priority: input.priority,
              status: "Open",
              source: "App",
            })
            .select("id, subject, message, priority, status, source, created_at, updated_at")
            .single();
          if (error || !ticket) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: ticket }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
