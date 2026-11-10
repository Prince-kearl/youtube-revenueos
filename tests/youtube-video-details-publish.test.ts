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

// Publishing a description from the AI Description Lab to YouTube, and undoing it
// (api.youtube.video-details.ts). The real route runs against the in-memory database with
// YouTube answered here. Every refused request must leave YouTube and the database untouched.

const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const route = await import("../src/routes/api.youtube.video-details");
const lib = await import("../src/lib/youtube-description");
const { videosCountLine } = await import("../src/lib/videos-page");

type Row = Record<string, unknown>;
const YT_A = "UCchannelAAAAAAAAAAAAAAAA";
const YT_B = "UCchannelBBBBBBBBBBBBBBBB";
const VIDEO = "videoAAAAA1";
const FOREIGN_VIDEO = "videoBBBBB1";

type Snippet = {
  channelId: string;
  title: string;
  description: string;
  categoryId: string;
  tags?: string[];
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
};

async function fixture(options: { updateStatus?: number; updateReason?: string } = {}) {
  const world: World = { ...emptyWorld() };
  world.features.push({ id: "feature-ai-lab", key: "ai_lab", is_active: true });
  const owner = addUser(world, "owner@x.test");
  const manager = addUser(world, "manager@x.test");
  const editor = addUser(world, "editor@x.test");
  const setter = addUser(world, "setter@x.test");
  const other = addUser(world, "other@x.test");
  const wA = addWorkspace(world, owner);
  addMember(world, wA, manager, "manager");
  addMember(world, wA, editor, "editor");
  addMember(world, wA, setter, "setter");
  const wB = addWorkspace(world, other);
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
    },
    {
      id: channelB,
      workspace_id: wB,
      user_id: other,
      youtube_channel_id: YT_B,
      connection_id: "conn-B",
    },
  ];
  world.audit_events = [];

  const videos = new Map<string, Snippet>([
    [
      VIDEO,
      {
        channelId: YT_A,
        title: "My title",
        description: "Old description",
        categoryId: "22",
        tags: ["one", "two"],
        defaultLanguage: "en",
      },
    ],
    [FOREIGN_VIDEO, { channelId: YT_B, title: "Theirs", description: "Theirs", categoryId: "10" }],
  ]);
  const youtube: string[] = [];
  const updates: Array<{ id: string; snippet: Snippet }> = [];
  world.external = (url, init) => {
    if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/youtube/v3/videos")
      return undefined;
    youtube.push(`${init.method} ${url.searchParams.get("part")}`);
    if (init.method === "GET") {
      const snippet = videos.get(url.searchParams.get("id") ?? "");
      return Response.json({ items: snippet ? [{ id: url.searchParams.get("id"), snippet }] : [] });
    }
    if (init.method === "PUT") {
      if (options.updateStatus)
        return Response.json(
          { error: { errors: [{ reason: options.updateReason ?? "invalidDescription" }] } },
          { status: options.updateStatus },
        );
      const body = JSON.parse(init.body ?? "{}") as { id: string; snippet: Snippet };
      updates.push(body);
      const current = videos.get(body.id)!;
      videos.set(body.id, { ...body.snippet, channelId: current.channelId });
      return Response.json({ id: body.id, snippet: body.snippet });
    }
    return undefined;
  };
  return {
    world,
    owner,
    manager,
    editor,
    setter,
    other,
    wA,
    wB,
    channelA,
    channelB,
    videos,
    youtube,
    updates,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const post = (f: Fixture, as: string | null, body: unknown) =>
  callTeamApi(route, f.world, { as, method: "POST", path: "/api/youtube/video-details", body });
const status = (f: Fixture, as: string | null, channelId = f.channelA, videoId = VIDEO) =>
  callTeamApi(route, f.world, {
    as,
    method: "GET",
    path: "/api/youtube/video-details",
    query: `?channelId=${channelId}&videoId=${videoId}`,
  });
// What the page saw on YouTube: the video's title and tags as they are now, and the description
// the test names (so a test can make it stale).
const seen = (f: Fixture, videoId: string, description: string) => {
  const v = f.videos.get(videoId);
  return { title: v?.title ?? "", description, tags: v?.tags ?? [] };
};
const publish = (f: Fixture, as: string | null, extra: Record<string, unknown> = {}) => {
  const {
    description = "New description",
    expectedDescription = "Old description",
    channelId = f.channelA,
    videoId = VIDEO,
    changes,
    ...rest
  } = extra;
  return post(f, as, {
    action: "publish",
    channelId,
    videoId,
    changes: changes ?? { description },
    expected: seen(f, videoId as string, expectedDescription as string),
    ...rest,
  });
};
const undo = (f: Fixture, as: string | null, expectedDescription = "New description") =>
  post(f, as, {
    action: "undo",
    channelId: f.channelA,
    videoId: VIDEO,
    expected: seen(f, VIDEO, expectedDescription),
  });
const audit = (f: Fixture) => f.world.audit_events as Row[];

function assertUntouched(f: Fixture, result: { writes: unknown[] }, message: string) {
  assert.equal(f.updates.length, 0, `${message}: nothing sent to YouTube`);
  assert.equal(audit(f).length, 0, `${message}: nothing recorded`);
  assert.equal(f.videos.get(VIDEO)!.description, "Old description", message);
  assert.deepEqual(
    (result.writes as Array<{ method: string }>).filter((w) => w.method !== "GET"),
    [],
    `${message}: no database writes`,
  );
}

// ---------- publishing ----------

test("an owner publishes: only the description changes; title, category, tags and language are sent back", async () => {
  const f = await fixture();
  const result = await publish(f, f.owner);
  assert.equal(result.status, 200, result.text);
  assert.equal((result.body.data as Row).status, "published");
  assert.equal((result.body.data as Row).undoAvailable, true);
  assert.deepEqual(f.updates, [
    {
      id: VIDEO,
      snippet: {
        title: "My title",
        description: "New description",
        categoryId: "22",
        tags: ["one", "two"],
        defaultLanguage: "en",
      },
    },
  ]);
  assert.deepEqual(f.youtube, ["GET snippet", "PUT snippet"], "one read, one write");
  const [event] = audit(f);
  assert.equal(event.action, "youtube_description.published");
  assert.equal(event.user_id, f.owner);
  assert.equal(event.resource_id, f.channelA);
  assert.deepEqual((event.metadata as Row).previous, { description: "Old description" });
  assert.deepEqual((event.metadata as Row).fields, ["description"]);
  assert.equal((event.metadata as Row).workspaceId, f.wA);
  assert.equal((event.metadata as Row).videoId, VIDEO);
});

test("managers and editors may publish", async () => {
  for (const who of ["manager", "editor"] as const) {
    const f = await fixture();
    const result = await publish(f, f[who]);
    assert.equal(result.status, 200, `${who}: ${result.text}`);
    assert.equal(f.updates.length, 1);
  }
});

test("a setter may not publish or undo, and YouTube is never asked", async () => {
  const f = await fixture();
  const result = await publish(f, f.setter);
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "ROLE_NOT_ALLOWED");
  assertUntouched(f, result, "setter publish");
  assert.deepEqual(f.youtube, []);
  const undone = await undo(f, f.setter, "Old description");
  assert.equal(undone.status, 403);
  const s = await status(f, f.setter);
  assert.equal((s.body.data as Row).canPublish, false);
});

