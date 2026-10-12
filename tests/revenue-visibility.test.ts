// Workspace revenue visibility: who may see money, exercised through the real route handlers
// against an in-memory database that behaves like production AFTER the column-privacy migrations
// (a member's session is refused any request naming a money column — see protectMoney in
// tests/helpers/team-fake-api.ts). So each case proves three things at once: the answer the
// caller gets, that no amount is in it, and that the application never even asked the database
// for one on the caller's behalf.
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
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = {
  summary: await import("../src/routes/api.revenue.summary"),
  videos: await import("../src/routes/api.revenue.videos"),
  deals: await import("../src/routes/api.deals"),
  reportsSummary: await import("../src/routes/api.reports.summary"),
  reportsExport: await import("../src/routes/api.reports.export"),
  visibility: await import("../src/routes/api.workspace.revenue-visibility"),
  members: await import("../src/routes/api.workspace.members"),
};
const policy = await import("../src/lib/revenue-visibility");
const views = {
  dashboard: await import("../src/lib/dashboard-revenue"),
  analytics: await import("../src/lib/analytics-revenue"),
  videos: await import("../src/lib/videos-revenue"),
};

// Distinctive amounts, so "does this figure appear anywhere in the response" is a real check.
const MONEY = {
  channel: "123.45",
  video: "67.89",
  deal: "5555",
  closedDeal: "3333",
  otherWorkspace: "9191",
  commission: "37",
};
const VIEWS = 4242;
const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

type Flags = { editor?: boolean; setter?: boolean };

