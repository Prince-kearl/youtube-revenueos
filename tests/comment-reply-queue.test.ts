import test from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type World,
} from "./helpers/team-fake-api";

// Bulk Comment Automation replies go through a server-side queue (comment_reply_jobs) that sends
// in small paced batches within a per-workspace daily cap and a reserve of the app-wide YouTube
// quota, never replies twice to one comment, and only ever replies to comments YouTube confirms
// are on the caller's own channel. The real routes run against the in-memory database, with
// YouTube answered here.

const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const queueRoute = await import("../src/routes/api.comment-replies");
const processRoute = await import("../src/routes/api.comment-replies.process");
const replyRoute = await import("../src/routes/api.comment-rules.replies");
const { personalizeReply, matchRule } = await import("../src/lib/comment-rule-match");

type Thread = { id: string; videoId: string; channel: string; author: string; text: string };
type Row = Record<string, unknown>;

const YT_A = "UCchannelAAAAAAAAAAAAAAAA";
const YT_B = "UCchannelBBBBBBBBBBBBBBBB";
const YT_STRANGER = "UCsomeoneElsesChannel0000";

async function fixture(
  options: { threads?: Thread[]; pages?: string[][]; quota?: "ok" | "exceeded" } = {},
) {
  const world: World = { ...emptyWorld() };
  world.features.push({ id: "feature-comments", key: "comment_automation", is_active: true });
  const owner = addUser(world, "owner@x.test");
  const editor = addUser(world, "editor@x.test");
  const other = addUser(world, "other@x.test");
  const wA = addWorkspace(world, owner);
  addMember(world, wA, editor, "editor");
  const wB = addWorkspace(world, other);
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
    {
      id: "conn-B",
      access_token_ciphertext: await encryptSecretToBytea("token-B"),
      refresh_token_ciphertext: await encryptSecretToBytea("refresh-B"),
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
      connection_id: "conn-B",
      connected_at: "2026-09-01T00:00:00Z",
    },
  ];
  world.comment_automation_rules = [];
  world.comment_automation_replies = [];
  world.comment_reply_jobs = [];
  world.youtube_quota_events = [];
  world.videos = [];
  world.leads = [];
  world.lead_messages = [];

  const threads = new Map((options.threads ?? []).map((t) => [t.id, t]));
  const posted: Array<{ token: string; parentId: string; text: string }> = [];
  const youtube: string[] = [];
  const tokenChannel: Record<string, string> = { "token-A": YT_A, "token-B": YT_B };
  const threadJson = (t: Thread) => ({
    id: t.id,
    snippet: {
      videoId: t.videoId,
      channelId: t.channel,
      canReply: true,
      topLevelComment: {
        snippet: {
          textDisplay: t.text,
          authorDisplayName: t.author,
          authorChannelId: { value: `UCauthor-${t.id}` },
          likeCount: 0,
          publishedAt: "2026-10-01T00:00:00Z",
        },
      },
    },
  });
  world.external = (url, { method, headers, body }) => {
    if (url.hostname !== "www.googleapis.com") return undefined;
    const token = (headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const resource = url.pathname.split("/").pop();
    youtube.push(`${method} ${resource}${url.search}`);
    if (resource === "commentThreads" && url.searchParams.get("id")) {
      const ids = url.searchParams.get("id")!.split(",");
      return Response.json({
        items: ids.flatMap((id) => (threads.has(id) ? [threadJson(threads.get(id)!)] : [])),
      });
    }
    if (resource === "commentThreads" && url.searchParams.get("allThreadsRelatedToChannelId")) {
      assert.equal(url.searchParams.get("allThreadsRelatedToChannelId"), tokenChannel[token]);
      const pages = options.pages ?? [];
      const index = Number(url.searchParams.get("pageToken")?.replace("p", "") ?? "1") - 1;
      return Response.json({
        items: (pages[index] ?? []).map((id) => threadJson(threads.get(id)!)),
        ...(index + 1 < pages.length ? { nextPageToken: `p${index + 2}` } : {}),
      });
    }
    if (resource === "comments" && method === "POST") {
      if (options.quota === "exceeded")
        return Response.json(
          { error: { code: 403, errors: [{ reason: "quotaExceeded" }] } },
          { status: 403 },
        );
      const sent = JSON.parse(body ?? "{}") as {
        snippet: { parentId: string; textOriginal: string };
      };
      posted.push({ token, parentId: sent.snippet.parentId, text: sent.snippet.textOriginal });
      return Response.json({
        id: `reply-${posted.length}`,
        snippet: { publishedAt: "2026-10-20T00:00:00Z" },
      });
    }
    return undefined;
  };
  return { world, owner, editor, other, wA, wB, channelA, channelB, posted, youtube };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const thread = (
  id: string,
  channel = YT_A,
  author = "Ada Lovelace",
  text = `Comment ${id}`,
): Thread => ({
  id,
  videoId: "videoAAAAA1",
  channel,
  author,
  text,
});

const queue = (f: Fixture, as: string | null, body: unknown, channelId = f.channelA) =>
  callTeamApi(queueRoute, f.world, {
    as,
    method: "POST",
    path: "/api/comment-replies",
    query: `?channelId=${channelId}`,
    body,
  });
const process = (f: Fixture, as: string | null) =>
  callTeamApi(processRoute, f.world, { as, method: "POST", path: "/api/comment-replies/process" });
const jobs = (f: Fixture) => f.world.comment_reply_jobs as Row[];
const selected = (...ids: string[]) => ({
  mode: "selected",
  items: ids.map((id) => ({ youtubeCommentId: id, replyText: "Thanks {name}!" })),
});

// ---------- queueing ----------

test("only comments YouTube confirms are on the caller's own channel are queued, with YouTube's own data", async () => {
  const f = await fixture({
    threads: [
      thread("cmtOwn00001"),
      thread("cmtForeign1", YT_STRANGER),
      thread("cmtOtherWs1", YT_B),
    ],
  });
  const r = await queue(
    f,
    f.owner,
    selected("cmtOwn00001", "cmtForeign1", "cmtOtherWs1", "cmtMissing1"),
  );
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data && (r.body.data as Row).queued, 1);
  assert.equal((r.body.data as Row).notOnChannel, 3);
  assert.deepEqual(
    jobs(f).map((j) => j.youtube_comment_id),
    ["cmtOwn00001"],
  );
  const job = jobs(f)[0];
  // Name, text and video come from YouTube; "{name}" is personalized.
  assert.equal(job.author_name, "Ada Lovelace");
  assert.equal(job.comment_text, "Comment cmtOwn00001");
  assert.equal(job.reply_text, "Thanks Ada!");
  assert.equal(job.workspace_id, f.wA);
  assert.equal(job.status, "queued");
  assert.deepEqual(f.posted, [], "queueing sends nothing");
});

