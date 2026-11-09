import {
  addMember,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// YouTube API compliance and quota accounting:
//   1. disconnecting a channel (and deleting an account) also ends Tubify's access at Google,
//      unless another connection uses the same Google account;
//   2. every YouTube Data API request is counted with its real cost, on Google's quota day;
//   3. the admin quota panel: admins only, totals only.

const env = (globalThis as Record<string, unknown>).__env__ as Record<string, string>;
env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const { createServiceSupabaseClient } = await import("../src/lib/server/supabase");
const quota = await import("../src/lib/server/youtube-quota");
const { recordYoutubeApiCall, resetYoutubeQuotaRecorderCache } =
  await import("../src/lib/server/youtube-quota-recorder");
const { revokeGoogleGrant, revokeGoogleGrantsOfUser, GOOGLE_REVOKE_URL } =
  await import("../src/lib/server/google-revoke");
const { softDisconnectChannel } = await import("../src/lib/server/youtube-disconnect");
const oauth = await import("../src/lib/server/google-oauth");
const registry = await import("../src/lib/server/youtube-token-registry");
const quotaRoute = await import("../src/routes/api.admin.youtube-quota");

type Row = Record<string, unknown>;

// Runs `fn` with a service-role client inside the fake world.
async function inWorld<T>(
  world: World,
  fn: (service: ReturnType<typeof createServiceSupabaseClient>) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  const route = {
    Route: {
      options: {
        server: {
          handlers: {
            GET: async () => {
              result = await fn(createServiceSupabaseClient());
              return new Response("{}");
            },
          },
        },
      },
    },
  };
  await callTeamApi(route, world, { as: null, method: "GET", path: "/in-world" });
  return result as T;
}

// ---------- 2. what each request costs, and which day it counts towards ----------

test("each Data API request is priced as Google prices it; other Google APIs are not counted", () => {
  const cost = (method: string, url: string) => quota.dataApiCall(method, url);
  assert.deepEqual(cost("GET", "https://www.googleapis.com/youtube/v3/videos?part=snippet"), {
    operation: "videos.list",
    units: 1,
  });
  assert.deepEqual(cost("GET", "https://www.googleapis.com/youtube/v3/commentThreads?id=x"), {
    operation: "commentThreads.list",
    units: 1,
  });
  assert.deepEqual(cost("POST", "https://www.googleapis.com/youtube/v3/comments?part=snippet"), {
    operation: "comments.insert",
    units: 50,
  });
  assert.deepEqual(cost("PUT", "https://www.googleapis.com/youtube/v3/comments?part=snippet"), {
    operation: "comments.update",
    units: 50,
  });
  assert.deepEqual(cost("GET", "https://www.googleapis.com/youtube/v3/search?q=x"), {
    operation: "search.list",
    units: 100,
  });
  assert.deepEqual(cost("POST", "https://www.googleapis.com/upload/youtube/v3/videos"), {
    operation: "videos.insert",
    units: 1600,
  });
  // Analytics, Reporting and sign-in have quotas of their own (or none)
  assert.equal(cost("GET", "https://youtubeanalytics.googleapis.com/v2/reports?ids=x"), null);
  assert.equal(cost("GET", "https://youtubereporting.googleapis.com/v1/jobs"), null);
  assert.equal(cost("POST", "https://oauth2.googleapis.com/token"), null);
  assert.equal(cost("GET", "not a url"), null);
});

test("the quota day is Google's: midnight to midnight Pacific time, across daylight saving", () => {
  // winter (PST, UTC-8)
  assert.equal(
    quota.quotaDayStart(new Date("2026-11-09T10:00:00Z")).toISOString(),
    "2026-11-09T08:00:00.000Z",
  );
  // 05:00 UTC is still the previous evening in California
  assert.equal(
    quota.quotaDayStart(new Date("2026-11-09T05:00:00Z")).toISOString(),
    "2026-11-08T08:00:00.000Z",
  );
  // summer (PDT, UTC-7)
  assert.equal(
    quota.quotaDayStart(new Date("2026-07-01T12:00:00Z")).toISOString(),
    "2026-07-01T07:00:00.000Z",
  );
  // the day daylight saving ends (2026-11-01): midnight was still PDT
  assert.equal(
    quota.quotaDayStart(new Date("2026-11-01T20:00:00Z")).toISOString(),
    "2026-11-01T07:00:00.000Z",
  );
  assert.equal(quota.quotaDayKey(new Date("2026-11-09T05:00:00Z")), "2026-11-08");
  assert.equal(quota.quotaLevel(6_999), "ok");
  assert.equal(quota.quotaLevel(7_000), "warning");
  assert.equal(quota.quotaLevel(9_000), "critical");
});

test("every request youtubeFetch sends is reported — the retry after a refresh too — and reporting never breaks a request", async () => {
  const calls: Array<{
    operation: string;
    units: number;
    status: number;
    connectionId: string | null;
  }> = [];
  quota.setYoutubeQuotaRecorder(async (call) => void calls.push(call));
  registry.resetYoutubeTokenRegistry();
  registry.registerYoutubeAccessToken("token-1", "conn-1", async () => {
    registry.registerYoutubeAccessToken("token-2", "conn-1", async () => "token-2", {
      forced: true,
    });
    return "token-2";
  });
  const realFetch = globalThis.fetch;
  const answers = [401, 200];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("youtubeanalytics")) return new Response(JSON.stringify({ rows: [] }));
    return new Response(JSON.stringify({ items: [] }), { status: answers.shift() ?? 200 });
  }) as typeof fetch;
  try {
    await oauth.fetchAuthorizedYoutubeChannels("token-1");
    assert.deepEqual(
      calls.map((c) => [c.operation, c.units, c.status, c.connectionId]),
      [
        ["channels.list", 1, 401, "conn-1"],
        ["channels.list", 1, 200, "conn-1"],
      ],
    );
    // the Analytics API is not part of the Data API quota
    await oauth.queryYoutubeAnalytics("token-2", {
      channelId: "UCx",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      metrics: ["views"],
    } as never);
    assert.equal(calls.length, 2);
    // a recorder that fails does not fail the request
    quota.setYoutubeQuotaRecorder(async () => {
      throw new Error("database down");
    });
    assert.deepEqual(await oauth.fetchAuthorizedYoutubeChannels("token-2"), []);
  } finally {
    globalThis.fetch = realFetch;
    quota.setYoutubeQuotaRecorder(null);
    registry.resetYoutubeTokenRegistry();
  }
});

