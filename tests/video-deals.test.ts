import {
  addMember,
  addUser,
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
  allocateEqualCents,
  centsToAmount,
  inAllocationOrder,
  toCents,
  MAX_DEAL_CENTS,
} from "../src/lib/server/video-deals";

// Phase 2B-2: brand deals linked to videos, and the contracted value attributed to each video.
// The real route handlers run against the in-memory database (helpers/team-fake-api.ts), which
// behaves like Postgres after the column-privacy migrations: a member's session that names a
// deal's value, or writes a deal or a link, is refused. The database's own workspace-integrity
// triggers on deal_videos were verified separately on a disposable Postgres.

const routes = {
  deals: await import("../src/routes/api.videos.deals"),
  revenueVideos: await import("../src/routes/api.revenue.videos"),
  linkActivity: await import("../src/routes/api.videos.link-activity"),
};

const YT = { a: "vidAAAAAAA1", b: "vidAAAAAAA2", c: "vidAAAAAAA3", other: "vidOTHER001" };
const UNKNOWN_YT = "vidUNKNOWN1";

type Who = "owner" | "manager" | "editor" | "setter" | "staffEditor" | "stranger";

function fixture(flags: { editor?: boolean; setter?: boolean } = {}) {
  const world: World = { ...emptyWorld(), protectMoney: true };
  world.features.push(
    { id: "feature-deals", key: "brand_deals", is_active: true },
    { id: "feature-links", key: "link_tracking", is_active: true },
  );
  const users: Record<Who, string> = {
    owner: addUser(world, "owner@x.test"),
    manager: addUser(world, "manager@x.test"),
    editor: addUser(world, "editor@x.test"),
    setter: addUser(world, "setter@x.test"),
    staffEditor: addUser(world, "staff@x.test", "superadmin"),
    stranger: addUser(world, "stranger@x.test"),
  };
  const ws = addWorkspace(world, users.owner);
  addMember(world, ws, users.manager, "manager");
  addMember(world, ws, users.editor, "editor");
  addMember(world, ws, users.setter, "setter");
  addMember(world, ws, users.staffEditor, "editor");
  Object.assign(
    world.workspaces.find((w) => w.id === ws)!,
    {
      editor_revenue_visible: flags.editor ?? false,
      setter_revenue_visible: flags.setter ?? false,
    },
  );
  const otherWs = addWorkspace(world, users.stranger);
  Object.assign(
    world.workspaces.find((w) => w.id === otherWs)!,
    {
      editor_revenue_visible: false,
      setter_revenue_visible: false,
    },
  );

  const channel = { a: uuid(), b: uuid(), other: uuid() };
  world.youtube_channels = [
    { id: channel.a, workspace_id: ws, youtube_channel_id: "UCa", channel_name: "A" },
    { id: channel.b, workspace_id: ws, youtube_channel_id: "UCb", channel_name: "B" },
    { id: channel.other, workspace_id: otherWs, youtube_channel_id: "UCo", channel_name: "O" },
  ];
  const video = { a: uuid(), b: uuid(), c: uuid(), other: uuid() };
  const videoRow = (id: string, channelId: string, yt: string) => ({
    id,
    channel_id: channelId,
    youtube_video_id: yt,
    title: yt,
    thumbnail: null,
    published_at: "2026-01-01T00:00:00Z",
    status: "active",
  });
  world.videos = [
    videoRow(video.a, channel.a, YT.a),
    videoRow(video.b, channel.a, YT.b),
    videoRow(video.c, channel.b, YT.c),
    videoRow(video.other, channel.other, YT.other),
  ];
  const deal = { usd: uuid(), eur: uuid(), pipeline: uuid(), zero: uuid(), other: uuid() };
  const dealRow = (
    id: string,
    workspaceId: string,
    name: string,
    stage: string,
    value: string,
    currency = "USD",
  ) => ({
    id,
    workspace_id: workspaceId,
    user_id: users.owner,
    name,
    stage,
    value,
    currency,
    created_at: "2026-09-01T00:00:00Z",
  });
  world.deals = [
    dealRow(deal.usd, ws, "Acme sponsorship", "contracted", "100.00"),
    dealRow(deal.eur, ws, "Euro brand", "completed", "250.00", "EUR"),
    dealRow(deal.pipeline, ws, "Maybe brand", "negotiating", "999.00"),
    dealRow(deal.zero, ws, "Gifted product", "contracted", "0.00"),
    dealRow(deal.other, otherWs, "Their deal", "contracted", "777.00"),
  ];
  world.deal_videos = [];
  return { world, users, ws, otherWs, channel, video, deal };
}
type Fixture = ReturnType<typeof fixture>;

