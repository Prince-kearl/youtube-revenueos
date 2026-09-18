import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";

const idSchema = z.string().uuid();

const stageEnum = z.enum(["prospect", "pitched", "negotiating", "contracted", "completed"]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(160).nullable().optional(),
  value: z.number().min(0).max(100_000_000),
  tag: z.string().trim().max(60).nullable().optional(),
  stage: stageEnum.default("prospect"),
  nextAction: z.string().trim().max(200).nullable().optional(),
  expectedCloseDate: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  assignedMemberId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  contactName: z.string().trim().max(160).nullable().optional(),
  value: z.number().min(0).max(100_000_000).optional(),
  tag: z.string().trim().max(60).nullable().optional(),
  stage: stageEnum.optional(),
  nextAction: z.string().trim().max(200).nullable().optional(),
  expectedCloseDate: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  assignedMemberId: z.string().uuid().nullable().optional(),
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

const dealColumns =
  "id, name, contact_name, value, currency, tag, stage, next_action, expected_close_date, closed_at, notes, assigned_member_id, created_at, updated_at";

// completed_at mirrors closed_at automatically: entering the 'completed' stage stamps closed_at
// for real (once, not overwritten on later edits), leaving it clears it — so "closed" always
// reflects the deal's actual current stage rather than a value the UI could forget to update.
function stageSideEffect(stage: string | undefined, existingClosedAt: string | null | undefined) {
  if (stage === undefined) return {};
  if (stage === "completed") return { closed_at: existingClosedAt ?? new Date().toISOString() };
  return { closed_at: null };
}

type SupabaseClientLike = Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"];

async function assertOwnedMember(client: SupabaseClientLike, workspaceId: string, id: string) {
  const { data, error } = await client
    .from("workspace_members")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });
}

export const Route = createFileRoute("/api/deals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(request, "brand_deals");
          const { data, error } = await client
            .from("deals")
            .select(dealColumns)
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
          const { client, user, workspaceId } = await requireWorkspaceFeature(
            request,
            "brand_deals",
          );
          const input = createSchema.parse(await parseJson(request));
          if (input.assignedMemberId) {
            await assertOwnedMember(client, workspaceId, input.assignedMemberId);
          }
          const { data, error } = await client
            .from("deals")
            .insert({
              user_id: user.id,
              workspace_id: workspaceId,
              name: input.name,
              contact_name: input.contactName ?? null,
              value: input.value,
              tag: input.tag ?? null,
              stage: input.stage,
              next_action: input.nextAction ?? null,
              expected_close_date: input.expectedCloseDate ?? null,
              notes: input.notes ?? null,
              assigned_member_id: input.assignedMemberId ?? null,
              ...stageSideEffect(input.stage, null),
            })
            .select(dealColumns)
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
          const { client, workspaceId } = await requireWorkspaceFeature(request, "brand_deals");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = updateSchema.parse(await parseJson(request));
          if (input.assignedMemberId) {
            await assertOwnedMember(client, workspaceId, input.assignedMemberId);
          }

          const { data: existing } = await client
            .from("deals")
            .select("closed_at")
            .eq("id", id)
            .maybeSingle();
          if (!existing) return json({ error: "DEAL_NOT_FOUND" }, { status: 404 });

          const update: Record<string, unknown> = {
            ...stageSideEffect(input.stage, existing.closed_at),
          };
          if (input.name !== undefined) update.name = input.name;
          if (input.contactName !== undefined) update.contact_name = input.contactName;
          if (input.value !== undefined) update.value = input.value;
          if (input.tag !== undefined) update.tag = input.tag;
          if (input.stage !== undefined) update.stage = input.stage;
          if (input.nextAction !== undefined) update.next_action = input.nextAction;
          if (input.expectedCloseDate !== undefined)
            update.expected_close_date = input.expectedCloseDate;
          if (input.notes !== undefined) update.notes = input.notes;
          if (input.assignedMemberId !== undefined)
            update.assigned_member_id = input.assignedMemberId;

          const { data, error } = await client
            .from("deals")
            .update(update)
            .eq("id", id)
            .select(dealColumns)
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
          const { client } = await requireWorkspaceFeature(request, "brand_deals");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { error } = await client.from("deals").delete().eq("id", id);
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
