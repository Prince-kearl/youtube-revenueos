import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  type World,
} from "./helpers/team-fake-api";

// Multichannel connection, end to end on the server: the real "Connect" route, Google's consent
// answered here (token exchange, ID token, channels.list), the real OAuth callback, what is stored
// (connection with encrypted tokens, channel rows), and channel-specific data read back through
// the real data routes. Google itself is simulated: these tests do not reach Google.

const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
env.GOOGLE_CLIENT_SECRET = "client-secret";
env.GOOGLE_REDIRECT_URI = "https://app.test/api/youtube/callback";
env.APP_URL = "https://app.test";
const { decryptSecretFromBytea } = await import("../src/lib/server/crypto");
const routes = {
  auth: await import("../src/routes/api.youtube.auth"),
  callback: await import("../src/routes/api.youtube.callback"),
  channels: await import("../src/routes/api.youtube.channels"),
  connections: await import("../src/routes/api.youtube.connections"),
  videos: await import("../src/routes/api.youtube.videos"),
};

type Row = Record<string, unknown>;
type GoogleAccount = {
  sub: string;
  email: string;
  channels: Array<{ id: string; title: string; videos: string[] }>;
};

const ALICE: GoogleAccount = {
  sub: "google-sub-alice",
  email: "alice@gmail.test",
  channels: [{ id: "UCaliceAAAAAAAAAAAAAAAAA", title: "Alice Cooks", videos: ["vidAlice001"] }],
};
const BRAND: GoogleAccount = {
  sub: "google-sub-brand",
  email: "brand@gmail.test",
  channels: [
    { id: "UCbrandBBBBBBBBBBBBBBBBB", title: "Brand Tech", videos: ["vidBrand001", "vidBrand002"] },
  ],
};
const MANAGER_OF_TWO: GoogleAccount = {
  sub: "google-sub-multi",
  email: "multi@gmail.test",
  channels: [
    { id: "UCmultiOneCCCCCCCCCCCCCC", title: "Multi One", videos: ["vidMulti001"] },
    { id: "UCmultiTwoDDDDDDDDDDDDDD", title: "Multi Two", videos: ["vidMulti002"] },
  ],
};

const idToken = (account: GoogleAccount) =>
  [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: account.sub, email: account.email })).toString("base64url"),
    "sig",
  ].join(".");

function fixture(plan: "starter" | "pro" | "scale" | null = "scale") {
  const world: World = { ...emptyWorld() };
  const owner = addUser(world, "owner@x.test");
  const manager = addUser(world, "manager@x.test");
  const editor = addUser(world, "editor@x.test");
  const other = addUser(world, "other@x.test");
  const wA = addWorkspace(world, owner);
  addMember(world, wA, manager, "manager");
  addMember(world, wA, editor, "editor");
  const wB = addWorkspace(world, other);
  if (plan) addSubscription(world, owner, plan);
  addSubscription(world, other, "scale");
  world.youtube_connections = [];
  world.youtube_channels = [];
  world.youtube_quota_events = [];
  (world as unknown as Record<string, Row[]>).youtube_integration_settings = [];

  // Google, simulated: codes → accounts, tokens → accounts, refresh tokens that may be revoked.
  const codes = new Map<string, GoogleAccount | "fail" | "no_refresh">();
  const tokens = new Map<string, GoogleAccount>();
  const revoked = new Set<string>();
  const google: string[] = [];
  let issued = 0;
  world.external = (url, { method, headers, body }) => {
    google.push(`${method} ${url.hostname}${url.pathname}`);
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      const form = new URLSearchParams(body ?? "");
      if (form.get("grant_type") === "authorization_code") {
        const account = codes.get(form.get("code") ?? "");
        if (!account || account === "fail")
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        issued += 1;
        if (account === "no_refresh")
          return Response.json({ access_token: `at-${issued}`, expires_in: 3600, scope: "openid" });
        tokens.set(`at-${issued}`, account);
        tokens.set(`rt-${account.sub}`, account);
        return Response.json({
          access_token: `at-${issued}`,
          refresh_token: `rt-${account.sub}`,
          expires_in: 3600,
          scope: "openid email https://www.googleapis.com/auth/youtube.force-ssl",
          id_token: idToken(account),
        });
      }
      if (form.get("grant_type") === "refresh_token") {
        const rt = form.get("refresh_token") ?? "";
        if (revoked.has(rt) || !tokens.has(rt))
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        issued += 1;
        tokens.set(`at-${issued}`, tokens.get(rt)!);
        return Response.json({ access_token: `at-${issued}`, expires_in: 3600 });
      }
    }
    if (url.hostname !== "www.googleapis.com") return undefined;
    const token = (headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const account = tokens.get(token);
    if (!account) return Response.json({ error: { code: 401 } }, { status: 401 });
    const resource = url.pathname.split("/").pop();
    if (resource === "channels")
      return Response.json({
        items: account.channels.map((c) => ({
          id: c.id,
          snippet: {
            title: c.title,
            customUrl: `@${c.title.replace(/\s/g, "")}`,
            thumbnails: { default: { url: `https://img.test/${c.id}` } },
          },
          statistics: {
            subscriberCount: "10",
            viewCount: "100",
            videoCount: String(c.videos.length),
          },
          contentDetails: { relatedPlaylists: { uploads: `UU${c.id.slice(2)}` } },
        })),
      });
    if (resource === "playlistItems") {
      const channel = account.channels.find(
        (c) => `UU${c.id.slice(2)}` === url.searchParams.get("playlistId"),
      );
      return Response.json({
        items: (channel?.videos ?? []).map((v) => ({
          contentDetails: { videoId: v },
          snippet: { title: v },
        })),
      });
    }
    if (resource === "videos") {
      const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean);
      return Response.json({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: `Video ${id}`,
            publishedAt: "2026-10-01T00:00:00Z",
            channelId: account.channels.find((c) => c.videos.includes(id))?.id,
          },
          statistics: { viewCount: "5" },
          contentDetails: { duration: "PT1M" },
          status: { privacyStatus: "public" },
        })),
      });
    }
    return undefined;
  };
  return { world, owner, manager, editor, other, wA, wB, codes, tokens, revoked, google };
}
type Fixture = ReturnType<typeof fixture>;