test("without a session, or with the AI lab turned off for the role, nothing happens", async () => {
  const f = await fixture();
  const anonymous = await publish(f, null);
  assert.equal(anonymous.status, 401);
  assertUntouched(f, anonymous, "anonymous");
  f.world.role_feature_access.push({
    role: "editor",
    feature_id: "feature-ai-lab",
    enabled: false,
  });
  const disabled = await publish(f, f.editor);
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.error, "FEATURE_DISABLED");
  assertUntouched(f, disabled, "feature disabled");
  assert.deepEqual(f.youtube, []);
});

test("another workspace's channel gets the same 404 as one that does not exist", async () => {
  const f = await fixture();
  const foreign = await publish(f, f.owner, {
    channelId: f.channelB,
    videoId: FOREIGN_VIDEO,
    expectedDescription: "Theirs",
  });
  const unknown = await publish(f, f.owner, { channelId: uuid() });
  for (const r of [foreign, unknown]) {
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "CHANNEL_NOT_FOUND");
  }
  assert.equal(foreign.text, unknown.text);
  assert.deepEqual(f.youtube, [], "no YouTube request with anyone's token");
  assert.equal(f.videos.get(FOREIGN_VIDEO)!.description, "Theirs");
  assert.equal(audit(f).length, 0);
  const s = await status(f, f.owner, f.channelB, FOREIGN_VIDEO);
  assert.equal(s.status, 404);
});

