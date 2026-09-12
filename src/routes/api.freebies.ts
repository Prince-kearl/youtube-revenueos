import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { generateFreebieContent } from "@/lib/server/ai-generation";

const generateSchema = z.object({
  product: z.string().trim().min(1).max(200),
  audience: z.string().trim().min(1).max(200),
  tone: z.string().trim().min(1).max(200),
  format: z.string().trim().min(1).max(60),
  formatLabel: z.string().trim().min(1).max(60),
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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/freebies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "freebie",
          );
          const { data, error } = await client
            .from("lead_magnets")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          return withCookies(json({ data }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Synchronous generate+save, matching AI Lab's optimize route — nothing is persisted if
      // generation fails, since a failed attempt has no content worth keeping.
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "freebie",
          );
          const input = generateSchema.parse(await parseJson(request));

          let content: string;
          try {
            content = await generateFreebieContent({
              product: input.product,
              audience: input.audience,
              tone: input.tone,
              formatLabel: input.formatLabel,
            });
          } catch (error) {
            if (error instanceof Error && error.message === "AI_PROVIDER_NOT_CONFIGURED") {
              return withCookies(
                json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 }),
                setCookieHeaders,
              );
            }
            return withCookies(
              json({ error: "GENERATION_FAILED" }, { status: 502 }),
              setCookieHeaders,
            );
          }

          const title = `${input.product} ${input.formatLabel}`.slice(0, 120);
          const { data, error } = await client
            .from("lead_magnets")
            .insert({
              user_id: user.id,
              workspace_id: workspaceId,
              title,
              product: input.product,
              audience: input.audience,
              tone: input.tone,
              format: input.format,
              content,
            })
            .select()
            .single();
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
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
          const { client, setCookieHeaders } = await requireWorkspaceFeature(request, "freebie");
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const { error } = await client.from("lead_magnets").delete().eq("id", id);
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
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