let clock = Date.UTC(2026, 9, 1);
/** A link row as the database would hold it, created at increasing instants. */
function seedLink(f: Fixture, dealId: string, videoId: string, workspaceId = f.ws, at?: string) {
  clock += 1000;
  f.world.deal_videos!.push({
    deal_id: dealId,
    video_id: videoId,
    workspace_id: workspaceId,
    created_by: f.users.owner,
    created_at: at ?? new Date(clock).toISOString().replace("Z", "000+00:00"),
  });
}

const get = (f: Fixture, who: Who, yt: string) =>
  callTeamApi(routes.deals, f.world, {
    as: f.users[who],
    method: "GET",
    path: "/api/videos/deals",
    query: `?videoId=${yt}`,
  });
const link = (f: Fixture, who: Who, body: unknown) =>
  callTeamApi(routes.deals, f.world, {
    as: f.users[who],
    method: "POST",
    path: "/api/videos/deals",
    body,
  });
const unlink = (f: Fixture, who: Who, query: string) =>
  callTeamApi(routes.deals, f.world, {
    as: f.users[who],
    method: "DELETE",
    path: "/api/videos/deals",
    query,
  });

type DealView = {
  id: string;
  name: string;
  stage: string;
  currency: string;
  linkedVideoCount: number;
  dealValue: number | null;
  attribution: { status: string; amount?: number };
};
const dealsOf = (result: CallResult) => (result.body.data as { deals: DealView[] }).deals;
const totalsOf = (result: CallResult) =>
  (result.body.data as { contractedByCurrency: unknown }).contractedByCurrency;
const byId = (result: CallResult, id: string) => dealsOf(result).find((d) => d.id === id)!;
const tablesRead = (result: CallResult) => new Set(result.reads.map((r) => String(r.table)));

// ============================================================
// Allocation (pure)
// ============================================================

const at = (n: number) => `2026-10-01T00:00:0${n}.000000+00:00`;

test("allocation: equal split in integer cents, remainder to the earliest-linked videos", () => {
  const links = [
    { video_id: "v-c", created_at: at(3) },
    { video_id: "v-a", created_at: at(1) },
    { video_id: "v-b", created_at: at(2) },
  ];
  assert.deepEqual(
    [...allocateEqualCents(10000, links)],
    [
      ["v-a", 3334],
      ["v-b", 3333],
      ["v-c", 3333],
    ],
  );
  assert.deepEqual([...allocateEqualCents(1, links).values()], [1, 0, 0]);
  assert.deepEqual([...allocateEqualCents(2, links).values()], [1, 1, 0]);
  assert.deepEqual([...allocateEqualCents(0, links).values()], [0, 0, 0]);
  assert.deepEqual([...allocateEqualCents(555, [links[0]])], [["v-c", 555]]);
  assert.equal(allocateEqualCents(100, []).size, 0);
  assert.throws(() => allocateEqualCents(-1, links));
  assert.throws(() => allocateEqualCents(1.5, links));
});