test("a video on another YouTube channel is refused as not found, before any write", async () => {
  const f = await fixture();
  const result = await publish(f, f.owner, {
    videoId: FOREIGN_VIDEO,
    expectedDescription: "Theirs",
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "VIDEO_NOT_FOUND");
  assert.deepEqual(f.youtube, ["GET snippet"], "read only, never updated");
  assert.equal(f.videos.get(FOREIGN_VIDEO)!.description, "Theirs");
  assert.equal(audit(f).length, 0);
  const missing = await publish(f, f.owner, { videoId: "missingVid1" });
  assert.equal(missing.status, 404);
  assert.equal(missing.text, result.text, "same answer as a video that does not exist");
});

test("an edit made on YouTube after the page loaded is never overwritten", async () => {
  const f = await fixture();
  f.videos.get(VIDEO)!.description = "Edited in Studio";
  const result = await publish(f, f.owner);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "CHANGED_ON_YOUTUBE");
  assert.equal(f.updates.length, 0);
  assert.equal(audit(f).length, 0);
  assert.equal(f.videos.get(VIDEO)!.description, "Edited in Studio");
});

test("descriptions YouTube would refuse are refused first, with no YouTube request", async () => {
  const f = await fixture();
  const cases: Array<[string, string]> = [
    ["   ", "EMPTY"],
    ["Click <here>", "ANGLE_BRACKETS"],
    ["é".repeat(2501), "TOO_LONG"], // 2,501 characters but 5,002 bytes
  ];
  for (const [description, code] of cases) {
    const result = await publish(f, f.owner, { description });
    assert.equal(result.status, 422, code);
    assert.equal(result.body.error, code);
    assertUntouched(f, result, code);
  }
  const strict = await publish(f, f.owner, { title: "sneaky title change" });
  assert.equal(strict.status, 422, "unknown fields are refused");
  assert.equal(strict.body.error, "VALIDATION_ERROR");
  assert.deepEqual(f.youtube, []);
});

test("Windows line endings from the browser are sent as YouTube stores them", async () => {
  const f = await fixture();
  f.videos.get(VIDEO)!.description = "Line one\nLine two";
  const result = await publish(f, f.owner, {
    description: "New one\r\nNew two",
    expectedDescription: "Line one\r\nLine two",
  });
  assert.equal(result.status, 200, result.text);
  assert.equal(f.updates[0].snippet.description, "New one\nNew two");
});

test("publishing what YouTube already has changes nothing", async () => {
  const f = await fixture();
  const result = await publish(f, f.owner, { description: "Old description" });
  assert.equal(result.status, 200);
  assert.equal((result.body.data as Row).status, "unchanged");
  assert.equal(f.updates.length, 0);
  assert.equal(audit(f).length, 0);
});

test("when YouTube refuses the update, the record of a change is withdrawn", async () => {
  const f = await fixture({ updateStatus: 400 });
  const result = await publish(f, f.owner);
  assert.equal(result.status, 422);
  assert.equal(result.body.error, "YOUTUBE_REFUSED");
  assert.equal(audit(f).length, 0);
  assert.equal(f.videos.get(VIDEO)!.description, "Old description");

  const quota = await fixture({ updateStatus: 403, updateReason: "quotaExceeded" });
  const exhausted = await publish(quota, quota.owner);
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.body.error, "YOUTUBE_QUOTA_EXCEEDED");
  assert.equal(audit(quota).length, 0);
});

test("if the record cannot be written, YouTube is not touched", async () => {
  const f = await fixture();
  f.world.refuseWrites = { audit_events: "42501" };
  const result = await publish(f, f.owner);
  assert.equal(result.status, 500);
  assert.equal(f.updates.length, 0);
  assert.equal(f.videos.get(VIDEO)!.description, "Old description");
});

// ---------- undo ----------

