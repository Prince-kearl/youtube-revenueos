import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

const idSchema = z.string().uuid();

const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.enum(["Instagram", "YouTube Comment", "Email"]),
  username: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  source: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateLeadSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  username: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["new", "contacted", "qualified", "call_booked", "converted", "lost"]).optional(),
  assignedTo: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  unread: z.boolean().optional(),
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

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const { data, error } = await client
            .from("leads")
            .select("*")
            .order("pinned", { ascending: false })
            .order("updated_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const input = createLeadSchema.parse(await parseJson(request));
          const { data, error } = await client
            .from("leads")
            .insert({
              user_id: user.id,
              name: input.name,
              platform: input.platform,
              username: input.username ?? null,
              email: input.email ?? null,
              source: input.source ?? null,
              notes: input.notes ?? null,
              unread: false,
            })
            .select()
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = updateLeadSchema.parse(await parseJson(request));
          const update: Record<string, unknown> = {};
          if (input.name !== undefined) update.name = input.name;
          if (input.username !== undefined) update.username = input.username;
          if (input.email !== undefined) update.email = input.email;
          if (input.notes !== undefined) update.notes = input.notes;
          if (input.status !== undefined) update.status = input.status;
          if (input.assignedTo !== undefined) update.assigned_to = input.assignedTo;
          if (input.tags !== undefined) update.tags = input.tags;
          if (input.pinned !== undefined) update.pinned = input.pinned;
          if (input.muted !== undefined) update.muted = input.muted;
          if (input.favorite !== undefined) update.favorite = input.favorite;
          if (input.archived !== undefined) update.archived = input.archived;
          if (input.unread !== undefined) update.unread = input.unread;
          const { data, error } = await client
            .from("leads")
            .update(update)
            .eq("id", id)
            .select()
            .single();
          if (error) {
            const notFound = error.code === "PGRST116";
            return json(
              { error: notFound ? "NOT_FOUND" : "DATABASE_ERROR" },
              { status: notFound ? 404 : 500 },
            );
          }
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client } = await requireSessionUser(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { error } = await client.from("leads").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
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
