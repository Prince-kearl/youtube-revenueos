import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSyncableChannel,
  planReconnect,
  softDisconnectChannel,
  type DisconnectStore,
} from "../src/lib/server/youtube-disconnect";

// A small in-memory model of the tables that matter for disconnecting: channels, connections
// (which hold the credentials), and the history hanging off a channel. The model deletes history
// only if a channel row is deleted — exactly what the database's cascades do — so "history
// survives" below means "the channel row was never deleted".

interface Channel {
  id: string;
  youtubeChannelId: string;
  connectionId: string | null;
}

class Model implements DisconnectStore {
  channels = new Map<string, Channel>();
  connections = new Map<string, { tokens: string }>();
  videos = new Map<string, { channelId: string }>();
  videoStats = new Map<string, { videoId: string; channelId: string; views: number }>();
  channelStats = new Map<string, { channelId: string; views: number }>();
  syncState = new Map<string, { statsSyncedAt: string }>();
  trackedLinks = new Map<string, { videoId: string | null }>();
  clicks = new Map<string, { videoId: string | null; channelId: string | null }>();
  failOn: "count" | "detach" | "delete" | null = null;
  calls: string[] = [];

  seed(channel: Channel, tokens = "encrypted-tokens") {
    this.channels.set(channel.id, channel);
    if (channel.connectionId && !this.connections.has(channel.connectionId))
      this.connections.set(channel.connectionId, { tokens });
    const videoId = `${channel.id}-video`;
    this.videos.set(videoId, { channelId: channel.id });
    this.videoStats.set(`${videoId}:2026-10-01`, { videoId, channelId: channel.id, views: 12 });
    this.channelStats.set(`${channel.id}:2026-10-01`, { channelId: channel.id, views: 20 });
    this.syncState.set(channel.id, { statsSyncedAt: "2026-10-05T00:00:00Z" });
    this.trackedLinks.set(`${channel.id}-link`, { videoId });
    this.clicks.set(`${channel.id}-click`, { videoId, channelId: channel.id });
  }

  historyFor(channelId: string) {
    return {
      channelRow: this.channels.has(channelId),
      videos: [...this.videos.values()].filter((v) => v.channelId === channelId).length,
      videoStats: [...this.videoStats.values()].filter((s) => s.channelId === channelId).length,
      channelStats: [...this.channelStats.values()].filter((s) => s.channelId === channelId).length,
      syncState: this.syncState.has(channelId),
      linkStillPointsAtVideo: this.trackedLinks.get(`${channelId}-link`)?.videoId ?? null,
      clickStillAttributed: this.clicks.get(`${channelId}-click`) ?? null,
    };
  }

  async getChannel(channelId: string) {
    const channel = this.channels.get(channelId);
    return channel ? { id: channel.id, connectionId: channel.connectionId } : null;
  }
  async detachChannel(channelId: string) {
    this.calls.push("detach");
    if (this.failOn === "detach") throw new Error("detach failed");
    this.channels.get(channelId)!.connectionId = null;
  }
  async attachChannel(channelId: string, connectionId: string) {
    this.calls.push("attach");
    this.channels.get(channelId)!.connectionId = connectionId;
  }
  async countOtherChannelsUsingConnection(connectionId: string, exceptChannelId: string) {
    this.calls.push("count");
    if (this.failOn === "count") throw new Error("count failed");
    return [...this.channels.values()].filter(
      (c) => c.connectionId === connectionId && c.id !== exceptChannelId,
    ).length;
  }
  async deleteConnection(connectionId: string) {
    this.calls.push("delete");
    if (this.failOn === "delete") throw new Error("delete failed");
    // Mirrors the real foreign key (ON DELETE RESTRICT): a referenced connection can't be deleted.
    if ([...this.channels.values()].some((c) => c.connectionId === connectionId))
      throw new Error("connection still referenced");
    this.connections.delete(connectionId);
  }
}

const KEARL = { id: "channel-kearl", youtubeChannelId: "UC-kearl", connectionId: "conn-1" };