function quotaWorld() {
  const w: World = emptyWorld();
  const owner = addUser(w, "owner@x.test");
  const ws = addWorkspace(w, owner);
  const other = addUser(w, "other@x.test");
  const ws2 = addWorkspace(w, other);
  (w.workspaces.find((x) => x.id === ws) as Row).name = "Creator Studio";
  (w.workspaces.find((x) => x.id === ws2) as Row).name = "Agency";
  w.youtube_connections = [];
  w.youtube_channels = [
    { id: "ch-1", workspace_id: ws, connection_id: "conn-1", youtube_channel_id: "UC1" },
    { id: "ch-2", workspace_id: ws2, connection_id: "conn-2", youtube_channel_id: "UC2" },
  ];
  w.youtube_quota_events = [];
  return { w, owner, ws, ws2, other };
}

test("a measured request is stored with its operation, cost and channel — never a token or URL", async () => {
  const f = quotaWorld();
  resetYoutubeQuotaRecorderCache();
  await inWorld(f.w, async (service) => {
    await recordYoutubeApiCall(service, {
      operation: "videos.list",
      units: 1,
      status: 200,
      connectionId: "conn-1",
    });
    await recordYoutubeApiCall(service, {
      operation: "comments.insert",
      units: 50,
      status: 403,
      connectionId: null,
    });
  });
  const rows = f.w.youtube_quota_events as Row[];
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [
      r.source,
      r.operation,
      r.quota_units,
      r.succeeded,
      r.channel_id,
      r.error_code,
    ]),
    [
      ["api", "videos.list", 1, true, "ch-1", null],
      ["api", "comments.insert", 50, false, null, "HTTP_403"],
    ],
  );
  for (const r of rows)
    for (const key of Object.keys(r)) assert.doesNotMatch(key, /token|url|body|response/i);
});

