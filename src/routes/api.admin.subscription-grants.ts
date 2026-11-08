import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { trustedLivemode } from "@/lib/server/stripe-mode";
import {
  GRANT_PLANS,
  MAX_GRANT_DAYS,
  grantActionError,
  grantEnd,
  readActiveGrant,
  type GrantActionError,
} from "@/lib/server/subscription-grants";

// Admin-granted subscriptions: give a user a paid plan for a number of days or with no end,
// without payment; extend it; revoke it. No Stripe request is ever made.
//
//   GET  ?userId=<uuid>   the user's current grant and its history
//   POST {action: "grant" | "extend" | "revoke", ...}
//
// Admin only: a signed-in Superadmin with manage_billing (requirePermission checks the session,
// console access and the permission, on the server, before anything is read). Every request is
// validated by a strict schema. Every write is one database function that records the grant, its
// history and the admin audit entry in the same transaction (the migration's header). A grant
// id that does not exist, or that belongs to another user, gets the same 404. A user who already
// pays through Stripe cannot be given a grant (one subscription per user), and a user can have
// only one active grant (a unique index; a second is refused with 409).

const STRIPE_HELD_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete"] as const;
const HISTORY_LIMIT = 20;

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

const reason = z.string().trim().min(3, "A reason of at least 3 characters is required").max(500);
const duration = z.union([
  z.literal("lifetime"),
  z.strictObject({ days: z.number().int().min(1).max(MAX_GRANT_DAYS) }),
]);

const bodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("grant"),
    userId: z.string().uuid(),
    plan: z.enum(GRANT_PLANS),
    duration,
    reason,
  }),
  z.strictObject({
    action: z.literal("extend"),
    userId: z.string().uuid(),
    grantId: z.string().uuid(),
    /** Days added to the current end, or no end. */
    duration,
    reason,
  }),
  z.strictObject({
    action: z.literal("revoke"),
    userId: z.string().uuid(),
    grantId: z.string().uuid(),
    reason,
  }),
]);

const STATUS: Record<GrantActionError, number> = {
  ACTIVE_GRANT_EXISTS: 409,
  GRANT_NOT_FOUND: 404,
  GRANT_ALREADY_LIFETIME: 409,
  GRANT_NOT_LATER: 422,
  GRANT_END_IN_PAST: 422,
  GRANTS_NOT_AVAILABLE: 503,
  DATABASE_ERROR: 500,
};

type GrantRow = {
  id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
};

const summary = (row: GrantRow) => ({
  id: row.id,
  plan: row.plan_id,
  status: row.status,
  startsAt: row.starts_at,
  expiresAt: row.expires_at,
});

