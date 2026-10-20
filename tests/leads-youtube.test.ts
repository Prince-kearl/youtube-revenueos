import test from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type World,
} from "./helpers/team-fake-api";

// Lead Inbox ↔ YouTube: receiving a commenter's comments and replies, and replying to them in
// their own thread. The real route runs against the in-memory database with YouTube answered
// here. Refused requests must not read from or post to YouTube.

const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const route = await import("../src/routes/api.leads.youtube");

type Row = Record<string, unknown>;
const YT_A = "UCchannelAAAAAAAAAAAAAAAA";
const YT_B = "UCchannelBBBBBBBBBBBBBBBB";
const LEAD_YT = "UCleadLEADleadLEADlead01";
const OTHER_VIEWER = "UCviewerVIEWERviewerVIE1";

type Thread = { id: string; channel: string; author: string; text: string; at: string };
type Reply = { id: string; author: string; text: string; at: string };

async function fixture(
  options: { threads?: Thread[]; replies?: Record<string, Reply[]>; page?: string[] } = {},
) {
  const world: World = { ...emptyWorld() };
  world.features.push({ id: "feature-leads", key: "leads", is_active: true });
  const owner = addUser(world, "owner@x.test");
  const editor = addUser(world, "editor@x.test");
  const other = addUser(world, "other@x.test");
  const wA = addWorkspace(world, owner);
  addMember(world, wA, editor, "editor");
  const wB = addWorkspace(world, other);
  // Comment Automation and Lead Inbox are paid features.
  addSubscription(world, owner, "scale");
  addSubscription(world, other, "scale");
  const channelA = uuid();
  const channelB = uuid();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  world.youtube_connections = [
    {
      id: "conn-A",
      access_token_ciphertext: await encryptSecretToBytea("token-A"),
      refresh_token_ciphertext: await encryptSecretToBytea("refresh-A"),
      token_expiry: future,
    },
  ];
  world.youtube_channels = [
    {
      id: channelA,
      workspace_id: wA,
      user_id: owner,
      youtube_channel_id: YT_A,
      connection_id: "conn-A",
      connected_at: "2026-09-02T00:00:00Z",
    },
    {
      id: channelB,
      workspace_id: wB,
      user_id: other,
      youtube_channel_id: YT_B,
      connection_id: "conn-A",
      connected_at: "2026-09-01T00:00:00Z",
    },
  ];
  const lead = uuid();
  const foreignLead = uuid();
  const emailLead = uuid();
  world.leads = [
    {
      id: lead,
      workspace_id: wA,
      user_id: owner,
      name: "Grace",
      platform: "YouTube Comment",
      username: LEAD_YT,
    },
    {
      id: foreignLead,
      workspace_id: wB,
      user_id: other,
      name: "Mallory",
      platform: "YouTube Comment",
      username: LEAD_YT,
    },
    {
      id: emailLead,
      workspace_id: wA,
      user_id: owner,
      name: "Ed",
      platform: "Email",
      username: null,
    },
  ];
  world.lead_messages = [];
  world.comment_automation_replies = [];
  world.comment_reply_jobs = [];
  world.youtube_quota_events = [];

  const threads = new Map((options.threads ?? []).map((t) => [t.id, t]));
  const replies = options.replies ?? {};
  const youtube: string[] = [];
  const posted: Array<{ parentId: string; text: string }> = [];
  const threadJson = (t: Thread) => ({
    id: t.id,
    snippet: {
      videoId: "videoAAAAA1",
      channelId: t.channel,
      canReply: true,
      totalReplyCount: (replies[t.id] ?? []).length,
      topLevelComment: {
        snippet: {
          textDisplay: t.text,
          authorDisplayName: "Grace",
          authorChannelId: { value: t.author },
          publishedAt: t.at,
        },
      },
    },
  });
  world.external = (url, { method, body }) => {
    if (url.hostname !== "www.googleapis.com") return undefined;
    const resource = url.pathname.split("/").pop();
    youtube.push(`${method} ${resource}`);
    if (resource === "commentThreads" && url.searchParams.get("id"))
      return Response.json({
        items: url.searchParams
          .get("id")!
          .split(",")
          .flatMap((id) => (threads.has(id) ? [threadJson(threads.get(id)!)] : [])),
      });
    if (resource === "commentThreads" && url.searchParams.get("allThreadsRelatedToChannelId")) {
      assert.equal(url.searchParams.get("allThreadsRelatedToChannelId"), YT_A);
      return Response.json({
        items: (options.page ?? []).map((id) => threadJson(threads.get(id)!)),
      });
    }
    if (resource === "comments" && method === "GET") {
      const parentId = url.searchParams.get("parentId")!;
      return Response.json({
        items: (replies[parentId] ?? []).map((r) => ({
          id: r.id,
          snippet: {
            parentId,
            textOriginal: r.text,
            authorDisplayName: "x",
            authorChannelId: { value: r.author },
            publishedAt: r.at,
          },
        })),
      });
    }
    if (resource === "comments" && method === "POST") {
      const sent = JSON.parse(body ?? "{}") as {
        snippet: { parentId: string; textOriginal: string };
      };
      posted.push({ parentId: sent.snippet.parentId, text: sent.snippet.textOriginal });
      return Response.json({ id: `${sent.snippet.parentId}.new${posted.length}`, snippet: {} });
    }
    return undefined;
  };
  return {
    world,
    owner,
    editor,
    other,
    wA,
    channelA,
    channelB,
    lead,
    foreignLead,
    emailLead,
    youtube,
    posted,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const receive = (f: Fixture, as: string | null, leadId: string, channelId = f.channelA) =>
  callTeamApi(route, f.world, {
    as,
    method: "GET",
    path: "/api/leads/youtube",
    query: `?leadId=${leadId}&channelId=${channelId}`,
  });
const send = (f: Fixture, as: string | null, body: unknown, channelId = f.channelA) =>
  callTeamApi(route, f.world, {
    as,
    method: "POST",
    path: "/api/leads/youtube",
    query: `?channelId=${channelId}`,
    body,
  });
const messages = (f: Fixture) => f.world.lead_messages as Row[];
const allowSyncAgain = (f: Fixture) => {
  f.world.youtube_quota_events = (f.world.youtube_quota_events as Row[]).filter(
    (e) => !String(e.operation).startsWith("lead.sync"),
  );
};

const LEAD_THREADS: Thread[] = [
  {
    id: "thrLead0001",
    channel: YT_A,
    author: LEAD_YT,
    text: "Which mic do you use?",
    at: "2026-10-01T00:00:00Z",
  },
  {
    id: "thrLead0002",
    channel: YT_A,
    author: LEAD_YT,
    text: "Loved this one",
    at: "2026-10-05T00:00:00Z",
  },
  // Not theirs, or not on this channel: never read or replied to.
  {
    id: "thrViewer01",
    channel: YT_A,
    author: OTHER_VIEWER,
    text: "First!",
    at: "2026-10-06T00:00:00Z",
  },
  {
    id: "thrElsewhr1",
    channel: YT_B,
    author: LEAD_YT,
    text: "On another channel",
    at: "2026-10-07T00:00:00Z",
  },
];
const LEAD_REPLIES: Record<string, Reply[]> = {
  thrLead0001: [
    { id: "thrLead0001.a", author: YT_A, text: "A Shure SM7B!", at: "2026-10-01T01:00:00Z" },
    {
      id: "thrLead0001.b",
      author: LEAD_YT,
      text: "Thanks, ordering one",
      at: "2026-10-01T02:00:00Z",
    },
    { id: "thrLead0001.c", author: OTHER_VIEWER, text: "me too", at: "2026-10-01T03:00:00Z" },
  ],
};

test("receive: the lead's comments, their replies and the channel's replies arrive once each", async () => {
  const f = await fixture({
    threads: LEAD_THREADS,
    replies: LEAD_REPLIES,
    page: ["thrViewer01", "thrLead0002", "thrLead0001"],
  });
  const r = await receive(f, f.owner, f.lead);
  assert.equal(r.status, 200, r.text);
  const rows = messages(f).map((m) => [
    m.from_who,
    m.text,
    m.youtube_comment_id,
    m.youtube_thread_id,
  ]);
  assert.deepEqual(
    rows.sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
    [
      ["lead", "Which mic do you use?", "thrLead0001", "thrLead0001"],
      ["you", "A Shure SM7B!", "thrLead0001.a", "thrLead0001"],
      ["lead", "Thanks, ordering one", "thrLead0001.b", "thrLead0001"],
      ["lead", "Loved this one", "thrLead0002", "thrLead0002"],
    ],
  );
  assert.ok(messages(f).every((m) => m.lead_id === f.lead));
  assert.equal((f.world.leads as Row[]).find((l) => l.id === f.lead)!.unread, true);
  assert.equal(((r.body.data as Row).messages as Row[]).length, 4);

  // Again (after the throttle window): nothing is added twice.
  allowSyncAgain(f);
  const again = await receive(f, f.owner, f.lead);
  assert.equal((again.body.data as Row).added, 0);
  assert.equal(messages(f).length, 4);
});

test("receive: a conversation recorded before YouTube ids were kept is linked, not duplicated", async () => {
  const f = await fixture({ threads: LEAD_THREADS, replies: LEAD_REPLIES, page: ["thrLead0001"] });
  const old = uuid();
  messages(f).push({
    id: old,
    lead_id: f.lead,
    from_who: "lead",
    kind: "comment",
    text: "Which mic do you use?",
    youtube_comment_id: null,
  });
  await receive(f, f.owner, f.lead);
  const linked = messages(f).find((m) => m.id === old)!;
  assert.equal(linked.youtube_comment_id, "thrLead0001");
  assert.equal(messages(f).filter((m) => m.text === "Which mic do you use?").length, 1);
});

test("receive is throttled per lead: a quick repeat makes no YouTube calls", async () => {
  const f = await fixture({ threads: LEAD_THREADS, replies: LEAD_REPLIES, page: ["thrLead0001"] });
  await receive(f, f.owner, f.lead);
  const calls = f.youtube.length;
  const r = await receive(f, f.owner, f.lead);
  assert.equal(r.status, 200);
  assert.equal((r.body.data as Row).synced, false);
  assert.equal(f.youtube.length, calls);
});

test("send: a public reply in the lead's newest thread of their own, recorded in the conversation", async () => {
  const f = await fixture({
    threads: LEAD_THREADS,
    replies: LEAD_REPLIES,
    page: ["thrLead0002", "thrLead0001"],
  });
  await receive(f, f.owner, f.lead);
  const r = await send(f, f.owner, { leadId: f.lead, text: "  Thanks Grace!  " });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(f.posted, [{ parentId: "thrLead0002", text: "Thanks Grace!" }]);
  const sent = messages(f).find((m) => m.youtube_comment_id === "thrLead0002.new1")!;
  assert.deepEqual(
    [sent.from_who, sent.kind, sent.text, sent.youtube_thread_id],
    ["you", "comment", "Thanks Grace!", "thrLead0002"],
  );
  // It counts towards the workspace's daily reply cap.
  assert.ok(
    (f.world.youtube_quota_events as Row[]).some(
      (e) => e.operation === "lead.reply" && e.quota_units === 50,
    ),
  );
  // A named thread of theirs is used as asked.
  await send(f, f.owner, { leadId: f.lead, text: "About the mic…", threadId: "thrLead0001" });
  assert.equal(f.posted[1].parentId, "thrLead0001");
});

test("send never posts in a thread the lead did not start on the caller's channel", async () => {
  const f = await fixture({ threads: LEAD_THREADS, page: [] });
  for (const threadId of ["thrViewer01", "thrElsewhr1", "thrMissing1"]) {
    const r = await send(f, f.owner, { leadId: f.lead, text: "hi", threadId });
    assert.deepEqual([r.status, r.body], [409, { error: "NO_THREAD" }], threadId);
  }
  // No known thread at all.
  const none = await send(f, f.owner, { leadId: f.lead, text: "hi" });
  assert.deepEqual([none.status, none.body], [409, { error: "NO_THREAD" }]);
  assert.deepEqual(f.posted, []);
});

test("another workspace's lead, a non-YouTube lead, or a refused caller: nothing read or sent", async () => {
  const f = await fixture({ threads: LEAD_THREADS, replies: LEAD_REPLIES, page: ["thrLead0001"] });
  const foreign = await receive(f, f.owner, f.foreignLead);
  assert.deepEqual([foreign.status, foreign.body], [404, { error: "NOT_FOUND" }]);
  const foreignSend = await send(f, f.owner, { leadId: f.foreignLead, text: "hi" });
  assert.deepEqual([foreignSend.status, foreignSend.body], [404, { error: "NOT_FOUND" }]);
  const missing = await receive(f, f.owner, uuid());
  assert.deepEqual([missing.status, missing.body], [404, { error: "NOT_FOUND" }]);
  const email = await send(f, f.owner, { leadId: f.emailLead, text: "hi" });
  assert.deepEqual([email.status, email.body], [409, { error: "NOT_A_YOUTUBE_LEAD" }]);
  const otherChannel = await send(f, f.owner, { leadId: f.lead, text: "hi" }, f.channelB);
  assert.deepEqual([otherChannel.status, otherChannel.body], [404, { error: "CHANNEL_NOT_FOUND" }]);
  assert.equal((await receive(f, null, f.lead)).status, 401);
  f.world.role_feature_access.push({ role: "editor", feature_id: "feature-leads", enabled: false });
  assert.equal((await send(f, f.editor, { leadId: f.lead, text: "hi" })).status, 403);
  for (const bad of [
    { leadId: "nope", text: "hi" },
    { leadId: f.lead, text: "   " },
    { leadId: f.lead, text: "x".repeat(4_001) },
    { leadId: f.lead, text: "hi", extra: 1 },
    { leadId: f.lead, text: "hi", threadId: "bad id" },
  ])
    assert.equal((await send(f, f.owner, bad)).status, 422, JSON.stringify(bad).slice(0, 60));
  assert.equal((await receive(f, f.owner, "not-a-uuid")).status, 422);
  assert.deepEqual(f.youtube, [], "no YouTube call for any refused request");
  assert.deepEqual(messages(f), []);
});

test("send stops at the daily reply cap, which counts replies sent from the inbox", async () => {
  env.COMMENT_REPLY_DAILY_CAP = "2";
  try {
    const f = await fixture({ threads: LEAD_THREADS, page: ["thrLead0001"] });
    await receive(f, f.owner, f.lead);
    assert.equal((await send(f, f.owner, { leadId: f.lead, text: "one" })).status, 201);
    assert.equal((await send(f, f.owner, { leadId: f.lead, text: "two" })).status, 201);
    const third = await send(f, f.owner, { leadId: f.lead, text: "three" });
    assert.deepEqual([third.status, third.body], [429, { error: "DAILY_REPLY_LIMIT" }]);
    assert.equal(f.posted.length, 2);
  } finally {
    delete env.COMMENT_REPLY_DAILY_CAP;
  }
});

test("without a paid plan the conversation is refused before YouTube", async () => {
  const f = await fixture({ threads: LEAD_THREADS, page: ["thrLead0001"] });
  f.world.subscriptions = f.world.subscriptions.filter((s) => s.user_id !== f.owner);
  const r = await receive(f, f.owner, f.lead);
  const s = await send(f, f.owner, { leadId: f.lead, text: "hi" });
  assert.deepEqual([r.status, s.status], [402, 402]);
  assert.deepEqual(f.youtube, []);
  assert.deepEqual(f.posted, []);
});
