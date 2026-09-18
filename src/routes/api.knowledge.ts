import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { uploadWorkspaceFile, deleteWorkspaceFile, workspaceFilePath } from "@/lib/server/storage";
import { extractTextFromFile } from "@/lib/server/text-extraction";

// Real backing for the Freebie page's Knowledge Base: pasted notes or uploaded files (transcripts,
// sheets, docs) a creator drops in so AI Lab/Freebie generation can be grounded in their own
// material instead of inventing everything. `lead_magnet_id` null = usable by any freebie in the
// workspace; set = attached to one specific freebie (see api.freebies.ts, which reparents a
// freshly-uploaded "just for this freebie" file onto the new row once generation succeeds).
const MAX_FILE_BYTES = 15 * 1024 * 1024;

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

async function assertOwnedLeadMagnet(
  client: Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"],
  id: string,
) {
  const { data, error } = await client.from("lead_magnets").select("id").eq("id", id).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "FREEBIE_NOT_FOUND" }, { status: 404 });
}

export const Route = createFileRoute("/api/knowledge")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(request, "freebie");
          const url = new URL(request.url);
          const rawLeadMagnetId = url.searchParams.get("leadMagnetId");
          const leadMagnetId = rawLeadMagnetId ? idSchema.parse(rawLeadMagnetId) : null;

          let query = client
            .from("knowledge_items")
            .select(
              "id, title, kind, content, file_name, file_type, file_size, extraction_status, lead_magnet_id, created_at",
            )
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          query = leadMagnetId
            ? query.eq("lead_magnet_id", leadMagnetId)
            : query.is("lead_magnet_id", null);
          const { data, error } = await query;
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(request, "freebie");
          const form = await request.formData();
          const title = String(form.get("title") ?? "").trim();
          const kind = String(form.get("kind") ?? "");
          const rawLeadMagnetId = form.get("leadMagnetId");
          const leadMagnetId =
            rawLeadMagnetId && String(rawLeadMagnetId).trim()
              ? idSchema.parse(String(rawLeadMagnetId))
              : null;
          if (!title || title.length > 200)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (kind !== "note" && kind !== "file")
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (leadMagnetId) await assertOwnedLeadMagnet(client, leadMagnetId);

          if (kind === "note") {
            const content = String(form.get("content") ?? "").trim();
            if (!content) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
            const { data, error } = await client
              .from("knowledge_items")
              .insert({
                workspace_id: workspaceId,
                created_by: user.id,
                lead_magnet_id: leadMagnetId,
                title,
                kind: "note",
                content: content.slice(0, 200_000),
                extraction_status: "ready",
              })
              .select(
                "id, title, kind, content, file_name, file_type, file_size, extraction_status, lead_magnet_id, created_at",
              )
              .single();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            return json({ data }, { status: 201 });
          }

          const file = form.get("file");
          if (!(file instanceof File) || file.size === 0)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (file.size > MAX_FILE_BYTES) return json({ error: "FILE_TOO_LARGE" }, { status: 413 });

          const path = workspaceFilePath(workspaceId, "knowledge", crypto.randomUUID(), file.name);
          const { error: uploadError } = await uploadWorkspaceFile(path, file);
          if (uploadError) return json({ error: "UPLOAD_FAILED" }, { status: 500 });

          const extraction = await extractTextFromFile(file);
          const { data, error } = await client
            .from("knowledge_items")
            .insert({
              workspace_id: workspaceId,
              created_by: user.id,
              lead_magnet_id: leadMagnetId,
              title,
              kind: "file",
              content: extraction.content,
              file_path: path,
              file_name: file.name,
              file_type: file.type || null,
              file_size: file.size,
              extraction_status: extraction.status,
            })
            .select(
              "id, title, kind, content, file_name, file_type, file_size, extraction_status, lead_magnet_id, created_at",
            )
            .single();
          if (error) {
            await deleteWorkspaceFile(path);
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          return json({ data }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(request, "freebie");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { data: existing, error: existingError } = await client
            .from("knowledge_items")
            .select("id, file_path")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (existingError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!existing) return json({ error: "NOT_FOUND" }, { status: 404 });

          const { error } = await client.from("knowledge_items").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (existing.file_path) await deleteWorkspaceFile(existing.file_path);
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
