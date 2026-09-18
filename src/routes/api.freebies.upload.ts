import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { deleteWorkspaceFile, uploadWorkspaceFile, workspaceFilePath } from "@/lib/server/storage";

// The "just upload your own finished freebie" path — no AI involved. A creator who already has a
// PDF/deck/etc. can skip generation entirely and go straight to publishing it (see api.freebies.ts
// PATCH ?action=publish, which requires either real content or a real file_path before allowing
// publish).
const MAX_FILE_BYTES = 25 * 1024 * 1024;

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

export const Route = createFileRoute("/api/freebies/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(request, "freebie");
          const form = await request.formData();
          const title = String(form.get("title") ?? "").trim();
          const file = form.get("file");
          if (!title || title.length > 120)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (!(file instanceof File) || file.size === 0)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (file.size > MAX_FILE_BYTES) return json({ error: "FILE_TOO_LARGE" }, { status: 413 });

          const path = workspaceFilePath(workspaceId, "freebies", crypto.randomUUID(), file.name);
          const { error: uploadError } = await uploadWorkspaceFile(path, file);
          if (uploadError) return json({ error: "UPLOAD_FAILED" }, { status: 500 });

          const { data, error } = await client
            .from("lead_magnets")
            .insert({
              user_id: user.id,
              workspace_id: workspaceId,
              title,
              product: title,
              audience: "—",
              tone: "—",
              format: "upload",
              content: null,
              source: "uploaded",
              status: "draft",
              file_path: path,
              file_name: file.name,
              file_type: file.type || null,
            })
            .select()
            .single();
          if (error) {
            await deleteWorkspaceFile(path);
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }
          return json({ data }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
