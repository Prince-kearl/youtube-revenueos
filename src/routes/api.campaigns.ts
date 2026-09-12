import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";

const idSchema = z.string().uuid();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  status: z.enum(["draft", "ready"]).default("draft"),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  status: z.enum(["draft", "ready"]).optional(),
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

export const Route = createFileRoute("/api/campaigns")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(request, "email");
          const { data, error } = await client
            .from("campaigns")
            .select("id, name, subject, body, status, created_at, updated_at")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId } = await requireWorkspaceFeature(request, "email");
          const input = createSchema.parse(await parseJson(request));
          const { data, error } = await client
            .from("campaigns")
            .insert({
              user_id: user.id,
              workspace_id: workspaceId,
              name: input.name,
              subject: input.subject,
              body: input.body,
              status: input.status,
            })
            .select("id, name, subject, body, status, created_at, updated_at")
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "email");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = updateSchema.parse(await parseJson(request));
          const { data, error } = await client
            .from("campaigns")
            .update(input)
            .eq("id", id)
            .select("id, name, subject, body, status, created_at, updated_at")
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "email");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { error } = await client.from("campaigns").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ success: true });
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
