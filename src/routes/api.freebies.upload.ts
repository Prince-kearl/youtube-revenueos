import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { deleteWorkspaceFile } from "@/lib/server/storage";
import { resolveFormUpload } from "@/lib/server/uploads";

// The "just upload your own finished freebie" path — no AI involved. A creator who already has a
// PDF/deck/etc. can skip generation entirely and go straight to publishing it (see api.freebies.ts
// PATCH ?action=publish, which requires either real content or a real file_path before allowing
// publish). The file itself arrives via a direct-to-Storage upload (see uploads.ts); the size
// limit lives there too.

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
          if (!title || title.length > 120)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const upload = await resolveFormUpload(form, workspaceId, "freebies");
          if (!upload) return json({ error: "VALIDATION_ERROR" }, { status: 422 });

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
              file_path: upload.path,
              file_name: upload.name,
              file_type: upload.type,
            })
            .select()
            .single();
          if (error) {
            await deleteWorkspaceFile(upload.path);
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
