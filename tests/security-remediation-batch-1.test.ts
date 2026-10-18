import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_ROLES, canActOnUser, canManageRole, type AppRole } from "../src/lib/server/roles";
import { exactIlikePattern, sameTextIgnoringCase } from "../src/lib/server/exact-match";
import {
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";

// Security remediation, batch 1. Two rules are pinned here, on the real routes:
//
//   1. Taking over or locking out an account (impersonation, password reset, ban) follows the
//      platform role hierarchy: an Owner can never do it to a Superadmin or another Owner.
//   2. A lead-magnet opt-in is attached to an existing lead only when the email address is the
//      same address — never because a pattern character happened to match a different one.

const routes = {
  impersonate: await import("../src/routes/api.admin.users.impersonate"),
  resetPassword: await import("../src/routes/api.admin.users.reset-password"),
  users: await import("../src/routes/api.admin.users"),
  optin: await import("../src/routes/api.freebies.optin"),
};

// ============================================================
// 1. Platform roles: who may act on whom
// ============================================================

test("canActOnUser: a Superadmin on anyone; an Owner only below Owner; nobody else at all", () => {
  for (const target of APP_ROLES) assert.equal(canActOnUser("superadmin", target), true, target);
  const ownerMay: Record<AppRole, boolean> = {
    superadmin: false,
    owner: false,
    manager: true,
    setter: true,
    editor: true,
    user: true,
  };
  for (const target of APP_ROLES)
    assert.equal(canActOnUser("owner", target), ownerMay[target], `owner → ${target}`);
  for (const acting of ["manager", "setter", "editor", "user"] as const)
    for (const target of APP_ROLES)
      assert.equal(canActOnUser(acting, target), false, `${acting} → ${target}`);
  // The same line the existing role-change rule draws.
  for (const acting of APP_ROLES)
    for (const target of APP_ROLES)
      assert.equal(
        canActOnUser(acting, target),
        canManageRole(acting, target, "user"),
        `${acting} → ${target}`,
      );
});

interface Staff {
  world: World;
  ids: Record<AppRole | "superadmin2" | "owner2", string>;
}
function staff(): Staff {
  const world = emptyWorld();
  const ids = {} as Staff["ids"];
  for (const role of APP_ROLES) ids[role] = addUser(world, `${role}@example.com`, role);
  ids.superadmin2 = addUser(world, "superadmin2@example.com", "superadmin");
  ids.owner2 = addUser(world, "owner2@example.com", "owner");
  return { world, ids };
}

type Action =
  | "impersonate"
  | "reset password"
  | "ban"
  | "unban"
  | "verify email"
  | "set creator badge"
  | "delete";
const act = (s: Staff, action: Action, as: string | null, targetId: string): Promise<CallResult> =>
  action === "impersonate"
    ? callTeamApi(routes.impersonate, s.world, {
        as,
        method: "POST",
        path: "/api/admin/users/impersonate",
        body: { id: targetId },
      })
    : action === "reset password"
      ? callTeamApi(routes.resetPassword, s.world, {
          as,
          method: "POST",
          path: "/api/admin/users/reset-password",
          body: { id: targetId },
        })
      : action === "delete"
        ? callTeamApi(routes.users, s.world, {
            as,
            method: "DELETE",
            path: "/api/admin/users",
            query: `?id=${targetId}`,
          })
        : callTeamApi(routes.users, s.world, {
            as,
            method: "PATCH",
            path: "/api/admin/users",
            query: `?id=${targetId}`,
            body:
              action === "ban"
                ? { banDuration: "24h" }
                : action === "unban"
                  ? { banDuration: "none" }
                  : action === "verify email"
                    ? { emailConfirm: true }
                    : { creatorVerified: true },
          });
const ACTIONS: Action[] = [
  "impersonate",
  "reset password",
  "ban",
  "unban",
  "verify email",
  "set creator badge",
  "delete",
];
const PERFORMED: Record<Action, RegExp> = {
  impersonate: /^POST \/auth\/v1\/admin\/generate_link$/,
  "reset password": /^POST \/auth\/v1\/recover$/,
  ban: /^PUT \/auth\/v1\/admin\/users\//,
  unban: /^PUT \/auth\/v1\/admin\/users\//,
  "verify email": /^PUT \/auth\/v1\/admin\/users\//,
  "set creator badge": /^PUT \/auth\/v1\/admin\/users\//,
  delete: /^DELETE \/auth\/v1\/admin\/users\//,
};
const audited = (result: CallResult) =>
  result.writes.filter((write) => write.table === "admin_audit_log").length;

for (const action of ACTIONS) {
  test(`${action}: an Owner is refused against a Superadmin and against another Owner, before anything happens`, async () => {
    for (const target of ["superadmin", "owner2"] as const) {
      const s = staff();
      const result = await act(s, action, s.ids.owner, s.ids[target]);
      assert.deepEqual(
        [target, result.status, result.body],
        [target, 403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }],
      );
      // No sign-in link, no reset email, no ban — and nothing written or logged as done.
      assert.deepEqual(result.authActions, [], target);
      assert.deepEqual(result.writes, [], target);
      assert.doesNotMatch(result.text, /action_link|token|url/, target);
    }
  });

  test(`${action}: an Owner may still act on accounts below Owner`, async () => {
    for (const target of ["manager", "setter", "editor", "user"] as const) {
      const s = staff();
      const result = await act(s, action, s.ids.owner, s.ids[target]);
      assert.equal(result.status, 200, target);
      assert.equal(result.authActions.length, 1, target);
      assert.match(result.authActions[0], PERFORMED[action], target);
      assert.equal(audited(result), 1, `${target}: audited`);
    }
  });

  test(`${action}: a Superadmin may act on accounts below it${action === "impersonate" ? "" : ", and on another Superadmin"}`, async () => {
    // Impersonation needs a strictly higher role (canImpersonate): one Superadmin may not sign in
    // as another. Every other action keeps canActOnUser, where a Superadmin may act on anyone.
    const targets =
      action === "impersonate"
        ? (["owner", "manager", "user"] as const)
        : (["superadmin2", "owner", "manager", "user"] as const);
    for (const target of targets) {
      const s = staff();
      const result = await act(s, action, s.ids.superadmin, s.ids[target]);
      assert.equal(result.status, 200, target);
      assert.match(result.authActions[0], PERFORMED[action], target);
    }
  });

  test(`${action}: roles without user management are refused outright`, async () => {
    for (const acting of ["manager", "setter", "editor", "user"] as const) {
      const s = staff();
      // Against a plain user, so only the caller's own role decides it.
      const target = acting === "user" ? s.ids.editor : s.ids.user;
      const result = await act(s, action, s.ids[acting], target);
      assert.deepEqual(
        [acting, result.status, result.body],
        [acting, 403, { error: "PERMISSION_REQUIRED" }],
      );
      assert.deepEqual(result.authActions, [], acting);
    }
    const s = staff();
    const signedOut = await act(s, action, null, s.ids.user);
    assert.equal(signedOut.status, 401);
    assert.deepEqual(signedOut.authActions, []);
  });
}

