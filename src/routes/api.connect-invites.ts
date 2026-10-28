import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { canManageWorkspaceMembers, getWorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";
import {
  cleanupAbandonedInviteConnections,
  hashInviteToken,
  inviteState,
  INVITE_TTL_DAYS,
  MAX_OPEN_INVITES,
  newInviteToken,
  type InviteRow,
} from "@/lib/server/connect-invites";

// Client connect links, for the agency (see lib/server/connect-invites.ts).
//
//   GET     this workspace's links: who they are for, their state, the channel connected
//   POST    { label? } → a new link; the link itself is returned ONCE (only its hash is stored)
//   DELETE  ?id= → revoke a link that has not been used
//
// The caller must be signed in, with a plan (connecting channels needs one), and an owner or
// manager of their CURRENT workspace — the same rule as connecting a channel directly. Every read
// and write names that workspace; a link of another workspace is "not found".

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

const createSchema = z
  .object({ label: z.string().trim().min(1).max(80).nullable().optional() })
  .strict();

const notAllowed = () =>
  json(
    {
      error: "FORBIDDEN",
      message: "Only the workspace owner or a manager can invite clients to connect a channel.",
    },
    { status: 403 },
  );

function linkFor(request: Request, token: string) {
  const origin = new URL(request.url).origin;
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
  const appUrl = isLocal ? origin : (getServerEnv("APP_URL") ?? origin);
  return `${appUrl}/connect/${token}`;
}

export const Route = createFileRoute("/api/connect-invites")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { workspaceId, workspaceRole } = await getWorkspaceContext(request);
          if (!canManageWorkspaceMembers(workspaceRole)) return notAllowed();
          const service = createServiceSupabaseClient();
          await cleanupAbandonedInviteConnections(service, workspaceId);
          const { data, error } = await service
            .from("channel_connect_invites")
            .select(
              "id, workspace_id, created_by, label, expires_at, used_at, used_channel_id, pending_connection_id, revoked_at, created_at",
            )
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .limit(100);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const invites = (data ?? []) as InviteRow[];
          const channelIds = invites.map((i) => i.used_channel_id).filter(Boolean) as string[];
          const names = new Map<string, string>();
          if (channelIds.length) {
            const { data: channels } = await service
              .from("youtube_channels")
              .select("id, channel_name")
              .eq("workspace_id", workspaceId)
              .in("id", channelIds);
            for (const c of channels ?? []) names.set(c.id as string, c.channel_name as string);
          }
          return json({
            data: invites.map((i) => ({
              id: i.id,
              label: i.label,
              state: inviteState(i),
              expiresAt: i.expires_at,
              usedAt: i.used_at,
              channelName: i.used_channel_id ? (names.get(i.used_channel_id) ?? null) : null,
              createdAt: i.created_at,
            })),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const { user, workspaceId, workspaceRole } = await getWorkspaceContext(request);
          if (!canManageWorkspaceMembers(workspaceRole)) return notAllowed();
          let body: unknown = {};
          try {
            body = await request.json();
          } catch {
            body = {};
          }
          const parsed = createSchema.safeParse(body ?? {});
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });

          const service = createServiceSupabaseClient();
          const now = new Date();
          const { count, error: countError } = await service
            .from("channel_connect_invites")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .is("used_at", null)
            .is("revoked_at", null)
            .gt("expires_at", now.toISOString());
          if (countError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if ((count ?? 0) >= MAX_OPEN_INVITES)
            return json(
              {
                error: "TOO_MANY_OPEN_INVITES",
                message: `You have ${MAX_OPEN_INVITES} links waiting. Revoke some before creating more.`,
              },
              { status: 429 },
            );

          const token = newInviteToken();
          const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
          const { data, error } = await service
            .from("channel_connect_invites")
            .insert({
              workspace_id: workspaceId,
              created_by: user.id,
              token_hash: await hashInviteToken(token),
              label: parsed.data.label ?? null,
              expires_at: expiresAt,
            })
            .select("id, label, expires_at, created_at")
            .single();
          if (error || !data) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json(
            {
              data: {
                id: data.id,
                label: data.label,
                state: "valid",
                expiresAt: data.expires_at,
                usedAt: null,
                channelName: null,
                createdAt: data.created_at,
                // Shown once: only its hash is stored.
                url: linkFor(request, token),
              },
            },
            { status: 201 },
          );
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      DELETE: async ({ request }) => {
        try {
          const { workspaceId, workspaceRole } = await getWorkspaceContext(request);
          if (!canManageWorkspaceMembers(workspaceRole)) return notAllowed();
          const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
          if (!id.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const service = createServiceSupabaseClient();
          const { data, error } = await service
            .from("channel_connect_invites")
            .update({ revoked_at: new Date().toISOString(), pending_connection_id: null })
            .eq("id", id.data)
            .eq("workspace_id", workspaceId)
            .is("used_at", null)
            .is("revoked_at", null)
            .select("id");
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!data?.length) return json({ error: "NOT_FOUND" }, { status: 404 });
          await cleanupAbandonedInviteConnections(
            service,
            workspaceId,
            new Date(Date.now() + 2 * 3600e3),
          );
          return json({ data: { id: id.data, state: "revoked" } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
