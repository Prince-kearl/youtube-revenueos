// Scale-only Team Management: who may do what, on which plan — exercised through the real route
// handlers against an in-memory database (tests/helpers/team-fake-api.ts), so each case proves
// both the answer and that a refused request wrote nothing and sent nothing.
import {
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  member,
  uuid,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const route = await import("../src/routes/api.workspace.members");
const { resolveTeamManagementEntitlement, SUPERADMIN_TEAM_EXCEPTION_ENABLED } =
  await import("../src/lib/server/workspace-entitlements");
const policy = await import("../src/lib/team-policy");

const PLAN_REQUIRED = {
  error: "PLAN_REQUIRED",
  message: "Team management is available on Scale.",
  requiredPlan: "scale",
};

/** A workspace with one of each role. `plan` is the OWNER's subscription ("none" for no row). */
function team(plan: string = "scale", status = "active") {
  const world = emptyWorld();
  const owner = addUser(world, "owner@x.test");
  const manager = addUser(world, "manager@x.test");
  const manager2 = addUser(world, "manager2@x.test");
  const setter = addUser(world, "setter@x.test");
  const editor = addUser(world, "editor@x.test");
  const workspace = addWorkspace(world, owner);
  if (plan !== "none") addSubscription(world, owner, plan, status);
  const rows = {
    owner: world.workspace_members[0].id as string,
    manager: addMember(world, workspace, manager, "manager", {
      lead_share: 11,
      commission: 37,
      cost_amount: 4321,
    }),
    manager2: addMember(world, workspace, manager2, "manager", {
      lead_share: 12,
      commission: 38,
      cost_amount: 4322,
    }),
    setter: addMember(world, workspace, setter, "setter", {
      lead_share: 13,
      commission: 39,
      cost_amount: 4323,
    }),
    editor: addMember(world, workspace, editor, "editor", {
      lead_share: 14,
      commission: 41,
      cost_amount: 4324,
    }),
  };
  Object.assign(member(world, rows.owner), { lead_share: 15, commission: 42, cost_amount: 4325 });
  return { world, workspace, users: { owner, manager, manager2, setter, editor }, rows };
}

const invite = (world: World, as: string | null, body: Record<string, unknown>) =>
  callTeamApi(route, world, { as, method: "POST", body });
const patch = (world: World, as: string | null, id: string, body: Record<string, unknown>) =>
  callTeamApi(route, world, { as, method: "PATCH", query: `?id=${id}`, body });
const remove = (world: World, as: string | null, id: string) =>
  callTeamApi(route, world, { as, method: "DELETE", query: `?id=${id}` });
const list = (world: World, as: string | null) => callTeamApi(route, world, { as, method: "GET" });

const snapshot = (world: World) => JSON.stringify(world.workspace_members);
/** Asserts a refusal that touched nothing: no write, no email, roster byte-identical. */
function assertRefusedCleanly(
  before: string,
  world: World,
  result: Awaited<ReturnType<typeof invite>>,
) {
  assert.deepEqual(result.writes, [], "a refused request must not write");
  assert.deepEqual(result.invitesSent, [], "a refused request must not send an invite");
  assert.equal(snapshot(world), before, "the roster must be unchanged");
}

// ---------- A. the plan entitlement ----------

test("an owner on Scale can invite: a pending member is created and the invite is sent", async () => {
  const { world, users, workspace } = team("scale");
  const result = await invite(world, users.owner, { email: "new@x.test", role: "editor" });
  assert.equal(result.status, 201);
  assert.deepEqual(result.invitesSent, ["new@x.test"]);
  const created = world.workspace_members.find((m) => m.invited_email === "new@x.test")!;
  assert.equal(created.status, "invited");
  assert.equal(created.workspace_id, workspace);
  assert.equal(created.invited_by, users.owner);
});

test("a Scale trial grants team management", async () => {
  const { world, users } = team("scale", "trialing");
  assert.equal(
    (await invite(world, users.owner, { email: "new@x.test", role: "editor" })).status,
    201,
  );
});

for (const [label, plan, status] of [
  ["Starter", "starter", "active"],
  ["Pro", "pro", "active"],
  ["a Pro trial", "pro", "trialing"],
  ["a Starter trial", "starter", "trialing"],
  ["no subscription", "none", "active"],
  ["a past-due Scale subscription", "scale", "past_due"],
  ["a canceled Scale subscription", "scale", "canceled"],
  ["an unpaid Scale subscription", "scale", "unpaid"],
  ["an incomplete Scale subscription", "scale", "incomplete"],
  ["an expired Scale subscription", "scale", "incomplete_expired"],
  ["a plan the app does not recognise", "enterprise-legacy", "active"],
] as const) {
  test(`${label}: inviting is refused with PLAN_REQUIRED and nothing is created`, async () => {
    const { world, users } = team(plan, status);
    const before = snapshot(world);
    const result = await invite(world, users.owner, { email: "new@x.test", role: "editor" });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, PLAN_REQUIRED);
    assertRefusedCleanly(before, world, result);
  });

  test(`${label}: changing a role is refused with PLAN_REQUIRED and nothing is written`, async () => {
    const { world, users, rows } = team(plan, status);
    const before = snapshot(world);
    const result = await patch(world, users.owner, rows.editor, { role: "setter" });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, PLAN_REQUIRED);
    assertRefusedCleanly(before, world, result);
  });
}