test("impersonation of a permitted target returns the sign-in link; of a forbidden one, nothing", async () => {
  const s = staff();
  const allowed = await act(s, "impersonate", s.ids.owner, s.ids.user);
  assert.match(String((allowed.body.data as { url: string }).url), /^https:\/\//);
  const refused = await act(s, "impersonate", s.ids.owner, s.ids.superadmin);
  assert.equal(refused.body.data, undefined);
});

test("ban: a request that demotes and bans in one go is decided on the target's CURRENT role", async () => {
  const s = staff();
  // An Owner tries to demote another Owner to user and ban them in the same request.
  const result = await callTeamApi(routes.users, s.world, {
    as: s.ids.owner,
    method: "PATCH",
    path: "/api/admin/users",
    query: `?id=${s.ids.owner2}`,
    body: { role: "user", banDuration: "24h" },
  });
  assert.deepEqual([result.status, result.body], [403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }]);
  assert.deepEqual(result.authActions, []);
  assert.deepEqual(result.writes, []);
  assert.equal(s.world.profiles.find((p) => p.id === s.ids.owner2)!.role, "owner", "unchanged");
});

test("unchanged admin behaviour: self-ban is still refused, unknown users are 404, role changes follow canManageRole", async () => {
  const s = staff();
  const self = await act(s, "ban", s.ids.superadmin, s.ids.superadmin);
  assert.deepEqual([self.status, self.body], [409, { error: "CANNOT_CHANGE_OWN_ROLE" }]);
  const selfImpersonate = await act(s, "impersonate", s.ids.superadmin, s.ids.superadmin);
  assert.equal(selfImpersonate.status, 409);
  for (const action of ACTIONS) {
    const unknown = await act(s, action, s.ids.superadmin, uuid());
    assert.equal(unknown.status, 404, action);
    assert.deepEqual(unknown.authActions, [], action);
  }
  // An Owner promoting a user to manager (a plain role change) still works; to owner does not.
  const patch = (role: string) =>
    callTeamApi(routes.users, s.world, {
      as: s.ids.owner,
      method: "PATCH",
      path: "/api/admin/users",
      query: `?id=${s.ids.user}`,
      body: { role },
    });
  assert.equal((await patch("manager")).status, 200);
  assert.equal((await patch("owner")).status, 403);
});