test("a comment is never queued twice, and one already replied to is not queued", async () => {
  const f = await fixture({ threads: [thread("cmtOne00001"), thread("cmtTwo00001")] });
  f.world.comment_automation_replies!.push({
    id: uuid(),
    channel_id: f.channelA,
    youtube_comment_id: "cmtTwo00001",
    status: "sent",
    created_at: "2026-10-01T00:00:00Z",
  });
  const first = await queue(f, f.owner, selected("cmtOne00001", "cmtTwo00001"));
  assert.deepEqual(
    [(first.body.data as Row).queued, (first.body.data as Row).alreadyReplied],
    [1, 1],
  );
  const again = await queue(f, f.owner, selected("cmtOne00001"));
  assert.deepEqual(
    [(again.body.data as Row).queued, (again.body.data as Row).alreadyQueued],
    [0, 1],
  );
  assert.equal(jobs(f).length, 1);
});

test("'all on YouTube' queues every comment of the channel, page after page, with each comment's rule", async () => {
  const threads = [
    thread("cmtPage1a01", YT_A, "Bo", "what is the price?"),
    thread("cmtPage1b01"),
    thread("cmtPage2a01"),
  ];
  const f = await fixture({ threads, pages: [["cmtPage1a01", "cmtPage1b01"], ["cmtPage2a01"]] });
  f.world.comment_automation_rules!.push({
    id: uuid(),
    channel_id: f.channelA,
    name: "Pricing",
    trigger_type: "keyword",
    keywords: ["price"],
    reply_template: "Hi {name}, pricing is in the description.",
    video_id: null,
    active: true,
  });
  const r = await queue(f, f.owner, { mode: "all" });
  assert.equal(r.status, 201, r.text);
  assert.equal((r.body.data as Row).queued, 3);
  const byId = Object.fromEntries(jobs(f).map((j) => [j.youtube_comment_id, j.reply_text]));
  assert.equal(byId.cmtPage1a01, "Hi Bo, pricing is in the description.");
  assert.equal(byId.cmtPage1b01, "Thanks for your comment! 🙌");
  assert.ok(
    f.youtube.some((call) => call.includes("pageToken=p2")),
    "second page read",
  );
});

