import type { SupabaseClient } from "@supabase/supabase-js";
import { channelCapacity, overChannelLimit, resolveWorkspacePlan } from "./plan-access";
import type { YoutubeChannelSummary } from "./google-oauth";

// Client connect links (table channel_connect_invites, migration 202610280001).
//
// An agency (owner or manager of a workspace) creates a link and sends it to a client. The client
// — who is NOT a Tubify user and never becomes a workspace member — opens it, signs in with THEIR
// Google account, and the one channel they choose is attached to the agency's workspace:
//
//   * the Google authorization is the client's: the connection row carries the client's Google
//     identity and granted_via_invite_id; the client can withdraw it from their Google account;
//   * only the channel the client chose is attached; the workspace can never list or attach the
//     client's other channels through that authorization (api.youtube.connections.ts refuses it);
//   * the channel goes through the same channel records, plan limit, and later sync/disconnect as
//     any other channel.
//
// Links: 256-bit random secret, only its SHA-256 hash stored; single use; 7-day expiry; revocable.
// Every function takes the service-role client and names the workspace / invite it acts on.

export const INVITE_TTL_DAYS = 7;
/** Links that can be waiting at once per workspace. */
export const MAX_OPEN_INVITES = 50;
/** A client authorization waiting for the client to pick a channel is dropped after this long. */
export const PENDING_PICK_MS = 60 * 60_000;
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type InviteState = "valid" | "expired" | "used" | "revoked";

export interface InviteRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  label: string | null;
  expires_at: string;
  used_at: string | null;
  used_channel_id: string | null;
  pending_connection_id: string | null;
  revoked_at: string | null;
  created_at: string;
}

const INVITE_COLUMNS =
  "id, workspace_id, created_by, label, expires_at, used_at, used_channel_id, pending_connection_id, revoked_at, created_at";

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A new link secret: 32 random bytes, base64url (43 characters). */
export function newInviteToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** What is stored instead of the secret. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function inviteState(invite: InviteRow, now: Date = new Date()): InviteState {
  if (invite.revoked_at) return "revoked";
  if (invite.used_at) return "used";
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return "expired";
  return "valid";
}

/** The invite a link's secret belongs to, or null (malformed or unknown). */
export async function loadInviteByToken(
  service: SupabaseClient,
  token: string,
): Promise<InviteRow | null> {
  if (!INVITE_TOKEN.test(token)) return null;
  const { data } = await service
    .from("channel_connect_invites")
    .select(INVITE_COLUMNS)
    .eq("token_hash", await hashInviteToken(token))
    .maybeSingle();
  return (data as InviteRow | null) ?? null;
}

/** Deletes a client authorization no channel uses (its encrypted tokens go with it). */
export async function dropUnusedInviteConnection(
  service: SupabaseClient,
  workspaceId: string,
  connectionId: string,
): Promise<void> {
  const { count } = await service
    .from("youtube_channels")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connectionId);
  if ((count ?? 0) > 0) return;
  await service
    .from("youtube_connections")
    .delete()
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .not("granted_via_invite_id", "is", null);
}

/**
 * Client authorizations nobody finished with — the client never picked a channel, or the link
 * expired or was revoked meanwhile — are deleted with their tokens.
 */