/** "Connect channel" → Google consent (as `account`) → callback. Returns where the browser lands. */
async function connect(
  f: Fixture,
  as: string,
  account: GoogleAccount | "fail" | "no_refresh",
  options: { tamperState?: boolean; denied?: boolean } = {},
) {
  const start = await callTeamApi(routes.auth, f.world, {
    as,
    method: "GET",
    path: "/api/youtube/auth",
    query: "?returnTo=/settings",
  });
  const location = start.headers.get("location") ?? "";
  // Refused before Google (not allowed, no workspace…): the browser never reaches Google.
  if (start.status !== 302 || !location.startsWith("https://accounts.google.com/"))
    return { start, landing: null as string | null };
  const state = new URL(location).searchParams.get("state") ?? "";
  const cookies = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const code = `code-${Math.random().toString(36).slice(2)}`;
  f.codes.set(code, account);
  const query = options.denied
    ? "?error=access_denied"
    : `?code=${code}&state=${options.tamperState ? "forged" : state}`;
  const back = await callTeamApi(routes.callback, f.world, {
    as,
    method: "GET",
    path: "/api/youtube/callback",
    query,
    headers: { cookie: cookies },
  });
  return { start, back, landing: back.headers.get("location") };
}

const channels = (f: Fixture) => f.world.youtube_channels as Row[];
const connections = (f: Fixture) => f.world.youtube_connections as Row[];
const listChannels = (f: Fixture, as: string) =>
  callTeamApi(routes.channels, f.world, { as, method: "GET", path: "/api/youtube/channels" });
const videos = (f: Fixture, as: string, channelId?: string) =>
  callTeamApi(routes.videos, f.world, {
    as,
    method: "GET",
    path: "/api/youtube/videos",
    query: channelId ? `?channelId=${channelId}` : "",
  });
const disconnect = (f: Fixture, as: string, id: string) =>
  callTeamApi(routes.channels, f.world, {
    as,
    method: "DELETE",
    path: "/api/youtube/channels",
    query: `?id=${id}`,
  });
const rowFor = (f: Fixture, youtubeChannelId: string, workspaceId = f.wA) =>
  channels(f).find(
    (c) => c.youtube_channel_id === youtubeChannelId && c.workspace_id === workspaceId,
  );

// ---------- 1, 4, 10: the first channel ----------