// ---------- 1. revoking at Google ----------

async function connectionRow(id: string, workspaceId: string, subject: string | null) {
  return {
    id,
    workspace_id: workspaceId,
    google_subject_id: subject,
    refresh_token_ciphertext: await encryptSecretToBytea(`refresh-${id}`),
    access_token_ciphertext: await encryptSecretToBytea(`access-${id}`),
  };
}

function googleRevoke(world: World, answer = 200) {
  const sent: string[] = [];
  world.external = (url, init) => {
    if (`${url.origin}${url.pathname}` !== GOOGLE_REVOKE_URL) return undefined;
    sent.push(new URLSearchParams(init.body ?? "").get("token") ?? "");
    return new Response(answer === 200 ? "" : '{"error":"invalid_token"}', { status: answer });
  };
  return sent;
}

test("disconnecting the last channel of a Google account revokes Tubify's access at Google", async () => {
  const f = quotaWorld();
  f.w.youtube_connections!.push(await connectionRow("conn-1", f.ws, "google-sub-A"));
  const sent = googleRevoke(f.w);
  const outcome = await inWorld(f.w, (service) =>
    revokeGoogleGrant(service, { connectionId: "conn-1", workspaceId: f.ws }),
  );
  assert.equal(outcome, "revoked");
  assert.deepEqual(sent, ["refresh-conn-1"], "the refresh token, sent to Google's revoke endpoint");
});

test("a Google account still connected elsewhere is not revoked (it would cut that connection off)", async () => {
  const f = quotaWorld();
  f.w.youtube_connections!.push(
    await connectionRow("conn-1", f.ws, "google-sub-A"),
    await connectionRow("conn-2", f.ws2, "google-sub-A"), // the same account, another workspace
  );
  const sent = googleRevoke(f.w);
  const outcome = await inWorld(f.w, (service) =>
    revokeGoogleGrant(service, { connectionId: "conn-1", workspaceId: f.ws }),
  );
  assert.equal(outcome, "skipped_shared_account");
  assert.deepEqual(sent, [], "Google is not asked");
});

test("an unknown account, another workspace's connection, an expired grant and an outage are all handled", async () => {
  const f = quotaWorld();
  f.w.youtube_connections!.push(
    await connectionRow("conn-old", f.ws, null),
    await connectionRow("conn-2", f.ws2, "google-sub-B"),
  );
  let sent = googleRevoke(f.w);
  assert.equal(
    await inWorld(f.w, (s) =>
      revokeGoogleGrant(s, { connectionId: "conn-old", workspaceId: f.ws }),
    ),
    "skipped_unknown_account",
  );
  // a connection of another workspace is not found from this one
  assert.equal(
    await inWorld(f.w, (s) => revokeGoogleGrant(s, { connectionId: "conn-2", workspaceId: f.ws })),
    "failed",
  );
  assert.deepEqual(sent, []);
  sent = googleRevoke(f.w, 400);
  assert.equal(
    await inWorld(f.w, (s) => revokeGoogleGrant(s, { connectionId: "conn-2", workspaceId: f.ws2 })),
    "already_invalid",
  );
  googleRevoke(f.w, 503);
  assert.equal(
    await inWorld(f.w, (s) => revokeGoogleGrant(s, { connectionId: "conn-2", workspaceId: f.ws2 })),
    "failed",
  );
});