test("the three routes check the target's role before the privileged call, in source order", () => {
  const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
  const before = (source: string, check: string, privileged: string) => {
    const at = source.indexOf(check);
    assert.ok(at > 0, check);
    assert.ok(at < source.indexOf(privileged), `${check} precedes ${privileged}`);
  };
  before(
    flat("src/routes/api.admin.users.impersonate.ts"),
    "if (!canImpersonate(actingRole, toAppRole(profile.role as string | null)))",
    "service.auth.admin.generateLink(",
  );
  before(
    flat("src/routes/api.admin.users.reset-password.ts"),
    "if (!canActOnUser(actingRole, toAppRole(target.role as string | null)))",
    "anon.auth.resetPasswordForEmail(",
  );
  // (Only the PATCH handler: the invite handler above it also sets a role.)
  const usersFile = flat("src/routes/api.admin.users.ts");
  const users = usersFile.slice(usersFile.indexOf("PATCH: async"));
  const gate =
    "if ( changesAccount && targetId !== user.id && !canActOnUser(actingRole, targetCurrentRole) )";
  for (const privileged of [
    ".update({ role: input.role })",
    "ban_duration: input.banDuration",
    "email_confirm: input.emailConfirm",
    "creator_verified: input.creatorVerified",
  ])
    before(users, gate, privileged);
  assert.match(
    users,
    /const changesAccount = input\.banDuration !== undefined \|\| input\.emailConfirm !== undefined \|\| input\.creatorVerified !== undefined;/,
  );
  const remove = usersFile.slice(usersFile.indexOf("DELETE: async"));
  before(
    remove,
    "if (!canActOnUser(actingRole, toAppRole(target.role as string)))",
    "service.auth.admin.deleteUser(targetId)",
  );
});

// ============================================================
// 2. Lead-magnet opt-in: the same address, and only the same address
// ============================================================

test("exactIlikePattern escapes every pattern character; sameTextIgnoringCase is never a pattern match", () => {
  assert.equal(exactIlikePattern("a_b@example.com"), "a\\_b@example.com");
  assert.equal(exactIlikePattern("50%off@example.com"), "50\\%off@example.com");
  assert.equal(exactIlikePattern("back\\slash@example.com"), "back\\\\slash@example.com");
  assert.equal(exactIlikePattern("plain.name+tag@example.com"), "plain.name+tag@example.com");
  assert.equal(sameTextIgnoringCase("John.Doe@Example.com", "john.doe@example.com"), true);
  assert.equal(sameTextIgnoringCase("axb@example.com", "a_b@example.com"), false);
  assert.equal(sameTextIgnoringCase("anything@example.com", "%@example.com"), false);
  assert.equal(sameTextIgnoringCase("a*b@example.com", "axb@example.com"), false);
  assert.equal(sameTextIgnoringCase(null, "a@example.com"), false);
  assert.equal(sameTextIgnoringCase(" a@example.com", "a@example.com"), false);
});