// ---------- authorization and validation ----------

test("refused before anything is read from YouTube or queued", async () => {
  const f = await fixture({ threads: [thread("cmtOwn00001")] });
  // Signed out.
  assert.equal((await queue(f, null, selected("cmtOwn00001"))).status, 401);
  // Another workspace's channel id: the same answer as a channel that does not exist.
  const foreign = await queue(f, f.owner, selected("cmtOwn00001"), f.channelB);
  assert.deepEqual([foreign.status, foreign.body], [404, { error: "CHANNEL_NOT_FOUND" }]);
  // Comment Automation switched off for the caller's role.
  f.world.role_feature_access.push({
    role: "editor",
    feature_id: "feature-comments",
    enabled: false,
  });
  const editor = await queue(f, f.editor, selected("cmtOwn00001"));
  assert.equal(editor.status, 403);
  // Malformed requests.
  for (const bad of [
    { mode: "selected", items: [] },
    { mode: "selected", items: [{ youtubeCommentId: "../etc", replyText: "x" }] },
    { mode: "selected", items: [{ youtubeCommentId: "cmtOwn00001", replyText: "" }] },
    { mode: "selected", items: [{ youtubeCommentId: "cmtOwn00001", replyText: "x", extra: 1 }] },
    {
      mode: "selected",
      items: Array.from({ length: 501 }, () => ({
        youtubeCommentId: "cmtOwn00001",
        replyText: "x",
      })),
    },
    { mode: "everything" },
  ])
    assert.equal((await queue(f, f.owner, bad)).status, 422, JSON.stringify(bad).slice(0, 60));
  assert.deepEqual(jobs(f), []);
  assert.deepEqual(f.youtube, []);
});

// ---------- processing ----------

async function queued(f: Fixture, ...ids: string[]) {
  const r = await queue(f, f.owner, selected(...ids));
  assert.equal(r.status, 201, r.text);
}

test("processing sends a small batch to the right comments with the channel's own token", async () => {
  const ids = [
    "cmtBatch001",
    "cmtBatch002",
    "cmtBatch003",
    "cmtBatch004",
    "cmtBatch005",
    "cmtBatch006",
  ];
  const f = await fixture({ threads: ids.map((id) => thread(id)) });
  await queued(f, ...ids);
  const r = await process(f, f.owner);
  assert.equal(r.status, 200, r.text);
  assert.equal((r.body.data as Row).sent, 4, "one batch of 4, not everything at once");
  assert.deepEqual(
    f.posted.map((p) => [p.token, p.parentId, p.text]),
    ids.slice(0, 4).map((id) => ["token-A", id, "Thanks Ada!"]),
  );
  assert.equal(jobs(f).filter((j) => j.status === "sent").length, 4);
  assert.equal(jobs(f).filter((j) => j.status === "queued").length, 2);
  assert.equal(
    (f.world.comment_automation_replies as Row[]).filter((r2) => r2.status === "sent").length,
    4,
  );
  assert.equal(
    (f.world.youtube_quota_events as Row[]).filter((e) => e.operation === "comments.insert").length,
    4,
  );
});

test("the per-workspace daily cap: the rest stays queued for tomorrow", async () => {
  env.COMMENT_REPLY_DAILY_CAP = "2";
  try {
    const ids = ["cmtCap00001", "cmtCap00002", "cmtCap00003"];
    const f = await fixture({ threads: ids.map((id) => thread(id)) });
    await queued(f, ...ids);
    const first = await process(f, f.owner);
    assert.deepEqual(
      [(first.body.data as Row).sent, (first.body.data as Row).paused],
      [2, "daily_limit"],
    );
    const second = await process(f, f.owner);
    assert.deepEqual(
      [(second.body.data as Row).sent, (second.body.data as Row).paused],
      [0, "daily_limit"],
    );
    assert.equal(f.posted.length, 2);
    assert.equal(jobs(f).filter((j) => j.status === "queued").length, 1);
  } finally {
    delete env.COMMENT_REPLY_DAILY_CAP;
  }
});

