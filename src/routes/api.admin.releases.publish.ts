import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const bodySchema = z.object({ id: z.string().uuid() });

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

// Marking a release "current" and "rolling back" to an older one are the exact same mechanical
// operation — this app has no integration with the actual deployment/infrastructure layer, so
// neither one touches source code, migrations, or the live Vercel deployment. This only ever
// changes Tubify's own release *metadata*. The audit action name reflects which direction it was
// (older version becoming current = rollback) purely for a legible history, per the spec's
// explicit instruction never to imply a real infrastructure rollback happened.
export const Route = createFileRoute("/api/admin/releases/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_releases");
          const service = createServiceSupabaseClient();
          const input = bodySchema.parse(await parseJson(request));

          const { data: target } = await service
            .from("app_releases")
            .select("*")
            .eq("id", input.id)
            .maybeSingle();
          if (!target) return json({ error: "RELEASE_NOT_FOUND" }, { status: 404 });
          if (target.is_current) return json({ error: "ALREADY_CURRENT" }, { status: 409 });

          const { data: previousCurrent } = await service
            .from("app_releases")
            .select("id, version, created_at")
            .eq("is_current", true)
            .maybeSingle();
          const isRollback = Boolean(
            previousCurrent && new Date(target.created_at) < new Date(previousCurrent.created_at),
          );

          // Clear the old current row first — the partial unique index only allows one is_current
          // row at a time, so this order avoids a conflict (same pattern as plan price changes).
          if (previousCurrent) {
            // The outgoing release becomes "rolled_back" if we're moving to an older version
            // (that's what "rollback" means here), or "deprecated" if moving forward to a newer
            // one — a normal publish superseding it.
            await service
              .from("app_releases")
              .update({ is_current: false, status: isRollback ? "rolled_back" : "deprecated" })
              .eq("id", previousCurrent.id);
          }

          const { data: updated, error } = await service
            .from("app_releases")
            .update({
              is_current: true,
              status: "published",
              published_at: target.published_at ?? new Date().toISOString(),
            })
            .eq("id", target.id)
            .select()
            .single();
          if (error) {
            // Best-effort revert so a DB failure doesn't leave the app with zero current releases.
            if (previousCurrent) {
              await service
                .from("app_releases")
                .update({ is_current: true, status: "published" })
                .eq("id", previousCurrent.id);
            }
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: isRollback ? "release_rolled_back" : "release_published",
            target: target.version,
            oldValue: previousCurrent ? { currentVersion: previousCurrent.version } : null,
            newValue: { currentVersion: target.version },
          });

          return json({ data: updated });
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
