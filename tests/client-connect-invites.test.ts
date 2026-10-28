import test from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  type World,
} from "./helpers/team-fake-api";

// Client connect links, end to end: the agency creates a link; the client (no Tubify account, no
// session) opens it, signs in with THEIR Google account (simulated here), and the one channel they
// choose lands in the agency's workspace. The real routes and the real OAuth callback run against
// the in-memory database; Google is answered here.

const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
env.GOOGLE_CLIENT_SECRET = "client-secret";
env.GOOGLE_REDIRECT_URI = "https://app.test/api/youtube/callback";
env.APP_URL = "https://app.test";
const routes = {
  invites: await import("../src/routes/api.connect-invites"),
  publicInfo: await import("../src/routes/api.connect-invites.public"),
  start: await import("../src/routes/api.connect-invites.start"),
  pick: await import("../src/routes/api.connect-invites.pick"),
  callback: await import("../src/routes/api.youtube.callback"),
  auth: await import("../src/routes/api.youtube.auth"),
  channels: await import("../src/routes/api.youtube.channels"),
  connections: await import("../src/routes/api.youtube.connections"),
};

type Row = Record<string, unknown>;
type Account = { sub: string; email: string; channels: Array<{ id: string; title: string }> };

const CLIENT: Account = {
  sub: "sub-client-nima",
  email: "nima@client.test",
  channels: [{ id: "UCnimaCEOAAAAAAAAAAAAAAA", title: "NIMA CEO" }],
};
const CLIENT_TWO: Account = {
  sub: "sub-client-kian",
  email: "kian@client.test",
  channels: [
    { id: "UCkianBoschmanBBBBBBBBBB", title: "Kian Boschman" },
    { id: "UCkianPrivateCCCCCCCCCCC", title: "Kian Private" },
  ],
};
const AGENCY_OWN: Account = {
  sub: "sub-twan",
  email: "twan@agency.test",
  channels: [{ id: "UCtwanGrootDDDDDDDDDDDDD", title: "Twan" }],
};

const idToken = (a: Account) =>
  [
    Buffer.from('{"alg":"none"}').toString("base64url"),
    Buffer.from(JSON.stringify({ sub: a.sub, email: a.email })).toString("base64url"),
    "x",
  ].join(".");

function fixture(plan: "starter" | "pro" | "scale" = "scale") {
  const world: World = { ...emptyWorld() };
  const owner = addUser(world, "twan@agency.test");
  const editor = addUser(world, "editor@agency.test");
  const other = addUser(world, "other@x.test");
  const wA = addWorkspace(world, owner);
  addMember(world, wA, editor, "editor");
  const wB = addWorkspace(world, other);
  addSubscription(world, owner, plan);
  addSubscription(world, other, "scale");
  world.youtube_connections = [];
  world.youtube_channels = [];
  world.youtube_quota_events = [];
  (world as unknown as Record<string, Row[]>).channel_connect_invites = [];
  const codes = new Map<string, Account | "fail">();
  const tokens = new Map<string, Account>();
  const google: string[] = [];
  let n = 0;
  world.external = (url, { method, headers, body }) => {
    google.push(`${method} ${url.hostname}${url.pathname}`);
    if (url.hostname === "oauth2.googleapis.com") {
      const form = new URLSearchParams(body ?? "");
      if (form.get("grant_type") === "authorization_code") {
        const account = codes.get(form.get("code") ?? "");
        if (!account || account === "fail")
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        n += 1;
        tokens.set(`at-${n}`, account);
        tokens.set(`rt-${account.sub}`, account);
        return Response.json({
          access_token: `at-${n}`,
          refresh_token: `rt-${account.sub}`,
          expires_in: 3600,
          scope: "openid email youtube",
          id_token: idToken(account),
        });
      }
      const rt = form.get("refresh_token") ?? "";
      if (!tokens.has(rt)) return Response.json({ error: "invalid_grant" }, { status: 400 });
      n += 1;
      tokens.set(`at-${n}`, tokens.get(rt)!);
      return Response.json({ access_token: `at-${n}`, expires_in: 3600 });
    }
    if (url.hostname !== "www.googleapis.com") return undefined;
    const account = tokens.get((headers.get("Authorization") ?? "").replace(/^Bearer /, ""));
    if (!account) return Response.json({ error: { code: 401 } }, { status: 401 });
    return Response.json({
      items: account.channels.map((c) => ({
        id: c.id,
        snippet: { title: c.title, thumbnails: { default: { url: `https://img.test/${c.id}` } } },
        statistics: { subscriberCount: "10", viewCount: "10", videoCount: "1" },
        contentDetails: { relatedPlaylists: { uploads: `UU${c.id.slice(2)}` } },
      })),
    });
  };
  return { world, owner, editor, other, wA, wB, codes, google };
}
type Fixture = ReturnType<typeof fixture>;