test("the app-wide quota reserve: replies stop before syncs would run out", async () => {
  const ids = ["cmtQuota001", "cmtQuota002"];
  const f = await fixture({ threads: ids.map((id) => thread(id)) });
  await queued(f, ...ids);
  // Another user has spent most of today's quota: 10,000 - 2,000 reserve - 7,900 - 1 (the lookup
  // when queueing) = 99 units: room for exactly one 50-unit reply.
  f.world.youtube_quota_events!.push({
    id: 1,
    operation: "channels.list",
    quota_units: 7_900,
    succeeded: true,
    created_at: new Date().toISOString(),
  });
  const r = await process(f, f.owner);
  assert.deepEqual([(r.body.data as Row).sent, (r.body.data as Row).paused], [1, "quota"]);
  assert.equal(jobs(f).filter((j) => j.status === "queued").length, 1);
});

test("YouTube says its quota is exhausted: the reply goes back to the queue, nothing is lost", async () => {
  const f = await fixture({ threads: [thread("cmtQx000001")], quota: "exceeded" });
  await queued(f, "cmtQx000001");
  const r = await process(f, f.owner);
  assert.deepEqual([(r.body.data as Row).sent, (r.body.data as Row).paused], [0, "quota"]);
  const job = jobs(f)[0];
  assert.deepEqual([job.status, job.attempts], ["queued", 0]);
});

test("a comment replied to after it was queued is skipped, never replied to twice", async () => {
  const f = await fixture({ threads: [thread("cmtLate0001")] });
  await queued(f, "cmtLate0001");
  f.world.comment_automation_replies!.push({
    id: uuid(),
    channel_id: f.channelA,
    youtube_comment_id: "cmtLate0001",
    status: "sent",
    created_at: new Date().toISOString(),
  });
  const r = await process(f, f.owner);
  assert.equal((r.body.data as Row).skipped, 1);
  assert.deepEqual(f.posted, []);
  assert.equal(jobs(f)[0].status, "skipped");
});

test("one workspace's processing never touches another workspace's queue", async () => {
  const f = await fixture({ threads: [thread("cmtWsB00001", YT_B)] });
  // A job in workspace B (written directly, as the server would for B's owner).
  f.world.comment_reply_jobs!.push({
    id: uuid(),
    workspace_id: f.wB,
    channel_id: f.channelB,
    youtube_comment_id: "cmtWsB00001",
    youtube_video_id: "videoAAAAA1",
    comment_text: "hi",
    reply_text: "hello",
    status: "queued",
    attempts: 0,
    created_at: "2026-10-01T00:00:00Z",
  });
  const r = await process(f, f.owner);
  assert.equal((r.body.data as Row).sent, 0);
  assert.deepEqual(f.posted, []);
  assert.equal(jobs(f)[0].status, "queued");
});

test("cancel: only the caller's channel's waiting replies, and nothing already sent", async () => {
  const f = await fixture({ threads: [thread("cmtCancel01"), thread("cmtCancel02")] });
  await queued(f, "cmtCancel01", "cmtCancel02");
  jobs(f)[0].status = "sent";
  const r = await callTeamApi(queueRoute, f.world, {
    as: f.owner,
    method: "DELETE",
    path: "/api/comment-replies",
    query: `?channelId=${f.channelA}`,
  });
  assert.deepEqual(r.body, { data: { cancelled: 1 } });
  assert.deepEqual(
    jobs(f).map((j) => j.status),
    ["sent", "skipped"],
  );
});

test("processing needs a signed-in member with Comment Automation, and sends only their queue", async () => {
  const f = await fixture({ threads: [thread("cmtAuth0001")] });
  await queued(f, "cmtAuth0001");
  assert.equal((await process(f, null)).status, 401);
  f.world.role_feature_access.push({
    role: "editor",
    feature_id: "feature-comments",
    enabled: false,
  });
  assert.equal((await process(f, f.editor)).status, 403);
  assert.deepEqual(f.posted, []);
  // The workspace-B owner's processing never reaches workspace A's queue.
  const other = await process(f, f.other);
  assert.equal((other.body.data as Row).sent, 0);
  assert.deepEqual(f.posted, []);
  assert.equal(jobs(f)[0].status, "queued");
});