test("the plan is the workspace OWNER's: a manager with no subscription can invite in a Scale workspace", async () => {
  const { world, users } = team("scale");
  assert.equal(world.subscriptions.filter((s) => s.user_id === users.manager).length, 0);
  const result = await invite(world, users.manager, { email: "new@x.test", role: "setter" });
  assert.equal(result.status, 201);
});

test("a member's personal Scale subscription grants nothing in a Pro workspace", async () => {
  const { world, users, rows } = team("pro");
  addSubscription(world, users.manager, "scale");
  const before = snapshot(world);
  const invited = await invite(world, users.manager, { email: "new@x.test", role: "setter" });
  assert.deepEqual(invited.body, PLAN_REQUIRED);
  assertRefusedCleanly(before, world, invited);
  const changed = await patch(world, users.manager, rows.editor, { role: "setter" });
  assert.deepEqual(changed.body, PLAN_REQUIRED);
  assertRefusedCleanly(before, world, changed);
});

test("the newest live subscription decides: an older Scale row does not outlive a newer Pro one", async () => {
  const { world, users } = team("none");
  addSubscription(world, users.owner, "scale", "canceled", "2026-01-01T00:00:00Z");
  addSubscription(world, users.owner, "pro", "active", "2026-06-01T00:00:00Z");
  assert.deepEqual(
    (await invite(world, users.owner, { email: "n@x.test", role: "editor" })).body,
    PLAN_REQUIRED,
  );
});

test("plan and workspace named in the request are ignored", async () => {
  const { world, users, rows } = team("pro");
  const other = addWorkspace(world, addUser(world, "elsewhere@x.test"));
  const before = snapshot(world);
  const invited = await invite(world, users.owner, {
    email: "new@x.test",
    role: "editor",
    plan: "scale",
    planId: "scale",
    requiredPlan: "starter",
    workspaceId: other,
    workspace_id: other,
    entitlement: { allowed: true },
  });
  assert.deepEqual(invited.body, PLAN_REQUIRED);
  assertRefusedCleanly(before, world, invited);
  const changed = await patch(world, users.owner, rows.editor, {
    role: "setter",
    plan: "scale",
    teamManagement: { allowed: true },
  });
  assert.deepEqual(changed.body, PLAN_REQUIRED);
});

test("if the workspace's plan cannot be determined, the action is refused — but not as an upsell", async () => {
  const { world, users } = team("scale");
  world.failingReads = ["workspaces"];
  const before = snapshot(world);
  const result = await invite(world, users.owner, { email: "new@x.test", role: "editor" });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "ENTITLEMENT_UNAVAILABLE" });
  assertRefusedCleanly(before, world, result);
});

test("a subscription lookup that fails is treated as no plan (fails closed)", async () => {
  const { world, users } = team("scale");
  world.failingReads = ["subscriptions"];
  const before = snapshot(world);
  const result = await invite(world, users.owner, { email: "new@x.test", role: "editor" });
  assert.equal(result.status, 403);
  assertRefusedCleanly(before, world, result);
});

// ---------- B. roles are independent of the plan ----------

test("Scale never grants what a role forbids: an editor and a setter cannot invite", async () => {
  const { world, users } = team("scale");
  for (const who of [users.editor, users.setter]) {
    const before = snapshot(world);
    const result = await invite(world, who, { email: "new@x.test", role: "editor" });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "CANNOT_MANAGE_MEMBERS" });
    assertRefusedCleanly(before, world, result);
  }
});

test("a role restriction is never reported as a plan restriction", async () => {
  const { world, users, rows } = team("starter");
  assert.deepEqual(
    (await invite(world, users.editor, { email: "n@x.test", role: "editor" })).body,
    { error: "CANNOT_MANAGE_MEMBERS" },
  );
  assert.deepEqual((await patch(world, users.setter, rows.editor, { role: "setter" })).body, {
    error: "CANNOT_MANAGE_MEMBERS",
  });
  assert.deepEqual(
    (await invite(world, users.manager, { email: "n@x.test", role: "manager" })).body,
    { error: "CANNOT_ASSIGN_ROLE" },
  );
});

test("a manager on Scale cannot create or promote a peer or a superior", async () => {
  const { world, users, rows } = team("scale");
  for (const role of ["owner", "manager"]) {
    const before = snapshot(world);
    const invited = await invite(world, users.manager, { email: "n@x.test", role });
    assert.deepEqual(invited.body, { error: "CANNOT_ASSIGN_ROLE" });
    assertRefusedCleanly(before, world, invited);
    const promoted = await patch(world, users.manager, rows.setter, { role });
    assert.deepEqual(promoted.body, { error: "CANNOT_ASSIGN_ROLE" });
    assertRefusedCleanly(before, world, promoted);
  }
  // …nor change the role of the owner or of a fellow manager
  for (const target of [rows.owner, rows.manager2]) {
    const result = await patch(world, users.manager, target, { role: "editor" });
    assert.deepEqual(result.body, { error: "CANNOT_ASSIGN_ROLE" });
  }
  // …but can move a setter to editor
  const ok = await patch(world, users.manager, rows.setter, { role: "editor" });
  assert.equal(ok.status, 200);
  assert.equal(member(world, rows.setter).role, "editor");
});