const createLink = (f: Fixture, as: string | null, label?: string) =>
  callTeamApi(routes.invites, f.world, {
    as,
    method: "POST",
    path: "/api/connect-invites",
    body: label ? { label } : {},
  });
const tokenOf = (url: string) => url.split("/connect/")[1];
const invites = (f: Fixture) =>
  (f.world as unknown as Record<string, Row[]>).channel_connect_invites;
const channels = (f: Fixture) => f.world.youtube_channels as Row[];
const connections = (f: Fixture) => f.world.youtube_connections as Row[];

/** The client: opens the link, continues with Google as `account`, comes back. No session. */
async function clientConnects(
  f: Fixture,
  token: string,
  account: Account | "fail",
  options: { denied?: boolean } = {},
) {
  const start = await callTeamApi(routes.start, f.world, {
    as: null,
    method: "GET",
    path: "/api/connect-invites/start",
    query: `?token=${token}`,
  });
  const location = start.headers.get("location") ?? "";
  if (!location.startsWith("https://accounts.google.com/")) return { start, landing: location };
  const state = new URL(location).searchParams.get("state");
  const cookies = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
  const code = `code-${Math.random().toString(36).slice(2)}`;
  f.codes.set(code, account);
  const back = await callTeamApi(routes.callback, f.world, {
    as: null,
    method: "GET",
    path: "/api/youtube/callback",
    query: options.denied ? "?error=access_denied" : `?code=${code}&state=${state}`,
    headers: { cookie: cookies },
  });
  return { start, back, landing: back.headers.get("location") ?? "" };
}

// ---------- the agency side ----------

test("an owner creates a link (shown once; only its hash is stored); editors and outsiders cannot", async () => {
  const f = fixture();
  const r = await createLink(f, f.owner, "NIMA CEO");
  assert.equal(r.status, 201, r.text);
  const url = (r.body.data as Row).url as string;
  assert.match(url, /^https:\/\/app\.test\/connect\/[A-Za-z0-9_-]{43}$/);
  const stored = invites(f)[0];
  assert.equal(stored.workspace_id, f.wA);
  assert.equal(stored.created_by, f.owner);
  assert.match(String(stored.token_hash), /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(invites(f)).includes(tokenOf(url)), "the secret itself is not stored");

  assert.equal((await createLink(f, f.editor)).status, 403);
  assert.equal((await createLink(f, null)).status, 401);
  const list = await callTeamApi(routes.invites, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/connect-invites",
  });
  const listed = list.body.data as Row[];
  assert.deepEqual(
    listed.map((i) => [i.label, i.state]),
    [["NIMA CEO", "valid"]],
  );
  assert.ok(!("url" in listed[0]), "the link is never listed again");
  // Another workspace sees none of it and cannot revoke it.
  const otherList = await callTeamApi(routes.invites, f.world, {
    as: f.other,
    method: "GET",
    path: "/api/connect-invites",
  });
  assert.deepEqual(otherList.body.data, []);
  const otherRevoke = await callTeamApi(routes.invites, f.world, {
    as: f.other,
    method: "DELETE",
    path: "/api/connect-invites",
    query: `?id=${stored.id}`,
  });
  assert.equal(otherRevoke.status, 404);
});

// ---------- the client side ----------

test("a client connects their channel through the link: it lands in the agency's workspace as the client's grant", async () => {
  const f = fixture();
  const token = tokenOf((await createLink(f, f.owner, "NIMA")).body.data.url as string);
  const info = await callTeamApi(routes.publicInfo, f.world, {
    as: null,
    method: "GET",
    path: "/api/connect-invites/public",
    query: `?token=${token}`,
  });
  assert.equal((info.body.data as Row).state, "valid");
  assert.equal((info.body.data as Row).label, "NIMA");

  const { landing } = await clientConnects(f, token, CLIENT);
  assert.equal(landing, `https://app.test/connect/${token}?result=connected&channel=NIMA%20CEO`);
  const channel = channels(f).find((c) => c.youtube_channel_id === CLIENT.channels[0].id)!;
  assert.equal(channel.workspace_id, f.wA);
  const connection = connections(f).find((c) => c.id === channel.connection_id)!;
  assert.deepEqual(
    [
      connection.workspace_id,
      connection.user_id,
      connection.google_subject_id,
      connection.google_email,
      connection.granted_via_invite_id,
    ],
    [f.wA, f.owner, CLIENT.sub, CLIENT.email, invites(f)[0].id],
    "the grant is the client's, in the agency's workspace",
  );
  assert.ok(invites(f)[0].used_at);
  assert.equal(invites(f)[0].used_channel_id, channel.id);

  // The agency sees it, marked as a client's channel.
  const list = (
    await callTeamApi(routes.channels, f.world, {
      as: f.owner,
      method: "GET",
      path: "/api/youtube/channels",
    })
  ).body as { data: Row[] };
  const listed = list.data.find((c) => c.id === channel.id)!;
  assert.deepEqual([listed.shared_by_client, listed.client_email], [true, CLIENT.email]);

  // The link works once.
  const again = await clientConnects(f, token, CLIENT);
  assert.equal(again.landing, `/connect/${token}?result=used`);
});