interface Magnet {
  world: World;
  workspace: string;
  otherWorkspace: string;
  owner: string;
}
function magnet(): Magnet {
  const world = emptyWorld();
  const owner = addUser(world, "creator@example.com");
  const stranger = addUser(world, "other@example.com");
  const workspace = addWorkspace(world, owner);
  const otherWorkspace = addWorkspace(world, stranger);
  world.lead_magnets = [
    {
      id: uuid(),
      workspace_id: workspace,
      slug: "guide",
      status: "published",
      title: "The Guide",
      source: "generated",
      content: "# The guide",
      file_path: null,
      file_name: null,
    },
  ];
  world.leads = [];
  world.lead_messages = [];
  world.lead_magnet_optins = [];
  return { world, workspace, otherWorkspace, owner };
}
let leadNumber = 0;
function lead(m: Magnet, email: string | null, values: Record<string, unknown> = {}): string {
  const id = uuid();
  m.world.leads!.push({
    id,
    workspace_id: m.workspace,
    user_id: m.owner,
    name: "Existing",
    platform: "Email",
    email,
    username: null,
    unread: false,
    created_at: new Date(Date.UTC(2026, 0, 1) + ++leadNumber * 60_000).toISOString(),
    ...values,
  });
  return id;
}
const optIn = (m: Magnet, email: string, extra: Record<string, unknown> = {}) =>
  callTeamApi(routes.optin, m.world, {
    as: null,
    method: "POST",
    path: "/api/freebies/optin",
    body: { slug: "guide", email, ...extra },
  });
const leadsOf = (m: Magnet, workspace = m.workspace) =>
  m.world.leads!.filter((row) => row.workspace_id === workspace);
const optinLeadIds = (m: Magnet) => m.world.lead_magnet_optins!.map((row) => row.lead_id);
const messagesFor = (m: Magnet, leadId: string) =>
  m.world.lead_messages!.filter((row) => row.lead_id === leadId).length;

test("opt-in: an underscore never matches a different address", async () => {
  const m = magnet();
  // Three leads an unescaped pattern "a_b@example.com" would have matched.
  const others = ["axb@example.com", "a.b@example.com", "a-b@example.com"].map((email) =>
    lead(m, email),
  );
  const result = await optIn(m, "a_b@example.com");
  assert.equal(result.status, 200);
  const all = leadsOf(m);
  assert.equal(all.length, 4, "a new lead was created");
  const created = all.find((row) => row.email === "a_b@example.com")!;
  assert.ok(created && !others.includes(created.id as string));
  assert.deepEqual(optinLeadIds(m), [created.id]);
  // The other people's leads are untouched: not marked unread, no note added.
  for (const id of others) {
    assert.equal(all.find((row) => row.id === id)!.unread, false);
    assert.equal(messagesFor(m, id), 0);
  }
  // The lookup sent the escaped address.
  const lookup = result.reads.find((read) => read.table === "leads")!;
  assert.match(decodeURIComponent(String(lookup.body)), /email=ilike\.a\\_b@example\.com/);
});

test("opt-in: the exact address is matched even when a look-alike exists, whichever is older", async () => {
  for (const exactFirst of [true, false]) {
    const m = magnet();
    let exact = "";
    if (exactFirst) exact = lead(m, "a_b@example.com");
    const lookalike = lead(m, "axb@example.com");
    if (!exactFirst) exact = lead(m, "a_b@example.com");
    const result = await optIn(m, "A_B@Example.com");
    assert.equal(result.status, 200);
    assert.equal(leadsOf(m).length, 2, "no new lead");
    assert.deepEqual(optinLeadIds(m), [exact]);
    assert.equal(messagesFor(m, exact), 1);
    assert.equal(messagesFor(m, lookalike), 0);
    assert.equal(leadsOf(m).find((row) => row.id === lookalike)!.unread, false);
  }
});

