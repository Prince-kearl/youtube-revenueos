// Disconnecting YouTube removes ACCESS, not HISTORY.
//
// A channel is "connected" when its youtube_channels row points at a youtube_connections row
// (which holds the encrypted Google tokens), and "disconnected" when connection_id is NULL.
// Disconnecting therefore detaches the channel from its connection and deletes the connection —
// and with it every stored credential — once no other channel uses it. The youtube_channels row
// itself is kept, so its id stays stable and everything hanging off it survives: videos,
// channel_daily_stats, video_daily_stats, youtube_sync_state, tracked-link/click/lead
// attribution. Previously the row was hard-deleted, which cascaded through all of those.
//
// Reconnecting is keyed on the stable YouTube channel id within the workspace (there is a unique
// constraint on exactly that pair), never on a name or title, so the same row is reattached and
// its history continues.
//
// No schema change is involved: connection_id was already nullable, and its foreign key is
// ON DELETE RESTRICT — which is why the order below is detach first, then delete the connection.

export interface DisconnectStore {
  /** The channel as the CALLER is allowed to see it (RLS-scoped), or null. */
  getChannel(channelId: string): Promise<{ id: string; connectionId: string | null } | null>;
  /** Set connection_id to NULL on this channel. Must not touch any other column or row. */
  detachChannel(channelId: string): Promise<void>;
  /** Point this channel back at a connection (used only to undo a detach that could not be
   * completed). */
  attachChannel(channelId: string, connectionId: string): Promise<void>;
  /** How many OTHER channels reference this connection. */
  countOtherChannelsUsingConnection(connectionId: string, exceptChannelId: string): Promise<number>;
  /** Delete the connection row and the encrypted tokens it holds. */
  deleteConnection(connectionId: string): Promise<void>;
}

export interface DisconnectResult {
  /** "not_found" also covers a channel the caller cannot see; "already_disconnected" is a no-op. */
  status: "disconnected" | "already_disconnected" | "not_found";
  /** True when the stored Google credentials were deleted as part of this call. False when
   * another channel still depends on the same connection (e.g. a second channel under one Brand
   * Account grant), in which case they must stay until that channel is disconnected too. */
  credentialsRemoved: boolean;
}

export async function softDisconnectChannel(
  store: DisconnectStore,
  channelId: string,
): Promise<DisconnectResult> {
  const channel = await store.getChannel(channelId);
  if (!channel) return { status: "not_found", credentialsRemoved: false };
  if (!channel.connectionId) return { status: "already_disconnected", credentialsRemoved: false };

  // A connection can back several channels. Its credentials are deleted only when this was the
  // last channel using them — never while a sibling still syncs through them. Counted BEFORE
  // anything changes, so a failure here leaves the channel fully connected and safely retryable.
  const others = await store.countOtherChannelsUsingConnection(channel.connectionId, channel.id);

  await store.detachChannel(channel.id);
  if (others > 0) return { status: "disconnected", credentialsRemoved: false };

  try {
    await store.deleteConnection(channel.connectionId);
  } catch (error) {
    // Never end up "disconnected" while the credentials still exist and nothing points at them:
    // that would leave usable tokens stored with no way to find and remove them. Put the channel
    // back so the state stays honest and the person can try again.
    await store.attachChannel(channel.id, channel.connectionId).catch(() => {});
    throw error;
  }
  return { status: "disconnected", credentialsRemoved: true };
}

export interface ExistingChannelRow {
  youtube_channel_id: string;
  connection_id: string | null;
}

export interface ReconnectPlan {
  /** Channels that are connected right now and that this Google grant can also see: their
   * connection is refreshed (repointed at the new grant). */
  refreshIds: string[];
  /** Connections those channels were using before, which the new grant supersedes. */
  supersededConnectionIds: string[];
  /** Channels this grant can see that are NOT currently connected in this workspace — brand new
   * ones and previously disconnected ones alike. Both go through the normal "connect" step,
   * whose upsert on (workspace_id, youtube_channel_id) reattaches an existing disconnected row
   * instead of creating a second one. */
  connectIds: string[];
  /** The subset of connectIds that already has a (disconnected) row and will be reattached. */
  reattachIds: string[];
}

/**
 * Decides what a fresh Google grant means for the channels it can see, given the workspace's
 * existing rows. Identity is the YouTube channel id only.
 *
 * A previously disconnected channel is deliberately NOT refreshed implicitly: the person turned
 * it off, so it comes back only by being connected again like any other channel (automatically
 * when it is the only one on offer, or through the channel picker when there are several).
 */
export function planReconnect(
  existingRows: ExistingChannelRow[],
  discoveredYoutubeChannelIds: string[],
  newConnectionId: string,
): ReconnectPlan {
  const discovered = [...new Set(discoveredYoutubeChannelIds)];
  const byId = new Map(existingRows.map((row) => [row.youtube_channel_id, row]));
  const connected = discovered.filter((id) => byId.get(id)?.connection_id);
  const notConnected = discovered.filter((id) => !byId.get(id)?.connection_id);
  return {
    refreshIds: connected,
    supersededConnectionIds: [
      ...new Set(
        connected
          .map((id) => byId.get(id)!.connection_id as string)
          .filter((connectionId) => connectionId !== newConnectionId),
      ),
    ],
    connectIds: notConnected,
    reattachIds: notConnected.filter((id) => byId.has(id)),
  };
}

/** Whether a channel should be synced: it must have a connection, and that connection must be
 * active. A disconnected channel (no connection) is never synced. */
export function isSyncableChannel(row: {
  connection?: { status?: string | null } | Array<{ status?: string | null }> | null;
}): boolean {
  const connection = Array.isArray(row.connection) ? row.connection[0] : row.connection;
  return connection?.status === "active";
}