test("nobody can change their own role", async () => {
  const { world, users, rows } = team("scale");
  for (const [who, row] of [
    [users.owner, rows.owner],
    [users.manager, rows.manager],
    [users.editor, rows.editor],
  ] as const) {
    const before = snapshot(world);
    const result = await patch(world, who, row, { role: "owner" });
    assert.deepEqual(result.body, { error: "CANNOT_CHANGE_OWN_ROLE" });
    assertRefusedCleanly(before, world, result);
  }
});

// ---------- C. the superadmin exception ----------

function staffWorkspace(staffWorkspaceRole: "owner" | "editor" | "manager") {
  const world = emptyWorld();
  const staff = addUser(world, "staff@x.test", "superadmin");
  const owner = staffWorkspaceRole === "owner" ? staff : addUser(world, "o@x.test");
  const workspace = addWorkspace(world, owner);
  const staffRow =
    staffWorkspaceRole === "owner"
      ? (world.workspace_members[0].id as string)
      : addMember(world, workspace, staff, staffWorkspaceRole);
  const editor = addMember(world, workspace, addUser(world, "e@x.test"), "editor");
  return { world, staff, workspace, staffRow, editor };
}

test("the exception is switched on, and is a single documented constant", () => {
  assert.equal(SUPERADMIN_TEAM_EXCEPTION_ENABLED, true);
  const source = readFileSync("src/lib/server/workspace-entitlements.ts", "utf8");
  assert.equal(source.match(/export const SUPERADMIN_TEAM_EXCEPTION_ENABLED/g)?.length, 1);
  assert.match(source, /To retire it, set this to false/);
  // No identity is hardcoded: the only source is the trusted profiles.role.
  assert.doesNotMatch(source, /@[a-z0-9-]+\.[a-z]{2,}/i, "no email addresses");
  assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-/i, "no user ids");
});

test("a superadmin who owns a workspace with no subscription can invite and change roles", async () => {
  const { world, staff, editor } = staffWorkspace("owner");
  assert.equal(world.subscriptions.length, 0);
  const invited = await invite(world, staff, { email: "new@x.test", role: "editor" });
  assert.equal(invited.status, 201);
  assert.equal((await patch(world, staff, editor, { role: "setter" })).status, 200);
  assert.equal(world.subscriptions.length, 0, "no complimentary subscription is created");
  const listed = await list(world, staff);
  assert.deepEqual((listed.body.meta as Record<string, unknown>).teamManagement, {
    allowed: true,
    reason: "superadmin_exception",
    requiredPlan: "scale",
  });
});

test("the exception waives the plan only — a superadmin who is an editor still cannot manage", async () => {
  const { world, staff, editor } = staffWorkspace("editor");
  const before = snapshot(world);
  const invited = await invite(world, staff, { email: "new@x.test", role: "editor" });
  assert.deepEqual(invited.body, { error: "CANNOT_MANAGE_MEMBERS" });
  assertRefusedCleanly(before, world, invited);
  assert.deepEqual((await patch(world, staff, editor, { role: "setter" })).body, {
    error: "CANNOT_MANAGE_MEMBERS",
  });
  assert.deepEqual((await remove(world, staff, editor)).body, { error: "CANNOT_MANAGE_MEMBERS" });
});

test("…and a superadmin who is a manager is still bound by the hierarchy", async () => {
  const { world, staff, workspace } = staffWorkspace("manager");
  const ownerRow = world.workspace_members.find(
    (m) => m.workspace_id === workspace && m.role === "owner",
  )!.id as string;
  assert.deepEqual((await invite(world, staff, { email: "n@x.test", role: "manager" })).body, {
    error: "CANNOT_ASSIGN_ROLE",
  });
  assert.deepEqual((await remove(world, staff, ownerRow)).body, { error: "CANNOT_REMOVE_MEMBER" });
  assert.deepEqual((await patch(world, staff, ownerRow, { commission: 5 })).body, {
    error: "CANNOT_EDIT_COMPENSATION",
  });
  assert.equal((await invite(world, staff, { email: "n@x.test", role: "setter" })).status, 201);
});

test("a superadmin has no reach into a workspace they are not a member of", async () => {
  const { world, staff } = staffWorkspace("owner");
  const elsewhere = addWorkspace(world, addUser(world, "elsewhere@x.test"));
  const stranger = addMember(world, elsewhere, addUser(world, "s@x.test"), "editor", {
    commission: 77,
  });
  const before = snapshot(world);
  for (const result of [
    await patch(world, staff, stranger, { role: "setter" }),
    await patch(world, staff, stranger, { commission: 1 }),
    await remove(world, staff, stranger),
  ]) {
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "MEMBER_NOT_FOUND" });
    assertRefusedCleanly(before, world, result);
  }
  const listed = await list(world, staff);
  assert.ok(!listed.text.includes(stranger), "another workspace's roster is not listed");
  // An invite always lands in the caller's own workspace, whatever the body says.
  await invite(world, staff, { email: "new@x.test", role: "editor", workspaceId: elsewhere });
  assert.notEqual(
    world.workspace_members.find((m) => m.invited_email === "new@x.test")!.workspace_id,
    elsewhere,
  );
});

