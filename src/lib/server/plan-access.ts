import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlatformSuperadmin } from "./platform-staff";

// What a WORKSPACE's subscription gives it — the one place plan access is decided (Phase 4B-2).
//
// A plan belongs to the workspace and is resolved through its owner, exactly like the team-
// management entitlement (lib/server/workspace-entitlements.ts):
//
//   workspace  →  workspaces.owner_id  →  that owner's subscription  →  plan  →  limits
//
// Only Tubify's own record of the subscription is read — kept current by the Stripe webhook,
// which writes Stripe's authoritative state (api.stripe.webhook.ts) — so no Stripe request is made
// while authorising a request. A subscription counts while it is "active" or "trialing": a trial
// gets its plan in full; a trial canceled before its end keeps it until Stripe ends it; past-due,
// unpaid, canceled, expired, incomplete and missing subscriptions, and any plan this file does
// not know, give no plan. A database error gives none either ("unavailable"). Everything here
// fails closed — and nothing here deletes or hides data: a workspace without a plan keeps all of
// it, and gets it back the moment a subscription is active again.

/**
 * The approved plans (Starter $29, Pro $79, Scale $199 a month). Prices live in Stripe and the
 * plans table; the limits are enforced here, on the server.
 */
export const PLAN_LIMITS = {
  starter: { channels: 1, aiAnalysesPerMonth: 5, teamManagement: false },
  pro: { channels: 3, aiAnalysesPerMonth: 50, teamManagement: false },
  scale: { channels: 10, aiAnalysesPerMonth: 250, teamManagement: true },
} as const;

export type PaidPlan = keyof typeof PLAN_LIMITS;
export type PlanLimits = (typeof PLAN_LIMITS)[PaidPlan];

export const TRIAL_DAYS = 14;

/**
 * Platform staff (profiles.role = "superadmin") get Scale in workspaces THEY ARE A MEMBER OF —
 * the same narrow exception team management already makes (workspace-entitlements.ts), for the
 * same reason: Tubify's own workspaces have no subscription. It waives the plan and nothing else;
 * every workspace role rule still applies, and it opens no other workspace.
 *
 * To retire it, set this to false.
 */
export const STAFF_PLAN_EXCEPTION_ENABLED = true;

export type WorkspacePlan =
  | {
      plan: PaidPlan;
      limits: PlanLimits;
      /** subscription: the owner's own; staff_exception: see below. */
      source: "subscription" | "staff_exception";
      status: "active" | "trialing";
      /** The end of the current period — the trial's end while trialing — when known. */
      periodEnd: string | null;
    }
  | { plan: null; limits: null; source: "none" | "unavailable"; status: null; periodEnd: null };

const NO_PLAN: WorkspacePlan = {
  plan: null,
  limits: null,
  source: "none",
  status: null,
  periodEnd: null,
};
const UNAVAILABLE: WorkspacePlan = {
  plan: null,
  limits: null,
  source: "unavailable",
  status: null,
  periodEnd: null,
};

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLAN_LIMITS, value);
}

/**
 * The plan of `workspaceId`, as it applies to its member `userId`.
 *
 * Both ids must come from the server's own authentication (the caller's session and their active
 * membership), never from the request. `service` is the service-role client: a member cannot read
 * the owner's subscription through row-level security, and must not be able to.
 *
 * With no subscription, platform staff get the staff exception (STAFF_PLAN_EXCEPTION_ENABLED).
 */
export async function resolveWorkspacePlan(
  service: SupabaseClient,
  input: { workspaceId: string; userId: string },
  options: { staffException: boolean } = { staffException: STAFF_PLAN_EXCEPTION_ENABLED },
): Promise<WorkspacePlan> {
  try {
    const { data: workspace, error: workspaceError } = await service
      .from("workspaces")
      .select("owner_id")
      .eq("id", input.workspaceId)
      .maybeSingle();
    if (workspaceError || !workspace?.owner_id) return UNAVAILABLE;
    const { data: subscription, error: subscriptionError } = await service
      .from("subscriptions")
      .select("plan_id, status, current_period_end")
      .eq("user_id", workspace.owner_id as string)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) return UNAVAILABLE;
    if (subscription && isPaidPlan(subscription.plan_id))
      return {
        plan: subscription.plan_id,
        limits: PLAN_LIMITS[subscription.plan_id],
        source: "subscription",
        status: subscription.status as "active" | "trialing",
        periodEnd: (subscription.current_period_end as string | null) ?? null,
      };
    if (options.staffException && (await isPlatformSuperadmin(service, input.userId)))
      return {
        plan: "scale",
        limits: PLAN_LIMITS.scale,
        source: "staff_exception",
        status: "active",
        periodEnd: null,
      };
    return NO_PLAN;
  } catch {
    return UNAVAILABLE;
  }
}