test("disconnect keeps the channel row and all of its history", async () => {
  const model = new Model();
  model.seed({ ...KEARL });
  const before = model.historyFor(KEARL.id);

  const result = await softDisconnectChannel(model, KEARL.id);

  assert.deepEqual(result, { status: "disconnected", credentialsRemoved: true });
  assert.deepEqual(
    model.historyFor(KEARL.id),
    before,
    "nothing that hangs off the channel changed",
  );
  assert.equal(model.historyFor(KEARL.id).videoStats, 1);
  assert.equal(model.historyFor(KEARL.id).channelStats, 1);
  assert.equal(model.historyFor(KEARL.id).linkStillPointsAtVideo, `${KEARL.id}-video`);
  assert.deepEqual(model.historyFor(KEARL.id).clickStillAttributed, {
    videoId: `${KEARL.id}-video`,
    channelId: KEARL.id,
  });
});

test("disconnect removes the stored Google credentials", async () => {
  const model = new Model();
  model.seed({ ...KEARL });

  await softDisconnectChannel(model, KEARL.id);

  assert.equal(model.channels.get(KEARL.id)!.connectionId, null, "channel no longer has access");
  assert.equal(model.connections.size, 0, "no usable credentials are retained");
});

test("credentials shared with another channel stay until that channel is disconnected too", async () => {
  const model = new Model();
  model.seed({ ...KEARL });
  model.seed({ id: "channel-brand", youtubeChannelId: "UC-brand", connectionId: "conn-1" });

  const first = await softDisconnectChannel(model, KEARL.id);
  assert.deepEqual(first, { status: "disconnected", credentialsRemoved: false });
  assert.equal(model.connections.has("conn-1"), true, "the sibling still syncs through them");
  assert.equal(model.channels.get("channel-brand")!.connectionId, "conn-1", "sibling untouched");

  const second = await softDisconnectChannel(model, "channel-brand");
  assert.deepEqual(second, { status: "disconnected", credentialsRemoved: true });
  assert.equal(model.connections.size, 0);
});

test("disconnecting twice is a harmless no-op", async () => {
  const model = new Model();
  model.seed({ ...KEARL });
  await softDisconnectChannel(model, KEARL.id);
  model.calls = [];

  const again = await softDisconnectChannel(model, KEARL.id);

  assert.deepEqual(again, { status: "already_disconnected", credentialsRemoved: false });
  assert.deepEqual(model.calls, [], "nothing was written");
  assert.equal(model.historyFor(KEARL.id).videoStats, 1);
});

test("a channel the caller cannot see is reported as not found and nothing is touched", async () => {
  const model = new Model();
  model.seed({ ...KEARL });
  const result = await softDisconnectChannel(model, "someone-elses-channel");
  assert.deepEqual(result, { status: "not_found", credentialsRemoved: false });
  assert.equal(model.channels.get(KEARL.id)!.connectionId, "conn-1");
  assert.equal(model.connections.size, 1);
});

test("a failure before anything changes leaves the channel fully connected", async () => {
  const model = new Model();
  model.seed({ ...KEARL });
  model.failOn = "count";
  await assert.rejects(softDisconnectChannel(model, KEARL.id));
  assert.equal(model.channels.get(KEARL.id)!.connectionId, "conn-1");
  assert.equal(model.connections.size, 1);
});

test("if the credentials cannot be deleted the channel is not left looking disconnected", async () => {
  // The dangerous half-state would be: channel shows as disconnected, but usable tokens are
  // still stored with nothing pointing at them. The channel is reattached instead, so the
  // credentials stay findable and the disconnect can simply be retried.
  const model = new Model();
  model.seed({ ...KEARL });
  model.failOn = "delete";

  await assert.rejects(softDisconnectChannel(model, KEARL.id));

  assert.equal(model.channels.get(KEARL.id)!.connectionId, "conn-1");
  assert.equal(model.connections.has("conn-1"), true);
  assert.deepEqual(model.calls, ["count", "detach", "delete", "attach"]);

  model.failOn = null;
  const retry = await softDisconnectChannel(model, KEARL.id);
  assert.deepEqual(retry, { status: "disconnected", credentialsRemoved: true });
  assert.equal(model.connections.size, 0);
});

// ---------- reconnect ----------

test("reconnect: a disconnected channel is reattached, not treated as already connected", () => {
  const plan = planReconnect(
    [{ youtube_channel_id: "UC-kearl", connection_id: null }],
    ["UC-kearl"],
    "conn-new",
  );
  assert.deepEqual(plan.connectIds, ["UC-kearl"], "it goes through the normal connect step");
  assert.deepEqual(plan.reattachIds, ["UC-kearl"], "onto its existing row");
  assert.deepEqual(plan.refreshIds, []);
  assert.deepEqual(plan.supersededConnectionIds, []);
});

