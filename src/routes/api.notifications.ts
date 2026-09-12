import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/server/workspace";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

const idSchema = z.string().uuid();

const patchSchema = z
  .object({
    read: z.boolean().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.read !== undefined || v.pinned !== undefined || v.archived !== undefined, {
    message: "Provide at least one field to update",
  });

const actionSchema = z.object({ action: z.enum(["mark_all_read", "clear_all"]) });

// Shared per-workspace alert feed — see 202609200001_notifications.sql. Not gated by
// requireWorkspaceFeature: like /settings and /support, notifications are always available
// regardless of role/feature toggles (see OPEN_ROUTES in stores.ts).
export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await getWorkspaceContext(request);
          const { data, error } = await client
            .from("notifications")
            .select("id, type, title, message, read, pinned, archived, created_at")
            .eq("workspace_id", workspaceId)
            .order("pinned", { ascending: false })
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client, workspaceId } = await getWorkspaceContext(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = patchSchema.parse(await request.json());
          const { data, error } = await client
            .from("notifications")
            .update(input)
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .select("id, type, title, message, read, pinned, archived, created_at")
            .maybeSingle();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!data) return json({ error: "NOTIFICATION_NOT_FOUND" }, { status: 404 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, workspaceId } = await getWorkspaceContext(request);
          const { action } = actionSchema.parse(await request.json());
          if (action === "mark_all_read") {
            const { error } = await client
              .from("notifications")
              .update({ read: true })
              .eq("workspace_id", workspaceId)
              .eq("archived", false);
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          } else {
            const { error } = await client
              .from("notifications")
              .delete()
              .eq("workspace_id", workspaceId);
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          return json({ data: { ok: true } });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client, workspaceId } = await getWorkspaceContext(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { error } = await client
            .from("notifications")
            .delete()
            .eq("id", id)
            .eq("workspace_id", workspaceId);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: { ok: true } });
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