test("S1 connect the first channel: OAuth → stored connection and channel → its own data", async () => {
  const f = fixture();
  const { start, landing } = await connect(f, f.owner, ALICE);
  const google = new URL(start.headers.get("location")!);
  assert.equal(google.origin + google.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(google.searchParams.get("access_type"), "offline");
  // select_account: Google always shows its account / channel picker (one channel per sign-in).
  assert.equal(google.searchParams.get("prompt"), "select_account consent");
  assert.equal(landing, "https://app.test/settings?youtube=connected");

  assert.equal(connections(f).length, 1);
  const conn = connections(f)[0];
  assert.deepEqual(
    [conn.workspace_id, conn.user_id, conn.google_subject_id, conn.status],
    [f.wA, f.owner, ALICE.sub, "active"],
  );
  // Tokens are stored encrypted, never in clear.
  assert.notEqual(String(conn.refresh_token_ciphertext), "rt-google-sub-alice");
  assert.equal(
    await decryptSecretFromBytea(conn.refresh_token_ciphertext as string),
    "rt-google-sub-alice",
  );

  const row = rowFor(f, ALICE.channels[0].id)!;
  assert.deepEqual(
    [row.workspace_id, row.connection_id, row.channel_name, row.thumbnail, row.uploads_playlist_id],
    [
      f.wA,
      conn.id,
      "Alice Cooks",
      `https://img.test/${ALICE.channels[0].id}`,
      `UU${ALICE.channels[0].id.slice(2)}`,
    ],
  );

  // S4: persisted — a fresh request lists it, and its videos come back from YouTube.
  const list = await listChannels(f, f.owner);
  assert.deepEqual(
    (list.body.data as Row[]).map((c) => c.channel_name),
    ["Alice Cooks"],
  );
  const v = await videos(f, f.owner, row.id as string);
  assert.equal(v.status, 200, v.text);
  assert.deepEqual(
    ((v.body.data as Row).videos as Row[]).map((x) => x.id),
    ["vidAlice001"],
  );
});

// ---------- 2, 3: a second channel and isolation ----------

test("S2/S3 a second channel (another Google account) is added beside the first; each shows only its own data", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  const before = { ...rowFor(f, ALICE.channels[0].id)! };
  const { landing } = await connect(f, f.owner, BRAND);
  assert.equal(landing, "https://app.test/settings?youtube=connected");
  assert.equal(connections(f).length, 2);
  const alice = rowFor(f, ALICE.channels[0].id)!;
  const brand = rowFor(f, BRAND.channels[0].id)!;
  assert.deepEqual(
    [alice.id, alice.connection_id],
    [before.id, before.connection_id],
    "first untouched",
  );
  assert.notEqual(alice.connection_id, brand.connection_id);

  const va = await videos(f, f.owner, alice.id as string);
  const vb = await videos(f, f.owner, brand.id as string);
  assert.deepEqual(
    ((va.body.data as Row).videos as Row[]).map((x) => x.id),
    ["vidAlice001"],
  );
  assert.deepEqual(
    ((vb.body.data as Row).videos as Row[]).map((x) => x.id),
    ["vidBrand001", "vidBrand002"],
  );
});

test("S2b one Google account with two channels: the person picks, then the chosen one is added", async () => {
  const f = fixture();
  const { landing } = await connect(f, f.owner, MANAGER_OF_TWO);
  const target = new URL(landing!);
  assert.equal(target.searchParams.get("youtube"), "pick_channels");
  const pending = target.searchParams.get("pendingConnectionId")!;
  assert.equal(channels(f).length, 0, "nothing added before the person chooses");
  const offered = await callTeamApi(routes.connections, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/connections",
    query: `?discover=${pending}`,
  });
  assert.deepEqual(
    (offered.body.data as Row[]).map((c) => c.channelId),
    MANAGER_OF_TWO.channels.map((c) => c.id),
  );
  const add = await callTeamApi(routes.connections, f.world, {
    as: f.owner,
    method: "POST",
    path: "/api/youtube/connections",
    body: { connectionId: pending, channelId: MANAGER_OF_TWO.channels[1].id },
  });
  assert.equal(add.status, 201, add.text);
  assert.deepEqual(
    channels(f).map((c) => c.channel_name),
    ["Multi Two"],
  );
});

// ---------- 5, 6, 7: disconnect, reconnect, duplicate ----------

test("S5 disconnecting one channel leaves the other working; its credentials are removed", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  await connect(f, f.owner, BRAND);
  const alice = rowFor(f, ALICE.channels[0].id)!;
  const brand = rowFor(f, BRAND.channels[0].id)!;
  const aliceConnection = alice.connection_id;
  const r = await disconnect(f, f.owner, alice.id as string);
  assert.equal(r.status, 200, r.text);
  assert.equal(rowFor(f, ALICE.channels[0].id)!.connection_id, null, "row kept, detached");
  assert.ok(!connections(f).some((c) => c.id === aliceConnection), "its tokens deleted");
  const list = await listChannels(f, f.owner);
  assert.deepEqual(
    (list.body.data as Row[]).map((c) => c.channel_name),
    ["Brand Tech"],
  );
  const vb = await videos(f, f.owner, brand.id as string);
  assert.equal(vb.status, 200);
  const va = await videos(f, f.owner, alice.id as string);
  assert.equal(va.status, 404, "a disconnected channel's data is not read");
});

