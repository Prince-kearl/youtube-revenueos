import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  resolveRevenueAccess,
  revenueHiddenResponse,
  type RevenueAccess,
} from "@/lib/server/revenue-visibility";
import {
  REVENUE_HIDDEN,
  REVENUE_VISIBLE,
  dealStageChangeNeedsRevenueAccess,
} from "@/lib/revenue-visibility";

// Brand deals. A deal's VALUE is money and follows the workspace's revenue visibility (see
// lib/server/revenue-visibility.ts); everything else about a deal is ordinary pipeline data that
// any member with the brand_deals feature may work with.
//
// Reading. The value column is not readable through the member-facing database role, so it is
// never part of a query on the caller's client. It is added to a response only for a caller who
// may see revenue, through the MoneyReader bound to the caller's own workspace. For anyone else
// each deal carries `value: null` and `value_hidden: true` — hidden, which is neither zero nor
// "not set".
//
// Writing. Deals are not writable through the member-facing database role at all (see the
// revenue-column-privacy migration), so every write happens here, with the service role, after
// these checks — and is always filtered by the caller's own workspace, which comes from their
// membership and never from the request:
//
//   * a member who may NOT see revenue can create a deal and edit its non-monetary fields, but
//     can never set, change, clear or remove an amount: a request that so much as names `value`
//     is refused (whatever it holds — a number, 0, null, a string), and so is deleting a deal,
//     which would destroy an amount they cannot see. A deal they create starts at the column's
//     default until someone who may see revenue sets it;
//     The same member cannot move a deal into or out of "contracted" or "completed" either,
//     nor create one there: those stages are what put a deal's value into the contracted and
//     closed totals, and they cannot know what that value is (see
//     dealStageChangeNeedsRevenueAccess). The check is on the caller's access and on the stage
//     asked for — never on the deal's value, which is not read to decide it. Editing other
//     fields of a deal that is already in one of those stages stays allowed;
//   * a member who MAY see revenue keeps the existing behaviour.
//
// Both schemas are strict allowlists: a key that is not listed fails validation instead of being
// dropped, so nothing in a request can reach a column this file does not name (workspace_id,
// user_id, id, created_at, closed_at…).

const idSchema = z.string().uuid();

const stageEnum = z.enum(["prospect", "pitched", "negotiating", "contracted", "completed"]);

const dealValue = z.number().finite().min(0).max(100_000_000);

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    contactName: z.string().trim().max(160).nullable().optional(),
    // Required for a member who may set it (checked in the handler); never accepted otherwise.
    value: dealValue.optional(),
    tag: z.string().trim().max(60).nullable().optional(),
    stage: stageEnum.default("prospect"),
    nextAction: z.string().trim().max(200).nullable().optional(),
    expectedCloseDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    assignedMemberId: z.string().uuid().nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    contactName: z.string().trim().max(160).nullable().optional(),
    value: dealValue.optional(),
    tag: z.string().trim().max(60).nullable().optional(),
    stage: stageEnum.optional(),
    nextAction: z.string().trim().max(200).nullable().optional(),
    expectedCloseDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    assignedMemberId: z.string().uuid().nullable().optional(),
  })
  .strict();

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

/** Whether a request body names the deal's value at all — before validation, so that a hidden
 * viewer sending `value: null`, `"5"`, `-1` or `0` is refused as a write to an amount rather
 * than answered with a validation message. */
function namesValue(body: unknown): boolean {
  return typeof body === "object" && body !== null && Object.hasOwn(body, "value");
}

/** Everything about a deal except its value. Safe on the caller's own client. */
const dealColumns =
  "id, name, contact_name, currency, tag, stage, next_action, expected_close_date, closed_at, notes, assigned_member_id, created_at, updated_at";

type DealRow = Record<string, unknown> & { id: string };

/** The rows as this caller may see them: with their values when the caller may see revenue,
 * otherwise with the value withheld and marked as such. A failed value read throws rather than
 * passing a deal off as having no value. */
async function withValues(
  rows: DealRow[],
  access: RevenueAccess,
): Promise<Array<DealRow & { value: number | null; value_hidden: boolean }>> {
  if (!access.money) return rows.map((row) => ({ ...row, value: null, value_hidden: true }));
  if (rows.length === 0) return [];
  let values: Map<string, number | null>;
  try {
    values = await access.money.dealValues(rows.map((row) => row.id));
  } catch {
    throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  }
  return rows.map((row) => ({ ...row, value: values.get(row.id) ?? null, value_hidden: false }));
}

