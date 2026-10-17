import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { readRevenueVisibility, resolveRevenueAccess } from "@/lib/server/revenue-visibility";

// Workspace revenue visibility: which of the configurable roles (editor, setter) may see revenue
// amounts in this workspace. The rules are in lib/revenue-visibility.ts.
//
//   GET    any active member — the setting, and what THIS caller may do. No amounts.
//   PATCH  owner, manager, or platform staff who are a member — change one or both roles.
//
// The workspace is always the caller's own (from their active membership); nothing in the request
// can name another one. The setting lives on the workspace row, which members cannot write
// directly, so this handler — after its own authorisation — is the only way to change it.

// Strict: exactly these two optional booleans. Any other key (a workspace id, a role, "owner",
// "manager"…) fails validation instead of being quietly ignored, and at least one must be given.
const updateSchema = z
  .object({
    editor: z.boolean().optional(),
    setter: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.editor !== undefined || value.setter !== undefined);

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

export const Route = createFileRoute("/api/workspace/revenue-visibility")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request, { requirePlan: false });
          const access = await resolveRevenueAccess(ctx);
          return json({
            data: {
              editor: access.settings.editor,
              setter: access.settings.setter,
              // What this caller may do, so a page can choose what to show. Not a permission in
              // itself: every endpoint decides again on the server.
              canView: access.canView,
              canManage: access.canManage,
              // False until the setting's storage exists (the migration has been applied).
              available: access.settingsAvailable,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request, { requirePlan: false });
          const service = createServiceSupabaseClient();
          const access = await resolveRevenueAccess(ctx, service);
          // Authorised before the body is even read.
          if (!access.canManage)
            return json({ error: "CANNOT_MANAGE_REVENUE_VISIBILITY" }, { status: 403 });
          const input = updateSchema.parse(await parseJson(request));

          const update: Record<string, boolean> = {};
          if (input.editor !== undefined) update.editor_revenue_visible = input.editor;
          if (input.setter !== undefined) update.setter_revenue_visible = input.setter;

          const { data, error } = await service
            .from("workspaces")
            .update(update)
            .eq("id", ctx.workspaceId)
            .select("id")
            .maybeSingle();
          // Nothing is reported as saved unless the row was actually written.
          if (error || !data)
            return json({ error: "REVENUE_VISIBILITY_UNAVAILABLE" }, { status: 503 });

          // Answer with what is now stored, read back — not with what was asked for.
          const stored = await readRevenueVisibility(service, ctx.workspaceId);
          if (!stored.available)
            return json({ error: "REVENUE_VISIBILITY_UNAVAILABLE" }, { status: 503 });
          return json({
            data: {
              editor: stored.settings.editor,
              setter: stored.settings.setter,
              canView: access.canView,
              canManage: true,
              available: true,
            },
          });
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