test("S6 reconnecting a disconnected channel reattaches the same row (history kept)", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  const id = rowFor(f, ALICE.channels[0].id)!.id;
  await disconnect(f, f.owner, id as string);
  const { landing } = await connect(f, f.owner, ALICE);
  assert.equal(landing, "https://app.test/settings?youtube=connected");
  assert.equal(channels(f).length, 1);
  assert.equal(rowFor(f, ALICE.channels[0].id)!.id, id);
  assert.ok(rowFor(f, ALICE.channels[0].id)!.connection_id);
});

test("S7 connecting an already-connected channel again: no duplicate, tokens refreshed", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  const conn = connections(f)[0].id;
  const { landing } = await connect(f, f.owner, ALICE);
  assert.equal(landing, "https://app.test/settings?youtube=already_connected");
  assert.equal(channels(f).length, 1);
  assert.equal(connections(f).length, 1);
  assert.equal(connections(f)[0].id, conn);
});

// ---------- 8: failures ----------

test("S8 denied consent, a forged state, a failed code exchange and a missing refresh token store nothing", async () => {
  const f = fixture();
  assert.equal(
    (await connect(f, f.owner, ALICE, { denied: true })).landing,
    "https://app.test/settings?youtube=denied",
  );
  assert.equal(
    (await connect(f, f.owner, ALICE, { tamperState: true })).landing,
    "https://app.test/settings?youtube=invalid_state",
  );
  assert.equal(
    (await connect(f, f.owner, "fail")).landing,
    "https://app.test/settings?youtube=error",
  );
  assert.equal(
    (await connect(f, f.owner, "no_refresh")).landing,
    "https://app.test/settings?youtube=reauthorize_required",
  );
  assert.deepEqual([connections(f).length, channels(f).length], [0, 0]);
});

test("S8b revoked Google access: the channel is flagged for reconnection and its data route says so", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  const conn = connections(f)[0];
  conn.token_expiry = new Date(Date.now() - 60_000).toISOString(); // access token expired
  f.revoked.add("rt-google-sub-alice"); // and the person revoked Tubify in their Google account
  const row = rowFor(f, ALICE.channels[0].id)!;
  const r = await videos(f, f.owner, row.id as string);
  assert.equal(r.status, 401, r.text);
  assert.equal((r.body as Row).error, "YOUTUBE_REAUTH_REQUIRED");
  assert.equal(connections(f)[0].status, "reauth_required");
  assert.equal(rowFor(f, ALICE.channels[0].id)!.last_sync_status, "reauth_required");
  // Reconnecting fixes it.
  f.revoked.delete("rt-google-sub-alice");
  await connect(f, f.owner, ALICE);
  assert.equal(rowFor(f, ALICE.channels[0].id)!.last_sync_status, "never_synced");
  assert.equal(
    connections(f).find((c) => c.id === rowFor(f, ALICE.channels[0].id)!.connection_id)!.status,
    "active",
  );
});

test("S8c an expired access token is refreshed silently", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  connections(f)[0].token_expiry = new Date(Date.now() - 60_000).toISOString();
  const r = await videos(f, f.owner, rowFor(f, ALICE.channels[0].id)!.id as string);
  assert.equal(r.status, 200, r.text);
  assert.ok(new Date(connections(f)[0].token_expiry as string).getTime() > Date.now());
});

// ---------- 9: plan limits and permissions ----------

test("S9 the plan's channel limit and a missing subscription stop a new channel", async () => {
  const f = fixture("starter");
  await connect(f, f.owner, ALICE);
  const { landing } = await connect(f, f.owner, BRAND);
  assert.equal(landing, "https://app.test/settings?youtube=channel_limit");
  assert.equal(rowFor(f, BRAND.channels[0].id)?.connection_id ?? null, null);
  const g = fixture(null);
  assert.equal(
    (await connect(g, g.owner, ALICE)).landing,
    "https://app.test/settings?youtube=subscription_required",
  );
  assert.equal(g.world.youtube_channels!.length, 0);
});