test("opt-in: letter case does not create a duplicate lead", async () => {
  const m = magnet();
  // Typed into the inbox by hand, with capitals.
  const existing = lead(m, "John.Doe@Example.com");
  for (const typed of ["john.doe@example.com", "JOHN.DOE@EXAMPLE.COM", "John.Doe@Example.com"]) {
    assert.equal((await optIn(m, typed)).status, 200, typed);
  }
  assert.equal(leadsOf(m).length, 1);
  assert.deepEqual(optinLeadIds(m), [existing, existing, existing]);
  assert.equal(leadsOf(m)[0].unread, true, "the creator is told about the returning lead");
  assert.equal(messagesFor(m, existing), 3);
});

test("opt-in: a first-time address creates one lead, and opting in again reuses it", async () => {
  const m = magnet();
  const first = await optIn(m, "New.Person@example.com", { name: "New Person" });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.data, {
    kind: "content",
    content: "# The guide",
    title: "The Guide",
  });
  const second = await optIn(m, "new.person@example.com");
  assert.equal(second.status, 200);
  const all = leadsOf(m);
  assert.equal(all.length, 1);
  assert.equal(all[0].email, "new.person@example.com", "stored lower-cased");
  assert.equal(all[0].platform, "Email");
  assert.equal(m.world.lead_magnet_optins!.length, 2);
  assert.ok(optinLeadIds(m).every((id) => id === all[0].id));
});

test("opt-in: similar addresses stay separate people", async () => {
  const m = magnet();
  const addresses = [
    "ab@example.com",
    "a_b@example.com",
    "a__b@example.com",
    "a.b@example.com",
    "a_b@example.co",
    "xa_b@example.com",
  ];
  for (const address of addresses) assert.equal((await optIn(m, address)).status, 200, address);
  assert.deepEqual(
    leadsOf(m)
      .map((row) => row.email)
      .sort(),
    [...addresses].sort(),
  );
  assert.equal(new Set(optinLeadIds(m)).size, addresses.length);
});

test("opt-in: only an Email lead of the SAME workspace is ever reused", async () => {
  const m = magnet();
  const elsewhere = lead(m, "fan@example.com", { workspace_id: m.otherWorkspace });
  const instagram = lead(m, "fan@example.com", { platform: "Instagram" });
  const result = await optIn(m, "fan@example.com");
  assert.equal(result.status, 200);
  const created = leadsOf(m).find((row) => row.platform === "Email")!;
  assert.ok(created && created.id !== instagram);
  assert.deepEqual(optinLeadIds(m), [created.id]);
  // The other workspace's lead is untouched and nothing was added to that workspace.
  assert.equal(leadsOf(m, m.otherWorkspace).length, 1);
  assert.equal(messagesFor(m, elsewhere), 0);
  assert.equal(messagesFor(m, instagram), 0);
  // Every lead read and write names the lead magnet's own workspace.
  const lookup = result.reads.find((read) => read.table === "leads")!;
  assert.match(
    decodeURIComponent(String(lookup.body)),
    new RegExp(`workspace_id=eq\\.${m.workspace}`),
  );
  assert.ok(
    result.writes
      .filter((write) => write.table === "leads" && write.method === "POST")
      .every((write) => (write.body as { workspace_id: string }).workspace_id === m.workspace),
  );
});

test("opt-in: an address that is not a valid email, or carries a wildcard, is refused and matches nothing", async () => {
  const m = magnet();
  const existing = lead(m, "anyone@example.com");
  for (const bad of ["%@example.com", "*@example.com", "a%b@example.com", "not-an-email", "_"]) {
    const result = await optIn(m, bad);
    assert.equal(result.status, 422, bad);
    assert.deepEqual(result.writes, [], bad);
  }
  assert.equal(leadsOf(m).length, 1);
  assert.equal(messagesFor(m, existing), 0);
});

test("opt-in: if the lookup fails, the request fails — no duplicate lead is created blind", async () => {
  const m = magnet();
  lead(m, "fan@example.com");
  m.world.failingReads = ["leads"];
  const result = await optIn(m, "fan@example.com");
  assert.deepEqual([result.status, result.body], [500, { error: "DATABASE_ERROR" }]);
  assert.deepEqual(result.writes, []);
});