function workspace(
  flags: Flags = {},
  revenue: { channel: unknown; video: unknown } = {
    channel: MONEY.channel,
    video: MONEY.video,
  },
) {
  const world: World = { ...emptyWorld(), protectMoney: true };
  world.features.push(
    { id: "feature-deals", key: "brand_deals", is_active: true },
    { id: "feature-reports", key: "reports", is_active: true },
  );
  const users = {
    owner: addUser(world, "owner@x.test"),
    manager: addUser(world, "manager@x.test"),
    editor: addUser(world, "editor@x.test"),
    setter: addUser(world, "setter@x.test"),
    // Platform staff who are only an editor in this workspace.
    staffEditor: addUser(world, "staff@x.test", "superadmin"),
    stranger: addUser(world, "stranger@x.test"),
  };
  const id = addWorkspace(world, users.owner);
  addSubscription(world, users.owner, "scale");
  const rows = {
    owner: world.workspace_members[0].id as string,
    manager: addMember(world, id, users.manager, "manager", { commission: 37, cost_amount: 4321 }),
    editor: addMember(world, id, users.editor, "editor", { commission: 12, cost_amount: 100 }),
    setter: addMember(world, id, users.setter, "setter", { commission: 13, cost_amount: 200 }),
    staffEditor: addMember(world, id, users.staffEditor, "editor"),
  };
  Object.assign(
    world.workspaces.find((w) => w.id === id)!,
    {
      editor_revenue_visible: flags.editor ?? false,
      setter_revenue_visible: flags.setter ?? false,
    },
  );
  const other = addWorkspace(world, users.stranger);
  Object.assign(
    world.workspaces.find((w) => w.id === other)!,
    {
      editor_revenue_visible: false,
      setter_revenue_visible: false,
    },
  );

  const channel = uuid();
  const otherChannel = uuid();
  const video = uuid();
  const otherVideo = uuid();
  world.youtube_channels = [
    {
      id: channel,
      workspace_id: id,
      youtube_channel_id: "UCmine",
      channel_name: "Mine",
      connection_id: uuid(),
      connected_at: "2026-01-01",
    },
    {
      id: otherChannel,
      workspace_id: other,
      youtube_channel_id: "UCother",
      channel_name: "Other",
      connection_id: uuid(),
      connected_at: "2026-01-01",
    },
  ];
  world.videos = [
    {
      id: video,
      channel_id: channel,
      youtube_video_id: "vidAAAAAAA1",
      title: "Mine",
      thumbnail: null,
      published_at: "2026-01-01T00:00:00Z",
      status: "active",
      analytics_updated_at: "2026-09-01T00:00:00Z",
    },
    {
      id: otherVideo,
      channel_id: otherChannel,
      youtube_video_id: "vidBBBBBBB2",
      title: "Theirs",
      thumbnail: null,
      published_at: "2026-01-01T00:00:00Z",
      status: "active",
      analytics_updated_at: "2026-09-01T00:00:00Z",
    },
  ];
  const stats = (channelId: string, amount: unknown) => ({
    channel_id: channelId,
    day: day(10),
    views: VIEWS,
    watch_minutes: 900,
    estimated_revenue_usd: amount,
    ad_revenue_usd: amount,
    premium_revenue_usd: amount === null ? null : "0",
  });
  world.channel_daily_stats = [
    stats(channel, revenue.channel),
    stats(otherChannel, MONEY.otherWorkspace),
  ];
  world.video_daily_stats = [
    { ...stats(channel, revenue.video), video_id: video },
    { ...stats(otherChannel, MONEY.otherWorkspace), video_id: otherVideo },
  ];
  world.youtube_sync_state = [];
  const deal = (
    workspaceId: string,
    name: string,
    value: string,
    stage: string,
    closed: string | null,
  ) => ({
    id: uuid(),
    workspace_id: workspaceId,
    user_id: users.owner,
    name,
    contact_name: null,
    value,
    currency: "USD",
    tag: null,
    stage,
    next_action: null,
    expected_close_date: null,
    closed_at: closed,
    notes: null,
    assigned_member_id: null,
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  world.deals = [
    deal(id, "Open deal", MONEY.deal, "contracted", null),
    deal(
      id,
      "Closed deal",
      MONEY.closedDeal,
      "completed",
      new Date(Date.now() - 3 * 86_400_000).toISOString(),
    ),
    deal(other, "Their deal", MONEY.otherWorkspace, "prospect", null),
  ];
  world.leads = [];
  return {
    world,
    id,
    other,
    users,
    rows,
    channel,
    video,
    dealIds: world.deals.map((d) => d.id as string),
  };
}

type Fixture = ReturnType<typeof workspace>;
type Who = keyof Fixture["users"];
const get = (f: Fixture, who: Who | null, route: { Route: unknown }, path: string, query = "") =>
  callTeamApi(route, f.world, { as: who ? f.users[who] : null, method: "GET", path, query });
const send = (
  f: Fixture,
  who: Who | null,
  route: { Route: unknown },
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  query = "",
) => callTeamApi(route, f.world, { as: who ? f.users[who] : null, method, path, query, body });

const AMOUNTS = Object.values(MONEY).filter((v) => v !== MONEY.commission);
/** No amount of this workspace (or any other) appears anywhere in the response text. */
function assertNoAmounts(text: string, label: string) {
  for (const amount of AMOUNTS) assert.ok(!text.includes(amount), `${label}: ${amount} leaked`);
}
/** The application never asked the database for money on the member's own session. */
function assertNeverAskedForMoney(result: Awaited<ReturnType<typeof get>>, label: string) {
  assert.deepEqual(result.refusedMoneyReads, [], `${label}: asked for money on a member session`);
}
const moneyReads = (result: Awaited<ReturnType<typeof get>>) =>
  result.reads.filter((read) =>
    /estimated_revenue_usd|ad_revenue_usd|premium_revenue_usd|\bvalue\b/.test(
      decodeURIComponent(String(read.body)),
    ),
  );

// Who sees revenue, by role and setting.
const CASES: Array<{ who: Who; flags: Flags; sees: boolean; label: string }> = [
  { who: "owner", flags: {}, sees: true, label: "owner" },
  { who: "manager", flags: {}, sees: true, label: "manager" },
  { who: "editor", flags: {}, sees: false, label: "editor, visibility off" },
  { who: "editor", flags: { editor: true }, sees: true, label: "editor, visibility on" },
  {
    who: "editor",
    flags: { setter: true },
    sees: false,
    label: "editor, only setters switched on",
  },
  { who: "setter", flags: {}, sees: false, label: "setter, visibility off" },
  { who: "setter", flags: { setter: true }, sees: true, label: "setter, visibility on" },
  {
    who: "setter",
    flags: { editor: true },
    sees: false,
    label: "setter, only editors switched on",
  },
  { who: "staffEditor", flags: {}, sees: true, label: "superadmin who is an editor here" },
];

// ---------- A. the policy itself ----------

test("policy: the role matrix", () => {
  const off = { editor: false, setter: false };
  const on = { editor: true, setter: true };
  for (const settings of [off, on, null, undefined]) {
    assert.equal(policy.canViewWorkspaceRevenue({ role: "owner" }, settings), true);
    assert.equal(policy.canViewWorkspaceRevenue({ role: "manager" }, settings), true);
    assert.equal(policy.canViewWorkspaceRevenue({ role: null }, settings), false);
    assert.equal(policy.canViewWorkspaceRevenue({ role: undefined }, settings), false);
  }
  assert.equal(policy.canViewWorkspaceRevenue({ role: "editor" }, off), false);
  assert.equal(policy.canViewWorkspaceRevenue({ role: "setter" }, off), false);
  assert.equal(policy.canViewWorkspaceRevenue({ role: "editor" }, on), true);
  assert.equal(policy.canViewWorkspaceRevenue({ role: "setter" }, on), true);
  assert.equal(
    policy.canViewWorkspaceRevenue({ role: "editor" }, { editor: false, setter: true }),
    false,
  );
  assert.equal(
    policy.canViewWorkspaceRevenue({ role: "setter" }, { editor: true, setter: false }),
    false,
  );
  assert.equal(policy.canViewWorkspaceRevenue({ role: "editor", isSuperadmin: true }, off), true);
  // Staff status without a membership is nothing.
  assert.equal(policy.canViewWorkspaceRevenue({ role: null, isSuperadmin: true }, on), false);
  assert.equal(policy.canManageRevenueVisibility({ role: null, isSuperadmin: true }), false);
});

test("policy: missing, malformed or unknown inputs are all 'no'", () => {
  for (const settings of [null, undefined, {}, { editor: "true" }, { editor: 1 }, { editor: null }])
    assert.equal(policy.canViewWorkspaceRevenue({ role: "editor" }, settings as never), false);
  for (const role of ["admin", "superadmin", "Owner", "viewer", ""])
    assert.equal(
      policy.canViewWorkspaceRevenue({ role: role as never }, { editor: true, setter: true }),
      false,
      role,
    );
  assert.deepEqual(policy.DEFAULT_REVENUE_VISIBILITY, { editor: false, setter: false });
});

test("policy: only owners, managers and member staff may manage; seeing revenue is not managing it", () => {
  assert.equal(policy.canManageRevenueVisibility({ role: "owner" }), true);
  assert.equal(policy.canManageRevenueVisibility({ role: "manager" }), true);
  assert.equal(policy.canManageRevenueVisibility({ role: "editor" }), false);
  assert.equal(policy.canManageRevenueVisibility({ role: "setter" }), false);
  assert.equal(policy.canManageRevenueVisibility({ role: "editor", isSuperadmin: true }), true);
  assert.deepEqual([...policy.CONFIGURABLE_REVENUE_ROLES], ["editor", "setter"]);
});

// ---------- B. stored YouTube revenue ----------

for (const { who, flags, sees, label } of CASES) {
  test(`revenue summary — ${label}: ${sees ? "amounts returned" : "amounts withheld, activity kept"}`, async () => {
    const f = workspace(flags);
    const result = await get(f, who, routes.summary, "/api/revenue/summary");
    assert.equal(result.status, 200);
    const data = result.body.data as {
      visibility: { revenue: string };
      earned: {
        revenue: { usd: number | null };
        views: number;
        rpm: number | null;
        trend: Array<{ revenue: { usd: number | null } }>;
      };
      deals: { available: boolean; reason?: string };
    };
    assertNeverAskedForMoney(result, label);
    assert.ok(!result.text.includes(MONEY.otherWorkspace), "another workspace's revenue");
    assert.equal(data.earned.views, VIEWS, "activity is returned either way");
    if (sees) {
      assert.equal(data.visibility.revenue, "visible");
      assert.equal(data.earned.revenue.usd, Number(MONEY.channel));
      assert.ok(data.earned.rpm !== null);
      assert.equal(data.deals.available, true);
      assert.ok(moneyReads(result).every((read) => read.as === "service"));
    } else {
      assert.equal(data.visibility.revenue, "hidden");
      assert.equal(data.earned.revenue.usd, null);
      assert.equal(data.earned.rpm, null);
      assert.ok(data.earned.trend.every((point) => point.revenue.usd === null));
      assert.deepEqual(data.deals, { available: false, reason: "REVENUE_HIDDEN" });
      assertNoAmounts(result.text, label);
      assert.deepEqual(moneyReads(result), [], "no amount was read at all, by any client");
    }
  });

  test(`revenue by video — ${label}: ${sees ? "amounts returned" : "amounts withheld, views kept"}`, async () => {
    const f = workspace(flags);
    const result = await get(f, who, routes.videos, "/api/revenue/videos");
    assert.equal(result.status, 200);
    const data = result.body.data as {
      visibility: { revenue: string };
      videos: Array<{
        views: number;
        rpm: number | null;
        revenueShare: number | null;
        revenue: { usd: number | null };
      }>;
    };
    assertNeverAskedForMoney(result, label);
    assert.equal(data.videos.length, 1, "own workspace's video only");
    assert.equal(data.videos[0].views, VIEWS);
    if (sees) {
      assert.equal(data.visibility.revenue, "visible");
      assert.equal(data.videos[0].revenue.usd, Number(MONEY.video));
    } else {
      assert.equal(data.visibility.revenue, "hidden");
      assert.equal(data.videos[0].revenue.usd, null);
      assert.equal(data.videos[0].rpm, null);
      assert.equal(data.videos[0].revenueShare, null);
      assertNoAmounts(result.text, label);
      assert.deepEqual(moneyReads(result), []);
    }
  });
}

test("zero, unavailable and hidden are three different answers", async () => {
  const read = async (f: Fixture, who: Who) => {
    const result = await get(f, who, routes.summary, "/api/revenue/summary");
    const data = result.body.data as {
      visibility: { revenue: string };
      earned: { revenue: { usd: number | null; availability: string } };
    };
    return {
      usd: data.earned.revenue.usd,
      availability: data.earned.revenue.availability,
      visibility: data.visibility.revenue,
    };
  };
  // YouTube reported zero.
  assert.deepEqual(await read(workspace({}, { channel: "0", video: "0" }), "owner"), {
    usd: 0,
    availability: "available",
    visibility: "visible",
  });
  // YouTube reported nothing.
  assert.deepEqual(await read(workspace({}, { channel: null, video: null }), "owner"), {
    usd: null,
    availability: "unavailable",
    visibility: "visible",
  });
  // There is an amount, and this viewer may not see it — whether it is zero, missing or real.
  for (const revenue of [
    { channel: "0", video: "0" },
    { channel: null, video: null },
    { channel: MONEY.channel, video: MONEY.video },
  ]) {
    const hidden = await read(workspace({}, revenue), "editor");
    assert.equal(hidden.visibility, "hidden");
    assert.equal(hidden.usd, null, "never 0");
  }
});

test("a hidden list is never ordered by revenue, RPM or share — and says what it was ordered by", async () => {
  const f = workspace();
  for (const sort of ["revenue", "rpm", "revenueShare"]) {
    const hidden = await get(f, "setter", routes.videos, "/api/revenue/videos", `?sort=${sort}`);
    assert.equal(hidden.status, 200);
    assert.equal((hidden.body.data as { sort: { by: string } }).sort.by, "views", sort);
    assertNoAmounts(hidden.text, sort);
    assert.deepEqual(moneyReads(hidden), []);
    const visible = await get(f, "owner", routes.videos, "/api/revenue/videos", `?sort=${sort}`);
    assert.equal((visible.body.data as { sort: { by: string } }).sort.by, sort);
  }
  // The default (no sort given) is revenue for those who may see it, views for those who may not.
  const byDefault = await get(f, "editor", routes.videos, "/api/revenue/videos");
  assert.equal((byDefault.body.data as { sort: { by: string } }).sort.by, "views");
});

test("revenue endpoints: signed out, removed, and another workspace's channel", async () => {
  const f = workspace({ editor: true });
  for (const [route, path] of [
    [routes.summary, "/api/revenue/summary"],
    [routes.videos, "/api/revenue/videos"],
  ] as const) {
    assert.equal((await get(f, null, route, path)).status, 401);
    // A channel of another workspace is "not found" for an authorised viewer — never its figures.
    const foreign = await get(
      f,
      "owner",
      route,
      path,
      `?channelId=${f.world.youtube_channels![1].id}`,
    );
    assert.ok(!foreign.text.includes(MONEY.otherWorkspace));
    assert.notEqual(
      (foreign.body.data as { channels?: unknown[] } | undefined)?.channels?.length,
      1,
    );
  }
  f.world.workspace_members.find((m) => m.id === f.rows.editor)!.status = "removed";
  const removed = await get(f, "editor", routes.summary, "/api/revenue/summary");
  assert.equal(removed.status, 403);
  assert.deepEqual(removed.body, { error: "NO_WORKSPACE" });
  const invited = workspace({ editor: true });
  invited.world.workspace_members.find((m) => m.id === invited.rows.editor)!.status = "invited";
  assert.equal((await get(invited, "editor", routes.summary, "/api/revenue/summary")).status, 403);
});

test("an unreadable setting hides revenue from editors and setters, and never from owners or managers", async () => {
  const f = workspace({ editor: true, setter: true });
  f.world.failingReads = ["workspaces"];
  for (const who of ["editor", "setter"] as const) {
    const result = await get(f, who, routes.summary, "/api/revenue/summary");
    assert.equal(
      (result.body.data as { visibility: { revenue: string } }).visibility.revenue,
      "hidden",
    );
    assertNoAmounts(result.text, who);
  }
  for (const who of ["owner", "manager"] as const) {
    const result = await get(f, who, routes.summary, "/api/revenue/summary");
    assert.equal(
      (result.body.data as { visibility: { revenue: string } }).visibility.revenue,
      "visible",
    );
  }
});

test("a workspace row without the setting (before the migration) means off", async () => {
  const f = workspace();
  const row = f.world.workspaces.find((w) => w.id === f.id)!;
  delete row.editor_revenue_visible;
  delete row.setter_revenue_visible;
  const result = await get(f, "editor", routes.summary, "/api/revenue/summary");
  assert.equal(
    (result.body.data as { visibility: { revenue: string } }).visibility.revenue,
    "hidden",
  );
  for (const junk of ["true", 1, "yes", null]) {
    row.editor_revenue_visible = junk;
    const again = await get(f, "editor", routes.summary, "/api/revenue/summary");
    assert.equal(
      (again.body.data as { visibility: { revenue: string } }).visibility.revenue,
      "hidden",
      `stored ${JSON.stringify(junk)}`,
    );
  }
});

test("an unreadable profile does not make anyone staff", async () => {
  const f = workspace();
  f.world.failingReads = ["profiles"];
  const result = await get(f, "staffEditor", routes.summary, "/api/revenue/summary");
  assert.equal(
    (result.body.data as { visibility: { revenue: string } }).visibility.revenue,
    "hidden",
  );
});

test("financial responses are never cacheable", () => {
  for (const file of [
    "src/lib/server/revenue-summary.ts",
    "src/routes/api.deals.ts",
    "src/routes/api.reports.summary.ts",
    "src/routes/api.workspace.revenue-visibility.ts",
    "src/lib/server/revenue-visibility.ts",
  ])
    assert.match(readFileSync(file, "utf8"), /"Cache-Control": "private, no-store"/, file);
});

// ---------- C. brand deals ----------

const PATH = "/api/workspace/revenue-visibility";
type DealOut = {
  id: string;
  name: string;
  stage: string;
  value: number | null;
  value_hidden: boolean;
};

for (const { who, flags, sees, label } of CASES) {
  test(`deals — ${label}: ${sees ? "values returned" : "values withheld, deals still listed"}`, async () => {
    const f = workspace(flags);
    const result = await get(f, who, routes.deals, "/api/deals");
    assert.equal(result.status, 200);
    const data = result.body.data as DealOut[];
    assertNeverAskedForMoney(result, label);
    assert.equal(data.length, 2, "own workspace's deals only");
    assert.ok(!result.text.includes(MONEY.otherWorkspace));
    assert.deepEqual(data.map((d) => d.name).sort(), ["Closed deal", "Open deal"]);
    assert.deepEqual(result.body.visibility, { revenue: sees ? "visible" : "hidden" });
    if (sees) {
      assert.deepEqual(data.map((d) => d.value).sort(), [
        Number(MONEY.closedDeal),
        Number(MONEY.deal),
      ]);
      assert.ok(data.every((d) => d.value_hidden === false));
    } else {
      assert.ok(
        data.every((d) => d.value === null && d.value_hidden === true),
        "null AND marked hidden",
      );
      assertNoAmounts(result.text, label);
      assert.deepEqual(moneyReads(result), []);
    }
  });
}

const patchDeal = (f: Fixture, who: Who | null, id: string, body: unknown) =>
  send(f, who, routes.deals, "/api/deals", "PATCH", body, `?id=${id}`);
const postDeal = (f: Fixture, who: Who | null, body: unknown) =>
  send(f, who, routes.deals, "/api/deals", "POST", body);
const deleteDeal = (f: Fixture, who: Who | null, id: string) =>
  send(f, who, routes.deals, "/api/deals", "DELETE", undefined, `?id=${id}`);

for (const who of ["editor", "setter"] as const) {
  test(`writes — ${who} without visibility: can work the pipeline, can never set, change, clear or remove an amount`, async () => {
    const f = workspace();
    const [openDeal] = f.dealIds;
    const stored = () => f.world.deals!.find((d) => d.id === openDeal)!;
    const before = JSON.stringify(f.world.deals);

    // Anything that so much as names the value is refused — whatever it holds.
    for (const body of [
      { value: 1 },
      { value: 0 },
      { value: null },
      { value: -5 },
      { value: "5" },
      { value: 6000, stage: "completed" },
      { stage: "completed", value: undefined, name: "x", ...{ value: 2 } },
    ]) {
      const blind = await patchDeal(f, who, openDeal, body);
      assert.equal(blind.status, 403, JSON.stringify(body));
      assert.equal(blind.body.error, "REVENUE_HIDDEN");
      assert.deepEqual(blind.writes, [], "refused before anything was written");
      assert.equal(
        JSON.stringify(f.world.deals),
        before,
        "nothing changed, including permitted fields",
      );
    }
    for (const body of [
      { name: "Sneaky", value: 5 },
      { name: "Sneaky", value: 0 },
      { name: "Sneaky", value: null },
      { name: "Sneaky", value: "5" },
    ]) {
      const blind = await postDeal(f, who, body);
      assert.equal(blind.status, 403, JSON.stringify(body));
      assert.deepEqual(blind.writes, []);
    }
    assert.equal(
      f.world.deals!.some((d) => d.name === "Sneaky"),
      false,
    );

    // Removing a deal removes its amount: refused, so delete-and-recreate cannot reset one.
    const removed = await deleteDeal(f, who, openDeal);
    assert.equal(removed.status, 403);
    assert.equal(removed.body.error, "REVENUE_HIDDEN");
    assert.deepEqual(removed.writes, []);
    assert.equal(JSON.stringify(f.world.deals), before);

    // Ordinary pipeline work still goes through, and never carries an amount.
    // (This deal is already contracted: its other fields can still be edited — see the stage
    // tests below for what cannot.)
    const move = await patchDeal(f, who, openDeal, { tag: "priority", nextAction: "Invoice" });
    assert.equal(move.status, 200);
    assert.equal(stored().next_action, "Invoice");
    assert.equal(stored().stage, "contracted", "the stage was not touched");
    assert.equal(stored().value, MONEY.deal, "value untouched");
    assert.ok(move.writes.every((w) => !Object.hasOwn(w.body as object, "value")));
    assert.equal((move.body.data as DealOut).value, null);
    assert.equal((move.body.data as DealOut).value_hidden, true);
    assertNoAmounts(move.text, "update response");
    assertNeverAskedForMoney(move, "update");

    const created = await postDeal(f, who, { name: "New lead-in", stage: "prospect" });
    assert.equal(created.status, 201);
    const row = f.world.deals!.find((d) => d.name === "New lead-in")!;
    assert.equal(
      Object.hasOwn(row, "value"),
      false,
      "no amount was written: the column default applies",
    );
    assert.equal(row.workspace_id, f.id);
    assert.equal((created.body.data as DealOut).value_hidden, true);
    assertNeverAskedForMoney(created, "create");
  });
}

for (const { who, flags } of [
  { who: "owner", flags: {} },
  { who: "manager", flags: {} },
  { who: "editor", flags: { editor: true } },
  { who: "setter", flags: { setter: true } },
  { who: "staffEditor", flags: {} },
] as Array<{ who: Who; flags: Flags }>) {
  test(`writes — ${who} with visibility: the existing deal workflow is unchanged`, async () => {
    const f = workspace(flags);
    const created = await postDeal(f, who, { name: "Sponsor", value: 2500, stage: "pitched" });
    assert.equal(created.status, 201);
    const row = f.world.deals!.find((d) => d.name === "Sponsor")!;
    assert.equal(row.value, 2500);
    assert.equal((created.body.data as DealOut).value, 2500);
    assert.equal((created.body.data as DealOut).value_hidden, false);

    const edited = await patchDeal(f, who, row.id as string, { value: 0 });
    assert.equal(edited.status, 200);
    assert.equal(row.value, 0, "an authorised member may set a value to zero");
    assert.equal(
      (edited.body.data as DealOut).value,
      0,
      "and zero is reported as zero, not hidden",
    );

    // A deal still needs its value, and the value must be a sane number.
    assert.equal((await postDeal(f, who, { name: "No value" })).status, 422);
    for (const value of [-1, "100", null, 1e12, Number.NaN])
      assert.equal(
        (await patchDeal(f, who, row.id as string, { value })).status,
        422,
        String(value),
      );
    assert.equal(row.value, 0);

    const removed = await deleteDeal(f, who, row.id as string);
    assert.equal(removed.status, 200);
    assert.equal(
      f.world.deals!.some((d) => d.id === row.id),
      false,
    );
    for (const result of [created, edited, removed]) assertNeverAskedForMoney(result, who);
  });
}

test("writes: nothing outside the allowlist can be assigned", async () => {
  const f = workspace();
  const [openDeal] = f.dealIds;
  const before = JSON.stringify(f.world.deals);
  for (const extra of [
    { workspace_id: f.other },
    { workspaceId: f.other },
    { user_id: f.users.stranger },
    { id: uuid() },
    { closed_at: "1999-01-01T00:00:00Z" },
    { created_at: "1999-01-01T00:00:00Z" },
    { currency: "EUR" },
    { status: "won" },
    { value_hidden: false },
  ]) {
    const patched = await patchDeal(f, "owner", openDeal, { stage: "pitched", ...extra });
    assert.equal(patched.status, 422, JSON.stringify(extra));
    assert.deepEqual(patched.writes, []);
    const posted = await postDeal(f, "owner", { name: "X", value: 1, ...extra });
    assert.equal(posted.status, 422, JSON.stringify(extra));
    assert.deepEqual(posted.writes, []);
  }
  assert.equal(JSON.stringify(f.world.deals), before);
});

test("writes: every deal write is made by the server, for the caller's own workspace and identity", async () => {
  const f = workspace({ editor: true });
  const created = await postDeal(f, "editor", { name: "Mine", value: 10 });
  const insert = created.writes.find((w) => w.table === "deals")!;
  assert.equal(insert.as, "service", "never on the member's session");
  assert.equal((insert.body as Record<string, unknown>).workspace_id, f.id);
  assert.equal((insert.body as Record<string, unknown>).user_id, f.users.editor);
  const [openDeal, , theirs] = f.dealIds;
  const edited = await patchDeal(f, "editor", openDeal, { tag: "x" });
  assert.ok(edited.writes.every((w) => w.as === "service"));
  // Another workspace's deal: not found for a change, and untouched by a delete.
  const before = JSON.stringify(f.world.deals!.find((d) => d.id === theirs));
  assert.equal((await patchDeal(f, "owner", theirs, { value: 1 })).status, 404);
  await deleteDeal(f, "owner", theirs);
  assert.equal(JSON.stringify(f.world.deals!.find((d) => d.id === theirs)), before);
  // Signed out: nothing.
  for (const result of [
    await postDeal(f, null, { name: "x", value: 1 }),
    await patchDeal(f, null, openDeal, { value: 1 }),
    await deleteDeal(f, null, openDeal),
  ]) {
    assert.equal(result.status, 401);
    assert.deepEqual(result.writes, []);
  }
});

test("writes: a role that loses visibility loses the ability to write on its very next request", async () => {
  const f = workspace({ editor: true });
  const [openDeal] = f.dealIds;
  assert.equal((await patchDeal(f, "editor", openDeal, { value: 42 })).status, 200);
  await send(f, "owner", routes.visibility, PATH, "PATCH", { editor: false });
  const after = await patchDeal(f, "editor", openDeal, { value: 43 });
  assert.equal(after.status, 403);
  assert.equal(f.world.deals!.find((d) => d.id === openDeal)!.value, 42);
  assert.equal((await deleteDeal(f, "editor", openDeal)).status, 403);
  // …and a removed member can do nothing at all.
  f.world.workspace_members.find((m) => m.id === f.rows.manager)!.status = "removed";
  const removed = await patchDeal(f, "manager", openDeal, { value: 1 });
  assert.equal(removed.status, 403);
  assert.deepEqual(removed.body, { error: "NO_WORKSPACE" });
});

test("an authorised member edits values as before", async () => {
  const f = workspace({ editor: true });
  const [openDeal] = f.dealIds;
  for (const who of ["owner", "manager", "editor"] as const) {
    const result = await send(
      f,
      who,
      routes.deals,
      "/api/deals",
      "PATCH",
      { value: 6000 },
      `?id=${openDeal}`,
    );
    assert.equal(result.status, 200, who);
    assert.equal((result.body.data as DealOut).value, 6000);
    assertNeverAskedForMoney(result, who);
  }
});

test("deals of another workspace cannot be read, changed or deleted", async () => {
  const f = workspace({ editor: true });
  const theirs = f.dealIds[2];
  const before = JSON.stringify(f.world.deals);
  const patched = await send(
    f,
    "owner",
    routes.deals,
    "/api/deals",
    "PATCH",
    { value: 1 },
    `?id=${theirs}`,
  );
  assert.equal(patched.status, 404);
  await send(f, "owner", routes.deals, "/api/deals", "DELETE", undefined, `?id=${theirs}`);
  assert.equal(JSON.stringify(f.world.deals), before, "nothing in the other workspace changed");
  assert.equal((await get(f, null, routes.deals, "/api/deals")).status, 401);
});

// ---------- D. reports and exports ----------

for (const { who, flags, sees, label } of CASES) {
  test(`reports — ${label}: ${sees ? "amounts returned" : "amounts withheld, counts kept"}`, async () => {
    const f = workspace(flags);
    const summary = await get(f, who, routes.reportsSummary, "/api/reports/summary");
    assert.equal(summary.status, 200);
    const data = summary.body.data as Record<string, unknown>;
    assertNeverAskedForMoney(summary, label);
    assert.equal(data.dealsClosedThisPeriod, 1, "counts are not financial");
    assert.deepEqual((data.totals as { deals: number }).deals, 2);
    assert.deepEqual(data.visibility, { revenue: sees ? "visible" : "hidden" });
    if (sees) {
      assert.equal(data.revenueThisPeriod, Number(MONEY.closedDeal));
      assert.equal(data.activePipeline, Number(MONEY.deal));
    } else {
      assert.equal(data.revenueThisPeriod, null, "never 0");
      assert.equal(data.activePipeline, null);
      assert.equal(data.revenueChangePct, null);
      assertNoAmounts(summary.text, label);
    }

    const csv = await get(f, who, routes.reportsExport, "/api/reports/export", "?type=deals");
    assert.equal(csv.status, 200);
    assertNeverAskedForMoney(csv, `${label} export`);
    assert.ok(csv.text.includes("Open deal") && csv.text.includes("Closed deal"));
    assert.ok(!csv.text.includes("Their deal"));
    if (sees) {
      assert.ok(csv.text.includes(MONEY.deal) && csv.text.includes(MONEY.closedDeal));
      assert.ok(!csv.text.includes("Hidden"));
    } else {
      assertNoAmounts(csv.text, `${label} export`);
      assert.equal(
        csv.text.match(/Hidden/g)?.length,
        2,
        "each value is written as Hidden — not blank, not 0",
      );
    }
  });
}

// ---------- E. the settings API ----------

type VisibilityOut = {
  editor: boolean;
  setter: boolean;
  canView: boolean;
  canManage: boolean;
  available: boolean;
};
const flagsOf = (f: Fixture, workspaceId = f.id) => {
  const row = f.world.workspaces.find((w) => w.id === workspaceId)!;
  return { editor: row.editor_revenue_visible, setter: row.setter_revenue_visible };
};

test("settings: every member can read the setting and what they may do — and no amounts", async () => {
  const f = workspace({ editor: true });
  const expected: Record<string, [boolean, boolean]> = {
    owner: [true, true],
    manager: [true, true],
    editor: [true, false],
    setter: [false, false],
    staffEditor: [true, true],
  };
  for (const [who, [canView, canManage]] of Object.entries(expected)) {
    const result = await get(f, who as Who, routes.visibility, PATH);
    assert.equal(result.status, 200, who);
    assert.deepEqual(
      result.body.data,
      { editor: true, setter: false, canView, canManage, available: true },
      who,
    );
    assertNoAmounts(result.text, who);
  }
  assert.equal((await get(f, null, routes.visibility, PATH)).status, 401);
});

test("settings: owners, managers and member staff can change it; the change is per role and per workspace", async () => {
  for (const who of ["owner", "manager", "staffEditor"] as const) {
    const f = workspace();
    const on = await send(f, who, routes.visibility, PATH, "PATCH", { editor: true });
    assert.equal(on.status, 200, who);
    assert.deepEqual(flagsOf(f), { editor: true, setter: false }, "only the editor flag moved");
    assert.deepEqual(
      flagsOf(f, f.other),
      { editor: false, setter: false },
      "the other workspace is untouched",
    );
    assert.equal((on.body.data as VisibilityOut).editor, true);
    assert.equal(on.writes.length, 1);
    assert.deepEqual(
      on.writes[0].body,
      { editor_revenue_visible: true },
      "nothing else is written",
    );

    const both = await send(f, who, routes.visibility, PATH, "PATCH", {
      editor: false,
      setter: true,
    });
    assert.equal(both.status, 200);
    assert.deepEqual(flagsOf(f), { editor: false, setter: true });
  }
});

test("settings: editors and setters cannot change it — even once they are allowed to see revenue", async () => {
  const f = workspace({ editor: true, setter: true });
  for (const who of ["editor", "setter"] as const) {
    for (const body of [{ editor: false }, { setter: true }, { editor: true, setter: true }]) {
      const result = await send(f, who, routes.visibility, PATH, "PATCH", body);
      assert.equal(result.status, 403, who);
      assert.deepEqual(result.body, { error: "CANNOT_MANAGE_REVENUE_VISIBILITY" });
      assert.deepEqual(result.writes, []);
    }
  }
  assert.deepEqual(flagsOf(f), { editor: true, setter: true });
  const out = await send(f, null, routes.visibility, PATH, "PATCH", { editor: false });
  assert.equal(out.status, 401);
  assert.deepEqual(out.writes, []);
});

test("settings: unknown fields, other workspaces, other roles and non-booleans are rejected whole", async () => {
  const f = workspace();
  for (const body of [
    {},
    { owner: false },
    { manager: false },
    { editor: true, manager: false },
    { editor: true, workspaceId: f.other },
    { editor: true, workspace_id: f.other },
    { editor: true, role: "owner" },
    { editor: "true" },
    { editor: 1 },
    { setter: null },
    { editor_revenue_visible: true },
    [true],
    "editor",
  ]) {
    const result = await send(f, "owner", routes.visibility, PATH, "PATCH", body);
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.deepEqual(result.writes, [], JSON.stringify(body));
  }
  assert.deepEqual(flagsOf(f), { editor: false, setter: false });
  assert.deepEqual(flagsOf(f, f.other), { editor: false, setter: false });
});

test("settings: a save that did not happen is never reported as saved", async () => {
  const f = workspace();
  f.world.workspaces = f.world.workspaces.filter((w) => w.id !== f.id);
  const result = await send(f, "owner", routes.visibility, PATH, "PATCH", { editor: true });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "REVENUE_VISIBILITY_UNAVAILABLE" });
});

