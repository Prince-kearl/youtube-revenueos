import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies, requireSessionUser } from "@/lib/server/supabase-ssr";
import { generateProjectConcept } from "@/lib/server/ai-generation";

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
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

export const Route = createFileRoute("/api/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, setCookieHeaders } = await requireSessionUser(request);
          const { data, error } = await client
            .from("projects")
            .select("*")
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
      // Synchronous create+generate: the AI call happens inside this request rather than through
      // a separate polling step, since it resolves in a few seconds and the old mock flow already
      // awaited generation immediately after creating the job client-side.
      POST: async ({ request }) => {
        try {
          const { client, user, setCookieHeaders } = await requireSessionUser(request);
          const input = createProjectSchema.parse(await parseJson(request));

          let generation: Awaited<ReturnType<typeof generateProjectConcept>>;
          try {
            generation = await generateProjectConcept(input);
          } catch (error) {
            if (error instanceof Error && error.message === "AI_PROVIDER_NOT_CONFIGURED") {
              return withCookies(
                json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 }),
                setCookieHeaders,
              );
            }
            // Generation failed after we'd normally have a job — persist the failure so it shows
            // up as a real "Failed" project instead of silently vanishing.
            const { data, error: insertError } = await client
              .from("projects")
              .insert({
                ...input,
                user_id: user.id,
                status: "failed",
                error: "Generation failed. Try creating the project again.",
              })
              .select()
              .single();
            if (insertError)
              return withCookies(
                json({ error: "DATABASE_ERROR" }, { status: 500 }),
                setCookieHeaders,
              );
            return withCookies(json({ data }, { status: 201 }), setCookieHeaders);
          }

          const { data, error } = await client
            .from("projects")
            .insert({ ...input, user_id: user.id, status: "completed", output: generation })
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
          const { client, setCookieHeaders } = await requireSessionUser(request);
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const { error } = await client.from("projects").delete().eq("id", id);
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