test("opt-in: an unknown or unpublished lead magnet is 404 and touches no lead", async () => {
  const m = magnet();
  m.world.lead_magnets![0].status = "draft";
  const result = await optIn(m, "fan@example.com");
  assert.equal(result.status, 404);
  assert.deepEqual(result.writes, []);
  const unknown = await callTeamApi(routes.optin, m.world, {
    as: null,
    method: "POST",
    path: "/api/freebies/optin",
    body: { slug: "nope", email: "fan@example.com" },
  });
  assert.equal(unknown.status, 404);
});

test("no unescaped pattern match on a visitor-supplied value is left in the opt-in route", () => {
  const source = readFileSync("src/routes/api.freebies.optin.ts", "utf8").replace(/\s+/g, " ");
  assert.match(source, /\.ilike\("email", exactIlikePattern\(email\)\)/);
  assert.equal(source.match(/\.ilike\(/g)?.length, 1);
  assert.match(source, /find\(\(lead\) => sameTextIgnoringCase\(lead\.email, email\)\)/);
  assert.doesNotMatch(source, /\.like\(/);
});

// ============================================================
// 3. The rest of user management: delete, email verification, creator badge, combined requests
// ============================================================

const patchUser = (s: Staff, as: string, targetId: string, body: Record<string, unknown>) =>
  callTeamApi(routes.users, s.world, {
    as,
    method: "PATCH",
    path: "/api/admin/users",
    query: `?id=${targetId}`,
    body,
  });
const roleOf = (s: Staff, id: string) => s.world.profiles.find((p) => p.id === id)?.role;

test("delete: an Owner cannot delete a Superadmin or another Owner, and the account is still there", async () => {
  for (const target of ["superadmin", "superadmin2", "owner2"] as const) {
    const s = staff();
    const result = await act(s, "delete", s.ids.owner, s.ids[target]);
    assert.deepEqual(
      [target, result.status, result.body],
      [target, 403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }],
    );
    assert.deepEqual(result.authActions, [], target);
    assert.deepEqual(result.writes, [], target);
    assert.ok(roleOf(s, s.ids[target]), "profile untouched");
  }
});

test("delete: the last-Superadmin and self rules still apply to a Superadmin", async () => {
  const s = staff();
  const self = await act(s, "delete", s.ids.superadmin, s.ids.superadmin);
  assert.deepEqual([self.status, self.body], [409, { error: "CANNOT_DELETE_SELF" }]);
  // Two Superadmins: one may delete the other.
  assert.equal((await act(s, "delete", s.ids.superadmin, s.ids.superadmin2)).status, 200);
  // With a single Superadmin left, nobody can delete it — an Owner is refused by rank first.
  const lone = staff();
  lone.world.profiles = lone.world.profiles.filter((p) => p.id !== lone.ids.superadmin2);
  const byOwner = await act(lone, "delete", lone.ids.owner, lone.ids.superadmin);
  assert.equal(byOwner.status, 403);
  assert.deepEqual(byOwner.authActions, []);
});

test("email verification and creator badge: an Owner cannot set either on a Superadmin or another Owner", async () => {
  for (const target of ["superadmin", "owner2"] as const)
    for (const body of [
      { emailConfirm: true },
      { emailConfirm: false },
      { creatorVerified: true },
      { creatorVerified: false },
    ]) {
      const s = staff();
      const result = await patchUser(s, s.ids.owner, s.ids[target], body);
      const label = `${target} ${JSON.stringify(body)}`;
      assert.deepEqual(
        [label, result.status, result.body],
        [label, 403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }],
      );
      assert.deepEqual(result.authActions, [], label);
      assert.deepEqual(result.writes, [], label);
    }
});