test("undo puts the previous description back, once", async () => {
  const f = await fixture();
  await publish(f, f.owner);
  const before = await status(f, f.editor);
  assert.equal(
    (before.body.data as Row).undoAvailable,
    true,
    "any publisher in the workspace sees it",
  );

  const result = await undo(f, f.editor);
  assert.equal(result.status, 200, result.text);
  assert.equal((result.body.data as Row).status, "restored");
  assert.equal(((result.body.data as Row).current as Row).description, "Old description");
  assert.equal(f.videos.get(VIDEO)!.description, "Old description");
  assert.equal(f.videos.get(VIDEO)!.title, "My title");
  assert.deepEqual(
    audit(f).map((e) => e.action),
    ["youtube_description.published", "youtube_description.restored"],
  );

  const again = await undo(f, f.editor, "Old description");
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "NOTHING_TO_UNDO");
  const after = await status(f, f.owner);
  assert.equal((after.body.data as Row).undoAvailable, false);
});

test("undo refuses to overwrite an edit made on YouTube after the publish", async () => {
  const f = await fixture();
  await publish(f, f.owner);
  f.videos.get(VIDEO)!.description = "Edited in Studio";
  const stale = await undo(f, f.owner, "New description");
  assert.equal(stale.status, 409);
  // Even when the page knows about the Studio edit, undo only restores over what publish wrote.
  const current = await undo(f, f.owner, "Edited in Studio");
  assert.equal(current.status, 409);
  assert.equal(f.videos.get(VIDEO)!.description, "Edited in Studio");
  assert.equal(audit(f).length, 1);
});

test("one workspace's publish history is invisible to another, even for the same video id", async () => {
  const f = await fixture();
  await publish(f, f.owner);
  // Workspace B's owner asks about the same video id on their own channel.
  const s = await status(f, f.other, f.channelB, VIDEO);
  assert.equal(s.status, 200);
  assert.equal((s.body.data as Row).undoAvailable, false);
  const foreignUndo = await post(f, f.other, {
    action: "undo",
    channelId: f.channelA,
    videoId: VIDEO,
    expected: seen(f, VIDEO, "New description"),
  });
  assert.equal(foreignUndo.status, 404);
  assert.equal(f.videos.get(VIDEO)!.description, "New description");
});

// ---------- daily limit ----------

test("a workspace gets 20 publishes and undos a day; other workspaces' use does not count", async () => {
  const f = await fixture();
  const now = new Date().toISOString();
  const seed = (workspaceId: string, channelId: string, n: number) => {
    for (let i = 0; i < n; i++)
      audit(f).push({
        id: uuid(),
        user_id: f.owner,
        action: "youtube_description.published",
        resource_type: "youtube_video_description",
        resource_id: channelId,
        metadata: { workspaceId, videoId: `seedVideo${String(i).padStart(2, "0")}` },
        created_at: now,
      });
  };
  seed(f.wB, f.channelB, 30);
  seed(f.wA, f.channelA, lib.DESCRIPTION_PUBLISH_DAILY_LIMIT - 1);
  const last = await publish(f, f.owner);
  assert.equal(last.status, 200, "the 20th is allowed");
  f.videos.get(VIDEO)!.description = "Old description";
  const over = await publish(f, f.owner);
  assert.equal(over.status, 429);
  assert.equal(over.body.error, "DAILY_LIMIT_REACHED");
  assert.equal(f.updates.length, 1, "the 21st never reaches YouTube");
});

// ---------- shared rules ----------

test("description rules: bytes, not characters; no angle brackets; not blank", () => {
  assert.equal(lib.descriptionProblem("Hello"), null);
  assert.equal(lib.descriptionProblem("a".repeat(5000)), null);
  assert.equal(lib.descriptionProblem("a".repeat(5001)), "TOO_LONG");
  assert.equal(lib.descriptionProblem("😀".repeat(1250)), null, "1,250 emoji = 5,000 bytes");
  assert.equal(lib.descriptionProblem("😀".repeat(1251)), "TOO_LONG");
  assert.equal(lib.descriptionProblem("a > b"), "ANGLE_BRACKETS");
  assert.equal(lib.descriptionProblem("\n \t"), "EMPTY");
  assert.deepEqual(lib.DESCRIPTION_PUBLISH_ROLES, ["owner", "manager", "editor"]);
  assert.equal(lib.canPublishDescription("setter"), false);
  assert.equal(lib.canPublishDescription(null), false);
});

