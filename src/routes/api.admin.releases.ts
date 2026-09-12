import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const semver = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/, "Use semantic versioning, e.g. 1.5.0");

const createSchema = z.object({
  version: semver,
  releaseName: z.string().trim().max(120).nullable().optional(),
  releaseNotes: z.string().trim().max(4000).nullable().optional(),
  minimumSupportedVersion: semver.nullable().optional(),
  status: z.enum(["draft", "testing"]).default("draft"),
  buildNumber: z.string().trim().max(60).nullable().optional(),
});

const editSchema = z.object({
  releaseName: z.string().trim().max(120).nullable().optional(),
  releaseNotes: z.string().trim().max(4000).nullable().optional(),
  minimumSupportedVersion: semver.nullable().optional(),
  buildNumber: z.string().trim().max(60).nullable().optional(),
  status: z.enum(["draft", "testing", "deprecated"]).optional(),
});

const idSchema = z.string().uuid();

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

export const Route = createFileRoute("/api/admin/releases")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "manage_releases");
          const { data, error } = await client
            .from("app_releases")
            .select("*")
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Creates a release record only — never touches is_current. See
      // api.admin.releases.publish.ts for making a release the active one.
      POST: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_releases");
          const service = createServiceSupabaseClient();
          const input = createSchema.parse(await parseJson(request));

          const { data: existing } = await service
            .from("app_releases")
            .select("id")
            .eq("version", input.version)
            .maybeSingle();
          if (existing) return json({ error: "VERSION_ALREADY_EXISTS" }, { status: 409 });

          const { data, error } = await service
            .from("app_releases")
            .insert({
              version: input.version,
              release_name: input.releaseName ?? null,
              release_notes: input.releaseNotes ?? null,
              minimum_supported_version: input.minimumSupportedVersion ?? null,
              status: input.status,
              build_number: input.buildNumber ?? null,
              created_by: user.id,
            })
            .select()
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "release_created",
            target: input.version,
            newValue: input,
          });

          return json({ data }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Metadata edits only. Deprecating the CURRENT release is refused — publish a replacement
      // first, so the app is never left with no current release.
      PATCH: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_releases");
          const service = createServiceSupabaseClient();
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = editSchema.parse(await parseJson(request));

          const { data: existing } = await service
            .from("app_releases")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (!existing) return json({ error: "RELEASE_NOT_FOUND" }, { status: 404 });
          if (input.status === "deprecated" && existing.is_current) {
            return json({ error: "CANNOT_DEPRECATE_CURRENT_RELEASE" }, { status: 409 });
          }

          const update: Record<string, unknown> = {};
          if (input.releaseName !== undefined) update.release_name = input.releaseName;
          if (input.releaseNotes !== undefined) update.release_notes = input.releaseNotes;
          if (input.minimumSupportedVersion !== undefined)
            update.minimum_supported_version = input.minimumSupportedVersion;
          if (input.buildNumber !== undefined) update.build_number = input.buildNumber;
          if (input.status !== undefined) update.status = input.status;

          const { data: updated, error } = await service
            .from("app_releases")
            .update(update)
            .eq("id", id)
            .select()
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: input.status === "deprecated" ? "release_deprecated" : "release_edited",
            target: existing.version,
            oldValue: existing,
            newValue: input,
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
