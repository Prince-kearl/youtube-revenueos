import {
  addMember,
  addUser,
  addPaidWorkspace,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  firstVerifiedChannel,
  orderVideoChannelCandidates,
} from "../src/lib/server/youtube-video-channel";

// The live video detail request (GET /api/youtube/video) must use the channel the VIDEO belongs
// to. It used to use the channel selected elsewhere in the app (or, without one, the most
// recently connected channel the user could see in any workspace), so in a workspace with more
// than one channel every video of the other channels failed with YOUTUBE_VIDEO_CHANNEL_MISMATCH.
//
// The real route runs against the in-memory database, with the YouTube Data and Analytics APIs
// answered here: each channel's token can only be used as that channel, and YouTube reports each
// video's true channel.

// Tokens are decrypted with this throwaway key (32 zero bytes).
(globalThis as unknown as { __env__: Record<string, string> }).__env__.TOKEN_ENCRYPTION_KEY =
  Buffer.alloc(32).toString("base64");
const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const route = await import("../src/routes/api.youtube.video");

// ============================================================
// The order and the verification (pure)
// ============================================================

const ch = (id: string) => ({ id });

test("candidates: the stored owner first, then the suggestion, then the rest — only ever connected channels", () => {
  const connected = [ch("a"), ch("b"), ch("c")];
  const ids = (list: { id: string }[]) => list.map((c) => c.id);
  assert.deepEqual(ids(orderVideoChannelCandidates(connected, ["c"], "a")), ["c", "a", "b"]);
  assert.deepEqual(ids(orderVideoChannelCandidates(connected, [], "b")), ["b", "a", "c"]);
  assert.deepEqual(ids(orderVideoChannelCandidates(connected, [], null)), ["a", "b", "c"]);
  // Duplicates and ids that are not connected channels of the workspace are dropped.
  assert.deepEqual(ids(orderVideoChannelCandidates(connected, ["b", "b", "zz"], "b")), [
    "b",
    "a",
    "c",
  ]);
  assert.deepEqual(ids(orderVideoChannelCandidates(connected, ["zz"], "other-ws")), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(orderVideoChannelCandidates([], ["a"], "a"), []);
});

const err = (message: string) => new Error(message);
const isReauth = (e: unknown) => e instanceof Error && e.message === "REAUTH";

test("verification: the first channel YouTube confirms is used; wrong or unauthorised channels are skipped", async () => {
  const tried: string[] = [];
  const verify = (outcomes: Record<string, Error | string>) => async (c: { id: string }) => {
    tried.push(c.id);
    const outcome = outcomes[c.id];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  const found = await firstVerifiedChannel(
    [ch("a"), ch("b"), ch("c")],
    verify({ a: err("YOUTUBE_VIDEO_CHANNEL_MISMATCH"), b: err("REAUTH"), c: "video-c" }),
    isReauth,
  );
  assert.deepEqual([found.channel.id, found.result, tried], ["c", "video-c", ["a", "b", "c"]]);
  // The stored owner confirmed first: nothing else is tried.
  tried.length = 0;
  await firstVerifiedChannel([ch("a"), ch("b")], verify({ a: "ok", b: "ok" }), isReauth);
  assert.deepEqual(tried, ["a"]);
});

test("verification: when nothing is confirmed the error is re-authorise, then mismatch, then not found; anything else stops at once", async () => {
  const fail = (outcomes: Error[]) =>
    firstVerifiedChannel(
      outcomes.map((_, i) => ch(String(i))),
      async (c) => {
        throw outcomes[Number(c.id)];
      },
      isReauth,
    );
  await assert.rejects(fail([err("YOUTUBE_VIDEO_NOT_FOUND"), err("REAUTH")]), /REAUTH/);
  await assert.rejects(
    fail([err("YOUTUBE_VIDEO_NOT_FOUND"), err("YOUTUBE_VIDEO_CHANNEL_MISMATCH")]),
    /YOUTUBE_VIDEO_CHANNEL_MISMATCH/,
  );
  await assert.rejects(fail([err("YOUTUBE_VIDEO_NOT_FOUND")]), /YOUTUBE_VIDEO_NOT_FOUND/);
  await assert.rejects(fail([]), /YOUTUBE_VIDEO_NOT_FOUND/);
  let tried = 0;
  await assert.rejects(
    firstVerifiedChannel(
      [ch("a"), ch("b")],
      async () => {
        tried++;
        throw err("YOUTUBE_VIDEOS_FAILED:500");
      },
      isReauth,
    ),
    /FAILED:500/,
  );
  assert.equal(tried, 1, "an unexpected YouTube failure is not retried on other channels");
});

// ============================================================
// The route
// ============================================================

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Workspace W1: channels A (newest connection) and B (older), and C (disconnected). Workspace
 * W2: channel D. YouTube knows which channel each video is really on. */
async function fixture() {
  const world: World = { ...emptyWorld() };
  const users = {
    owner: addUser(world, "owner@x.test"),
    editor: addUser(world, "editor@x.test"),
    other: addUser(world, "other@x.test"),
    nobody: addUser(world, "nobody@x.test"),
  };
  const w1 = addPaidWorkspace(world, users.owner);
  addMember(world, w1, users.editor, "editor");
  const w2 = addPaidWorkspace(world, users.other);
  // `nobody` has a profile and no workspace.
  world.workspace_members = world.workspace_members.filter((m) => m.user_id !== users.nobody);

  const yt = {
    A: "UCchannelAAAAAAAAAAAAAAAA",
    B: "UCchannelBBBBBBBBBBBBBBBB",
    C: "UCchannelCCCCCCCCCCCCCCCC",
    D: "UCchannelDDDDDDDDDDDDDDDD",
  };
  const channel = { A: uuid(), B: uuid(), C: uuid(), D: uuid() };
  const connection = { A: uuid(), B: uuid(), D: uuid() };
  const future = new Date(Date.now() + 3_600_000).toISOString();
  world.youtube_connections = [];
  for (const key of ["A", "B", "D"] as const)
    world.youtube_connections.push({
      id: connection[key],
      access_token_ciphertext: await encryptSecretToBytea(`token-${key}`),
      refresh_token_ciphertext: await encryptSecretToBytea(`refresh-${key}`),
      token_expiry: future,
    });
  const channelRow = (key: "A" | "B" | "C" | "D", workspaceId: string, connectedAt: string) => ({
    id: channel[key],
    workspace_id: workspaceId,
    user_id: users.owner,
    youtube_channel_id: yt[key],
    channel_name: `Channel ${key}`,
    channel_handle: `@${key.toLowerCase()}`,
    connection_id: key === "C" ? null : connection[key as "A" | "B" | "D"],
    connected_at: connectedAt,
  });
  world.youtube_channels = [
    channelRow("A", w1, "2026-09-03T00:00:00Z"),
    channelRow("B", w1, "2026-09-02T00:00:00Z"),
    channelRow("C", w1, "2026-09-04T00:00:00Z"),
    channelRow("D", w2, "2026-09-05T00:00:00Z"),
  ];
  // What the sync stored: which channel each video is on.
  const stored = (id: string, key: "A" | "B" | "C" | "D") => ({
    id: uuid(),
    channel_id: channel[key],
    youtube_video_id: id,
    title: id,
  });
  world.videos = [
    stored("vidAAAAAAA1", "A"),
    stored("vidBBBBBBB1", "B"),
    stored("vidCCCCCCC1", "C"),
    stored("vidDDDDDDD1", "D"),
    // Stored under A, but YouTube says it is on B (a stale relationship).
    stored("vidSTALE001", "A"),
  ];
  // YouTube's own answer: the channel each video is really on.
  const truth: Record<string, string> = {
    vidAAAAAAA1: yt.A,
    vidBBBBBBB1: yt.B,
    vidBBBBBBB2: yt.B, // a new upload on B, not synced yet
    vidCCCCCCC1: yt.C,
    vidDDDDDDD1: yt.D,
    vidSTALE001: yt.B,
  };
  const youtube: Array<{ api: "videos" | "analytics"; token: string; channel: string | null }> = [];
  world.external = (url, { headers }) => {
    const token = (headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/videos")) {
      const id = url.searchParams.get("id") ?? "";
      youtube.push({ api: "videos", token, channel: null });
      const channelId = truth[id];
      if (!channelId) return Response.json({ items: [] });
      return Response.json({
        items: [
          {
            id,
            snippet: {
              title: `Video ${id}`,
              channelId,
              publishedAt: "2026-09-01T00:00:00Z",
              thumbnails: {},
            },
            contentDetails: { duration: "PT1M" },
            statistics: { viewCount: "10" },
            status: { privacyStatus: "public" },
          },
        ],
      });
    }
    if (url.hostname === "youtubeanalytics.googleapis.com") {
      const ids = url.searchParams.get("ids") ?? "";
      youtube.push({ api: "analytics", token, channel: ids.replace("channel==", "") });
      return Response.json({ columnHeaders: [], rows: [] });
    }
    return undefined;
  };
  return { world, users, w1, w2, yt, channel, youtube };
}

const get = (f: Fixture, as: string | null, query: string) =>
  callTeamApi(route, f.world, { as, method: "GET", path: "/api/youtube/video", query });
const channelOf = (result: CallResult) =>
  (result.body.data as { channel?: { id: string } } | undefined)?.channel?.id ?? null;

test("a video of the selected channel loads with that channel", async () => {
  const f = await fixture();
  const result = await get(f, f.users.owner, `?videoId=vidAAAAAAA1&channelId=${f.channel.A}`);
  assert.equal(result.status, 200);
  assert.equal(channelOf(result), f.channel.A);
  assert.deepEqual(
    f.youtube.map((call) => call.token),
    f.youtube.map(() => "token-A"),
  );
});

test("a video of ANOTHER of the workspace's channels loads with its own channel — the selection is only a suggestion", async () => {
  const f = await fixture();
  // The page used to send the dashboard's active channel (A) for a video on B: 422 before.
  const result = await get(f, f.users.owner, `?videoId=vidBBBBBBB1&channelId=${f.channel.A}`);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(channelOf(result), f.channel.B);
  // Its stored channel was tried first: B's token, B's analytics — A was never used.
  assert.ok(f.youtube.length > 1);
  assert.ok(f.youtube.every((call) => call.token === "token-B"));
  assert.ok(f.youtube.filter((c) => c.api === "analytics").every((c) => c.channel === f.yt.B));
  // Without any suggestion, the same.
  const plain = await get(f, f.users.editor, "?videoId=vidBBBBBBB1");
  assert.equal(channelOf(plain), f.channel.B);
});

test("switching between videos never carries one video's channel over to the next", async () => {
  const f = await fixture();
  const sequence = ["vidAAAAAAA1", "vidBBBBBBB1", "vidAAAAAAA1", "vidBBBBBBB1"];
  const channels = [];
  for (const id of sequence)
    channels.push(channelOf(await get(f, f.users.owner, `?videoId=${id}`)));
  assert.deepEqual(channels, [f.channel.A, f.channel.B, f.channel.A, f.channel.B]);
  // And the page no longer sends a channel at all, nor refetches when the selected one changes.
  const page = readFileSync("src/routes/videos.$videoId.tsx", "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(page, /params\.set\("channelId"|activeChannelId|ACTIVE_YOUTUBE_CHANNEL_KEY/);
  assert.match(page, /\}, \[range, retryNonce, videoId\]\);/);
});

test("a video not stored yet is found on the right channel of a multi-channel workspace; YouTube still confirms it", async () => {
  const f = await fixture();
  const result = await get(f, f.users.owner, "?videoId=vidBBBBBBB2");
  assert.equal(result.status, 200);
  assert.equal(channelOf(result), f.channel.B);
  // A (newest connection) was tried first and refused by YouTube; B confirmed.
  const lookups = f.youtube.filter((c) => c.api === "videos").map((c) => c.token);
  assert.deepEqual(lookups, ["token-A", "token-B"]);
});

test("a stale stored channel is never trusted: YouTube's answer decides", async () => {
  const f = await fixture();
  const result = await get(f, f.users.owner, "?videoId=vidSTALE001");
  assert.equal(result.status, 200);
  assert.equal(channelOf(result), f.channel.B);
});

test("another workspace's video is never loaded — with any channel — and its connection is never used", async () => {
  const f = await fixture();
  const result = await get(f, f.users.owner, "?videoId=vidDDDDDDD1");
  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { error: "YOUTUBE_VIDEO_CHANNEL_MISMATCH" });
  assert.ok(f.youtube.every((call) => call.token !== "token-D"));
  assert.ok(!f.youtube.some((call) => call.api === "analytics"), "no report was run");
  // A disconnected channel's video: its channel is not a candidate.
  const disconnected = await get(f, f.users.owner, "?videoId=vidCCCCCCC1");
  assert.equal(disconnected.status, 422);
  // An id YouTube does not know.
  const unknown = await get(f, f.users.owner, "?videoId=vidUNKNOWN1");
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: "YOUTUBE_VIDEO_NOT_FOUND" });
});

