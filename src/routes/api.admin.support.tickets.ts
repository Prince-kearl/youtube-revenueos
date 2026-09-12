import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";
import { notifyWorkspace } from "@/lib/server/notify";

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

const patchSchema = z.object({
  status: z.enum(["Open", "Pending", "Resolved"]),
});

const idSchema = z.string().uuid();

// Admin-wide ticket visibility — every customer's tickets, not scoped to one workspace (see
// 202609180001_support_tickets.sql). This is what "connect the support page to the admin app"
// means: what a creator submits on /support or the landing-page contact form shows up here.
export const Route = createFileRoute("/api/admin/support/tickets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "manage_support");
          const { data, error } = await client
            .from("support_tickets")
            .select(
              "id, requester_name, requester_email, subject, message, priority, status, source, created_at, updated_at, workspaces(name)",
            )
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({
            data: (data ?? []).map((row) => {
              const workspaces = row.workspaces as { name: string }[] | { name: string } | null;
              const workspace = Array.isArray(workspaces) ? workspaces[0] : workspaces;
              const { workspaces: _workspaces, ...rest } = row;
              return {
                ...rest,
                org: workspace?.name ?? (rest.source === "Landing Page" ? "Not signed in" : "—"),
              };
            }),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_support");
          const ticketId = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = patchSchema.parse(await request.json());

          const service = createServiceSupabaseClient();
          const { data: updated, error } = await service
            .from("support_tickets")
            .update({ status: input.status })
            .eq("id", ticketId)
            .select("id, subject, status, workspace_id, user_id")
            .single();
          if (error || !updated) return json({ error: "TICKET_NOT_FOUND" }, { status: 404 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "support_ticket_status_changed",
            target: updated.subject,
            newValue: { status: input.status },
          });

          if (input.status === "Resolved" && updated.workspace_id && updated.user_id) {
            void notifyWorkspace(service, {
              workspaceId: updated.workspace_id,
              userId: updated.user_id,
              type: "check",
              title: "Your support ticket was resolved",
              message: updated.subject,
            });
          }

          const { workspace_id: _workspaceId, user_id: _userId, ...rest } = updated;
          return json({ data: rest });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