test("a superadmin with no workspace membership is refused before anything else", async () => {
  const world = emptyWorld();
  const staff = addUser(world, "staff@x.test", "superadmin");
  addWorkspace(world, addUser(world, "o@x.test"));
  const result = await invite(world, staff, { email: "new@x.test", role: "editor" });
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "NO_WORKSPACE" });
  assert.deepEqual(result.writes, []);
});

for (const platformRole of ["user", "admin", "owner", "manager", "support", "Superadmin", ""]) {
  test(`platform role ${JSON.stringify(platformRole)} does not qualify for the exception`, async () => {
    const world = emptyWorld();
    const user = addUser(world, "u@x.test", platformRole);
    addWorkspace(world, user);
    assert.deepEqual(
      (await invite(world, user, { email: "n@x.test", role: "editor" })).body,
      PLAN_REQUIRED,
    );
  });
}

test("the exception can be switched off, and then a superadmin needs Scale like anyone else", async () => {
  const { world, staff, workspace } = staffWorkspace("owner");
  const service = createClient("https://testref.supabase.co", "service-key");
  const resolve = (superadminException: boolean) =>
    resolveTeamManagementEntitlement(
      service,
      { workspaceId: workspace, userId: staff },
      { superadminException },
    );
  // Reuse the fake database by routing this client's requests through one API call's lifetime.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const table = url.pathname.split("/").pop()!;
    const rows = (world as unknown as Record<string, Array<Record<string, unknown>>>)[table];
    const filters = [...url.searchParams].filter(([, v]) => v.startsWith("eq."));
    const found = rows.filter((r) => filters.every(([k, v]) => String(r[k]) === v.slice(3)));
    const live = table === "subscriptions" ? [] : found;
    return new Response(JSON.stringify(live), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    assert.deepEqual(await resolve(true), {
      allowed: true,
      reason: "superadmin_exception",
      requiredPlan: "scale",
    });
    assert.deepEqual(await resolve(false), {
      allowed: false,
      reason: "plan_required",
      requiredPlan: "scale",
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an unreadable profile does not grant the exception", async () => {
  const { world, staff } = staffWorkspace("owner");
  world.failingReads = ["profiles"];
  const result = await invite(world, staff, { email: "new@x.test", role: "editor" });
  assert.notEqual(result.status, 201);
  assert.deepEqual(result.invitesSent, []);
});

// ---------- D. PATCH: field-level authorisation ----------

test("no member below owner can change their own lead share, commission or cost", async () => {
  for (const plan of ["scale", "pro", "none"]) {
    const { world, users, rows } = team(plan);
    for (const [who, row] of [
      [users.manager, rows.manager],
      [users.setter, rows.setter],
      [users.editor, rows.editor],
    ] as const) {
      for (const body of [
        { commission: 100 },
        { leadShare: 100 },
        { costAmount: 999999 },
        { commission: 100, leadShare: 100, costAmount: 1 },
      ]) {
        const before = snapshot(world);
        const result = await patch(world, who, row, body);
        assert.equal(result.status, 403, `${plan} ${JSON.stringify(body)}`);
        assert.deepEqual(result.body, { error: "CANNOT_EDIT_COMPENSATION" });
        assertRefusedCleanly(before, world, result);
      }
    }
  }
});

test("a member can edit their own job title on any plan — and only that is written", async () => {
  for (const plan of ["scale", "starter", "none"]) {
    const { world, users, rows } = team(plan);
    const result = await patch(world, users.setter, rows.setter, { jobTitle: "Closer" });
    assert.equal(result.status, 200, plan);
    assert.deepEqual(
      result.writes.map((w) => w.body),
      [{ job_title: "Closer" }],
    );
    assert.equal(member(world, rows.setter).commission, 39);
  }
});

test("a permitted field cannot carry a forbidden one: the whole request is refused", async () => {
  const { world, users, rows } = team("scale");
  const before = snapshot(world);
  const own = await patch(world, users.setter, rows.setter, { jobTitle: "Closer", commission: 90 });
  assert.deepEqual(own.body, { error: "CANNOT_EDIT_COMPENSATION" });
  assertRefusedCleanly(before, world, own);
  assert.equal(member(world, rows.setter).job_title, null, "the job title was not written either");

  const mgr = await patch(world, users.manager, rows.owner, { jobTitle: "x", costAmount: 1 });
  assert.equal(mgr.status, 403);
  assertRefusedCleanly(before, world, mgr);
});

test("role + compensation on a non-Scale workspace: refused whole, compensation not written", async () => {
  const { world, users, rows } = team("pro");
  const before = snapshot(world);
  const result = await patch(world, users.owner, rows.editor, {
    role: "setter",
    commission: 55,
    jobTitle: "x",
  });
  assert.deepEqual(result.body, PLAN_REQUIRED);
  assertRefusedCleanly(before, world, result);
});

test("compensation and job title edits by an authorised manager need no plan", async () => {
  for (const plan of ["scale", "pro", "none"]) {
    const { world, users, rows } = team(plan);
    const byOwner = await patch(world, users.owner, rows.manager, {
      commission: 20,
      costAmount: 5,
    });
    assert.equal(byOwner.status, 200, plan);
    assert.equal(member(world, rows.manager).commission, 20);
    const byManager = await patch(world, users.manager, rows.setter, { leadShare: 50 });
    assert.equal(byManager.status, 200, plan);
    assert.equal(member(world, rows.setter).lead_share, 50);
    assert.equal((await patch(world, users.owner, rows.owner, { commission: 3 })).status, 200);
  }
});

test("a manager cannot change the compensation or details of the owner or a fellow manager", async () => {
  const { world, users, rows } = team("scale");
  for (const target of [rows.owner, rows.manager2]) {
    const before = snapshot(world);
    const money = await patch(world, users.manager, target, { commission: 1 });
    assert.deepEqual(money.body, { error: "CANNOT_EDIT_COMPENSATION" });
    assertRefusedCleanly(before, world, money);
    const title = await patch(world, users.manager, target, { jobTitle: "Demoted" });
    assert.deepEqual(title.body, { error: "CANNOT_EDIT_MEMBER" });
    assertRefusedCleanly(before, world, title);
  }
});

test("a setter or editor cannot edit anyone else at all", async () => {
  const { world, users, rows } = team("scale");
  for (const body of [{ jobTitle: "x" }, { commission: 1 }, { role: "editor" }]) {
    const before = snapshot(world);
    const result = await patch(world, users.setter, rows.editor, body);
    assert.deepEqual(result.body, { error: "CANNOT_MANAGE_MEMBERS" });
    assertRefusedCleanly(before, world, result);
  }
});

test("only allowlisted fields can ever be written", async () => {
  const { world, users, rows, workspace } = team("scale");
  const elsewhere = addWorkspace(world, addUser(world, "elsewhere@x.test"));
  const hostile = {
    status: "removed",
    workspace_id: elsewhere,
    workspaceId: elsewhere,
    user_id: users.owner,
    invited_by: users.setter,
    id: uuid(),
    joined_at: "1999-01-01",
    plan: "scale",
  };
  const before = snapshot(world);
  const nothing = await patch(world, users.owner, rows.editor, hostile);
  assert.equal(nothing.status, 422);
  assert.deepEqual(nothing.body, { error: "NO_CHANGES" });
  assertRefusedCleanly(before, world, nothing);

  const mixed = await patch(world, users.owner, rows.editor, { ...hostile, jobTitle: "Editor II" });
  assert.equal(mixed.status, 200);
  assert.deepEqual(
    mixed.writes.map((w) => w.body),
    [{ job_title: "Editor II" }],
  );
  const row = member(world, rows.editor);
  assert.equal(row.status, "active");
  assert.equal(row.workspace_id, workspace);
  assert.equal(row.user_id, users.editor);
});

test("out-of-range and malformed values are rejected before any lookup", async () => {
  const { world, users, rows } = team("scale");
  for (const body of [
    { commission: 101 },
    { leadShare: -1 },
    { costAmount: -5 },
    { commission: "50" },
    { role: "superadmin" },
    { role: "admin" },
  ]) {
    const result = await patch(world, users.owner, rows.editor, body);
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.deepEqual(result.writes, []);
  }
  assert.equal((await patch(world, users.owner, "not-a-uuid", { jobTitle: "x" })).status, 422);
  assert.equal(
    (await invite(world, users.owner, { email: "new@x.test", role: "superadmin" })).status,
    422,
  );
});

// ---------- E. DELETE ----------

test("removing a member and cancelling an invite need no plan", async () => {
  for (const plan of ["none", "starter", "pro", "scale"]) {
    const { world, users, rows, workspace } = team(plan);
    const pending = addMember(world, workspace, null, "editor");
    const removed = await remove(world, users.owner, rows.setter);
    assert.equal(removed.status, 200, plan);
    assert.equal(member(world, rows.setter).status, "removed");
    const cancelled = await remove(world, users.owner, pending);
    assert.equal(cancelled.status, 200, plan);
    assert.equal(member(world, pending).status, "removed");
    assert.equal(world.workspace_members.length, 6, "rows are kept, never deleted");
  }
});

test("a manager can remove only setters and editors", async () => {
  const { world, users, rows } = team("scale");
  for (const target of [rows.owner, rows.manager2]) {
    const before = snapshot(world);
    const result = await remove(world, users.manager, target);
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "CANNOT_REMOVE_MEMBER" });
    assertRefusedCleanly(before, world, result);
  }
  assert.equal((await remove(world, users.manager, rows.setter)).status, 200);
  assert.equal((await remove(world, users.manager, rows.editor)).status, 200);
});

test("a setter or editor cannot remove anyone else, but may leave", async () => {
  const { world, users, rows } = team("starter");
  for (const target of [rows.owner, rows.manager, rows.setter]) {
    const before = snapshot(world);
    const result = await remove(world, users.editor, target);
    assert.deepEqual(result.body, { error: "CANNOT_MANAGE_MEMBERS" });
    assertRefusedCleanly(before, world, result);
  }
  assert.equal((await remove(world, users.editor, rows.editor)).status, 200);
  assert.equal(member(world, rows.editor).status, "removed");
});

test("the last owner can never be removed", async () => {
  const { world, users, rows, workspace } = team("scale");
  const before = snapshot(world);
  const result = await remove(world, users.owner, rows.owner);
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: "LAST_OWNER" });
  assertRefusedCleanly(before, world, result);

  // With a second owner, one of them may go — and then the remaining one may not.
  const second = addUser(world, "owner2@x.test");
  const secondRow = addMember(world, workspace, second, "owner");
  assert.equal((await remove(world, second, rows.owner)).status, 200);
  assert.deepEqual((await remove(world, second, secondRow)).body, { error: "LAST_OWNER" });
});

