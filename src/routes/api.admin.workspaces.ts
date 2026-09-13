import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireMinimumRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { logAdminAudit } from "@/lib/server/admin-audit";

const patchSchema = z.object({ name: z.string().trim().min(1).max(120) });
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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

// Maps a real subscription_status (or its absence) onto the same small vocabulary the old fake
// "Organizations" page used, since it happens to line up — every value here now comes from a
// real subscriptions row, not a fabricated one, and "Free" means no subscription row exists.
function planStatusLabel(status: string | null): string {
  if (status === "active") return "Active";
  if (status === "trialing") return "Trial";
  if (status === "past_due") return "Past Due";
  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired")
    return "Canceled";
  if (status === "incomplete") return "Incomplete";
  return "Free";
}

export const Route = createFileRoute("/api/admin/workspaces")({
  server: {
    handlers: {
      // Every real workspace (Tubify's actual tenant boundary — see the workspaces migration),
      // with its owner, real active member count, and the owner's real subscription/plan if any.
      // Console access (Superadmin/Owner) rather than any per-feature permission, same reasoning
      // as the Executive Dashboard: this reads across every user's workspace.
      GET: async ({ request }) => {
        try {
          await requireMinimumRole(request, "owner");
          const service = createServiceSupabaseClient();

          const [workspacesResult, membersResult, subsResult, plansResult, pricesResult] =
            await Promise.all([
              service
                .from("workspaces")
                .select("id, name, owner_id, created_at")
                .order("created_at", { ascending: false }),
              service.from("workspace_members").select("workspace_id, user_id, status"),
              service
                .from("subscriptions")
                .select("user_id, status, plan_id, stripe_price_id, billing_interval, created_at")
                .order("created_at", { ascending: false }),
              service.from("plans").select("slug, name"),
              service.from("plan_prices").select("stripe_price_id, amount_cents"),
            ]);

          const workspaces = workspacesResult.data ?? [];
          const ownerIds = [...new Set(workspaces.map((w) => w.owner_id))];
          const { data: owners } = await service
            .from("profiles")
            .select("id, name, email, avatar")
            .in("id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);
          const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));

          const memberCountByWorkspace = new Map<string, number>();
          for (const m of membersResult.data ?? []) {
            if (m.status !== "active") continue;
            memberCountByWorkspace.set(
              m.workspace_id,
              (memberCountByWorkspace.get(m.workspace_id) ?? 0) + 1,
            );
          }

          // One row per user: their most recent subscription (already ordered newest-first).
          const subs = subsResult.data ?? [];
          const latestSubByOwner = new Map<string, (typeof subs)[number]>();
          for (const sub of subs) {
            if (!latestSubByOwner.has(sub.user_id)) latestSubByOwner.set(sub.user_id, sub);
          }
          const planNameBySlug = new Map((plansResult.data ?? []).map((p) => [p.slug, p.name]));
          const priceByStripeId = new Map(
            (pricesResult.data ?? []).map((p) => [p.stripe_price_id, p.amount_cents as number]),
          );

          const rows = workspaces.map((w) => {
            const owner = ownerById.get(w.owner_id);
            const sub = latestSubByOwner.get(w.owner_id);
            const isPaid = sub && ["active", "trialing", "past_due"].includes(sub.status);
            const mrrCents = isPaid
              ? (() => {
                  const cents = priceByStripeId.get(sub.stripe_price_id) ?? 0;
                  return sub.billing_interval === "year" ? Math.round(cents / 12) : cents;
                })()
              : 0;
            return {
              id: w.id,
              name: w.name,
              createdAt: w.created_at,
              ownerName: owner?.name ?? null,
              ownerEmail: owner?.email ?? null,
              ownerAvatar: owner?.avatar ?? null,
              memberCount: memberCountByWorkspace.get(w.id) ?? 0,
              planName: sub ? (planNameBySlug.get(sub.plan_id) ?? sub.plan_id) : null,
              planStatus: planStatusLabel(sub?.status ?? null),
              mrrCents,
            };
          });

          return json({ data: rows });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      // The only real, safe mutation available here — everything else the old UI offered
      // (suspend, force a plan change, storage/seat quotas) has no real enforcement mechanism
      // anywhere in the app, so it isn't reintroduced as a fake control.
      PATCH: async ({ request }) => {
        try {
          const { user } = await requireMinimumRole(request, "owner");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = patchSchema.parse(await parseJson(request));

          const service = createServiceSupabaseClient();
          const { data: existing } = await service
            .from("workspaces")
            .select("id, name")
            .eq("id", id)
            .maybeSingle();
          if (!existing) return json({ error: "WORKSPACE_NOT_FOUND" }, { status: 404 });

          const { data: updated, error } = await service
            .from("workspaces")
            .update({ name: input.name })
            .eq("id", id)
            .select("id, name")
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logAdminAudit(service, {
            adminUserId: user.id,
            action: "workspace_renamed",
            target: existing.name,
            oldValue: { name: existing.name },
            newValue: { name: updated.name },
          });
          return json({ data: updated });
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
