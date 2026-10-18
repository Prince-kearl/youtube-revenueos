import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission, toAppRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { adminUserStatus } from "@/lib/server/admin-users";

// One account, for the admin Users detail view: identity and account status, workspace
// memberships, subscription plan, connected channels and recent admin actions on the account.
//
// Every related read is a single indexed lookup by this user's id (or email, for the audit log)
// with a small LIMIT — never a whole table. What is returned is deliberately narrow:
//   * no compensation (workspace_members.commission / lead_share stay private, as everywhere);
//   * no money (no price or amount — only the plan's name, status and renewal date);
//   * no tokens or connection ids for channels — only whether the channel is connected;
//   * no raw auth metadata.
// Same permission as the list (manage_users). An id that does not exist gets the same 404 as an
// id that never existed.

const MEMBERSHIP_LIMIT = 20;
const CHANNEL_LIMIT = 20;
const ACTIVITY_LIMIT = 10;

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

type MembershipRow = {
  role: string;
  status: string;
  joined_at: string | null;
  workspace_id: string;
  workspaces: { name: string; owner_id: string } | { name: string; owner_id: string }[] | null;
};

export const Route = createFileRoute("/api/admin/users/detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requirePermission(request, "manage_users");
          const parsedId = idSchema.safeParse(new URL(request.url).searchParams.get("id"));
          if (!parsedId.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const userId = parsedId.data;

          const service = createServiceSupabaseClient();
          const { data: profile, error: profileError } = await service
            .from("profiles")
            .select("id, name, email, avatar, role, created_at")
            .eq("id", userId)
            .maybeSingle();
          if (profileError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!profile) return json({ error: "USER_NOT_FOUND" }, { status: 404 });

          const auditTargets = [profile.id, profile.email].filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          );
          const [authUser, memberships, subscription, channels, activity] = await Promise.all([
            service.auth.admin.getUserById(userId),
            service
              .from("workspace_members")
              .select("role, status, joined_at, workspace_id, workspaces(name, owner_id)", {
                count: "exact",
              })
              .eq("user_id", userId)
              .neq("status", "removed")
              .order("joined_at", { ascending: false, nullsFirst: false })
              .limit(MEMBERSHIP_LIMIT),
            service
              .from("subscriptions")
              .select("plan_id, status, billing_interval, current_period_end, cancel_at_period_end")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            service
              .from("youtube_channels")
              .select(
                "id, channel_name, channel_handle, youtube_channel_id, subscriber_count, connection_id, connected_at, last_synced_at, last_sync_status",
                { count: "exact" },
              )
              .eq("user_id", userId)
              .order("connected_at", { ascending: false })
              .limit(CHANNEL_LIMIT),
            service
              .from("admin_audit_log")
              .select("action, created_at")
              .in("target", auditTargets)
              .order("created_at", { ascending: false })
              .limit(ACTIVITY_LIMIT),
          ]);
          if (memberships.error || subscription.error || channels.error || activity.error)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const auth = authUser.data?.user ?? null;
          const planId = (subscription.data?.plan_id as string | undefined) ?? null;
          const plan = planId
            ? await service.from("plans").select("name").eq("slug", planId).maybeSingle()
            : null;

          return json({
            data: {
              identity: {
                id: profile.id,
                name: profile.name,
                email: profile.email,
                avatar: profile.avatar,
                role: toAppRole(profile.role as string),
                createdAt: profile.created_at,
              },
              account: {
                status: auth
                  ? adminUserStatus({
                      banned_until: auth.banned_until ?? null,
                      email_confirmed_at: auth.email_confirmed_at ?? null,
                    })
                  : null,
                emailVerified: Boolean(auth?.email_confirmed_at),
                creatorVerified: auth?.user_metadata?.creator_verified === true,
                bannedUntil: auth?.banned_until ?? null,
                lastSignInAt: auth?.last_sign_in_at ?? null,
              },
              workspaces: {
                total: memberships.count ?? 0,
                items: ((memberships.data ?? []) as MembershipRow[]).map((row) => {
                  const workspace = Array.isArray(row.workspaces)
                    ? row.workspaces[0]
                    : row.workspaces;
                  return {
                    workspaceId: row.workspace_id,
                    name: workspace?.name ?? null,
                    isOwner: workspace?.owner_id === userId,
                    role: row.role,
                    status: row.status,
                    joinedAt: row.joined_at,
                  };
                }),
              },
              subscription: subscription.data
                ? {
                    plan: (plan?.data?.name as string | undefined) ?? planId,
                    status: subscription.data.status,
                    billingInterval: subscription.data.billing_interval,
                    currentPeriodEnd: subscription.data.current_period_end,
                    cancelAtPeriodEnd: subscription.data.cancel_at_period_end === true,
                  }
                : null,
              channels: {
                total: channels.count ?? 0,
                items: (channels.data ?? []).map((row) => ({
                  id: row.id,
                  name: row.channel_name,
                  handle: row.channel_handle,
                  youtubeChannelId: row.youtube_channel_id,
                  subscriberCount: Number(row.subscriber_count ?? 0),
                  connected: row.connection_id !== null,
                  connectedAt: row.connected_at,
                  lastSyncedAt: row.last_synced_at,
                  lastSyncStatus: row.last_sync_status ?? null,
                })),
              },
              recentAdminActions: (activity.data ?? []).map((row) => ({
                action: row.action,
                at: row.created_at,
              })),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