test("settings: removed and outside members are refused before anything else", async () => {
  const f = workspace();
  f.world.workspace_members.find((m) => m.id === f.rows.manager)!.status = "removed";
  const removed = await send(f, "manager", routes.visibility, PATH, "PATCH", { editor: true });
  assert.equal(removed.status, 403);
  assert.deepEqual(removed.body, { error: "NO_WORKSPACE" });
  // The other workspace's owner changes only their own workspace.
  const stranger = await send(f, "stranger", routes.visibility, PATH, "PATCH", { editor: true });
  assert.equal(stranger.status, 200);
  assert.deepEqual(flagsOf(f), { editor: false, setter: false });
  assert.deepEqual(flagsOf(f, f.other), { editor: true, setter: false });
});

test("switching a role on takes effect for that role only, and switching it off takes it away again", async () => {
  const f = workspace();
  const sees = async (who: Who) =>
    (
      (await get(f, who, routes.summary, "/api/revenue/summary")).body.data as {
        visibility: { revenue: string };
      }
    ).visibility.revenue === "visible";
  assert.deepEqual([await sees("editor"), await sees("setter")], [false, false]);
  await send(f, "manager", routes.visibility, PATH, "PATCH", { editor: true });
  assert.deepEqual([await sees("editor"), await sees("setter")], [true, false]);
  await send(f, "owner", routes.visibility, PATH, "PATCH", { editor: false, setter: true });
  assert.deepEqual([await sees("editor"), await sees("setter")], [false, true]);
});