test("S9b only an owner or manager can connect or disconnect the workspace's channels", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  const row = rowFor(f, ALICE.channels[0].id)!;
  const googleCalls = f.google.length;

  // An editor who clicks "Connect" is sent back with an explanation — Google is never opened.
  const editorConnect = await connect(f, f.editor, BRAND);
  assert.equal(editorConnect.start.status, 302);
  assert.equal(editorConnect.start.headers.get("location"), "/settings?youtube=not_allowed");
  assert.equal(editorConnect.landing, null);
  // Even with a valid state and code (a callback reached some other way), nothing is stored.
  const forged = await callTeamApi(routes.callback, f.world, {
    as: f.editor,
    method: "GET",
    path: "/api/youtube/callback",
    query: "?code=anything&state=s1",
    headers: { cookie: "yt_oauth_state=s1; yt_oauth_return=/settings" },
  });
  assert.equal(forged.headers.get("location"), "https://app.test/settings?youtube=not_allowed");
  assert.equal(f.google.length, googleCalls, "no code was exchanged");
  assert.equal(rowFor(f, BRAND.channels[0].id), undefined);

  // The picker endpoints refuse too.
  const conn = connections(f)[0].id as string;
  for (const call of [
    { method: "GET" as const, query: `?discover=${conn}` },
    { method: "POST" as const, body: { connectionId: conn, channelId: ALICE.channels[0].id } },
  ]) {
    const r = await callTeamApi(routes.connections, f.world, {
      as: f.editor,
      path: "/api/youtube/connections",
      ...call,
    });
    assert.equal(r.status, 403, call.method);
  }

  const editorDisconnect = await disconnect(f, f.editor, row.id as string);
  assert.equal(editorDisconnect.status, 403);
  assert.ok(rowFor(f, ALICE.channels[0].id)!.connection_id, "still connected");
  const list = await listChannels(f, f.editor);
  assert.deepEqual(
    [list.status, (list.body as Row).canManage],
    [200, false],
    "editor still sees it",
  );

  // A manager may.
  assert.equal(
    (await connect(f, f.manager, BRAND)).landing,
    "https://app.test/settings?youtube=connected",
  );
  assert.equal((await listChannels(f, f.manager)).body.canManage, true);
  assert.equal(
    (await disconnect(f, f.manager, rowFor(f, BRAND.channels[0].id)!.id as string)).status,
    200,
  );
});

test("S9c a return path with its own query keeps it, with the outcome added", async () => {
  const f = fixture();
  const start = await callTeamApi(routes.auth, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/auth",
    query: `?returnTo=${encodeURIComponent("/comments?video=abc")}`,
  });
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const cookies = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  f.codes.set("c1", ALICE);
  const back = await callTeamApi(routes.callback, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/callback",
    query: `?code=c1&state=${state}`,
    headers: { cookie: cookies },
  });
  assert.equal(
    back.headers.get("location"),
    "https://app.test/comments?video=abc&youtube=connected",
  );
});

// ---------- cross-workspace isolation ----------

test("X1 another workspace's channel: never listed, read or disconnected — even by a member of both", async () => {
  const f = fixture();
  await connect(f, f.other, BRAND); // workspace B's channel
  const bRow = rowFor(f, BRAND.channels[0].id, f.wB)!;
  await connect(f, f.owner, ALICE);
  // The owner of A is also a member of B (A is their current workspace).
  addMember(f.world, f.wB, f.owner, "editor");
  const list = await listChannels(f, f.owner);
  assert.deepEqual(
    (list.body.data as Row[]).map((c) => c.channel_name),
    ["Alice Cooks"],
    "only A's",
  );
  const read = await videos(f, f.owner, bRow.id as string);
  assert.equal(read.status, 404, "B's channel is not readable from A");
  const del = await disconnect(f, f.owner, bRow.id as string);
  assert.deepEqual([del.status, del.body], [404, { error: "CHANNEL_NOT_FOUND" }]);
  assert.ok(rowFor(f, BRAND.channels[0].id, f.wB)!.connection_id, "B's channel still connected");
});

test("X2 another workspace's Google connection can never be attached to this workspace", async () => {
  const f = fixture();
  await connect(f, f.other, MANAGER_OF_TWO); // B: picker pending
  const bConnection = connections(f).find((c) => c.workspace_id === f.wB)!.id as string;
  addMember(f.world, f.wB, f.owner, "editor");
  const discover = await callTeamApi(routes.connections, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/connections",
    query: `?discover=${bConnection}`,
  });
  assert.equal(discover.status, 404, "B's connection is not offered in A");
  const attach = await callTeamApi(routes.connections, f.world, {
    as: f.owner,
    method: "POST",
    path: "/api/youtube/connections",
    body: { connectionId: bConnection, channelId: MANAGER_OF_TWO.channels[0].id },
  });
  assert.equal(attach.status, 404, attach.text);
  assert.equal(rowFor(f, MANAGER_OF_TWO.channels[0].id, f.wA), undefined, "nothing added to A");
});