test("reconnect: a channel that is still connected has its connection refreshed", () => {
  const plan = planReconnect(
    [{ youtube_channel_id: "UC-kearl", connection_id: "conn-old" }],
    ["UC-kearl"],
    "conn-new",
  );
  assert.deepEqual(plan.refreshIds, ["UC-kearl"]);
  assert.deepEqual(plan.supersededConnectionIds, ["conn-old"]);
  assert.deepEqual(plan.connectIds, []);
});

test("reconnect: a channel never seen before is a plain new connection", () => {
  const plan = planReconnect([], ["UC-new"], "conn-new");
  assert.deepEqual(plan.connectIds, ["UC-new"]);
  assert.deepEqual(plan.reattachIds, [], "there is no existing row to reattach");
});

test("reconnect: connected, disconnected and new channels under one grant are told apart", () => {
  const plan = planReconnect(
    [
      { youtube_channel_id: "UC-live", connection_id: "conn-old" },
      { youtube_channel_id: "UC-off", connection_id: null },
      { youtube_channel_id: "UC-not-in-this-grant", connection_id: "conn-other" },
    ],
    ["UC-live", "UC-off", "UC-new", "UC-live"],
    "conn-new",
  );
  assert.deepEqual(plan.refreshIds, ["UC-live"]);
  assert.deepEqual(plan.connectIds, ["UC-off", "UC-new"]);
  assert.deepEqual(plan.reattachIds, ["UC-off"]);
  assert.deepEqual(
    plan.supersededConnectionIds,
    ["conn-old"],
    "an unrelated connection is left alone",
  );
});

test("reconnect: refreshing onto the same connection supersedes nothing", () => {
  const plan = planReconnect(
    [{ youtube_channel_id: "UC-kearl", connection_id: "conn-same" }],
    ["UC-kearl"],
    "conn-same",
  );
  assert.deepEqual(plan.supersededConnectionIds, []);
});

test("reconnect identity is the YouTube channel id, never the name", () => {
  // Two different channels that happen to share a display name must not be merged. planReconnect
  // is never given names at all — this pins that the only key is the id.
  const plan = planReconnect(
    [{ youtube_channel_id: "UC-original-kearl", connection_id: null }],
    ["UC-another-channel-also-called-kearl"],
    "conn-new",
  );
  assert.deepEqual(plan.reattachIds, [], "a same-named but different channel reuses nothing");
  assert.deepEqual(plan.connectIds, ["UC-another-channel-also-called-kearl"]);
});

// ---------- syncing ----------

test("a disconnected channel is not syncable; a connected one is", () => {
  assert.equal(isSyncableChannel({ connection: null }), false, "disconnected: no connection");
  assert.equal(isSyncableChannel({}), false);
  assert.equal(isSyncableChannel({ connection: { status: "active" } }), true);
  assert.equal(isSyncableChannel({ connection: [{ status: "active" }] }), true);
  assert.equal(isSyncableChannel({ connection: { status: "reauth_required" } }), false);
  assert.equal(isSyncableChannel({ connection: [] }), false);
});

test("disconnect then reconnect: same channel row, history intact, syncing resumes", async () => {
  const model = new Model();
  model.seed({ ...KEARL });
  const history = model.historyFor(KEARL.id);

  await softDisconnectChannel(model, KEARL.id);
  assert.equal(
    isSyncableChannel({ connection: null }),
    false,
    "while disconnected it is skipped by the sync",
  );

  // The same person authorises again; Google reports the same YouTube channel id.
  const plan = planReconnect(
    [...model.channels.values()].map((c) => ({
      youtube_channel_id: c.youtubeChannelId,
      connection_id: c.connectionId,
    })),
    [KEARL.youtubeChannelId],
    "conn-2",
  );
  assert.deepEqual(plan.reattachIds, [KEARL.youtubeChannelId]);
  // What the upsert on (workspace_id, youtube_channel_id) does: update the existing row.
  model.connections.set("conn-2", { tokens: "new-encrypted-tokens" });
  const row = [...model.channels.values()].find((c) => c.youtubeChannelId === plan.reattachIds[0])!;
  row.connectionId = "conn-2";

  assert.equal(model.channels.size, 1, "no second channel row was created");
  assert.equal(row.id, KEARL.id, "the id is unchanged, so every relationship still resolves");
  assert.deepEqual(model.historyFor(KEARL.id), history);
  assert.equal(isSyncableChannel({ connection: { status: "active" } }), true);
});