test("members of another workspace cannot be read, edited or removed", async () => {
  const { world, users } = team("scale");
  const elsewhere = addWorkspace(world, addUser(world, "elsewhere@x.test"));
  const stranger = addMember(world, elsewhere, addUser(world, "s@x.test"), "editor", {
    commission: 77,
    cost_amount: 7654,
  });
  const before = snapshot(world);
  for (const result of [
    await patch(world, users.owner, stranger, { commission: 1 }),
    await patch(world, users.owner, stranger, { role: "setter" }),
    await remove(world, users.owner, stranger),
  ]) {
    assert.equal(result.status, 404);
    assertRefusedCleanly(before, world, result);
  }
  const listed = await list(world, users.owner);
  assert.ok(!listed.text.includes(stranger) && !listed.text.includes("7654"));
});

// ---------- F. who is let in at all ----------

test("a signed-out request is refused with 401 on every method", async () => {
  const { world, rows } = team("scale");
  const before = snapshot(world);
  for (const result of [
    await list(world, null),
    await invite(world, null, { email: "n@x.test", role: "editor" }),
    await patch(world, null, rows.editor, { commission: 1 }),
    await remove(world, null, rows.editor),
  ]) {
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: "AUTH_REQUIRED" });
    assertRefusedCleanly(before, world, result);
  }
});