test("a suggested channel that is not one of the workspace's connected channels is refused before YouTube is called", async () => {
  const f = await fixture();
  for (const channelId of [f.channel.D, f.channel.C, uuid()]) {
    const result = await get(f, f.users.owner, `?videoId=vidAAAAAAA1&channelId=${channelId}`);
    assert.equal(result.status, 404, channelId);
    assert.deepEqual(result.body, { error: "CHANNEL_NOT_FOUND" });
  }
  const malformed = await get(f, f.users.owner, "?videoId=vidAAAAAAA1&channelId=not-a-uuid");
  assert.equal(malformed.status, 422);
  for (const videoId of ["", "short", "vidAAAAAAA1x"]) {
    const bad = await get(f, f.users.owner, `?videoId=${videoId}`);
    assert.equal(bad.status, 422, videoId);
  }
  assert.deepEqual(f.youtube, []);
});

test("authorization is unchanged: signed out is 401, no workspace is refused, and no connected channel is 404", async () => {
  const f = await fixture();
  const out = await get(f, null, "?videoId=vidAAAAAAA1");
  assert.equal(out.status, 401);
  const nobody = await get(f, f.users.nobody, "?videoId=vidAAAAAAA1");
  assert.equal(nobody.status, 403);
  // W2's owner sees only W2's channel D: W1's videos are not theirs.
  const theirs = await get(f, f.users.other, "?videoId=vidAAAAAAA1");
  assert.equal(theirs.status, 422);
  assert.ok(f.youtube.every((call) => call.token === "token-D"));
  // A workspace with no connected channel.
  f.world.youtube_channels = f.world.youtube_channels!.map((c) => ({ ...c, connection_id: null }));
  const none = await get(f, f.users.owner, "?videoId=vidAAAAAAA1");
  assert.equal(none.status, 404);
  assert.deepEqual(none.body, { error: "CHANNEL_NOT_FOUND" });
  assert.deepEqual(
    [out, nobody, theirs, none].flatMap((r) => r.writes),
    [],
    "nothing is written by these requests",
  );
});

test("source: channels come only from the caller's workspace, and every candidate is verified with YouTube", () => {
  const source = readFileSync("src/routes/api.youtube.video.ts", "utf8").replace(/\s+/g, " ");
  assert.match(source, /getWorkspaceContext\(request\)/);
  assert.match(
    source,
    /\.from\("youtube_channels"\) \.select\("id, youtube_channel_id, channel_name, channel_handle"\) \.eq\("workspace_id", workspaceId\) \.not\("connection_id", "is", null\)/,
  );
  // The service-role read of a channel's tokens is confined to the workspace too.
  assert.match(
    source,
    /\.eq\("id", candidate\.id\) \.eq\("workspace_id", workspaceId\) \.single\(\)/,
  );
  assert.match(source, /fetchYoutubeVideoById\(token, videoId, candidate\.youtube_channel_id\)/);
  assert.doesNotMatch(source, /requireSessionUser/);
});