/** The refusal of a request that needs a plan the workspace does not have. */
export function subscriptionRequired(plan: WorkspacePlan): Response {
  const unavailable = plan.source === "unavailable";
  return new Response(
    JSON.stringify(
      unavailable
        ? {
            error: "ENTITLEMENT_UNAVAILABLE",
            message: "We couldn't check this workspace's subscription. Please try again.",
          }
        : {
            error: "SUBSCRIPTION_REQUIRED",
            message:
              "This workspace needs an active subscription. Start a 14-day trial or choose a plan in Billing — your data is kept.",
          },
    ),
    {
      status: unavailable ? 503 : 402,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    },
  );
}

// ---------- channels ----------

/**
 * The channel limit, for one channel about to be connected to a workspace. A channel counts while
 * it is connected (youtube_channels.connection_id set); a disconnected one keeps its row and its
 * history and does not count. Reconnecting a channel that is already connected is not a new
 * channel — renewing access is always allowed, at any plan and over any limit.
 *
 * A workspace over its limit (after a downgrade) keeps every channel it has, connected and synced
 * as before: nothing is deleted or detached. It cannot connect another until it is back under its
 * limit — by disconnecting one, or on a larger plan.
 *
 * Throws when the channels cannot be read: the caller refuses rather than guesses.
 */
export async function channelCapacity(
  client: SupabaseClient,
  input: { workspaceId: string; plan: WorkspacePlan; youtubeChannelId: string },
): Promise<
  | { ok: true; reconnect: boolean }
  | {
      ok: false;
      reason: "subscription_required" | "limit_reached";
      limit: number;
      connected: number;
    }
> {
  const { data, error } = await client
    .from("youtube_channels")
    .select("youtube_channel_id")
    .eq("workspace_id", input.workspaceId)
    .not("connection_id", "is", null);
  if (error) throw new Error(`CHANNELS_READ_FAILED:${error.code ?? "unknown"}`);
  const connected = (data ?? []).map((row) => row.youtube_channel_id as string);
  if (connected.includes(input.youtubeChannelId)) return { ok: true, reconnect: true };
  if (!input.plan.limits)
    return { ok: false, reason: "subscription_required", limit: 0, connected: connected.length };
  if (connected.length >= input.plan.limits.channels)
    return {
      ok: false,
      reason: "limit_reached",
      limit: input.plan.limits.channels,
      connected: connected.length,
    };
  return { ok: true, reconnect: false };
}

/**
 * After connecting a NEW channel: whether the workspace is now over its limit — two connections
 * made at the same moment can both pass channelCapacity. The caller then detaches the channel it
 * just connected (its row stays, as for any disconnected channel). Throws when it cannot tell.
 */
export async function overChannelLimit(
  client: SupabaseClient,
  input: { workspaceId: string; plan: WorkspacePlan },
): Promise<boolean> {
  const { data, error } = await client
    .from("youtube_channels")
    .select("youtube_channel_id")
    .eq("workspace_id", input.workspaceId)
    .not("connection_id", "is", null);
  if (error) throw new Error(`CHANNELS_READ_FAILED:${error.code ?? "unknown"}`);
  return !input.plan.limits || (data ?? []).length > input.plan.limits.channels;
}

// ---------- the AI month ----------

/**
 * The start of the AI-quota month containing `now`: the first day of the calendar month at
 * 00:00 UTC. A month's allowance resets at that instant for every workspace, whatever its billing
 * date — one boundary, the same for everyone, independent of time zones.
 */
export function aiMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