test("a removed member is no longer a member", async () => {
  const { world, users, rows } = team("scale");
  member(world, rows.manager).status = "removed";
  for (const result of [
    await list(world, users.manager),
    await invite(world, users.manager, { email: "n@x.test", role: "editor" }),
    await remove(world, users.manager, rows.setter),
  ]) {
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "NO_WORKSPACE" });
    assert.deepEqual(result.writes, []);
  }
});

test("the team feature switch still applies, and is not reported as a plan restriction", async () => {
  const { world, users } = team("pro");
  world.role_feature_access.push({ role: "editor", feature_id: "feature-team", enabled: false });
  const result = await list(world, users.editor);
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "FEATURE_DISABLED" });
});

// ---------- G. who can see compensation ----------

const MONEY: Record<string, string[]> = {
  owner: ["15", "42", "4325"],
  manager: ["11", "37", "4321"],
  manager2: ["12", "38", "4322"],
  setter: ["13", "39", "4323"],
  editor: ["14", "41", "4324"],
};
type Listed = {
  id: string;
  lead_share: number | null;
  commission: number | null;
  cost_amount: number | null;
  compensation_visible: boolean;
};

for (const [viewer, sees] of [
  ["owner", ["owner", "manager", "manager2", "setter", "editor"]],
  ["manager", ["manager", "setter", "editor"]],
  ["setter", ["setter"]],
  ["editor", ["editor"]],
] as const) {
  test(`the API shows a ${viewer} the compensation of: ${sees.join(", ")} — and no one else's`, async () => {
    for (const plan of ["scale", "none"]) {
      const { world, users, rows } = team(plan);
      const result = await list(world, users[viewer]);
      assert.equal(result.status, 200);
      const data = result.body.data as Listed[];
      assert.equal(data.length, 5, "every member is still listed");
      for (const [name, id] of Object.entries(rows)) {
        const row = data.find((m) => m.id === id)!;
        const visible = (sees as readonly string[]).includes(name);
        assert.equal(row.compensation_visible, visible, `${viewer} → ${name}`);
        if (visible) {
          assert.equal(String(row.commission), MONEY[name][1]);
          assert.equal(String(row.cost_amount), MONEY[name][2]);
        } else {
          assert.equal(row.lead_share, null);
          assert.equal(row.commission, null);
          assert.equal(row.cost_amount, null);
          // …and the figure appears nowhere else in the response either
          assert.ok(!result.text.includes(MONEY[name][2]), `${name}'s cost leaked to ${viewer}`);
        }
      }
    }
  });
}

test("responses to writes are redacted too", async () => {
  const { world, users, rows } = team("scale");
  member(world, rows.editor).cost_amount = 8765;
  const own = await patch(world, users.setter, rows.setter, { jobTitle: "Closer" });
  assert.equal((own.body.data as Listed).compensation_visible, true);
  // A manager inviting at a role they manage sees what they just set; nothing above them leaks.
  const invited = await invite(world, users.manager, {
    email: "new@x.test",
    role: "setter",
    commission: 9,
  });
  assert.equal((invited.body.data as Listed).commission, 9);
});