const visibilityOf = (access: RevenueAccess) => (access.canView ? REVENUE_VISIBLE : REVENUE_HIDDEN);

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
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          const { client, workspaceId } = ctx;
          const access = await resolveRevenueAccess(ctx);
          const { data, error } = await client
            .from("deals")
            .select(dealColumns)
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({
            data: await withValues((data ?? []) as unknown as DealRow[], access),
            visibility: visibilityOf(access),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          const { client, user, workspaceId } = ctx;
          const service = createServiceSupabaseClient();
          const access = await resolveRevenueAccess(ctx, service);
          const body = await parseJson(request);
          // An amount may be set only by a member who may see amounts. Refused before the body
          // is validated and before anything is read or written.
          if (namesValue(body) && !access.canWrite) return revenueHiddenResponse();
          const input = createSchema.parse(body);
          // A deal cannot be created straight into a stage that counts as contracted or earned
          // by someone who may not see amounts. Refused before anything is read or written.
          if (!access.canWrite && dealStageChangeNeedsRevenueAccess(null, input.stage))
            return revenueHiddenResponse();
          // For a member who may set it, a deal still needs its value, as it always has.
          if (access.canWrite && input.value === undefined)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (input.assignedMemberId) {
            await assertOwnedMember(client, workspaceId, input.assignedMemberId);
          }
          const { data, error } = await service
            .from("deals")
            .insert({
              // Always the caller's own identity and workspace — never from the request.
              user_id: user.id,
              workspace_id: workspaceId,
              name: input.name,
              contact_name: input.contactName ?? null,
              // Left to the column default for a member who may not set amounts.
              ...(access.canWrite ? { value: input.value } : {}),
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
          const [created] = await withValues([data as unknown as DealRow], access);
          return json({ data: created, visibility: visibilityOf(access) }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          const { client, workspaceId } = ctx;
          const service = createServiceSupabaseClient();
          const access = await resolveRevenueAccess(ctx, service);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const body = await parseJson(request);
          // Changing an amount you are not allowed to see would be a blind overwrite of someone
          // else's figure — including overwriting it with 0 or clearing it. Refused before the
          // body is validated and before anything is read or written.
          if (namesValue(body) && !access.canWrite) return revenueHiddenResponse();
          const input = updateSchema.parse(body);
          if (input.assignedMemberId) {
            await assertOwnedMember(client, workspaceId, input.assignedMemberId);
          }

          // On the caller's own client: row-level security and the workspace filter together
          // make another workspace's deal "not found".
          const { data: existing } = await client
            .from("deals")
            .select("closed_at, stage")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (!existing) return json({ error: "DEAL_NOT_FOUND" }, { status: 404 });

          // The stage only counts as changing when it actually differs: a request that repeats
          // the deal's current stage (as the edit form does) writes nothing about the stage.
          const currentStage = (existing.stage as string | null) ?? null;
          const newStage =
            input.stage !== undefined && input.stage !== currentStage ? input.stage : undefined;
          // Entering or leaving "contracted" / "completed" needs revenue access. Decided from
          // the caller's access and the two stages alone — the deal's value is never read for
          // it. Refused before anything is written, permitted fields included.
          if (!access.canWrite && dealStageChangeNeedsRevenueAccess(currentStage, newStage))
            return revenueHiddenResponse();

          const update: Record<string, unknown> = {
            ...stageSideEffect(newStage, existing.closed_at),
          };
          if (input.name !== undefined) update.name = input.name;
          if (input.contactName !== undefined) update.contact_name = input.contactName;
          if (input.value !== undefined && access.canWrite) update.value = input.value;
          if (input.tag !== undefined) update.tag = input.tag;
          if (newStage !== undefined) update.stage = newStage;
          if (input.nextAction !== undefined) update.next_action = input.nextAction;
          if (input.expectedCloseDate !== undefined)
            update.expected_close_date = input.expectedCloseDate;
          if (input.notes !== undefined) update.notes = input.notes;
          if (input.assignedMemberId !== undefined)
            update.assigned_member_id = input.assignedMemberId;

          const { data, error } = await service
            .from("deals")
            .update(update)
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .select(dealColumns)
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const [updated] = await withValues([data as unknown as DealRow], access);
          return json({ data: updated, visibility: visibilityOf(access) });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          const { workspaceId } = ctx;
          const service = createServiceSupabaseClient();
          const access = await resolveRevenueAccess(ctx, service);
          // Deleting a deal removes its amount. A member who may not see amounts may not destroy
          // one either (nor delete a deal and re-create it to reset its value).
          if (!access.canWrite) return revenueHiddenResponse();
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { error } = await service
            .from("deals")
            .delete()
            .eq("id", id)
            .eq("workspace_id", workspaceId);
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