test("allocation: the order is fixed by link time (to the microsecond), then video id — never by input order", () => {
  const sameMs = [
    { video_id: "v-2", created_at: "2026-10-01T00:00:00.123457+00:00" },
    { video_id: "v-1", created_at: "2026-10-01T00:00:00.123456+00:00" },
    { video_id: "v-0", created_at: "2026-10-01T00:00:00.123457+00:00" },
  ];
  assert.deepEqual(
    inAllocationOrder(sameMs).map((l) => l.video_id),
    ["v-1", "v-0", "v-2"],
  );
  for (let shuffle = 0; shuffle < 6; shuffle++) {
    const input = [...sameMs].sort(() => (shuffle % 2 ? 1 : -1));
    assert.deepEqual([...allocateEqualCents(100, input)].sort(), [
      ["v-0", 33],
      ["v-1", 34],
      ["v-2", 33],
    ]);
  }
});

test("allocation: shares always add up exactly to the deal, for every supported value", () => {
  const values = [
    0,
    1,
    2,
    99,
    100,
    101,
    12_345,
    999_999,
    10_000_000_01,
    MAX_DEAL_CENTS,
    MAX_DEAL_CENTS - 1,
  ];
  for (let n = 1; n <= 13; n++) {
    const links = Array.from({ length: n }, (_, i) => ({
      video_id: `v-${String(i).padStart(2, "0")}`,
      created_at: at(i % 10),
    }));
    for (const cents of values) {
      const shares = [...allocateEqualCents(cents, links).values()];
      assert.equal(shares.length, n);
      assert.equal(
        shares.reduce((a, b) => a + b, 0),
        cents,
        `${cents} over ${n}`,
      );
      assert.ok(
        Math.max(...shares) - Math.min(...shares) <= 1,
        `${cents} over ${n}: equal within a cent`,
      );
      assert.ok(shares.every(Number.isSafeInteger));
    }
  }
  // Pseudo-random values across the whole supported range.
  let seed = 7;
  for (let i = 0; i < 2000; i++) {
    seed = (seed * 48271) % 2147483647;
    const cents = Math.floor((seed / 2147483647) * MAX_DEAL_CENTS);
    const n = 1 + (seed % 25);
    const links = Array.from({ length: n }, (_, k) => ({
      video_id: `v${k}`,
      created_at: at(k % 10),
    }));
    const total = [...allocateEqualCents(cents, links).values()].reduce((a, b) => a + b, 0);
    assert.equal(total, cents);
  }
});

test("money: stored values become exact integer cents; anything that is not an amount is refused, not guessed", () => {
  assert.equal(toCents("100.00"), 10000);
  assert.equal(toCents("0.10"), 10);
  assert.equal(toCents("0.07"), 7);
  assert.equal(toCents(5555), 555500);
  assert.equal(toCents("1234567.89"), 123456789);
  assert.equal(toCents("100000000.00"), MAX_DEAL_CENTS);
  assert.equal(toCents("999999999999.99"), 99_999_999_999_999);
  assert.equal(toCents("0"), 0);
  for (const bad of [null, undefined, "", "abc", "-1", -0.01, Number.NaN, Infinity, "1e15"])
    assert.equal(toCents(bad), null, String(bad));
  assert.equal(centsToAmount(3334), 33.34);
  assert.equal(centsToAmount(1), 0.01);
  assert.equal(centsToAmount(MAX_DEAL_CENTS), 100_000_000);
});

// ============================================================
// Reading
// ============================================================

test("a video with no deals, an unknown video and another workspace's video all get the same answer", async () => {
  const f = fixture();
  seedLink(f, f.deal.other, f.video.other, f.otherWs);
  const own = await get(f, "owner", YT.b);
  const unknown = await get(f, "owner", UNKNOWN_YT);
  const theirs = await get(f, "owner", YT.other);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body, {
    data: {
      deals: [],
      contractedByCurrency: [],
      payments: { tracked: false },
      period: { filtered: false },
    },
    visibility: { revenue: "visible" },
    permissions: { canLink: true },
  });
  assert.equal(unknown.text, own.text);
  assert.equal(theirs.text, own.text);
  assert.ok(!theirs.text.includes("Their deal") && !theirs.text.includes("777"));
});

