import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const patchSchema = z.object({
  role: z.enum(["user", "editor", "setter", "manager", "owner", "superadmin"]),
  featureId: z.string().uuid(),
  enabled: z.boolean(),
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

const featureColumns = "*, role_feature_access(*)";

export const Route = createFileRoute("/api/admin/features")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "manage_features");
          const { data, error } = await client
            .from("features")
            .select(featureColumns)
            .order("sort_order", { ascending: true });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Toggles a single (role, feature) pair. Writes go through the service-role client because
      // role_feature_access has no client-writable RLS policy — only requireAdminUser having
      // already verified this caller is a real admin makes the write safe.
      PATCH: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_features");
          const service = createServiceSupabaseClient();
          const input = patchSchema.parse(await parseJson(request));

          const { data: feature } = await service
            .from("features")
            .select("id, key, name, is_system_feature")
            .eq("id", input.featureId)
            .maybeSingle();
          if (!feature) return json({ error: "FEATURE_NOT_FOUND" }, { status: 404 });

          // A protected system feature (currently just "dashboard") can never be turned off for
          // superadmin — that's the one guarantee against a Superadmin locking themselves out of
          // their own product experience via this system.
          if (feature.is_system_feature && input.role === "superadmin" && !input.enabled) {
            return json({ error: "CANNOT_DISABLE_SYSTEM_FEATURE_FOR_ADMIN" }, { status: 409 });
          }

          const { data: existing } = await service
            .from("role_feature_access")
            .select("id, enabled")
            .eq("role", input.role)
            .eq("feature_id", input.featureId)
            .maybeSingle();

          const { data: updated, error } = await service
            .from("role_feature_access")
            .upsert(
              {
                id: existing?.id,
                role: input.role,
                feature_id: input.featureId,
                enabled: input.enabled,
                updated_by: user.id,
              },
              { onConflict: "role,feature_id" },
            )
            .select()
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: input.enabled ? "feature_enabled" : "feature_disabled",
            target: `${feature.key} · ${input.role}`,
            oldValue: { enabled: existing?.enabled ?? true },
            newValue: { enabled: input.enabled },
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