test("status badges for listed uploads", () => {
  const v = lib.videoVisibility;
  assert.equal(v({ privacyStatus: "public" }), "public");
  assert.equal(v({ privacyStatus: "unlisted" }), "unlisted");
  assert.equal(v({ privacyStatus: "private" }), "private");
  assert.equal(v({ privacyStatus: "private", publishAt: "2026-12-01T10:00:00Z" }), "scheduled");
  assert.equal(v({ privacyStatus: "private", uploadStatus: "uploaded" }), "processing");
  assert.equal(lib.hasNoDescription({ description: "  " }), true);
  assert.equal(lib.hasNoDescription({ description: null }), true);
  assert.equal(lib.hasNoDescription({ description: "x" }), false);
});

test("with every upload listed, the count line does not compare against YouTube's public count", () => {
  assert.deepEqual(
    videosCountLine({
      shown: 7,
      loaded: 7,
      hasMore: false,
      channelVideoCount: 5,
      searching: false,
      allUploads: true,
    }),
    { text: "7 videos", hint: null },
  );
  assert.deepEqual(
    videosCountLine({
      shown: 50,
      loaded: 50,
      hasMore: true,
      channelVideoCount: 40,
      searching: false,
      allUploads: true,
    }),
    { text: "50 videos loaded", hint: null },
  );
});

// ---------- opening a non-public upload in the lab ----------

const analyzeRoute = await import("../src/routes/api.youtube.analyze-video");

test("the lab opens the channel's own private upload, but never someone else's non-public video", async () => {
  const f = await fixture();
  f.world.videos = [];
  f.world.transcripts = [];
  const privacy: Record<string, { channelId: string; privacyStatus: string }> = {
    ownPrivate0: { channelId: YT_A, privacyStatus: "private" },
    theirUnlist: { channelId: YT_B, privacyStatus: "unlisted" },
  };
  f.world.external = (url) => {
    if (url.pathname !== "/youtube/v3/videos") return undefined;
    const id = url.searchParams.get("id") ?? "";
    const v = privacy[id];
    return Response.json({
      items: v
        ? [
            {
              id,
              snippet: { title: id, channelId: v.channelId },
              status: { privacyStatus: v.privacyStatus },
            },
          ]
        : [],
    });
  };
  const open = (videoId: string) =>
    callTeamApi(analyzeRoute, f.world, {
      as: f.owner,
      method: "GET",
      path: "/api/youtube/analyze-video",
      query: `?videoId=${videoId}&channelId=${f.channelA}`,
    });
  const own = await open("ownPrivate0");
  assert.equal(own.status, 200, own.text);
  const theirs = await open("theirUnlist");
  assert.equal(theirs.status, 422);
  assert.equal(theirs.body.error, "YOUTUBE_VIDEO_NOT_PUBLIC");
});

const aiAnalyzeRoute = await import("../src/routes/api.ai.analyze-video");

test("Analyze Video may analyze the channel's own private upload, never someone else's non-public video", async () => {
  const f = await fixture();
  const privacy: Record<string, { channelId: string; privacyStatus: string }> = {
    ownPrivate0: { channelId: YT_A, privacyStatus: "private" },
    theirUnlist: { channelId: YT_B, privacyStatus: "unlisted" },
  };
  f.world.external = (url) => {
    if (url.pathname !== "/youtube/v3/videos") return undefined;
    const id = url.searchParams.get("id") ?? "";
    const v = privacy[id];
    return Response.json({
      items: v
        ? [
            {
              id,
              snippet: { title: id, channelId: v.channelId },
              status: { privacyStatus: v.privacyStatus },
            },
          ]
        : [],
    });
  };
  const analyze = (videoId: string) =>
    callTeamApi(aiAnalyzeRoute, f.world, {
      as: f.owner,
      method: "POST",
      path: "/api/ai/analyze-video",
      body: { videoId, channelId: f.channelA },
    });
  const theirs = await analyze("theirUnlist");
  assert.equal(theirs.status, 422);
  assert.equal(theirs.body.error, "YOUTUBE_VIDEO_NOT_PUBLIC");
  // The own upload gets past the privacy check (what happens next — analytics, AI — is out of
  // scope here and not configured in this test).
  const own = await analyze("ownPrivate0");
  assert.notEqual(own.body.error, "YOUTUBE_VIDEO_NOT_PUBLIC");
});

// ---------- titles, tags, and several fields at once ----------