// ---------- the pages ----------

test("UI: connect/disconnect controls show only to an owner or manager; every page reports the outcome", async () => {
  const { readFileSync } = await import("node:fs");
  const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
  const settings = flat("src/routes/settings.tsx");
  const switcher = flat("src/components/YoutubeChannelSwitcher.tsx");
  assert.match(settings, /setCanManage\(response\.ok && body\.canManage === true\)/);
  assert.match(settings, /\{canManage && \( <button onClick=\{\(\) => disconnect\(channel\.id\)\}/);
  assert.match(settings, /Ask the workspace owner or a manager to connect a channel\./);
  assert.match(settings, /disabled: loading \|\| disconnecting \|\| !canManageChannels,/);
  assert.match(switcher, /\{canManage && \( <a href=\{connectHref\}/);
  // Back from Google on a page other than Settings: the outcome is shown, then cleared.
  assert.match(switcher, /export function YoutubeConnectionOutcome\(\)/);
  assert.match(switcher, /if \(window\.location\.pathname === "\/settings"\) return;/);
  assert.match(switcher, /const message = youtubeCallbackMessage\(status\);/);
  // Always mounted (the switcher itself is inside a menu that only exists while open).
  assert.match(flat("src/components/DashboardLayout.tsx"), /<YoutubeConnectionOutcome \/>/);
  // Settings opens its YouTube panel for a ?youtube= outcome (message, channel picker).
  assert.match(settings, /: youtube \? "YouTube Integration" : "Profile",/);
  const messages = flat("src/lib/youtube-connect-messages.ts");
  for (const status of [
    "connected",
    "denied",
    "not_allowed",
    "channel_limit",
    "already_connected",
    "invalid_state",
  ])
    assert.match(messages, new RegExp(`${status}: [{]`), status);
});

// ---------- MC-8: missing or expired session ----------

test("MC-8 'Connect' without a session goes to sign-in (never raw JSON), remembering a safe page", async () => {
  const f = fixture();
  const r = await callTeamApi(routes.auth, f.world, {
    as: null,
    method: "GET",
    path: "/api/youtube/auth",
    query: `?returnTo=${encodeURIComponent("/comments?video=abc")}`,
  });
  assert.equal(r.status, 302);
  assert.equal(
    r.headers.get("location"),
    `/?next=${encodeURIComponent("/comments?video=abc")}&reason=session_expired`,
  );
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("post_login_next="))!;
  assert.match(
    cookie,
    /^post_login_next=%2Fcomments%3Fvideo%3Dabc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600/,
  );
  assert.equal(f.google.length, 0, "Google is not opened without a session");
});

test("MC-8 a return path that is off the app, an API or an auth route is never remembered", async () => {
  const f = fixture();
  for (const [returnTo, expected] of [
    ["https://evil.test/x", "/settings"],
    ["//evil.test", "/settings"],
    [String.raw`/\evil.test`, "/settings"],
    ["/api/youtube/auth", "/dashboard"],
    ["/auth/callback?code=1", "/dashboard"],
    ["/api", "/dashboard"],
  ] as const) {
    const r = await callTeamApi(routes.auth, f.world, {
      as: null,
      method: "GET",
      path: "/api/youtube/auth",
      query: `?returnTo=${encodeURIComponent(returnTo)}`,
    });
    assert.equal(
      r.headers.get("location"),
      `/?next=${encodeURIComponent(expected)}&reason=session_expired`,
      returnTo,
    );
  }
  const { postLoginPath } = await import("../src/lib/safe-redirect");
  assert.equal(postLoginPath("/analytics?range=28d#top"), "/analytics?range=28d#top");
  assert.equal(postLoginPath("/apiary"), "/apiary", "only the /api and /auth routes are refused");
  assert.equal(postLoginPath(null), "/dashboard");
});

test("MC-8 a session that expired during Google's consent: sign in again, nothing stored", async () => {
  const f = fixture();
  f.codes.set("c-late", ALICE);
  const r = await callTeamApi(routes.callback, f.world, {
    as: null,
    method: "GET",
    path: "/api/youtube/callback",
    query: "?code=c-late&state=s1",
    headers: { cookie: "yt_oauth_state=s1; yt_oauth_return=%2Fvideos" },
  });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/?next=%2Fvideos&reason=session_expired");
  assert.equal(f.google.length, 0, "the code was not exchanged");
  assert.deepEqual([connections(f).length, channels(f).length], [0, 0]);
});

test("MC-8 after signing in, the person lands back where they were and can connect again", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  // What the sign-in page does next: /api/youtube/auth?returnTo=<next>&ifNeeded=1.
  const back = await callTeamApi(routes.auth, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/auth",
    query: `?returnTo=${encodeURIComponent("/comments?video=abc")}&ifNeeded=1`,
  });
  assert.equal(back.headers.get("location"), "/comments?video=abc");
  // And "Connect" now goes to Google as normal.
  const again = await connect(f, f.owner, BRAND);
  assert.equal(again.landing, "https://app.test/settings?youtube=connected");

  const { readFileSync } = await import("node:fs");
  const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
  const signIn = flat("src/routes/index.tsx");
  assert.match(signIn, /setNextPath\(next \? postLoginPath\(next\) : null\);/);
  assert.match(
    signIn,
    /returnTo=\$\{encodeURIComponent\(nextPath \?\? "\/dashboard"\)\}&ifNeeded=1/,
  );
  assert.match(signIn, /Your session has expired\. Sign in again to continue/);
  const authCallback = flat("src/routes/auth.callback.tsx");
  assert.match(
    authCallback,
    /const next = postLoginPath\(getCookie\(request, POST_LOGIN_COOKIE\)\);/,
  );
  assert.match(authCallback, /buildExpiredCookie\(POST_LOGIN_COOKIE\)/);
});

test("legacy connection (no Google account id yet, needs reconnecting): reconnecting adopts it — no duplicate, history kept", async () => {
  const f = fixture();
  const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
  const legacyId = "0e000000-0000-4000-8000-000000000001";
  const channelId = "0c000000-0000-4000-8000-000000000001";
  connections(f).push({
    id: legacyId,
    workspace_id: f.wA,
    user_id: f.owner,
    google_subject_id: null,
    google_email: null,
    access_token_ciphertext: await encryptSecretToBytea("old-at"),
    refresh_token_ciphertext: await encryptSecretToBytea("old-rt"),
    token_expiry: new Date(Date.now() - 60_000).toISOString(),
    granted_scopes: [],
    status: "reauth_required",
  });
  channels(f).push({
    id: channelId,
    workspace_id: f.wA,
    user_id: f.owner,
    youtube_channel_id: ALICE.channels[0].id,
    channel_name: "Alice Cooks",
    connection_id: legacyId,
    connected_at: "2026-01-01T00:00:00Z",
    last_sync_status: "reauth_required",
  });
  const { landing } = await connect(f, f.owner, ALICE);
  assert.equal(landing, "https://app.test/settings?youtube=already_connected");
  assert.equal(connections(f).length, 1, "the legacy connection was adopted, not duplicated");
  const conn = connections(f)[0];
  assert.deepEqual([conn.id, conn.google_subject_id, conn.status], [legacyId, ALICE.sub, "active"]);
  const row = channels(f)[0];
  assert.deepEqual(
    [channels(f).length, row.id, row.connection_id, row.last_sync_status],
    [1, channelId, legacyId, "never_synced"],
  );
  const v = await videos(f, f.owner, channelId);
  assert.equal(v.status, 200, v.text);
});

// ---------- more than two channels ----------

const account = (n: number): GoogleAccount => ({
  sub: `google-sub-extra-${n}`,
  email: `extra${n}@gmail.test`,
  channels: [
    { id: `UCextra${String(n).padStart(17, "0")}`, title: `Extra ${n}`, videos: [`vidExtra${n}`] },
  ],
});

test("more than two channels: Scale connects five (different Google accounts), each keeps its own data", async () => {
  const f = fixture("scale");
  const accounts = [ALICE, BRAND, account(3), account(4), account(5)];
  for (const a of accounts)
    assert.equal(
      (await connect(f, f.owner, a)).landing,
      "https://app.test/settings?youtube=connected",
      a.email,
    );
  assert.equal(channels(f).filter((c) => c.connection_id).length, 5);
  assert.equal(connections(f).length, 5);
  const list = await listChannels(f, f.owner);
  assert.equal((list.body.data as Row[]).length, 5);
  for (const a of accounts) {
    const row = rowFor(f, a.channels[0].id)!;
    const v = await videos(f, f.owner, row.id as string);
    assert.deepEqual(
      ((v.body.data as Row).videos as Row[]).map((x) => x.id),
      a.channels[0].videos,
      a.email,
    );
  }
  // Disconnecting the third leaves the other four working.
  await disconnect(f, f.owner, rowFor(f, account(3).channels[0].id)!.id as string);
  assert.equal(((await listChannels(f, f.owner)).body.data as Row[]).length, 4);
});

test("more than two channels from ONE Google account: all three can be added through the picker", async () => {
  const f = fixture("scale");
  const three: GoogleAccount = {
    ...MANAGER_OF_TWO,
    channels: [
      ...MANAGER_OF_TWO.channels,
      { id: "UCmultiThreeEEEEEEEEEEEE", title: "Multi Three", videos: ["vidMulti003"] },
    ],
  };
  const pending = new URL((await connect(f, f.owner, three)).landing!).searchParams.get(
    "pendingConnectionId",
  )!;
  for (const c of three.channels) {
    const add = await callTeamApi(routes.connections, f.world, {
      as: f.owner,
      method: "POST",
      path: "/api/youtube/connections",
      body: { connectionId: pending, channelId: c.id },
    });
    assert.equal(add.status, 201, `${c.title}: ${add.text}`);
  }
  assert.deepEqual(
    channels(f)
      .map((c) => c.channel_name)
      .sort(),
    ["Multi One", "Multi Three", "Multi Two"],
  );
  assert.equal(connections(f).length, 1, "one Google connection backs all three");
});

test("Pro allows three channels; the fourth is refused with the plan message, the first three untouched", async () => {
  const f = fixture("pro");
  for (const a of [ALICE, BRAND, account(3)])
    assert.equal(
      (await connect(f, f.owner, a)).landing,
      "https://app.test/settings?youtube=connected",
    );
  assert.equal(
    (await connect(f, f.owner, account(4))).landing,
    "https://app.test/settings?youtube=channel_limit",
  );
  assert.equal(channels(f).filter((c) => c.connection_id).length, 3);
});

// ---------- disconnected channels stay visible, with a way back ----------

test("disconnected channels are listed (this workspace only, display fields only) and reconnect to the same record", async () => {
  const f = fixture();
  await connect(f, f.owner, ALICE);
  await connect(f, f.owner, BRAND);
  await connect(f, f.other, account(9)); // workspace B
  await disconnect(f, f.other, rowFor(f, account(9).channels[0].id, f.wB)!.id as string);
  const brandId = rowFor(f, BRAND.channels[0].id)!.id as string;
  await disconnect(f, f.owner, brandId);

  const list = await listChannels(f, f.owner);
  const body = list.body as { data: Row[]; disconnected: Row[]; canManage: boolean };
  assert.deepEqual(
    body.data.map((c) => c.channel_name),
    ["Alice Cooks"],
  );
  assert.deepEqual(
    body.disconnected.map((c) => [c.id, c.channel_name]),
    [[brandId, "Brand Tech"]],
    "not B's",
  );
  assert.deepEqual(Object.keys(body.disconnected[0]).sort(), [
    "channel_handle",
    "channel_name",
    "id",
    "last_synced_at",
    "subscriber_count",
    "thumbnail",
    "youtube_channel_id",
  ]);
  // An editor sees them too, but cannot manage them.
  const editorList = (await listChannels(f, f.editor)).body as {
    disconnected: Row[];
    canManage: boolean;
  };
  assert.deepEqual([editorList.disconnected.length, editorList.canManage], [1, false]);

  // Reconnecting brings back the same record, and it leaves the disconnected list.
  await connect(f, f.owner, BRAND);
  const after = (await listChannels(f, f.owner)).body as { data: Row[]; disconnected: Row[] };
  assert.ok(after.data.some((c) => c.id === brandId));
  assert.equal(after.disconnected.length, 0);
});

test("Settings shows the disconnected channels with Reconnect for an owner or manager", () => {
  const settings = readFileSync("src/routes/settings.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(
    settings,
    /<DisconnectedChannels channels=\{disconnectedChannels\} canManage=\{canManage\} \/>/,
  );
  assert.match(settings, /Disconnected channels/);
  assert.match(
    settings,
    /Their history is kept\. Reconnect one to bring it back exactly where it left off\./,
  );
  assert.match(settings, /On Google’s screen, choose “\{channel\.channel_name\}”\./);
  assert.match(settings, /Ask the workspace owner or a manager to reconnect it\./);
});