test("one deal on three videos: each video gets its share, the shares add up, the earliest-linked gets the extra cent", async () => {
  const f = fixture();
  seedLink(f, f.deal.usd, f.video.c);
  seedLink(f, f.deal.usd, f.video.a);
  seedLink(f, f.deal.usd, f.video.b);
  const shares = [];
  for (const [yt] of [[YT.c], [YT.a], [YT.b]]) {
    const result = await get(f, "owner", yt);
    assert.equal(result.status, 200);
    const view = byId(result, f.deal.usd);
    assert.equal(view.linkedVideoCount, 3);
    assert.equal(view.dealValue, 100);
    assert.equal(view.attribution.status, "contracted");
    shares.push(view.attribution.amount);
  }
  assert.deepEqual(shares, [33.34, 33.33, 33.33]);
  assert.equal(Math.round(shares.reduce((a, b) => a + b!, 0)! * 100), 10000);
});

test("several deals on one video: pipeline deals are listed without an amount; currencies are never combined", async () => {
  const f = fixture();
  seedLink(f, f.deal.usd, f.video.a);
  seedLink(f, f.deal.eur, f.video.a);
  seedLink(f, f.deal.pipeline, f.video.a);
  seedLink(f, f.deal.zero, f.video.a);
  seedLink(f, f.deal.usd, f.video.b);
  const result = await get(f, "owner", YT.a);
  assert.equal(result.status, 200);
  assert.deepEqual(
    dealsOf(result).map((d) => [d.name, d.stage, d.currency, d.dealValue, d.attribution]),
    [
      ["Acme sponsorship", "contracted", "USD", 100, { status: "contracted", amount: 50 }],
      ["Euro brand", "completed", "EUR", 250, { status: "contracted", amount: 250 }],
      ["Maybe brand", "negotiating", "USD", 999, { status: "not_contracted" }],
      ["Gifted product", "contracted", "USD", 0, { status: "contracted", amount: 0 }],
    ],
  );
  assert.deepEqual(totalsOf(result), [
    { currency: "EUR", amount: 250, dealCount: 1 },
    { currency: "USD", amount: 50, dealCount: 2 },
  ]);
  // Agreed, not received: nothing in the answer claims a payment.
  assert.deepEqual((result.body.data as Record<string, unknown>).payments, { tracked: false });
  assert.doesNotMatch(result.text, /received|paid|earned|revenue_?amount/i);
});