test("publishing a title changes only the title; description, tags and category are sent back", async () => {
  const f = await fixture();
  const result = await publish(f, f.editor, { changes: { title: "  A better title  " } });
  assert.equal(result.status, 200, result.text);
  assert.deepEqual(f.updates[0].snippet, {
    title: "A better title",
    description: "Old description",
    categoryId: "22",
    tags: ["one", "two"],
    defaultLanguage: "en",
  });
  const [event] = audit(f);
  assert.deepEqual((event.metadata as Row).fields, ["title"]);
  assert.deepEqual((event.metadata as Row).previous, { title: "My title" });
});

test("publishing tags sends them cleaned (trimmed, no blanks, no duplicates) and keeps the rest", async () => {
  const f = await fixture();
  const result = await publish(f, f.owner, {
    changes: { tags: [" cooking ", "Cooking", "", "meal prep", "one"] },
  });
  assert.equal(result.status, 200, result.text);
  assert.deepEqual(f.updates[0].snippet.tags, ["cooking", "meal prep", "one"]);
  assert.equal(f.updates[0].snippet.title, "My title");
  assert.equal(f.updates[0].snippet.description, "Old description");
});

test("titles and tags YouTube would refuse are refused first, with no YouTube request", async () => {
  const f = await fixture();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ title: "   " }, "TITLE_EMPTY"],
    [{ title: "x".repeat(101) }, "TITLE_TOO_LONG"],
    [{ title: "a <b>" }, "TITLE_ANGLE_BRACKETS"],
    [{ tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`) }, "TAGS_TOO_LONG"],
    [{ tags: ["ok", "<script>"] }, "TAGS_ANGLE_BRACKETS"],
    [{}, "NOTHING_TO_PUBLISH"],
  ];
  for (const [changes, code] of cases) {
    const result = await publish(f, f.owner, { changes });
    assert.equal(result.status, 422, code);
    assert.equal(result.body.error, code);
    assertUntouched(f, result, code);
  }
  const unknownField = await publish(f, f.owner, { changes: { categoryId: "10" } });
  assert.equal(unknownField.status, 422, "only title, description and tags can be changed");
  assert.equal(unknownField.body.error, "VALIDATION_ERROR");
  assert.deepEqual(f.youtube, []);
});

test("a title or tag edit made in Studio blocks a description publish too", async () => {
  const f = await fixture();
  const stale = { title: "My title", description: "Old description", tags: ["one", "two"] };
  f.videos.get(VIDEO)!.tags = ["one", "two", "studio"];
  const result = await post(f, f.owner, {
    action: "publish",
    channelId: f.channelA,
    videoId: VIDEO,
    changes: { description: "New description" },
    expected: stale,
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "CHANGED_ON_YOUTUBE");
  assert.equal(f.updates.length, 0);
  assert.deepEqual(f.videos.get(VIDEO)!.tags, ["one", "two", "studio"]);
});

test("undo of a title-and-tags publish restores both, and only over exactly what was written", async () => {
  const f = await fixture();
  const published = await publish(f, f.owner, {
    changes: { title: "New title", tags: ["fresh"] },
  });
  assert.equal(published.status, 200, published.text);
  assert.equal(f.videos.get(VIDEO)!.title, "New title");

  // Someone renames it in Studio: undo must not put the old title over that.
  f.videos.get(VIDEO)!.title = "Studio title";
  const blocked = await undo(f, f.owner, "Old description");
  assert.equal(blocked.status, 409);
  assert.equal(f.videos.get(VIDEO)!.title, "Studio title");

  f.videos.get(VIDEO)!.title = "New title";
  const restored = await undo(f, f.owner, "Old description");
  assert.equal(restored.status, 200, restored.text);
  assert.equal(f.videos.get(VIDEO)!.title, "My title");
  assert.deepEqual(f.videos.get(VIDEO)!.tags, ["one", "two"]);
  assert.equal(f.videos.get(VIDEO)!.description, "Old description");
});

test("a description published before titles and tags existed can still be undone", async () => {
  const f = await fixture();
  const { createHash } = await import("node:crypto");
  f.videos.get(VIDEO)!.description = "Published yesterday";
  audit(f).push({
    id: uuid(),
    user_id: f.owner,
    action: "youtube_description.published",
    resource_type: "youtube_video_description",
    resource_id: f.channelA,
    metadata: {
      workspaceId: f.wA,
      videoId: VIDEO,
      previousDescription: "Old description",
      newDescriptionSha256: createHash("sha256").update("Published yesterday").digest("hex"),
    },
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const s = await status(f, f.owner);
  assert.equal((s.body.data as Row).undoAvailable, true);
  const result = await undo(f, f.owner, "Published yesterday");
  assert.equal(result.status, 200, result.text);
  assert.equal(f.videos.get(VIDEO)!.description, "Old description");
});

// ---------- chapters and calls to action (published inside the description) ----------

test("chapter rules follow YouTube's: 0:00 first, at least 3, in order, 10 seconds each", () => {
  const ok = lib.parseChapters("0:00 Intro\n1:15 - Setup\n1:02:03 Wrap up", 4000);
  assert.equal(ok.problem, null);
  assert.deepEqual(
    ok.chapters.map((c) => c.seconds),
    [0, 75, 3723],
  );
  assert.equal(lib.parseChapters("0:00 A\n0:30 B", null).problem, "CHAPTERS_TOO_FEW");
  assert.equal(
    lib.parseChapters("0:05 A\n0:30 B\n1:00 C", null).problem,
    "CHAPTERS_FIRST_NOT_ZERO",
  );
  assert.equal(lib.parseChapters("0:00 A\n1:00 B\n0:30 C", null).problem, "CHAPTERS_OUT_OF_ORDER");
  assert.equal(lib.parseChapters("0:00 A\n0:05 B\n1:00 C", null).problem, "CHAPTERS_TOO_SHORT");
  assert.equal(lib.parseChapters("0:00 A\n0:30 B\n9:00 C", 120).problem, "CHAPTERS_PAST_END");
  assert.equal(
    lib.parseChapters("0:00 A\nnot a chapter\n1:00 C", null).problem,
    "CHAPTERS_BAD_LINE",
  );
  assert.equal(lib.parseChapterLine("0:75 Nope"), null);
  assert.equal(lib.chaptersBlock(ok.chapters), "00:00 Intro\n01:15 Setup\n1:02:03 Wrap up");
});

test("publishing chapters replaces the description's chapter list in place, or adds one", () => {
  const block = "00:00 Intro\n02:00 Middle\n05:00 End";
  assert.equal(
    lib.descriptionWithChapters("About this video.\n\nLinks below", block),
    `About this video.\n\nLinks below\n\n${block}`,
  );
  assert.equal(
    lib.descriptionWithChapters(
      "Top\n\n0:00 Old intro\n1:00 Old part\n3:00 Old end\n\nFooter",
      block,
    ),
    `Top\n\n${block}\n\nFooter`,
    "the rest of the description is kept",
  );
  assert.equal(lib.descriptionWithChapters("", block), block);
});

test("a call to action is added at the end once", () => {
  assert.equal(
    lib.descriptionWithCallToAction("Body\n", "Subscribe for more"),
    "Body\n\nSubscribe for more",
  );
  assert.equal(
    lib.descriptionWithCallToAction("Body\n\nSubscribe for more", "Subscribe for more"),
    "Body\n\nSubscribe for more",
  );
});

test("tag length is counted as YouTube counts it", () => {
  assert.equal(lib.tagsLength([]), 0);
  assert.equal(lib.tagsLength(["abc", "de"]), 6, "3 + 2 + 1 comma");
  assert.equal(lib.tagsLength(["meal prep"]), 11, "9 + 2 quotes for a tag with a space");
  assert.deepEqual(lib.cleanTags([" a ", "A", "b  c", ""]), ["a", "b c"]);
  assert.equal(lib.titleProblem("x".repeat(100)), null);
  assert.equal(lib.titleProblem("😀".repeat(100)), null, "characters, not bytes");
});

test("chapters are only suggested from a transcript that carries its own timestamps", async () => {
  const { transcriptHasTimestamps } = await import("../src/lib/server/ai-generation");
  assert.equal(transcriptHasTimestamps("Just words with no timing at all."), false);
  assert.equal(transcriptHasTimestamps(null), false);
  assert.equal(transcriptHasTimestamps("0:00 hi\n0:42 so\n[01:30] then\nmore"), true);
  assert.equal(transcriptHasTimestamps("At 3:00 we start\nnothing else"), false);
});