// ---------- F. compensation stays private ----------

test("allowing a role to see revenue never shows them anyone's compensation", async () => {
  const f = workspace({ editor: true, setter: true });
  for (const who of ["editor", "setter"] as const) {
    const result = await get(f, who, routes.members, "/api/workspace/members");
    assert.equal(result.status, 200);
    const data = result.body.data as Array<{
      id: string;
      commission: number | null;
      cost_amount: number | null;
      compensation_visible: boolean;
    }>;
    for (const row of data) {
      const own = row.id === f.rows[who];
      assert.equal(row.compensation_visible, own, `${who} → ${row.id}`);
      if (!own) assert.deepEqual([row.commission, row.cost_amount], [null, null]);
    }
    assert.ok(!result.text.includes("4321"), "the manager's cost");
    assertNeverAskedForMoney(result, `${who} roster`);
  }
});

test("the two rule sets are separate functions with separate inputs", () => {
  // Code only: the header comment names the compensation rule in order to say it is separate.
  const revenue = readFileSync("src/lib/revenue-visibility.ts", "utf8").replace(
    /^\s*\/\/.*$/gm,
    "",
  );
  assert.doesNotMatch(revenue, /canViewCompensation|redactMember/);
  const team = readFileSync("src/lib/team-policy.ts", "utf8");
  assert.doesNotMatch(team, /revenue-visibility|canViewWorkspaceRevenue/);
  assert.doesNotMatch(
    readFileSync("src/routes/api.workspace.members.ts", "utf8"),
    /revenue-visibility/,
  );
});