test("combined requests: nothing is applied when any part is against a target the caller does not outrank", async () => {
  const combos: Array<Record<string, unknown>> = [
    { role: "user", banDuration: "24h" },
    { role: "user", emailConfirm: false },
    { role: "manager", creatorVerified: true },
    { banDuration: "none", emailConfirm: true, creatorVerified: true },
    { role: "user", banDuration: "24h", emailConfirm: true, creatorVerified: false },
  ];
  for (const target of ["superadmin", "owner2"] as const)
    for (const body of combos) {
      const s = staff();
      const before = roleOf(s, s.ids[target]);
      const result = await patchUser(s, s.ids.owner, s.ids[target], body);
      const label = `${target} ${JSON.stringify(body)}`;
      assert.equal(result.status, 403, label);
      assert.equal(result.body.error, "PRIVILEGE_ESCALATION_BLOCKED", label);
      assert.deepEqual(result.authActions, [], label);
      assert.deepEqual(result.writes, [], label);
      assert.equal(roleOf(s, s.ids[target]), before, `${label}: role unchanged`);
    }
  // A role change the Owner may not make blocks the rest of an otherwise permitted request too.
  const s = staff();
  const promote = await patchUser(s, s.ids.owner, s.ids.user, {
    role: "owner",
    emailConfirm: true,
  });
  assert.equal(promote.status, 403);
  assert.deepEqual(promote.authActions, []);
  assert.equal(roleOf(s, s.ids.user), "user");
});

test("combined requests still work for a caller who outranks the target", async () => {
  const s = staff();
  const byOwner = await patchUser(s, s.ids.owner, s.ids.user, {
    role: "editor",
    banDuration: "24h",
    emailConfirm: true,
    creatorVerified: true,
  });
  assert.equal(byOwner.status, 200);
  assert.equal(roleOf(s, s.ids.user), "editor");
  assert.equal(byOwner.authActions.filter((a) => a.startsWith("PUT ")).length, 3);
  const bySuperadmin = await patchUser(s, s.ids.superadmin, s.ids.owner, {
    role: "manager",
    emailConfirm: true,
    creatorVerified: true,
  });
  assert.equal(bySuperadmin.status, 200);
  assert.equal(roleOf(s, s.ids.owner), "manager");
});

test("a caller's own email flag and creator badge are unchanged behaviour; a ban or role change on oneself is still refused", async () => {
  const s = staff();
  for (const body of [{ emailConfirm: true }, { creatorVerified: true }]) {
    assert.equal((await patchUser(s, s.ids.owner, s.ids.owner, body)).status, 200);
    assert.equal((await patchUser(s, s.ids.superadmin, s.ids.superadmin, body)).status, 200);
  }
  for (const body of [{ banDuration: "24h" }, { role: "superadmin" }, { role: "user" }]) {
    const result = await patchUser(s, s.ids.owner, s.ids.owner, body);
    assert.deepEqual([result.status, result.body], [409, { error: "CANNOT_CHANGE_OWN_ROLE" }]);
    assert.deepEqual(result.authActions, []);
  }
  assert.equal(roleOf(s, s.ids.owner), "owner");
});

test("inviting a user: an Owner still cannot create an Owner or a Superadmin", async () => {
  const s = staff();
  for (const role of ["owner", "superadmin"]) {
    const result = await callTeamApi(routes.users, s.world, {
      as: s.ids.owner,
      method: "POST",
      path: "/api/admin/users",
      body: { email: "new@example.com", role },
    });
    assert.deepEqual([role, result.status], [role, 403]);
    assert.deepEqual(result.invitesSent, []);
    assert.deepEqual(result.writes, []);
  }
});

