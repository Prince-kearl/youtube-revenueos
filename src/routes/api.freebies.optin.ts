import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { signedWorkspaceFileUrl } from "@/lib/server/storage";

// Trading an email for the freebie — the real point of a lead magnet. Runs entirely on the
// service client (public/unauthenticated visitor, like r.$slug.ts) and does two things atomically
// enough for this app's scale: records the opt-in, AND upserts a real "Email" lead into the same
// Lead Inbox every other channel feeds, so a launched freebie actually feeds the CRM instead of
// just logging a download.
const optinSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/i)
    .max(60),
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).nullable().optional(),
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

export const Route = createFileRoute("/api/freebies/optin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const input = optinSchema.parse(await parseJson(request));
          const service = createServiceSupabaseClient();

          const { data: magnet, error: magnetError } = await service
            .from("lead_magnets")
            .select("id, workspace_id, title, source, content, file_path, file_name")
            .eq("slug", input.slug)
            .eq("status", "published")
            .maybeSingle();
          if (magnetError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!magnet) return json({ error: "NOT_FOUND" }, { status: 404 });

          const { data: workspace } = await service
            .from("workspaces")
            .select("owner_id")
            .eq("id", magnet.workspace_id)
            .maybeSingle();
          if (!workspace) return json({ error: "NOT_FOUND" }, { status: 404 });

          const email = input.email.toLowerCase();
          const displayName = input.name?.trim() || email.split("@")[0];
          const noteText = `Opted in for "${magnet.title}"`;

          const { data: existingLead } = await service
            .from("leads")
            .select("id")
            .eq("workspace_id", magnet.workspace_id)
            .eq("platform", "Email")
            .ilike("email", email)
            .maybeSingle();

          let leadId: string;
          if (existingLead) {
            leadId = existingLead.id;
            await service
              .from("leads")
              .update({ unread: true, updated_at: new Date().toISOString() })
              .eq("id", leadId);
          } else {
            const { data: newLead, error: leadError } = await service
              .from("leads")
              .insert({
                user_id: workspace.owner_id,
                workspace_id: magnet.workspace_id,
                name: displayName,
                email,
                platform: "Email",
                status: "new",
                source: noteText,
                unread: true,
              })
              .select("id")
              .single();
            if (leadError || !newLead) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            leadId = newLead.id;
          }

          await service
            .from("lead_messages")
            .insert({ lead_id: leadId, from_who: "system", kind: "note", text: noteText });

          await service.from("lead_magnet_optins").insert({
            lead_magnet_id: magnet.id,
            workspace_id: magnet.workspace_id,
            email,
            name: input.name ?? null,
            lead_id: leadId,
          });

          if (magnet.source === "uploaded") {
            const downloadUrl = magnet.file_path
              ? await signedWorkspaceFileUrl(magnet.file_path, 60 * 60 * 24)
              : null;
            if (!downloadUrl) return json({ error: "FILE_UNAVAILABLE" }, { status: 500 });
            return json({ data: { kind: "file", downloadUrl, fileName: magnet.file_name } });
          }

          if (!magnet.content) return json({ error: "CONTENT_UNAVAILABLE" }, { status: 500 });
          return json({ data: { kind: "content", content: magnet.content, title: magnet.title } });
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