// ---------- G. live YouTube, AI and other routes ----------

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

test("live video analytics: revenue metrics are not requested for a viewer who may not see them", () => {
  const route = flat("src/routes/api.youtube.video.ts");
  assert.match(route, /const revenueAccess = await resolveRevenueAccessForRequest\(request\);/);
  assert.match(route, /const includeRevenue = revenueAccess\.canView;/);
  assert.match(route, /if \(!includeRevenue\) throw new Error\("revenue not requested"\);/);
  assert.equal(route.match(/activityMetrics, includeRevenue, \)/g)?.length, 2);
  assert.match(route, /\["views", "estimatedMinutesWatched"\], includeRevenue, \)/);
  assert.match(route, /visibility: includeRevenue \? REVENUE_VISIBLE : REVENUE_HIDDEN/);
  // The revenue metrics appear in exactly one request, and it is the guarded one.
  assert.equal(route.match(/\.\.\.revenueMetrics/g)?.length, 1);
});

test("live breakdowns: revenue per traffic source follows the same rule", () => {
  const route = flat("src/routes/api.youtube.breakdowns.ts");
  assert.match(route, /const revenueAccess = await resolveRevenueAccess\(ctx\);/);
  assert.match(route, /"insightTrafficSourceType", revenueAccess\.canView, \)/);
  assert.match(route, /visibility: revenueAccess\.canView \? REVENUE_VISIBLE : REVENUE_HIDDEN/);
});

test("AI video analysis: revenue never reaches the prompt, the result or the cache for a hidden viewer", () => {
  const route = flat("src/routes/api.ai.analyze-video.ts");
  assert.match(route, /await resolveRevenueAccessForRequest\(request\)/);
  assert.match(route, /revenueAccess\?\.canView === true, \)/);
  assert.match(route, /if \(!includeRevenue\) throw new Error\("revenue not requested"\);/);
  assert.match(
    route,
    /JSON\.stringify\(aiInput\.performance\)/,
    "the cache key covers the figures given",
  );
});

test("the assistant is given counts, never amounts", () => {
  const chat = readFileSync("src/routes/api.assistant.chat.ts", "utf8");
  assert.match(chat, /from\("deals"\)\.select\("stage"\)/);
  assert.doesNotMatch(chat, /\bvalue\b|estimated_revenue|channel_daily_stats|video_daily_stats/);
});

test("no member-session query names a money column anywhere in the application", () => {
  // Every read of an amount goes through moneyClient / access.privileged. This is the static
  // counterpart of protectMoney above, covering routes those tests do not call.
  const offenders: string[] = [];
  for (const file of [
    "src/routes/api.deals.ts",
    "src/routes/api.reports.summary.ts",
    "src/routes/api.reports.export.ts",
    "src/routes/api.assistant.chat.ts",
    "src/routes/api.leads.ts",
    "src/routes/api.destinations.top-videos.ts",
  ]) {
    const source = flat(file);
    for (const match of source.matchAll(
      /\bclient \.from\("(deals|channel_daily_stats|video_daily_stats)"\) \.select\( ?"([^"]*)"/g,
    ))
      if (/\bvalue\b|revenue_usd|\*/.test(match[2])) offenders.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(offenders, []);
  const store = flat("src/lib/server/revenue-store.ts");
  assert.match(store, /const columns = ctx\.revenue \? ACTIVITY_COLUMNS : STATS_COLUMNS;/);
  assert.match(store, /money\.readStats\("channel_daily_stats", channelIds, range\)/);
  assert.match(store, /const ACTIVITY_COLUMNS = "channel_id, day, views, watch_minutes";/);
});

