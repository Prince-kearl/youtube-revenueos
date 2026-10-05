import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { createWorkspaceSignedUploadUrl } from "@/lib/server/storage";
import { UPLOAD_PURPOSES, isUploadPurpose, newUploadPath } from "@/lib/server/uploads";

const inputSchema = z.object({
  purpose: z.string().refine(isUploadPurpose),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive(),
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

export const Route = createFileRoute("/api/uploads")({
  server: {
    handlers: {
      // Mints a signed upload URL so the browser can put a freebie/Knowledge Base file straight
      // into Storage (see uploads.ts for why). The route that later receives the returned path
      // re-verifies it with resolveFormUpload — the size declared here is only an early, friendly
      // rejection, not the enforcement.
      POST: async ({ request }) => {
        try {
          const { workspaceId } = await requireWorkspaceFeature(request, "freebie");
          let raw: unknown;
          try {
            raw = await request.json();
          } catch {
            return json({ error: "INVALID_JSON" }, { status: 400 });
          }
          const input = inputSchema.parse(raw);
          if (!isUploadPurpose(input.purpose))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (input.fileSize > UPLOAD_PURPOSES[input.purpose].maxBytes)
            return json({ error: "FILE_TOO_LARGE" }, { status: 413 });

          const path = newUploadPath(workspaceId, input.purpose, input.fileName);
          const signed = await createWorkspaceSignedUploadUrl(path);
          if (!signed) return json({ error: "UPLOAD_URL_FAILED" }, { status: 500 });
          return json({ data: { path, token: signed.token } }, { status: 201 });
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