test("deleting an account revokes its connections, even two to the same Google account", async () => {
  const f = quotaWorld();
  const conn = await connectionRow("conn-1", f.ws, "google-sub-A");
  const second = { ...(await connectionRow("conn-1b", f.ws, "google-sub-A")), user_id: f.owner };
  f.w.youtube_connections!.push(conn, second);
  const sent = googleRevoke(f.w);
  const outcomes = await inWorld(f.w, (s) => revokeGoogleGrantsOfUser(s, f.owner));
  assert.ok(outcomes.includes("revoked"), JSON.stringify(outcomes));
  assert.ok(!outcomes.includes("skipped_shared_account"), "both are going: neither is 'shared'");
  assert.ok(sent.length >= 1);
  const route = readFileSync("src/routes/api.admin.users.ts", "utf8");
  assert.ok(
    route.indexOf("revokeGoogleGrantsOfUser(service, targetId)") <
      route.indexOf("service.auth.admin.deleteUser(targetId)"),
    "revoked before the account (and its tokens) are deleted",
  );
});

test("disconnect: revoke before deleting the credentials; delete them whatever Google says", async () => {
  const order: string[] = [];
  const store = (revoke: () => Promise<never | "revoked">) => ({
    getChannel: async () => ({ id: "ch-1", connectionId: "conn-1" }),
    detachChannel: async () => void order.push("detach"),
    attachChannel: async () => void order.push("attach"),
    countOtherChannelsUsingConnection: async () => 0,
    deleteConnection: async () => void order.push("delete"),
    revokeAtGoogle: async () => {
      order.push("revoke");
      return revoke();
    },
  });
  const ok = await softDisconnectChannel(
    store(async () => "revoked"),
    "ch-1",
  );
  assert.deepEqual(order, ["detach", "revoke", "delete"]);
  assert.deepEqual(ok, {
    status: "disconnected",
    credentialsRemoved: true,
    googleAccess: "revoked",
  });

  order.length = 0;
  const failing = await softDisconnectChannel(
    store(async () => {
      throw new Error("Google unreachable");
    }),
    "ch-1",
  );
  assert.deepEqual(order, ["detach", "revoke", "delete"], "the credentials are still deleted");
  assert.equal(failing.googleAccess, "failed");

  // another channel still uses the connection: nothing is revoked or deleted
  order.length = 0;
  const shared = await softDisconnectChannel(
    { ...store(async () => "revoked"), countOtherChannelsUsingConnection: async () => 1 },
    "ch-1",
  );
  assert.deepEqual(order, ["detach"]);
  assert.equal(shared.googleAccess, "not_attempted");
  const route = readFileSync("src/routes/api.youtube.channels.ts", "utf8");
  assert.match(
    route,
    /revokeAtGoogle: \(connectionId\) =>\s+revokeGoogleGrant\(client, \{ connectionId, workspaceId \}\)/,
  );
});

// ---------- 3. the admin quota panel ----------

const getQuota = (world: World, as: string | null) =>
  callTeamApi(quotaRoute, world, { as, method: "GET", path: "/api/admin/youtube-quota" });

test("the quota panel is for admins only; nothing is read for anyone else", async () => {
  const f = quotaWorld();
  const manager = addUser(f.w, "manager@x.test", "manager");
  for (const [as, status] of [
    [null, 401],
    [f.owner, 403],
    [manager, 403],
  ] as const) {
    const r = await getQuota(f.w, as);
    assert.equal(r.status, status, String(as));
    assert.ok(!r.rpcCalls.includes("youtube_quota_usage"), `${as}: no usage read`);
  }
});