test("restricted members see names and stages, never an amount — hidden, not zero", async () => {
  const f = fixture();
  seedLink(f, f.deal.usd, f.video.a);
  seedLink(f, f.deal.pipeline, f.video.a);
  seedLink(f, f.deal.zero, f.video.a);
  for (const who of ["editor", "setter"] as const) {
    const result = await get(f, who, YT.a);
    assert.equal(result.status, 200, who);
    assert.deepEqual(result.body.visibility, { revenue: "hidden" });
    assert.deepEqual(result.body.permissions, { canLink: false });
    assert.deepEqual(
      dealsOf(result).map((d) => [d.name, d.stage, d.dealValue, d.attribution]),
      [
        ["Acme sponsorship", "contracted", null, { status: "hidden" }],
        ["Maybe brand", "negotiating", null, { status: "not_contracted" }],
        ["Gifted product", "contracted", null, { status: "hidden" }],
      ],
    );
    assert.equal(totalsOf(result), null);
    assert.doesNotMatch(
      result.text,
      /"amount"|"dealValue":\d|:100\b|:999\b|"contractedByCurrency":\[/,
    );
    // The value was never asked for on the member's session, nor read at all.
    assert.deepEqual(result.refusedMoneyReads, []);
    assert.ok(!result.reads.some((r) => String(r.body).includes("value")), who);
  }
});

test("who sees amounts follows revenue visibility: owner, manager, staff, and editors/setters only when allowed", async () => {
  const hidden = fixture();
  seedLink(hidden, hidden.deal.usd, hidden.video.a);
  for (const who of ["owner", "manager", "staffEditor"] as const)
    assert.equal(byId(await get(hidden, who, YT.a), hidden.deal.usd).dealValue, 100, who);
  const allowed = fixture({ editor: true, setter: true });
  seedLink(allowed, allowed.deal.usd, allowed.video.a);
  for (const who of ["editor", "setter"] as const) {
    const result = await get(allowed, who, YT.a);
    assert.equal(byId(result, allowed.deal.usd).attribution.amount, 100, who);
    assert.deepEqual(result.body.permissions, { canLink: true });
  }
});

test("without the brand_deals feature nothing is read, for any method", async () => {
  const f = fixture();
  f.world.role_feature_access.push({ role: "editor", feature_id: "feature-deals", enabled: false });
  const calls = [
    await get(f, "editor", YT.a),
    await link(f, "editor", { videoId: YT.a, dealId: f.deal.usd }),
    await unlink(f, "editor", `?videoId=${YT.a}&dealId=${f.deal.usd}`),
  ];
  for (const result of calls) {
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "FEATURE_DISABLED" });
    assert.ok(!["deals", "deal_videos", "videos"].some((t) => tablesRead(result).has(t)));
    assert.deepEqual(result.writes, []);
  }
  f.world.features.find((x) => x.key === "brand_deals")!.is_active = false;
  assert.equal((await get(f, "owner", YT.a)).status, 403);
  // Signed out.
  const out = await callTeamApi(routes.deals, f.world, {
    as: null,
    method: "GET",
    path: "/api/videos/deals",
    query: `?videoId=${YT.a}`,
  });
  assert.equal(out.status, 401);
});