export async function cleanupAbandonedInviteConnections(
  service: SupabaseClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<void> {
  const { data: connections } = await service
    .from("youtube_connections")
    .select("id, created_at")
    .eq("workspace_id", workspaceId)
    .not("granted_via_invite_id", "is", null)
    .lt("created_at", new Date(now.getTime() - PENDING_PICK_MS).toISOString());
  for (const connection of connections ?? [])
    await dropUnusedInviteConnection(service, workspaceId, connection.id as string);
}

export type AttachOutcome =
  | { status: "connected"; channelId: string; channelTitle: string }
  | { status: "used" | "channel_limit" | "subscription_required" | "storage_failed" };

/**
 * Attaches the ONE channel the client chose to the invite's workspace, through the client's
 * connection, and marks the link used. The link is claimed first (conditional update), so two
 * tabs racing on one link attach at most one channel. The plan's channel limit applies exactly as
 * for any other connection; if it refuses, the link is released for a later try and the client's
 * authorization is dropped.
 */
export async function attachInviteChannel(
  service: SupabaseClient,
  input: {
    invite: InviteRow;
    connectionId: string;
    channel: YoutubeChannelSummary;
    now?: Date;
  },
): Promise<AttachOutcome> {
  const { invite, connectionId, channel } = input;
  const now = input.now ?? new Date();
  const workspaceId = invite.workspace_id;

  // Claim the link.
  const { data: claimed } = await service
    .from("channel_connect_invites")
    .update({ used_at: now.toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .select("id");
  if (!claimed?.length) {
    await dropUnusedInviteConnection(service, workspaceId, connectionId);
    return { status: "used" };
  }
  const release = async () => {
    await service
      .from("channel_connect_invites")
      .update({ used_at: null, pending_connection_id: null })
      .eq("id", invite.id);
    await dropUnusedInviteConnection(service, workspaceId, connectionId);
  };

  const plan = await resolveWorkspacePlan(service, {
    workspaceId,
    userId: invite.created_by ?? "00000000-0000-0000-0000-000000000000",
  });
  let capacity: Awaited<ReturnType<typeof channelCapacity>>;
  try {
    capacity = await channelCapacity(service, {
      workspaceId,
      plan,
      youtubeChannelId: channel.channelId,
    });
  } catch {
    await release();
    return { status: "storage_failed" };
  }
  if (!capacity.ok) {
    await release();
    return {
      status:
        capacity.reason === "subscription_required" ? "subscription_required" : "channel_limit",
    };
  }

  // The channel's previous connection (a reconnect), superseded by the client's new grant.
  const { data: previous } = await service
    .from("youtube_channels")
    .select("id, connection_id")
    .eq("workspace_id", workspaceId)
    .eq("youtube_channel_id", channel.channelId)
    .maybeSingle();

  const { data: row, error } = await service
    .from("youtube_channels")
    .upsert(
      {
        user_id: invite.created_by,
        workspace_id: workspaceId,
        connection_id: connectionId,
        youtube_channel_id: channel.channelId,
        channel_name: channel.title,
        channel_handle: channel.handle,
        thumbnail: channel.thumbnail,
        subscriber_count: channel.subscriberCount,
        view_count: channel.viewCount,
        video_count: channel.videoCount,
        uploads_playlist_id: channel.uploadsPlaylistId,
        connected_at: now.toISOString(),
        last_sync_status: "never_synced",
        last_sync_error: null,
      },
      { onConflict: "workspace_id,youtube_channel_id" },
    )
    .select("id")
    .single();
  if (error || !row) {
    await release();
    return { status: "storage_failed" };
  }

  // A connection made at the same moment may have taken the last place.
  if (!capacity.reconnect) {
    let over: boolean;
    try {
      over = await overChannelLimit(service, { workspaceId, plan });
    } catch {
      over = true;
    }
    if (over) {
      await service
        .from("youtube_channels")
        .update({ connection_id: previous?.connection_id ?? null })
        .eq("id", row.id as string)
        .eq("workspace_id", workspaceId);
      await release();
      return { status: "channel_limit" };
    }
  }

  await service
    .from("channel_connect_invites")
    .update({ used_channel_id: row.id as string, pending_connection_id: null })
    .eq("id", invite.id);
  // The superseded connection, once nothing uses it (the FK refuses while something does).
  const superseded = previous?.connection_id as string | null | undefined;
  if (superseded && superseded !== connectionId)
    await service
      .from("youtube_connections")
      .delete()
      .eq("id", superseded)
      .eq("workspace_id", workspaceId);
  return { status: "connected", channelId: row.id as string, channelTitle: channel.title };
}