test("the roster is read with the service role, scoped to the caller's workspace", async () => {
  const { world, users, workspace } = team("scale");
  const result = await list(world, users.editor);
  const rosterRead = result.reads.find(
    (r) => r.table === "workspace_members" && String(r.body).includes("member%3Aprofiles"),
  )!;
  assert.equal(rosterRead.as, "service");
  assert.ok(String(rosterRead.body).includes(`workspace_id=eq.${workspace}`));
});

test("the list tells the page what it needs to choose controls, and no billing detail", async () => {
  const { world, users, rows } = team("pro");
  const result = await list(world, users.manager);
  assert.deepEqual(result.body.meta, {
    role: "manager",
    memberId: rows.manager,
    teamManagement: { allowed: false, reason: "plan_required", requiredPlan: "scale" },
  });
  assert.ok(!/"pro"|stripe|subscription|price/i.test(result.text));
});

test("viewing the team works on every plan, and when the plan cannot be determined", async () => {
  for (const plan of ["none", "starter", "pro", "scale"]) {
    const { world, users } = team(plan);
    assert.equal((await list(world, users.editor)).status, 200, plan);
  }
  const { world, users } = team("scale");
  world.failingReads = ["workspaces"];
  const result = await list(world, users.owner);
  assert.equal(result.status, 200);
  assert.deepEqual((result.body.meta as Record<string, unknown>).teamManagement, {
    allowed: false,
    reason: "unavailable",
    requiredPlan: "scale",
  });
});

// ---------- H. downgrade ----------

test("after a downgrade: everyone stays, roles keep working, only expansion is blocked", async () => {
  const { world, users, rows } = team("scale");
  const sub = world.subscriptions[0];
  sub.status = "canceled";
  const before = snapshot(world);

  const listed = await list(world, users.manager);
  assert.equal((listed.body.data as Listed[]).length, 5);
  assert.equal(snapshot(world), before, "nobody was removed or changed by the downgrade");

  assert.deepEqual(
    (await invite(world, users.owner, { email: "n@x.test", role: "editor" })).body,
    PLAN_REQUIRED,
  );
  assert.deepEqual(
    (await patch(world, users.owner, rows.editor, { role: "setter" })).body,
    PLAN_REQUIRED,
  );
  assert.equal((await patch(world, users.owner, rows.editor, { commission: 8 })).status, 200);
  assert.equal((await patch(world, users.editor, rows.editor, { jobTitle: "x" })).status, 200);
  assert.equal((await remove(world, users.manager, rows.setter)).status, 200);

  // Re-subscribing restores it with no other change.
  sub.status = "active";
  assert.equal(
    (await invite(world, users.owner, { email: "n@x.test", role: "editor" })).status,
    201,
  );
});

// ---------- I. the invite flow itself ----------

test("an invite that cannot be emailed leaves no pending member behind", async () => {
  const { world, users } = team("scale");
  world.inviteStatus = 500;
  const result = await invite(world, users.owner, { email: "new@x.test", role: "editor" });
  assert.equal(result.status, 502);
  assert.equal(
    world.workspace_members.some((m) => m.invited_email === "new@x.test"),
    false,
  );
});

test("an existing account with a workspace of its own is not pulled into another", async () => {
  const { world, users } = team("scale");
  addWorkspace(world, addUser(world, "taken@x.test"));
  const result = await invite(world, users.owner, { email: "taken@x.test", role: "editor" });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: "ALREADY_HAS_WORKSPACE" });
  assert.deepEqual(result.writes, []);
});

// ---------- J. the policy functions, exhaustively ----------

const ROLES = ["owner", "manager", "setter", "editor"] as const;
const entitled = { allowed: true, reason: "plan", requiredPlan: "scale" } as const;

test("policy: no combination of role and target lets a non-entitled workspace invite or re-role", () => {
  for (const reason of ["plan_required", "unavailable"] as const) {
    const entitlement = { allowed: false, reason, requiredPlan: "scale" } as const;
    for (const actorRole of ROLES)
      for (const other of ROLES) {
        assert.equal(
          policy.authorizeInvite({ actorRole, inviteRole: other, entitlement }).ok,
          false,
        );
        for (const role of ROLES)
          for (const isSelf of [true, false])
            assert.equal(
              policy.authorizeMemberUpdate({
                actorRole,
                isSelf,
                targetRole: other,
                changes: { role, compensation: false, jobTitle: false },
                entitlement,
              }).ok,
              false,
            );
      }
  }
});

