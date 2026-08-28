import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies, requireSessionUser } from "@/lib/server/supabase-ssr";

const destinationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40),
  url: z.string().url().max(2048),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
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

export const Route = createFileRoute("/api/destinations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, setCookieHeaders } = await requireSessionUser(request);
          const url = new URL(request.url);
          const status = url.searchParams.get("status");
          const query = client
            .from("destinations")
            .select("*")
            .order("created_at", { ascending: false });
          const result =
            status === "active" || status === "archived"
              ? await query.eq("status", status)
              : await query;
          if (result.error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          return withCookies(json({ data: result.data }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user, setCookieHeaders } = await requireSessionUser(request);
          const input = destinationSchema.parse(await parseJson(request));
          const { data, error } = await client
            .from("destinations")
            .insert({ ...input, user_id: user.id })
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
      PATCH: async ({ request }) => {
        try {
          const { client, setCookieHeaders } = await requireSessionUser(request);
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const input = destinationSchema.partial().parse(await parseJson(request));
          const { data, error } = await client
            .from("destinations")
            .update(input)
            .eq("id", id)
            .select()
            .single();
          if (error) {
            const notFound = error.code === "PGRST116";
            return withCookies(
              json(
                { error: notFound ? "NOT_FOUND" : "DATABASE_ERROR" },
                { status: notFound ? 404 : 500 },
              ),
              setCookieHeaders,
            );
          }
          return withCookies(json({ data }), setCookieHeaders);
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
          const { error } = await client.from("destinations").delete().eq("id", id);
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