// ---------- the single "Auto-reply" button ----------

const replyOne = (f: Fixture, as: string, id: string, channelId = f.channelA) =>
  callTeamApi(replyRoute, f.world, {
    as,
    method: "POST",
    path: "/api/comment-rules/replies",
    query: `?channelId=${channelId}`,
    body: {
      youtubeCommentId: id,
      youtubeVideoId: "spoofed",
      authorName: "Spoofed Name",
      commentText: "spoofed text",
      replyText: "Thanks {name}!",
    },
  });

test("single reply: a comment on another channel is refused and nothing is posted", async () => {
  const f = await fixture({ threads: [thread("cmtElse0001", YT_STRANGER)] });
  for (const id of ["cmtElse0001", "cmtNone0001"]) {
    const r = await replyOne(f, f.owner, id);
    assert.deepEqual([id, r.status, r.body], [id, 404, { error: "COMMENT_NOT_FOUND" }]);
  }
  assert.deepEqual(f.posted, []);
});

test("single reply: YouTube's data is recorded, not the request's, and a second reply is refused", async () => {
  const f = await fixture({ threads: [thread("cmtSingle01")] });
  const first = await replyOne(f, f.owner, "cmtSingle01");
  assert.equal(first.status, 201, first.text);
  assert.deepEqual(
    f.posted.map((p) => p.text),
    ["Thanks Ada!"],
  );
  const recorded = (f.world.comment_automation_replies as Row[])[0];
  assert.deepEqual(
    [recorded.author_name, recorded.comment_text, recorded.youtube_video_id],
    ["Ada Lovelace", "Comment cmtSingle01", "videoAAAAA1"],
  );
  const second = await replyOne(f, f.owner, "cmtSingle01");
  assert.deepEqual([second.status, second.body], [409, { error: "ALREADY_REPLIED" }]);
  assert.equal(f.posted.length, 1);
});

test("single reply: a queued comment, the daily cap and YouTube's quota are respected", async () => {
  const f = await fixture({ threads: [thread("cmtQueued01"), thread("cmtCapped01")] });
  await queued(f, "cmtQueued01");
  const queuedReply = await replyOne(f, f.owner, "cmtQueued01");
  assert.deepEqual([queuedReply.status, queuedReply.body], [409, { error: "ALREADY_QUEUED" }]);
  env.COMMENT_REPLY_DAILY_CAP = "1";
  try {
    f.world.comment_automation_replies!.push({
      id: uuid(),
      channel_id: f.channelA,
      youtube_comment_id: "cmtEarlier1",
      status: "sent",
      created_at: new Date().toISOString(),
    });
    const capped = await replyOne(f, f.owner, "cmtCapped01");
    assert.deepEqual([capped.status, capped.body], [429, { error: "DAILY_REPLY_LIMIT" }]);
  } finally {
    delete env.COMMENT_REPLY_DAILY_CAP;
  }
  assert.deepEqual(f.posted, []);
  const quota = await fixture({ threads: [thread("cmtQuotaX01")], quota: "exceeded" });
  const exceeded = await replyOne(quota, quota.owner, "cmtQuotaX01");
  assert.deepEqual([exceeded.status, exceeded.body], [429, { error: "YOUTUBE_QUOTA_EXCEEDED" }]);
});

// ---------- reply wording ----------

test("'{name}' becomes the commenter's first name, or disappears cleanly without one", () => {
  assert.equal(personalizeReply("Thanks {name}!", "Ada Lovelace"), "Thanks Ada!");
  assert.equal(personalizeReply("Thanks {name}!", "@handle"), "Thanks handle!");
  assert.equal(personalizeReply("Thanks {name}!", null), "Thanks!");
  assert.equal(personalizeReply("Hi {name}, thanks.", ""), "Hi, thanks.");
  assert.equal(personalizeReply("No placeholder here", "Ada"), "No placeholder here");
});