test("every account-level operation in the admin user routes is covered by a role check", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const users = source("src/routes/api.admin.users.ts");
  // Every privileged call the three files make…
  const calls = [
    ...users.matchAll(/service\.auth\.admin\.(\w+)\(/g),
    ...source("src/routes/api.admin.users.impersonate.ts").matchAll(
      /service\.auth\.admin\.(\w+)\(/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual([...new Set(calls)].sort(), [
    "deleteUser",
    "generateLink",
    "getUserById",
    "inviteUserByEmail",
    "updateUserById",
  ]);
  // …and each handler that makes one names a hierarchy check.
  for (const handler of ["POST: async", "PATCH: async", "DELETE: async"]) {
    const from = users.indexOf(handler);
    const next = users.indexOf(": async ({ request })", from + handler.length);
    const body = users.slice(from, next > 0 ? next : undefined);
    assert.match(body, /canManageRole\(|canActOnUser\(/, handler);
  }
});

// ============================================================
// 4. Opt-in lookup: no cut-off decides the answer
// ============================================================

test("opt-in: with more than 25 leads sharing one address in different letter case, the oldest is reused and no duplicate is made", async () => {
  const m = magnet();
  const variants: string[] = [];
  // 40 distinct capitalisations of the same address.
  for (let n = 0; n < 40; n++) {
    const local = "fanmail"
      .split("")
      .map((character, index) => ((n >> index) & 1 ? character.toUpperCase() : character))
      .join("");
    variants.push(lead(m, `${local}@Example.com`));
  }
  for (const cap of [undefined, 7]) {
    m.world.maxRows = cap;
    const result = await optIn(m, "fanmail@example.com");
    assert.equal(result.status, 200);
    assert.equal(leadsOf(m).length, 40, "no new lead");
    assert.equal(optinLeadIds(m).at(-1), variants[0], "the oldest lead with this address");
  }
});

test("opt-in: the right lead is found even when the lookup returns many other rows first", async () => {
  // A database that ignores the escaping would return every look-alike. The opt-in must still
  // read past them — however many there are — and attach only to the real address.
  const m = magnet();
  const lookalikes: string[] = [];
  for (let n = 0; n < 260; n++)
    lookalikes.push(lead(m, `a${String.fromCharCode(97 + (n % 26))}b@example.com`));
  // Distinct look-alikes of "a_b@example.com": "aab@…" to "azb@…" (repeated addresses are fine).
  const exact = lead(m, "a_b@example.com");
  m.world.looseIlike = true;
  m.world.maxRows = 50;
  const result = await optIn(m, "a_b@example.com");
  assert.equal(result.status, 200);
  assert.equal(leadsOf(m).length, 261, "no duplicate was created");
  assert.deepEqual(optinLeadIds(m), [exact]);
  for (const id of lookalikes) assert.equal(messagesFor(m, id), 0);
  assert.ok(
    leadsOf(m)
      .filter((row) => row.id !== exact)
      .every((row) => row.unread === false),
  );
  // It took more than one request to get there.
  assert.ok(result.reads.filter((read) => read.table === "leads").length > 1);
});

test("opt-in: when no lead has the address, look-alikes never stand in for it", async () => {
  const m = magnet();
  for (let n = 0; n < 120; n++) lead(m, `a${String.fromCharCode(97 + (n % 26))}b@example.com`);
  m.world.looseIlike = true;
  const result = await optIn(m, "a_b@example.com");
  assert.equal(result.status, 200);
  const created = leadsOf(m).filter((row) => row.email === "a_b@example.com");
  assert.equal(created.length, 1, "exactly one new lead");
  assert.deepEqual(optinLeadIds(m), [created[0].id]);
});

test("opt-in: a failure on a later page of the lookup fails the request and writes nothing", async () => {
  const m = magnet();
  for (let n = 0; n < 120; n++) lead(m, `a${String.fromCharCode(97 + (n % 26))}b@example.com`);
  m.world.looseIlike = true;
  m.world.maxRows = 50;
  m.world.failReadsAfter = { leads: 1 };
  const result = await optIn(m, "a_b@example.com");
  assert.deepEqual([result.status, result.body], [500, { error: "DATABASE_ERROR" }]);
  assert.deepEqual(result.writes, []);
});

test("the opt-in lookup has no fixed row limit", () => {
  const source = readFileSync("src/routes/api.freebies.optin.ts", "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(source, /\.limit\(/);
  assert.match(source, /\.range\(from, from \+ LEAD_LOOKUP_PAGE - 1\)/);
  assert.match(source, /if \(rows\.length === 0\) break;/);
  assert.match(
    source,
    /if \(lookupError\) return json\(\{ error: "DATABASE_ERROR" \}, \{ status: 500 \}\);/,
  );
});