test("validation: malformed ids and bodies are refused before anything is read or written", async () => {
  const f = fixture();
  for (const yt of ["", "short", "vidAAAAAAA1x", "vid%27OR%271", "../../etc"]) {
    const result = await get(f, "owner", yt);
    assert.equal(result.status, 422, yt);
    assert.ok(!tablesRead(result).has("deal_videos"));
  }
  const bodies = [
    {},
    { videoId: YT.a },
    { dealId: f.deal.usd },
    { videoId: YT.a, dealId: "not-a-uuid" },
    { videoId: "bad", dealId: f.deal.usd },
    { videoId: YT.a, dealId: f.deal.usd, workspaceId: f.otherWs },
    { videoId: YT.a, dealId: f.deal.usd, workspace_id: f.otherWs },
    { videoId: YT.a, dealId: f.deal.usd, share: 100 },
    [{ videoId: YT.a, dealId: f.deal.usd }],
  ];
  for (const body of bodies) {
    const result = await link(f, "owner", body);
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.deepEqual(result.writes, []);
  }
  const notJson = await callTeamApi(routes.deals, f.world, {
    as: f.users.owner,
    method: "POST",
    path: "/api/videos/deals",
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(notJson.status, 400);
  for (const query of [
    "",
    `?videoId=${YT.a}`,
    `?dealId=${f.deal.usd}`,
    `?videoId=bad&dealId=${f.deal.usd}`,
  ]) {
    const result = await unlink(f, "owner", query);
    assert.equal(result.status, 422, query);
    assert.deepEqual(result.writes, []);
  }
  assert.equal(f.world.deal_videos!.length, 0);
});

// ============================================================
// Linking and unlinking
// ============================================================

test("linking: written with the service role, in the caller's own workspace, as the caller — and answered with the refreshed view", async () => {
  const f = fixture();
  const first = await link(f, "owner", { videoId: YT.a, dealId: f.deal.usd });
  assert.equal(first.status, 201);
  assert.deepEqual(
    first.writes.map((w) => [w.method, w.table, w.as]),
    [["POST", "deal_videos", "service"]],
  );
  assert.equal(f.world.deal_videos!.length, 1);
  const row = f.world.deal_videos![0];
  assert.deepEqual(
    [row.deal_id, row.video_id, row.workspace_id, row.created_by],
    [f.deal.usd, f.video.a, f.ws, f.users.owner],
  );
  assert.deepEqual(
    dealsOf(first).map((d) => [d.id, d.attribution]),
    [[f.deal.usd, { status: "contracted", amount: 100 }]],
  );
  assert.deepEqual(first.body.permissions, { canLink: true });

  // A second video halves the share on both.
  const second = await link(f, "manager", { videoId: YT.c, dealId: f.deal.usd });
  assert.equal(second.status, 201);
  assert.equal(byId(second, f.deal.usd).attribution.amount, 50);
  assert.equal(byId(await get(f, "owner", YT.a), f.deal.usd).attribution.amount, 50);
});

test("linking twice changes nothing and is not an error", async () => {
  const f = fixture();
  assert.equal((await link(f, "owner", { videoId: YT.a, dealId: f.deal.usd })).status, 201);
  const again = await link(f, "owner", { videoId: YT.a, dealId: f.deal.usd });
  assert.equal(again.status, 200);
  assert.equal(f.world.deal_videos!.length, 1);
  assert.equal(dealsOf(again).length, 1);
});

test("unlinking re-splits the remaining videos; unlinking again is harmless", async () => {
  const f = fixture();
  seedLink(f, f.deal.usd, f.video.a);
  seedLink(f, f.deal.usd, f.video.b);
  seedLink(f, f.deal.usd, f.video.c);
  assert.equal(byId(await get(f, "owner", YT.a), f.deal.usd).attribution.amount, 33.34);
  const removed = await unlink(f, "owner", `?videoId=${YT.c}&dealId=${f.deal.usd}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.removed, true);
  assert.deepEqual(dealsOf(removed), []);
  assert.deepEqual(
    removed.writes.map((w) => [w.method, w.table, w.as]),
    [["DELETE", "deal_videos", "service"]],
  );
  assert.equal(byId(await get(f, "owner", YT.a), f.deal.usd).attribution.amount, 50);
  assert.equal(byId(await get(f, "owner", YT.b), f.deal.usd).attribution.amount, 50);
  const again = await unlink(f, "owner", `?videoId=${YT.c}&dealId=${f.deal.usd}`);
  assert.equal(again.status, 200);
  assert.equal(again.body.removed, false);
  assert.equal(f.world.deal_videos!.length, 2);
});

test("restricted members cannot link or unlink: refused before the body is read, nothing looked up or written", async () => {
  const f = fixture();
  seedLink(f, f.deal.usd, f.video.a);
  for (const who of ["editor", "setter"] as const) {
    const results = [
      await link(f, who, { videoId: YT.b, dealId: f.deal.usd }),
      await link(f, who, { not: "even valid" }),
      await unlink(f, who, `?videoId=${YT.a}&dealId=${f.deal.usd}`),
    ];
    for (const result of results) {
      assert.equal(result.status, 403, who);
      assert.equal(result.body.error, "REVENUE_HIDDEN");
      assert.deepEqual(result.writes, []);
      assert.ok(
        !["deals", "deal_videos", "videos", "youtube_channels"].some((t) =>
          tablesRead(result).has(t),
        ),
      );
    }
  }
  assert.equal(f.world.deal_videos!.length, 1);
});

test("another workspace's deal or video cannot be linked or unlinked — the same 404 as one that does not exist", async () => {
  const f = fixture();
  seedLink(f, f.deal.other, f.video.other, f.otherWs);
  const attempts = [
    [await link(f, "owner", { videoId: YT.a, dealId: f.deal.other }), "DEAL_NOT_FOUND"],
    [await link(f, "owner", { videoId: YT.a, dealId: uuid() }), "DEAL_NOT_FOUND"],
    [await link(f, "owner", { videoId: YT.other, dealId: f.deal.usd }), "VIDEO_NOT_FOUND"],
    [await link(f, "owner", { videoId: UNKNOWN_YT, dealId: f.deal.usd }), "VIDEO_NOT_FOUND"],
    [await unlink(f, "owner", `?videoId=${YT.other}&dealId=${f.deal.other}`), "DEAL_NOT_FOUND"],
    [await unlink(f, "owner", `?videoId=${YT.other}&dealId=${f.deal.usd}`), "VIDEO_NOT_FOUND"],
    [await link(f, "stranger", { videoId: YT.a, dealId: f.deal.usd }), "DEAL_NOT_FOUND"],
    [await link(f, "stranger", { videoId: YT.a, dealId: f.deal.other }), "VIDEO_NOT_FOUND"],
  ] as const;
  for (const [result, error] of attempts) {
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error });
    assert.deepEqual(result.writes, []);
  }
  // Their link is untouched, and nothing of ours was created.
  assert.deepEqual(
    f.world.deal_videos!.map((l) => [l.deal_id, l.video_id]),
    [[f.deal.other, f.video.other]],
  );
});

test("the database's own refusal (a concurrent move, a deleted deal) is a 409; any other write failure a 500 with no figures", async () => {
  for (const code of ["23514", "23503"]) {
    const f = fixture();
    f.world.refuseWrites = { deal_videos: code };
    const result = await link(f, "owner", { videoId: YT.a, dealId: f.deal.usd });
    assert.equal(result.status, 409, code);
    assert.deepEqual(result.body, { error: "LINK_REFUSED" });
  }
  const f = fixture();
  f.world.refuseWrites = { deal_videos: "XX000" };
  const failed = await link(f, "owner", { videoId: YT.a, dealId: f.deal.usd });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: "DATABASE_ERROR" });
});

test("a failed read fails the request — never an empty or partial answer", async () => {
  for (const table of ["deal_videos", "deals", "videos", "youtube_channels"]) {
    const f = fixture();
    seedLink(f, f.deal.usd, f.video.a);
    f.world.failingReads = [table];
    const result = await get(f, "owner", YT.a);
    assert.equal(result.status, 500, table);
    assert.deepEqual(result.body, { error: "DATABASE_ERROR" });
  }
  // A value that is not an amount is a failure too, not a zero.
  const f = fixture();
  seedLink(f, f.deal.usd, f.video.a);
  f.world.deals!.find((d) => d.id === f.deal.usd)!.value = "not-a-number";
  const result = await get(f, "owner", YT.a);
  assert.equal(result.status, 500);
});

// ============================================================
// Completeness
// ============================================================

test("paging: a tiny API row cap truncates nothing — every linked video and every linked deal is counted", async () => {
  const f = fixture();
  f.world.maxRows = 2;
  // One deal on seven videos (one of them ours here, the others on our channels).
  const extraVideos = Array.from({ length: 6 }, (_, i) => {
    const id = uuid();
    f.world.videos!.push({
      id,
      channel_id: f.channel.a,
      youtube_video_id: `vidEXTRA00${i}`,
      title: "x",
    });
    return id;
  });
  seedLink(f, f.deal.usd, f.video.a);
  for (const id of extraVideos) seedLink(f, f.deal.usd, id);
  // And 130 more contracted deals on the same video (more than one chunk of ids).
  const many = Array.from({ length: 130 }, (_, i) => {
    const id = uuid();
    f.world.deals!.push({
      id,
      workspace_id: f.ws,
      user_id: f.users.owner,
      name: `Deal ${i}`,
      stage: "contracted",
      value: "10.00",
      currency: "USD",
    });
    seedLink(f, id, f.video.a);
    return id;
  });
  const result = await get(f, "owner", YT.a);
  assert.equal(result.status, 200);
  assert.equal(dealsOf(result).length, 131);
  const usd = byId(result, f.deal.usd);
  assert.equal(usd.linkedVideoCount, 7);
  assert.equal(usd.attribution.amount, 14.29); // 10000 cents / 7 → 1429 rem 1, ours linked first
  assert.ok(many.every((id) => byId(result, id).attribution.amount === 10));
  assert.deepEqual(totalsOf(result), [{ currency: "USD", amount: 1314.29, dealCount: 131 }]);
  // The six other videos' shares, read the same way, complete the deal exactly.
  let total = Math.round(usd.attribution.amount! * 100);
  for (let i = 0; i < 6; i++) {
    const other = await get(f, "owner", `vidEXTRA00${i}`);
    total += Math.round(byId(other, f.deal.usd).attribution.amount! * 100);
  }
  assert.equal(total, 10000);
});

// ============================================================
// Nothing else changes
// ============================================================

test("YouTube revenue and link activity answer exactly the same with deals linked", async () => {
  const f = fixture();
  const revenue = () =>
    callTeamApi(routes.revenueVideos, f.world, {
      as: f.users.owner,
      method: "GET",
      path: "/api/revenue/videos",
    });
  const activity = () =>
    callTeamApi(routes.linkActivity, f.world, {
      as: f.users.owner,
      method: "GET",
      path: "/api/videos/link-activity",
      query: `?videoId=${YT.a}&days=90`,
    });
  const before = [await revenue(), await activity()];
  await link(f, "owner", { videoId: YT.a, dealId: f.deal.usd });
  await link(f, "owner", { videoId: YT.a, dealId: f.deal.eur });
  const after = [await revenue(), await activity()];
  for (let i = 0; i < 2; i++) {
    assert.equal(after[i].status, before[i].status);
    // (Link activity states the moment it was asked: that alone may differ.)
    const stable = (text: string) => text.replace(/"to":"[^"]+"/, '"to":"now"');
    assert.equal(stable(after[i].text), stable(before[i].text));
    assert.ok(!after[i].reads.some((r) => r.table === "deal_videos"));
  }
});

test("source: feature gate on every method, amounts only through the MoneyReader, the service role only for the link writes", () => {
  const route = readFileSync("src/routes/api.videos.deals.ts", "utf8");
  const lib = readFileSync("src/lib/server/video-deals.ts", "utf8");
  assert.equal(route.match(/requireWorkspaceFeature\(request, "brand_deals"\)/g)?.length, 3);
  assert.equal(route.match(/if \(!access\.canWrite\)/g)?.length, 2);
  // The service client is used only for revenue access and the two writes.
  // (POST and DELETE only; GET never creates one.)
  assert.equal(route.match(/createServiceSupabaseClient\(\)/g)?.length, 2);
  assert.deepEqual([...route.matchAll(/\b(\w+)\([^()]*\bservice\b/g)].map((m) => m[1]).sort(), [
    "deleteDealVideoLink",
    "insertDealVideoLink",
    "resolveRevenueAccess",
    "resolveRevenueAccess",
  ]);
  assert.doesNotMatch(route, /service\s*\.from\(/);
  assert.match(lib, /\.from\("deal_videos"\)\s*\.upsert\(/);
  assert.match(lib, /\.from\("deal_videos"\)\s*\.delete\(\)/);
  // No query in the module names a deal's value; amounts come from access.money.
  assert.doesNotMatch(lib, /\.select\([^)]*\bvalue\b/);
  assert.match(lib, /access\.money\.dealValues\(/);
  // Every read is filtered by the workspace or confined to its channels.
  assert.equal(lib.match(/\.eq\("workspace_id", workspaceId\)/g)?.length, 5);
  // Nothing about payments is claimed.
  assert.doesNotMatch(route + lib, /"received"|"paid"|status: "paid"/);
});