// ---------- H. what the pages show ----------

test("view models: a hidden response says Hidden — never $0 and never the 'unavailable' dash", async () => {
  const f = workspace();
  const summary = (await get(f, "editor", routes.summary, "/api/revenue/summary")).body
    .data as never;
  const videos = (await get(f, "editor", routes.videos, "/api/revenue/videos")).body.data as never;

  const dashboard = views.dashboard.mapDashboardRevenue(summary);
  assert.equal(dashboard.hidden, true);
  assert.equal(dashboard.total.text, "Hidden");
  assert.equal(dashboard.total.hidden, true);
  assert.equal(dashboard.changeText, "Hidden");
  assert.equal(dashboard.freshnessNote, "Revenue hidden by workspace settings");
  assert.deepEqual([dashboard.series, dashboard.split, dashboard.latest], [[], [], null]);
  assert.ok(dashboard.trend.every((point) => point.revenueUsd === null));

  const top = views.dashboard.mapTopRevenueVideos(videos);
  assert.ok(top.length === 1 && top[0].revenue.text === "Hidden" && top[0].views === VIEWS);

  const analytics = views.analytics.mapAnalyticsRevenue(summary);
  assert.deepEqual([analytics.perView.text, analytics.perView.changeText], ["Hidden", "Hidden"]);
  assert.deepEqual([analytics.sources.series, analytics.sources.hasData], [[], false]);
  assert.equal(views.analytics.mapVideoEarnings(videos).get("vidAAAAAAA1")?.text, "Hidden");

  const page = views.videos.mapVideosRevenuePage(videos, videos);
  const cell = page.cells.get("vidAAAAAAA1")!;
  assert.equal(page.hidden, true);
  assert.equal(cell.revenue.text, "Hidden");
  assert.notEqual(cell.status, "High Revenue", "no badge that ranks by revenue");
  assert.match(
    views.videos.describeVideosRevenue(page),
    /^Revenue hidden by workspace settings\. Change compares views/,
  );

  for (const text of [
    JSON.stringify(dashboard),
    JSON.stringify(top),
    JSON.stringify(analytics),
    JSON.stringify([...page.cells]),
  ]) {
    assertNoAmounts(text, "view model");
    assert.ok(!text.includes("$0"), "hidden is never shown as $0");
  }
});

test("view models: a visible response is unchanged", async () => {
  const f = workspace();
  const summary = (await get(f, "owner", routes.summary, "/api/revenue/summary")).body
    .data as never;
  const dashboard = views.dashboard.mapDashboardRevenue(summary);
  assert.equal(dashboard.hidden, false);
  assert.equal(dashboard.total.text, "$123");
  assert.equal(dashboard.total.usd, 123.45);
  assert.notEqual(dashboard.freshnessNote, "Revenue hidden by workspace settings");
  // A response from a deployment that predates the marker is read as visible.
  const { visibility: _omitted, ...legacy } = summary as Record<string, unknown>;
  assert.equal(views.dashboard.mapDashboardRevenue(legacy as never).hidden, false);
});