test("the agency can never browse or attach the client's other channels through the client's grant", async () => {
  const f = fixture();
  const token = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  await clientConnects(f, token, { ...CLIENT_TWO, channels: [CLIENT_TWO.channels[0]] });
  const grant = connections(f)[0];
  // Even if Google would now show more channels on that grant…
  const discover = await callTeamApi(routes.connections, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/connections",
    query: `?discover=${grant.id}`,
  });
  assert.equal(discover.status, 404);
  const attach = await callTeamApi(routes.connections, f.world, {
    as: f.owner,
    method: "POST",
    path: "/api/youtube/connections",
    body: { connectionId: grant.id, channelId: CLIENT_TWO.channels[1].id },
  });
  assert.equal(attach.status, 404);
  assert.equal(channels(f).length, 1);
});

test("a client with several channels picks ONE; only that one is attached", async () => {
  const f = fixture();
  const token = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  const { landing } = await clientConnects(f, token, CLIENT_TWO);
  assert.equal(landing, `https://app.test/connect/${token}?result=pick`);
  assert.equal(channels(f).length, 0, "nothing attached before the client picks");
  const info = await callTeamApi(routes.publicInfo, f.world, {
    as: null,
    method: "GET",
    path: "/api/connect-invites/public",
    query: `?token=${token}`,
  });
  assert.deepEqual(
    ((info.body.data as Row).choices as Row[]).map((c) => c.title),
    ["Kian Boschman", "Kian Private"],
  );

  const notTheirs = await callTeamApi(routes.pick, f.world, {
    as: null,
    method: "POST",
    path: "/api/connect-invites/pick",
    body: { token, channelId: "UCsomeoneElsesChannel000" },
  });
  assert.equal(notTheirs.status, 404);
  const picked = await callTeamApi(routes.pick, f.world, {
    as: null,
    method: "POST",
    path: "/api/connect-invites/pick",
    body: { token, channelId: CLIENT_TWO.channels[0].id },
  });
  assert.equal(picked.status, 200, picked.text);
  assert.deepEqual(
    channels(f).map((c) => c.channel_name),
    ["Kian Boschman"],
  );
  const second = await callTeamApi(routes.pick, f.world, {
    as: null,
    method: "POST",
    path: "/api/connect-invites/pick",
    body: { token, channelId: CLIENT_TWO.channels[1].id },
  });
  assert.equal(second.status, 409, "the link is used up");
  assert.equal(channels(f).length, 1);
});

test("cancelling at Google, a revoked link, an expired link, or a bad code store nothing", async () => {
  const f = fixture();
  const t1 = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  assert.equal(
    (await clientConnects(f, t1, CLIENT, { denied: true })).landing,
    `https://app.test/connect/${t1}?result=denied`,
  );
  assert.equal(
    (await clientConnects(f, t1, "fail")).landing,
    `https://app.test/connect/${t1}?result=error`,
  );

  const t2 = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  const id2 = invites(f).find((i) => !i.revoked_at && i.id !== invites(f)[0].id)!.id;
  await callTeamApi(routes.invites, f.world, {
    as: f.owner,
    method: "DELETE",
    path: "/api/connect-invites",
    query: `?id=${id2}`,
  });
  assert.equal((await clientConnects(f, t2, CLIENT)).landing, `/connect/${t2}?result=revoked`);

  const t3 = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  invites(f).at(-1)!.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await clientConnects(f, t3, CLIENT)).landing, `/connect/${t3}?result=expired`);

  assert.equal(
    (await clientConnects(f, "A".repeat(43), CLIENT)).landing,
    `/connect/${"A".repeat(43)}?result=invalid`,
  );
  assert.deepEqual([channels(f).length, connections(f).length], [0, 0]);
});