test("the shared rule matcher picks the same rule the page did", () => {
  const rules = [
    {
      id: "q",
      active: true,
      trigger_type: "question" as const,
      keywords: [],
      reply_template: "Q",
      video: null,
    },
    {
      id: "k",
      active: true,
      trigger_type: "keyword" as const,
      keywords: ["price"],
      reply_template: "K",
      video: null,
    },
    {
      id: "h",
      active: true,
      trigger_type: "handle" as const,
      keywords: [],
      reply_template: "H",
      video: null,
    },
  ];
  const map = new Map<string, string>();
  assert.equal(matchRule({ videoId: "v", text: "@me hi" }, rules, map)?.id, "h");
  assert.equal(matchRule({ videoId: "v", text: "the price?" }, rules, map)?.id, "k");
  assert.equal(matchRule({ videoId: "v", text: "why?" }, rules, map)?.id, "q");
  assert.equal(matchRule({ videoId: "v", text: "nice" }, rules, map), undefined);
});

// ---------- the Comment Automation page ----------

const { readFileSync } = await import("node:fs");
const page = readFileSync("src/routes/comments.tsx", "utf8").replace(/\s+/g, " ");

test("the page queues bulk replies on the server instead of sending them one by one", () => {
  // No loop of direct sends from the browser any more.
  assert.doesNotMatch(page, /for \(const id of ids\) \{[^}]*onSendReply/);
  assert.match(page, /postQueue\(\{ mode: "selected", items: items\.slice\(i, i \+ 500\) \}\)/);
  assert.match(page, /postQueue\(\{ mode: "all" \}\)/);
  // A confirmation first, saying how many go out today.
  assert.match(
    page,
    /go out today \(limit \$\{allowance\.dailyCap\} a day\); the rest continue on the following days\./,
  );
  // Progress, the reason it paused, and a way to stop.
  assert.match(page, /\{waiting\} waiting · \{allowance\?\.sentToday \?\? 0\} sent today/);
  assert.match(page, /daily_limit: "today’s limit reached — continues tomorrow"/);
  assert.match(page, /Cancel remaining/);
  // While the page is open it asks the server for the next batch; the server decides how many.
  assert.match(
    page,
    /fetch\("\/api\/comment-replies\/process", \{ method: "POST", cache: "no-store" \}\)/,
  );
  // A queued comment cannot be selected or replied to again.
  assert.match(page, /!repliedCommentIds\.has\(c\.id\) && !queue\.queuedIds\.has\(c\.id\)/);
  assert.match(page, /disabled=\{replied \|\| queued\}/);
});

test("the queue continues daily inside the existing sync job: after the sync, unable to fail it", () => {
  const sync = readFileSync("src/routes/api.youtube.sync.ts", "utf8").replace(/\s+/g, " ");
  const cron = sync.slice(sync.indexOf("GET: async"));
  const run = cron.indexOf(
    "await processAllQueues(service, { maxTotal: 60, timeBudgetMs: 20_000 })",
  );
  assert.ok(run > cron.indexOf("await runRevenueDataBatch("), "after the sync");
  assert.ok(
    run > cron.indexOf('return json({ error: "AUTH_REQUIRED" }'),
    "only after the cron secret check",
  );
  assert.match(
    cron,
    /try \{ commentReplies = await processAllQueues\([^)]*\); \} catch \{ commentReplies = null; \}/,
  );
  // No new scheduled job.
  assert.equal(JSON.parse(readFileSync("vercel.json", "utf8")).crons.length, 1);
  // The page's processing endpoint has no secret-protected GET of its own.
  assert.doesNotMatch(
    readFileSync("src/routes/api.comment-replies.process.ts", "utf8"),
    /GET: async/,
  );
});

test("the queue table: workspace-readable, server-written, one job per comment", () => {
  const sql = readFileSync("supabase/migrations/202610200001_comment_reply_queue.sql", "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.match(sql, /unique \(channel_id, youtube_comment_id\)/);
  assert.match(sql, /alter table public\.comment_reply_jobs enable row level security;/);
  assert.match(
    sql,
    /for select to authenticated using \(public\.is_active_workspace_member\(workspace_id\)\);/,
  );
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/);
  assert.match(sql, /revoke all on table public\.comment_reply_jobs from anon;/);
  assert.match(
    sql,
    /revoke insert, update, delete, truncate, references, trigger\s+on table public\.comment_reply_jobs from authenticated;/,
  );
  assert.match(
    sql,
    /create unique index if not exists comment_automation_replies_sent_once_idx\s+on public\.comment_automation_replies \(channel_id, youtube_comment_id\)\s+where status = 'sent';/,
  );
});