test("policy: entitlement never widens what a role may do", () => {
  for (const actorRole of ROLES)
    for (const targetRole of ROLES) {
      const manages =
        actorRole === "owner" ||
        (actorRole === "manager" && (targetRole === "setter" || targetRole === "editor"));
      assert.equal(
        policy.authorizeInvite({ actorRole, inviteRole: targetRole, entitlement: entitled }).ok,
        manages,
      );
      assert.equal(
        policy.authorizeMemberRemoval({ actorRole, isSelf: false, targetRole }).ok,
        manages,
      );
      assert.equal(
        policy.authorizeMemberUpdate({
          actorRole,
          isSelf: false,
          targetRole,
          changes: { compensation: true, jobTitle: false },
          entitlement: entitled,
        }).ok,
        manages,
      );
      assert.equal(
        policy.canViewCompensation({
          viewerRole: actorRole,
          isSelf: false,
          memberRole: targetRole,
        }),
        manages,
      );
    }
});

test("policy: what the Team page offers where Invite goes", () => {
  const no = { allowed: false, reason: "plan_required", requiredPlan: "scale" } as const;
  const unknown = { allowed: false, reason: "unavailable", requiredPlan: "scale" } as const;
  assert.equal(policy.teamInviteState({ role: undefined, entitlement: entitled }), "hidden");
  assert.equal(policy.teamInviteState({ role: "owner", entitlement: null }), "hidden");
  assert.equal(policy.teamInviteState({ role: "owner", entitlement: unknown }), "hidden");
  assert.equal(policy.teamInviteState({ role: "owner", entitlement: entitled }), "invite");
  assert.equal(policy.teamInviteState({ role: "manager", entitlement: entitled }), "invite");
  assert.equal(policy.teamInviteState({ role: "owner", entitlement: no }), "upgrade");
  assert.equal(policy.teamInviteState({ role: "manager", entitlement: no }), "upgrade");
  for (const role of ["setter", "editor"] as const)
    for (const entitlement of [entitled, no, unknown])
      assert.equal(policy.teamInviteState({ role, entitlement }), "role_restricted");
});

// ---------- K. the Team page and the migration ----------

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

test("the Team page takes its rules from the shared policy and never invents its own", () => {
  const page = flat("src/routes/team.tsx");
  assert.match(page, /from "@\/lib\/team-policy"/);
  assert.doesNotMatch(page, /function canManageMembers|function canAssignRole/);
  assert.match(page, /inviteState === "invite" && \( <button/);
  assert.match(page, /status === "ready" \? teamInviteState\(/, "nothing is offered while loading");
  assert.match(page, /open=\{inviting && inviteState === "invite"\}/);
});

test("the Team page shows the approved upgrade and role-restriction copy", () => {
  const page = flat("src/routes/team.tsx");
  assert.ok(page.includes("Manage your team with Scale"));
  assert.ok(
    page.includes(
      "Invite collaborators, assign roles, and manage your growing creator operation with Tubify Scale.",
    ),
  );
  assert.match(page, /<Link to="\/billing"[^>]*> Upgrade to Scale <\/Link>/);
  assert.ok(page.includes("You don't have permission to manage team members."));
  assert.doesNotMatch(page, /upgrade[^.<]*to remove/i);
});

test("the Team page keeps the roster and removal on every plan, and hides withheld figures", () => {
  const page = flat("src/routes/team.tsx");
  assert.match(page, /canRemove: !isSelf && manages,/, "removal does not consult the plan");
  assert.match(page, /\{m\.compensation_visible && \(/);
  assert.match(page, /body: JSON\.stringify\(changes\)/, "only changed, permitted fields are sent");
  assert.doesNotMatch(
    page,
    /leadShare: Number\(leadShare\) \|\| 0, commission: Number\(commission\) \|\| 0, costAmount: Number\(costAmount\) \|\| 0, \}\), \}\); const body = await response\.json\(\); if \(!response\.ok\) throw new Error\(body\.error \?\? "UPDATE_FAILED"\)/,
  );
});

test("the migration withholds exactly the three compensation columns from member roles", () => {
  const sql = readFileSync(
    "supabase/migrations/202610100001_workspace_member_compensation_privacy.sql",
    "utf8",
  );
  const statements = sql.replace(/--.*$/gm, "").replace(/\s+/g, " ");
  assert.match(
    statements,
    /revoke select on table public\.workspace_members from anon, authenticated;/,
  );
  const granted =
    /grant select \(([^)]+)\) on table public\.workspace_members to anon, authenticated;/
      .exec(statements)![1]
      .split(",")
      .map((c) => c.trim());
  for (const column of policy.COMPENSATION_COLUMNS) assert.ok(!granted.includes(column), column);
  // Everything the member-session code reads must stay granted.
  for (const column of ["id", "workspace_id", "user_id", "role", "status"])
    assert.ok(granted.includes(column), column);
  assert.doesNotMatch(
    statements,
    /\b(drop|delete|update|truncate|alter)\b/i,
    "no data or schema change",
  );
});

test("no member-session code reads a compensation column", () => {
  // The Team API reads them with the service role; nothing else may name them at all.
  for (const file of [
    "src/lib/server/workspace.ts",
    "src/routes/api.features.access.ts",
    "src/routes/api.deals.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    for (const column of policy.COMPENSATION_COLUMNS)
      assert.ok(!source.includes(column), `${file} reads ${column}`);
  }
  const api = flat("src/routes/api.workspace.members.ts");
  assert.doesNotMatch(api, /ctx\.client\s*\.from\("workspace_members"\)/);
});