// ---------- limits ----------

test("the plan's channel limit applies to client links; the link stays usable and the grant is dropped", async () => {
  const f = fixture("starter"); // 1 channel
  const t1 = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  await clientConnects(f, t1, CLIENT);
  const t2 = tokenOf((await createLink(f, f.owner)).body.data.url as string);
  const { landing } = await clientConnects(f, t2, {
    ...CLIENT_TWO,
    channels: [CLIENT_TWO.channels[0]],
  });
  assert.equal(landing, `https://app.test/connect/${t2}?result=channel_limit`);
  assert.equal(channels(f).length, 1);
  assert.equal(connections(f).length, 1, "the refused client's grant (and tokens) were dropped");
  assert.equal(invites(f).at(-1)!.used_at, null, "the link can be used once the limit allows");
});

test("an agency limit (set by staff) raises the plan's channel limit — and only raises it", async () => {
  const f = fixture("starter");
  const ws = f.world.workspaces.find((w) => w.id === f.wA)!;
  ws.channel_limit_override = 3;
  for (const account of [
    CLIENT,
    { ...CLIENT_TWO, channels: [CLIENT_TWO.channels[0]] },
    AGENCY_OWN,
  ]) {
    const t = tokenOf((await createLink(f, f.owner)).body.data.url as string);
    assert.match((await clientConnects(f, t, account)).landing, /result=connected/, account.email);
  }
  assert.equal(channels(f).length, 3);
  // A lower override never lowers a plan's limit.
  ws.channel_limit_override = 1;
  const g = fixture("pro");
  g.world.workspaces.find((w) => w.id === g.wA)!.channel_limit_override = 1;
  for (const account of [CLIENT, AGENCY_OWN]) {
    const t = tokenOf((await createLink(g, g.owner)).body.data.url as string);
    assert.match((await clientConnects(g, t, account)).landing, /result=connected/);
  }
});

// ---------- the agency's own Connect is unaffected ----------

test("the agency's own 'Connect' clears a client link cookie, so it is never mistaken for one", async () => {
  const f = fixture();
  const r = await callTeamApi(routes.auth, f.world, {
    as: f.owner,
    method: "GET",
    path: "/api/youtube/auth",
    query: "?returnTo=/settings",
  });
  assert.ok(r.headers.getSetCookie().some((c) => /^yt_invite=;.*Max-Age=0/.test(c)));
});

// ---------- the agency limit is set by platform staff only ----------

test("only a Superadmin sets a workspace's agency channel limit; it is audit-logged and listed", async () => {
  const adminRoute = await import("../src/routes/api.admin.workspaces");
  const f = fixture();
  const superadmin = addUser(f.world, "staff@tubify.test", "superadmin");
  (f.world as unknown as Record<string, Row[]>).admin_audit_log ??= [];
  const patch = (as: string, body: unknown) =>
    callTeamApi(adminRoute, f.world, {
      as,
      method: "PATCH",
      path: "/api/admin/workspaces",
      query: `?id=${f.wA}`,
      body,
    });

  // A workspace owner is not platform staff.
  assert.equal((await patch(f.owner, { channelLimitOverride: 50 })).status, 403);
  assert.equal(f.world.workspaces.find((w) => w.id === f.wA)!.channel_limit_override ?? null, null);

  const r = await patch(superadmin, { channelLimitOverride: 50 });
  assert.equal(r.status, 200, r.text);
  assert.equal(f.world.workspaces.find((w) => w.id === f.wA)!.channel_limit_override, 50);
  const audit = (f.world as unknown as Record<string, Row[]>).admin_audit_log;
  assert.ok(audit.some((a) => a.action === "workspace_channel_limit_changed"));
  for (const bad of [
    { channelLimitOverride: 0 },
    { channelLimitOverride: 501 },
    { channelLimitOverride: 2.5 },
    {},
    { other: 1 },
  ])
    assert.equal((await patch(superadmin, bad)).status, 422, JSON.stringify(bad));
  const list = await callTeamApi(adminRoute, f.world, {
    as: superadmin,
    method: "GET",
    path: "/api/admin/workspaces",
  });
  assert.equal((list.body.data as Row[]).find((w) => w.id === f.wA)!.channelLimitOverride, 50);
  // Cleared: the plan's own limit applies again.
  assert.equal((await patch(superadmin, { channelLimitOverride: null })).status, 200);
  assert.equal(f.world.workspaces.find((w) => w.id === f.wA)!.channel_limit_override, null);
});