test("the quota panel: today's measured usage by operation and workspace, the last 7 days, the warning level", async () => {
  const f = quotaWorld();
  const admin = addUser(f.w, "boss@tubify.test", "superadmin");
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  f.w.youtube_quota_events = [
    {
      id: 1,
      source: "api",
      channel_id: "ch-1",
      operation: "comments.insert",
      quota_units: 50,
      succeeded: true,
      created_at: at(1000),
    },
    {
      id: 2,
      source: "api",
      channel_id: "ch-1",
      operation: "videos.list",
      quota_units: 1,
      succeeded: true,
      created_at: at(2000),
    },
    {
      id: 3,
      source: "api",
      channel_id: "ch-2",
      operation: "videos.list",
      quota_units: 1,
      succeeded: false,
      created_at: at(3000),
    },
    {
      id: 4,
      source: "api",
      channel_id: null,
      operation: "channels.list",
      quota_units: 1,
      succeeded: true,
      created_at: at(4000),
    },
    // an estimate from a feature (source 'event') is never added in
    {
      id: 5,
      source: "event",
      channel_id: "ch-1",
      operation: "lead.reply",
      quota_units: 50,
      succeeded: true,
      created_at: at(5000),
    },
  ];
  const r = await getQuota(f.w, admin);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data as Row & {
    today: Row;
    byOperation: Row[];
    byWorkspace: Row[];
    days: Row[];
  };
  // events in the last few seconds can straddle midnight Pacific only in theory; all are "today"
  assert.equal(d.limit, 10_000);
  assert.equal(d.today.units, 53);
  assert.equal(d.today.calls, 4);
  assert.equal(d.today.failed, 1);
  assert.equal(d.today.level, "ok");
  assert.deepEqual(
    d.byOperation.map((o) => [o.operation, o.units, o.calls]),
    [
      ["comments.insert", 50, 1],
      ["videos.list", 2, 2],
      ["channels.list", 1, 1],
    ],
  );
  assert.deepEqual(
    d.byWorkspace.map((w) => [w.name, w.units]),
    [
      ["Creator Studio", 51],
      ["Agency", 1],
    ],
  );
  assert.equal(d.unattributedUnits, 1);
  assert.equal(d.days.length, 7);
  assert.equal((d.days.at(-1) as Row).units, 53);
  // totals and names only
  assert.doesNotMatch(r.text, /ch-1|ch-2|token|owner@x/);
});

test("before the migration the panel says quota tracking is not set up, instead of showing zero", async () => {
  const f = quotaWorld();
  const admin = addUser(f.w, "boss@tubify.test", "superadmin");
  f.w.quotaUsageMissing = true;
  const r = await getQuota(f.w, admin);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "QUOTA_ACCOUNTING_NOT_AVAILABLE");
});

test("the migration: additive, and the usage function is the server's alone", () => {
  const sql = readFileSync("supabase/migrations/202611090001_youtube_quota_accounting.sql", "utf8");
  assert.match(sql, /add column if not exists source text not null default 'event'/);
  assert.match(sql, /check \(source in \('event', 'api'\)\)/);
  assert.match(sql, /security invoker\s+set search_path = public, pg_temp/);
  assert.match(
    sql,
    /revoke execute on function public\.youtube_quota_usage\(timestamptz, timestamptz\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    sql,
    /grant execute on function public\.youtube_quota_usage\(timestamptz, timestamptz\) to service_role;/,
  );
  assert.match(sql, /at time zone 'America\/Los_Angeles'/);
  assert.doesNotMatch(sql, /security definer|drop table|delete from|update public/i);
});

test("the recorder is installed for every request (server entry), and readers count measured usage only", () => {
  const server = readFileSync("src/server.ts", "utf8");
  assert.match(server, /installYoutubeQuotaRecorder\(\);/);
  const queue = readFileSync("src/lib/server/comment-reply-queue.ts", "utf8");
  assert.match(queue, /\.eq\("source", "api"\)\s+\.gte\("created_at", quotaDay\)/);
  const card = readFileSync("src/routes/api.youtube.quota.ts", "utf8");
  assert.match(card, /\.eq\("source", "api"\)/);
  assert.match(card, /quotaDayStart\(\)/);
  const page = readFileSync("src/routes/comments.tsx", "utf8");
  assert.match(page, /Resets at midnight Pacific time\./);
  void addMember;
  void uuid;
});