export const Route = createFileRoute("/api/admin/subscription-grants")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requirePermission(request, "manage_billing");
          const parsed = z
            .string()
            .uuid()
            .safeParse(new URL(request.url).searchParams.get("userId"));
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const userId = parsed.data;
          const service = createServiceSupabaseClient();
          const { data: profile, error: profileError } = await service
            .from("profiles")
            .select("id")
            .eq("id", userId)
            .maybeSingle();
          if (profileError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!profile) return json({ error: "USER_NOT_FOUND" }, { status: 404 });

          const active = await readActiveGrant(service, userId);
          if (!active.ok) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          let current = null;
          if (active.grant) {
            const { data, error } = await service
              .from("subscription_grants")
              .select("id, plan_id, status, starts_at, expires_at, reason, granted_by")
              .eq("id", active.grant.id)
              .eq("user_id", userId)
              .maybeSingle();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            if (data) current = { ...summary(data as GrantRow), reason: data.reason as string };
          }
          const { data: events, error: eventsError } = await service
            .from("subscription_grant_events")
            .select("event, reason, actor_id, new_value, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(HISTORY_LIMIT);
          // Not applied yet: no history, the same as no grant.
          const history = eventsError ? [] : (events ?? []);
          const actorIds = [
            ...new Set(history.map((e) => e.actor_id as string | null).filter(Boolean)),
          ] as string[];
          const { data: actors } = actorIds.length
            ? await service.from("profiles").select("id, name").in("id", actorIds)
            : { data: [] as { id: string; name: string | null }[] };
          const actorName = new Map((actors ?? []).map((a) => [a.id as string, a.name as string]));

          return json({
            data: {
              current,
              history: history.map((e) => ({
                event: e.event,
                at: e.created_at,
                reason: e.reason ?? null,
                by: e.actor_id ? (actorName.get(e.actor_id as string) ?? "An admin") : null,
                plan: (e.new_value as { plan?: string } | null)?.plan ?? null,
                expiresAt:
                  (e.new_value as { expires_at?: string | null } | null)?.expires_at ?? null,
              })),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const { user: admin } = await requirePermission(request, "manage_billing");
          let raw: unknown;
          try {
            raw = await request.json();
          } catch {
            return json({ error: "INVALID_JSON" }, { status: 400 });
          }
          const parsed = bodySchema.safeParse(raw);
          if (!parsed.success)
            return json(
              { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message },
              { status: 422 },
            );
          const body = parsed.data;
          const service = createServiceSupabaseClient();

          const { data: profile, error: profileError } = await service
            .from("profiles")
            .select("id")
            .eq("id", body.userId)
            .maybeSingle();
          if (profileError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!profile) return json({ error: "USER_NOT_FOUND" }, { status: 404 });

          if (body.action === "grant") {
            // Platform staff already have every plan in their own workspaces; a grant to oneself
            // would only blur the audit trail.
            if (body.userId === admin.id)
              return json({ error: "SELF_GRANT_NOT_ALLOWED" }, { status: 403 });
            // One subscription per user: not while they hold a Stripe subscription.
            const livemode = trustedLivemode();
            if (livemode !== null) {
              const { data: held, error: heldError } = await service
                .from("subscriptions")
                .select("status")
                .eq("user_id", body.userId)
                .eq("livemode", livemode)
                .in("status", [...STRIPE_HELD_STATUSES])
                .limit(1);
              if (heldError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
              if (held && held.length)
                return json({ error: "PAID_SUBSCRIPTION_EXISTS" }, { status: 409 });
            }
            const { data, error } = await service.rpc("admin_grant_subscription", {
              p_admin_id: admin.id,
              p_user_id: body.userId,
              p_plan_id: body.plan,
              p_expires_at: grantEnd(body.duration, new Date()),
              p_reason: body.reason,
            });
            if (error) {
              const code = grantActionError(error);
              return json({ error: code }, { status: STATUS[code] });
            }
            return json({ data: summary(data as GrantRow) }, { status: 201 });
          }

          // Extend and revoke act on the user's current grant, by its id.
          const active = await readActiveGrant(service, body.userId);
          if (!active.ok) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!active.grant || active.grant.id !== body.grantId)
            return json({ error: "GRANT_NOT_FOUND" }, { status: 404 });

          if (body.action === "extend") {
            if (active.grant.expiresAt === null)
              return json({ error: "GRANT_ALREADY_LIFETIME" }, { status: 409 });
            const { data, error } = await service.rpc("admin_extend_subscription_grant", {
              p_admin_id: admin.id,
              p_grant_id: body.grantId,
              p_user_id: body.userId,
              p_expires_at: grantEnd(body.duration, new Date(active.grant.expiresAt)),
              p_reason: body.reason,
            });
            if (error) {
              const code = grantActionError(error);
              return json({ error: code }, { status: STATUS[code] });
            }
            return json({ data: summary(data as GrantRow) });
          }

          const { data, error } = await service.rpc("admin_revoke_subscription_grant", {
            p_admin_id: admin.id,
            p_grant_id: body.grantId,
            p_user_id: body.userId,
            p_reason: body.reason,
          });
          if (error) {
            const code = grantActionError(error);
            return json({ error: code }, { status: STATUS[code] });
          }
          return json({ data: summary(data as GrantRow) });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