test("pages: each money-showing screen has an explicit hidden state", () => {
  const expectations: Array<[string, RegExp[]]> = [
    ["src/routes/dashboard.tsx", [/revenue\.hidden \? "Revenue hidden by workspace settings\."/]],
    ["src/routes/videos.tsx", [/revenue\?\.revenue\.hidden \? \(/, /> Hidden </]],
    [
      "src/routes/analytics.tsx",
      [/visibility\?\.revenue === "hidden" \? "Hidden"/, /Revenue hidden by workspace settings\./],
    ],
    [
      "src/routes/videos.$videoId.tsx",
      [
        /data\.visibility\?\.revenue === "hidden" \? "Hidden"/,
        /"Revenue hidden by workspace settings"/,
      ],
    ],
    [
      "src/routes/reports.tsx",
      [
        /summary\.revenueThisPeriod === null \? "Hidden"/,
        /summary\.activePipeline === null \? "Hidden"/,
      ],
    ],
    [
      "src/routes/brand-deals.tsx",
      [
        /valuesHidden \? HIDDEN : d\.value\.toLocaleString\(\)/,
        /deals\.length > 0 && !valuesHidden/,
        /value: valuesHidden \? undefined : input\.value/,
        /hideValue=\{valuesHidden\}/,
      ],
    ],
    [
      "src/routes/team.tsx",
      [
        /setDeals\(hidden \? \[\] : body\.data\)/,
        /dealValuesHidden \? "Hidden"/,
        /<RevenueVisibilitySettings className="mt-6" \/>/,
      ],
    ],
  ];
  for (const [file, patterns] of expectations) {
    const source = flat(file);
    for (const pattern of patterns) assert.match(source, pattern, `${file} ${pattern}`);
  }
});

test("the settings card: approved copy, real controls, and no optimistic success", () => {
  const card = flat("src/components/RevenueVisibilitySettings.tsx");
  for (const copy of [
    "Revenue Visibility",
    "Choose which team roles can view financial amounts in this workspace.",
    "Allow editors to view revenue",
    "Allow setters to view revenue",
    "It does not give anyone access to private team compensation",
  ])
    assert.ok(card.includes(copy), copy);
  assert.match(card, /if \(state\.status === "ready" && !state\.data\.canManage\) return null;/);
  assert.match(
    card,
    /<Switch id=\{id\} checked=\{state\.data\[role\]\}/,
    "the switch shows server state",
  );
  assert.match(card, /<label htmlFor=\{id\}/, "each switch is labelled");
  // State changes only from a successful response body; a failure shows an error and nothing else.
  assert.match(
    card,
    /if \(!response\.ok \|\| !body\.data\) throw new Error\(body\.error \?\? "SAVE_FAILED"\); \/\/ Show what the server says is now stored, not what was asked for\. setState\(\{ status: "ready", data: body\.data \}\);/,
  );
  assert.match(card, /catch \(error\) \{ toast\.error\(/);
  assert.match(card, /ListLoadingState label="Loading revenue visibility"/);
  assert.match(card, /ErrorState/);
});

// ---------- I. the privileged read boundary ----------

test("the service-role client never leaves the access module: routes get a workspace-bound reader", () => {
  const access = readFileSync("src/lib/server/revenue-visibility.ts", "utf8");
  // The reader is not exported, so the only way to obtain one is resolveRevenueAccess.
  assert.match(access, /^function createMoneyReader\(/m);
  assert.doesNotMatch(access, /export (async )?function createMoneyReader/);
  assert.match(access, /money: canView \? createMoneyReader\(service, ctx\.workspaceId\) : null,/);
  // No field hands out the raw client any more.
  for (const file of [
    "src/lib/server/revenue-visibility.ts",
    "src/lib/server/revenue-store.ts",
    "src/lib/server/revenue-summary.ts",
    "src/lib/server/revenue-videos.ts",
    "src/routes/api.deals.ts",
    "src/routes/api.reports.summary.ts",
    "src/routes/api.reports.export.ts",
  ])
    assert.doesNotMatch(
      // Code only — comments may use the word.
      readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
      /\bprivileged\b/,
      file,
    );

  // Inside the reader, every query on a table is scoped by the bound workspace: directly, or by
  // channel ids the reader has itself just confirmed belong to it.
  const reader = access.slice(
    access.indexOf("function createMoneyReader("),
    access.indexOf("type AccessContext"),
  );
  const queries = reader.split(/service\s*\.from\(/).slice(1);
  assert.equal(queries.length, 4, "channel check, stats, deal values, deal summary");
  for (const query of queries) {
    const table = /^"?([a-z_]+|table)/.exec(query)![1];
    const scoped =
      /\.eq\("workspace_id", workspaceId\)/.test(query) ||
      /\.in\("channel_id", verified\)/.test(query);
    assert.ok(scoped, `the ${table} query is scoped to the reader's workspace`);
  }
  assert.match(reader, /const verified = await ownChannels\(channelIds\);/);
  // Fixed column lists only — nothing chosen by the caller, and never everything.
  assert.doesNotMatch(reader, /select\("\*"\)|select\(\)/);
  // Failures are reported by operation and code, never with row contents.
  assert.match(
    access,
    /console\.error\("Revenue read failed", \{ operation, code: error\?\.code \}\);/,
  );
});

test("the service-role key and client cannot reach the browser", () => {
  // Pages and shared modules import the pure rules only; nothing under lib/server.
  for (const file of [
    "src/lib/revenue-visibility.ts",
    "src/components/RevenueVisibilitySettings.tsx",
    "src/lib/dashboard-revenue.ts",
    "src/lib/analytics-revenue.ts",
    "src/lib/videos-revenue.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/g))
      assert.ok(
        match[1] || !match[2].includes("/server/"),
        `${file} imports ${match[2]} as a value`,
      );
    assert.doesNotMatch(source, /SERVICE_ROLE|createServiceSupabaseClient/);
  }
});

test("pages: what is offered matches what the server allows", () => {
  const deals = flat("src/routes/brand-deals.tsx");
  // No Delete for a viewer who may not see values; no value sent when creating or editing.
  assert.match(
    deals,
    /\{!valuesHidden && \( <DropdownMenuItem onSelect=\{\(\) => setDeleting\(d\)\}/,
  );
  assert.equal(deals.match(/value: valuesHidden \? undefined : input\.value/g)?.length, 2);
  assert.equal(deals.match(/hideValue=\{valuesHidden\}/g)?.length, 2);
  // The dashboard list is by views when revenue is hidden, and its heading says so.
  assert.match(
    flat("src/routes/dashboard.tsx"),
    /\{revenue\.hidden \? "Top Videos by Views" : "Top Revenue Videos"\}/,
  );
});

test("policy: nobody may write an amount they may not see", () => {
  const off = { editor: false, setter: false };
  const on = { editor: true, setter: true };
  for (const role of ["owner", "manager", "editor", "setter", null] as const)
    for (const settings of [off, on, null])
      for (const isSuperadmin of [false, true]) {
        const viewer = { role, isSuperadmin };
        if (policy.canWriteWorkspaceRevenue(viewer, settings))
          assert.equal(policy.canViewWorkspaceRevenue(viewer, settings), true);
      }
  assert.equal(policy.canWriteWorkspaceRevenue({ role: "editor" }, off), false);
  assert.equal(policy.canWriteWorkspaceRevenue({ role: "setter" }, off), false);
  assert.equal(policy.canWriteWorkspaceRevenue({ role: "editor" }, on), true);
  assert.equal(policy.canWriteWorkspaceRevenue({ role: "owner" }, off), true);
});

// ---------- J. deal stages that carry financial meaning ----------
//
// "contracted" and "completed" are what put a deal's value into the contracted and closed
// totals. A member who may not see amounts may neither move a deal into one of them nor out of
// one — whatever the deal's value is (a real figure, an explicit 0, or the 0 it starts with).

const STAGES = ["prospect", "pitched", "negotiating", "contracted", "completed"] as const;
const FINANCIAL = ["contracted", "completed"] as const;
const ORDINARY = ["prospect", "pitched", "negotiating"] as const;

/** Adds a deal of this workspace in the given stage and returns its id. */
function addDeal(f: Fixture, stage: string, value: string, workspaceId = f.id): string {
  const id = uuid();
  f.world.deals!.push({
    id,
    workspace_id: workspaceId,
    user_id: f.users.owner,
    name: `Deal in ${stage}`,
    contact_name: null,
    value,
    currency: "USD",
    tag: null,
    stage,
    next_action: null,
    expected_close_date: null,
    closed_at: stage === "completed" ? "2026-10-01T00:00:00.000Z" : null,
    notes: null,
    assigned_member_id: null,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}
const dealRow = (f: Fixture, id: string) => f.world.deals!.find((d) => d.id === id)!;

test("policy: which stage changes need revenue access", () => {
  const needs = policy.dealStageChangeNeedsRevenueAccess;
  assert.deepEqual([...policy.FINANCIAL_DEAL_STAGES], ["contracted", "completed"]);
  for (const from of [null, ...STAGES])
    for (const to of STAGES) {
      const expected =
        from !== to && (FINANCIAL.includes(to as never) || FINANCIAL.includes(from as never));
      assert.equal(needs(from, to), expected, `${from} → ${to}`);
    }
  // Not mentioning the stage, or repeating the current one, is never a stage change.
  for (const from of [null, ...STAGES]) {
    assert.equal(needs(from, undefined), false);
    if (from) assert.equal(needs(from, from), false);
  }
  assert.equal(policy.isFinancialDealStage("Completed"), false, "exact stage names only");
  assert.equal(policy.isFinancialDealStage(null), false);
});

for (const who of ["editor", "setter"] as const) {
  test(`stages — ${who} without visibility: cannot create a deal in, or move one into, contracted or completed`, async () => {
    for (const value of ["5000", "0"]) {
      const f = workspace();
      const prospect = addDeal(f, "prospect", value);
      const before = JSON.stringify(f.world.deals);
      for (const stage of FINANCIAL) {
        const created = await postDeal(f, who, { name: "Straight in", stage });
        assert.equal(created.status, 403, `create in ${stage}`);
        assert.equal(created.body.error, "REVENUE_HIDDEN");
        assert.deepEqual(created.writes, []);

        // Alone, with a permitted field beside it, or as a full form payload: all refused.
        for (const body of [
          { stage },
          { stage, nextAction: "Send contract" },
          {
            name: "Deal in prospect",
            contactName: null,
            tag: null,
            stage,
            nextAction: null,
            expectedCloseDate: null,
            assignedMemberId: null,
          },
        ]) {
          const moved = await patchDeal(f, who, prospect, body);
          assert.equal(moved.status, 403, `${stage} ${JSON.stringify(body)}`);
          assert.equal(moved.body.error, "REVENUE_HIDDEN");
          assert.deepEqual(moved.writes, [], "refused before anything was written");
          assertNoAmounts(moved.text, "refusal");
          assert.ok(
            !moved.text.includes(value === "0" ? '"value"' : value),
            "no value in the refusal",
          );
          assertNeverAskedForMoney(moved, "refusal");
          assert.deepEqual(moneyReads(moved), [], "the value was not read to decide it");
        }
      }
      assert.equal(JSON.stringify(f.world.deals), before, `nothing changed (deal value ${value})`);
      assert.equal(
        f.world.deals!.some((d) => d.name === "Straight in"),
        false,
      );
    }
  });

  test(`stages — ${who} without visibility: cannot move a deal out of contracted or completed`, async () => {
    const f = workspace();
    for (const from of FINANCIAL) {
      const id = addDeal(f, from, "5000");
      const before = JSON.stringify(dealRow(f, id));
      for (const to of STAGES.filter((s) => s !== from)) {
        const moved = await patchDeal(f, who, id, { stage: to, tag: "x" });
        assert.equal(moved.status, 403, `${from} → ${to}`);
        assert.deepEqual(moved.writes, []);
      }
      assert.equal(
        JSON.stringify(dealRow(f, id)),
        before,
        "stage, close date and tag all unchanged",
      );
    }
  });

  test(`stages — ${who} without visibility: ordinary stages and other fields still work`, async () => {
    const f = workspace();
    // Between the ordinary stages, freely.
    const id = addDeal(f, "prospect", "5000");
    for (const to of ["pitched", "negotiating", "prospect"]) {
      const moved = await patchDeal(f, who, id, { stage: to });
      assert.equal(moved.status, 200, to);
      assert.equal(dealRow(f, id).stage, to);
    }
    assert.equal(dealRow(f, id).value, "5000");
    // Creating in each ordinary stage, without a value.
    for (const stage of ORDINARY) {
      const created = await postDeal(f, who, { name: `New in ${stage}`, stage });
      assert.equal(created.status, 201, stage);
      assert.equal(f.world.deals!.find((d) => d.name === `New in ${stage}`)!.stage, stage);
    }
    assert.equal((await postDeal(f, who, { name: "Default stage" })).status, 201);
    assert.equal(f.world.deals!.find((d) => d.name === "Default stage")!.stage, "prospect");

    // A deal an owner already contracted or completed: its other fields stay editable, with or
    // without the request repeating the stage it already has — and the stage is not rewritten.
    for (const stage of FINANCIAL) {
      const settled = addDeal(f, stage, "7000");
      const closedAt = dealRow(f, settled).closed_at;
      for (const body of [
        { notes: "Asset list received" },
        { notes: "Asset list received", stage },
        {
          name: "Renamed",
          contactName: "A. Person",
          tag: "q4",
          stage,
          nextAction: "Chase",
          expectedCloseDate: null,
          assignedMemberId: null,
        },
      ]) {
        const edited = await patchDeal(f, who, settled, body);
        assert.equal(edited.status, 200, `${stage} ${JSON.stringify(body)}`);
        assert.ok(
          edited.writes.every(
            (w) =>
              !Object.hasOwn(w.body as object, "stage") &&
              !Object.hasOwn(w.body as object, "closed_at") &&
              !Object.hasOwn(w.body as object, "value"),
          ),
          "the write names neither the stage, the close date nor the value",
        );
        assert.equal((edited.body.data as DealOut).stage, stage, "the real stage is reported");
        assert.equal((edited.body.data as DealOut).value_hidden, true);
        assertNoAmounts(edited.text, "edit response");
      }
      assert.equal(dealRow(f, settled).stage, stage);
      assert.equal(dealRow(f, settled).closed_at, closedAt);
      assert.equal(dealRow(f, settled).value, "7000");
      assert.equal(dealRow(f, settled).name, "Renamed");
    }
  });
}

test("stages: there is no other way to say 'stage' — unknown or malformed fields are rejected whole", async () => {
  const f = workspace();
  const id = addDeal(f, "prospect", "5000");
  const before = JSON.stringify(f.world.deals);
  for (const body of [
    { Stage: "completed" },
    { status: "completed" },
    { dealStage: "contracted" },
    { stage_id: "completed" },
    { closed_at: "2026-10-01T00:00:00Z" },
    { stage: "Completed" },
    { stage: " completed" },
    { stage: ["completed"] },
    { stage: { to: "completed" } },
    { stage: 4 },
    { stage: "won" },
    { stage: null },
    { stage: "pitched", workspace_id: f.other },
    { stage: "pitched", role: "owner" },
    { stage: "pitched", workspaceRole: "owner", canWrite: true },
  ]) {
    for (const who of ["editor", "owner"] as const) {
      const patched = await patchDeal(f, who, id, body);
      assert.ok(
        [403, 422].includes(patched.status),
        `${who} ${JSON.stringify(body)} → ${patched.status}`,
      );
      assert.deepEqual(patched.writes, [], JSON.stringify(body));
      const posted = await postDeal(f, who, {
        name: "Y",
        ...(who === "owner" ? { value: 1 } : {}),
        ...body,
      });
      assert.ok([403, 422].includes(posted.status), `${who} create ${JSON.stringify(body)}`);
      assert.deepEqual(posted.writes, []);
    }
  }
  assert.equal(JSON.stringify(f.world.deals), before);
});

for (const { who, flags } of [
  { who: "owner", flags: {} },
  { who: "manager", flags: {} },
  { who: "editor", flags: { editor: true } },
  { who: "setter", flags: { setter: true } },
  { who: "staffEditor", flags: {} },
] as Array<{ who: Who; flags: Flags }>) {
  test(`stages — ${who} with visibility: every stage move works as before`, async () => {
    const f = workspace(flags);
    const id = addDeal(f, "prospect", "5000");
    for (const to of ["contracted", "completed", "negotiating", "completed", "prospect"]) {
      const moved = await patchDeal(f, who, id, { stage: to });
      assert.equal(moved.status, 200, to);
      assert.equal(dealRow(f, id).stage, to);
      // Completing stamps the close date; leaving completed clears it — unchanged behaviour.
      assert.equal(
        dealRow(f, id).closed_at !== null && dealRow(f, id).closed_at !== undefined,
        to === "completed",
        to,
      );
      assert.equal((moved.body.data as DealOut).value, 5000);
    }
    for (const stage of FINANCIAL) {
      const created = await postDeal(f, who, { name: `Direct ${stage}`, value: 900, stage });
      assert.equal(created.status, 201, stage);
      assert.equal(f.world.deals!.find((d) => d.name === `Direct ${stage}`)!.stage, stage);
    }
  });
}

test("stages: visibility does not replace the brand_deals feature gate", async () => {
  const f = workspace({ editor: true });
  const id = addDeal(f, "prospect", "5000");
  f.world.role_feature_access.push({ role: "editor", feature_id: "feature-deals", enabled: false });
  for (const result of [
    await patchDeal(f, "editor", id, { stage: "completed" }),
    await postDeal(f, "editor", { name: "x", value: 1, stage: "contracted" }),
    await get(f, "editor", routes.deals, "/api/deals"),
  ]) {
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "FEATURE_DISABLED" });
    assert.deepEqual(result.writes, []);
  }
  assert.equal(dealRow(f, id).stage, "prospect");
});

test("stages: removed, invited-only, outside and signed-out callers cannot move a deal at all", async () => {
  const f = workspace({ editor: true, setter: true });
  const id = addDeal(f, "prospect", "5000");
  const theirs = addDeal(f, "prospect", MONEY.otherWorkspace, f.other);
  f.world.workspace_members.find((m) => m.id === f.rows.editor)!.status = "removed";
  f.world.workspace_members.find((m) => m.id === f.rows.setter)!.status = "invited";
  for (const who of ["editor", "setter"] as const) {
    const moved = await patchDeal(f, who, id, { stage: "completed" });
    assert.equal(moved.status, 403);
    assert.deepEqual(moved.body, { error: "NO_WORKSPACE" });
    assert.deepEqual(moved.writes, []);
  }
  assert.equal((await patchDeal(f, null, id, { stage: "completed" })).status, 401);
  // Another workspace's deal is "not found" even for an owner, and the other workspace's owner
  // cannot reach this one's.
  assert.equal((await patchDeal(f, "owner", theirs, { stage: "completed" })).status, 404);
  assert.equal((await patchDeal(f, "stranger", id, { stage: "completed" })).status, 404);
  assert.equal(dealRow(f, id).stage, "prospect");
  assert.equal(dealRow(f, theirs).stage, "prospect");
});

test("stages: an unreadable setting or profile fails closed for editors, setters and staff — never for owners", async () => {
  for (const failing of ["workspaces", "profiles"]) {
    const f = workspace({ editor: true, setter: true });
    const id = addDeal(f, "prospect", "5000");
    f.world.failingReads = [failing];
    const refused =
      failing === "workspaces" ? (["editor", "setter"] as const) : (["staffEditor"] as const);
    // (With an unreadable profile, staffEditor is an ordinary editor; the flags are ON in this
    // fixture, so make them OFF for that case to isolate the staff exception.)
    if (failing === "profiles")
      Object.assign(
        f.world.workspaces.find((w) => w.id === f.id)!,
        { editor_revenue_visible: false },
      );
    for (const who of refused) {
      const moved = await patchDeal(f, who, id, { stage: "completed" });
      assert.equal(moved.status, 403, `${failing} ${who}`);
      assert.deepEqual(moved.writes, []);
    }
    assert.equal((await patchDeal(f, "owner", id, { stage: "contracted" })).status, 200, failing);
  }
});

test("stages: a hidden viewer's deal cannot reach the closed totals until someone with access moves it", async () => {
  const f = workspace();
  const closedBefore = (
    (await get(f, "owner", routes.reportsSummary, "/api/reports/summary")).body.data as {
      dealsClosedThisPeriod: number;
    }
  ).dealsClosedThisPeriod;
  const created = await postDeal(f, "editor", { name: "Unvalued", stage: "negotiating" });
  const id = (created.body.data as DealOut).id;
  for (const stage of FINANCIAL)
    assert.equal((await patchDeal(f, "editor", id, { stage })).status, 403);
  const closedAfter = (
    (await get(f, "owner", routes.reportsSummary, "/api/reports/summary")).body.data as {
      dealsClosedThisPeriod: number;
    }
  ).dealsClosedThisPeriod;
  assert.equal(closedAfter, closedBefore, "no unvalued deal was counted as closed");
  // An owner sets the value and completes it: now it counts, with a real figure.
  assert.equal((await patchDeal(f, "owner", id, { value: 1200, stage: "completed" })).status, 200);
  const summary = (await get(f, "owner", routes.reportsSummary, "/api/reports/summary")).body
    .data as { dealsClosedThisPeriod: number; revenueThisPeriod: number };
  assert.equal(summary.dealsClosedThisPeriod, closedBefore + 1);
  assert.equal(summary.revenueThisPeriod, Number(MONEY.closedDeal) + 1200);
});

test("stages: the rule lives in one policy function, used by the server and the page", () => {
  const api = flat("src/routes/api.deals.ts");
  assert.equal(
    api.match(/!access\.canWrite && dealStageChangeNeedsRevenueAccess\(/g)?.length,
    2,
    "create and update",
  );
  assert.match(api, /dealStageChangeNeedsRevenueAccess\(null, input\.stage\)/);
  assert.match(api, /dealStageChangeNeedsRevenueAccess\(currentStage, newStage\)/);
  // No role names and no deal value in the decision.
  assert.doesNotMatch(api, /workspaceRole|"editor"|"setter"|"owner"|"manager"/);
  assert.match(api, /\.select\("closed_at, stage"\)/, "the stage is read; the value is not");
  const page = flat("src/routes/brand-deals.tsx");
  assert.match(
    page,
    /hideValue && dealStageChangeNeedsRevenueAccess\(deal\?\.stage \?\? null, s\)/,
  );
  assert.match(page, /disabled=\{locked\}/);
  assert.match(
    page,
    /!\(valuesHidden && dealStageChangeNeedsRevenueAccess\(null, s\.stage\)\) && \(/,
  );
  assert.ok(
    page.includes("Moving a deal into or out of Contracted or Completed needs revenue access."),
  );
  assert.doesNotMatch(
    page,
    /"contracted"\) \|\| .*valuesHidden|stage === "completed" && valuesHidden/,
    "no second copy of the rule",
  );
});
