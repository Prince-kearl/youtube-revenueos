import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";

const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  voice: z.string().trim().min(1).max(40),
  destinationId: z.string().uuid().nullable().optional(),
  customInstructions: z.string().trim().max(2000).nullable().optional(),
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

function withCookies(response: Response, setCookieHeaders: string[]) {
  return applySetCookies(response, setCookieHeaders);
}

function logDbError(
  operation: string,
  error: { code?: string; message: string; details?: string; hint?: string },
) {
  console.error("description_templates request failed", {
    operation,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/description-templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const { data, error } = await client
            .from("description_templates")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("name", { ascending: true });
          if (error) {
            logDbError("select", error);
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
          return withCookies(json({ data }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } =
            await getWorkspaceContext(request);
          const input = templateSchema.parse(await parseJson(request));
          const { data, error } = await client
            .from("description_templates")
            .insert({
              name: input.name,
              voice: input.voice,
              destination_id: input.destinationId ?? null,
              custom_instructions: input.customInstructions ?? null,
              created_by: user.id,
              workspace_id: workspaceId,
            })
            .select()
            .single();
          if (error) {
            logDbError("insert", error);
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
          return withCookies(json({ data }, { status: 201 }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const { error, count } = await client
            .from("description_templates")
            .delete({ count: "exact" })
            .eq("id", id)
            .eq("workspace_id", workspaceId);
          if (error) {
            logDbError("delete", error);
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
          if (!count) {
            return withCookies(json({ error: "NOT_FOUND" }, { status: 404 }), setCookieHeaders);
          }
          return withCookies(json({ success: true }), setCookieHeaders);
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
