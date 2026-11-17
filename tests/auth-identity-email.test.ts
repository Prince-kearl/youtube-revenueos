import {
  addMember,
  addPaidWorkspace,
  addUser,
  callTeamApi,
  emptyWorld,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";

// profiles.email is a copy of an account's address that its holder can edit (and that can fall
// behind when the address changes). Nothing that sends an authentication link or matches an
// account by email may trust it: the account is resolved through Supabase Auth, by its immutable
// id (src/lib/server/auth-users.ts, getAuthIdentity).
//
// In the fake auth service a profile row stands for its account; `auth_email` is the address
// Supabase Auth holds when it differs from the profile's copy, and `email_confirmed: false` marks
// an address Auth has not confirmed.

const routes = {
  impersonate: await import("../src/routes/api.admin.users.impersonate"),
  resetPassword: await import("../src/routes/api.admin.users.reset-password"),
  members: await import("../src/routes/api.workspace.members"),
  invitations: await import("../src/routes/api.invitations"),
};

const profile = (w: World, id: string) => w.profiles.find((p) => p.id === id)!;
const audits = (r: CallResult) => r.writes.filter((write) => write.table === "admin_audit_log");

// ---------- admin impersonation and password reset ----------

function admins() {
  const w = emptyWorld();
  const superadmin = addUser(w, "boss@example.com", "superadmin");
  const owner = addUser(w, "owner@example.com", "owner");
  const target = addUser(w, "target@example.com");
  return { w, superadmin, owner, target };
}
type Admins = ReturnType<typeof admins>;

const impersonate = (a: Admins, as: string, id: string) =>
  callTeamApi(routes.impersonate, a.w, {
    as,
    method: "POST",
    path: "/api/admin/users/impersonate",
    body: { id },
  });
const resetPassword = (a: Admins, as: string, id: string) =>
  callTeamApi(routes.resetPassword, a.w, {
    as,
    method: "POST",
    path: "/api/admin/users/reset-password",
    body: { id },
  });

test("a spoofed profiles.email cannot redirect an impersonation link or a password reset", async () => {
  for (const action of [impersonate, resetPassword]) {
    const a = admins();
    // The target rewrites their profile copy to the Superadmin's address.
    profile(a.w, a.target).email = "boss@example.com";
    profile(a.w, a.target).auth_email = "target@example.com";
    const r = await action(a, a.superadmin, a.target);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.authTargets, ["target@example.com"], "the account's own address, from Auth");
    // Production contract (hotfix 232e17e): audit entries name the account by its immutable id
    // and carry no email address at all.
    const [audit] = audits(r);
    assert.equal((audit.body as Record<string, unknown>).target, a.target);
    assert.doesNotMatch(JSON.stringify(audit.body), /@/);
  }
});

test("the auth user id stays authoritative when the address has changed and the profile copy has not", async () => {
  for (const action of [impersonate, resetPassword]) {
    const a = admins();
    profile(a.w, a.target).auth_email = "new-address@example.com"; // the profile still says target@
    const r = await action(a, a.superadmin, a.target);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.authTargets, ["new-address@example.com"]);
  }
});

test("an unconfirmed address gets no impersonation link; a missing address gets nothing — and nothing is audited as done", async () => {
  // Production contract (hotfix 6f027a5): impersonating an unconfirmed address is refused
  // (EMAIL_UNCONFIRMED), because using a magic link would mark it verified.
  const a = admins();
  profile(a.w, a.target).email_confirmed = false;
  const unconfirmed = await impersonate(a, a.superadmin, a.target);
  assert.deepEqual([unconfirmed.status, unconfirmed.body], [409, { error: "EMAIL_UNCONFIRMED" }]);
  assert.deepEqual(unconfirmed.authActions, []);
  assert.equal(audits(unconfirmed).length, 0);
  // A password reset is deliberately still sent for an unconfirmed account: it goes only to that
  // account's own Auth address, and completing it proves the inbox — that is how it recovers.
  const r = admins();
  profile(r.w, r.target).email_confirmed = false;
  const recovery = await resetPassword(r, r.superadmin, r.target);
  assert.equal(recovery.status, 200);
  assert.deepEqual(recovery.authTargets, ["target@example.com"]);
  // No address at all: nothing is sent and nothing audited, for either action.
  for (const action of [impersonate, resetPassword]) {
    const b = admins();
    profile(b.w, b.target).auth_email = null;
    const none = await action(b, b.superadmin, b.target);
    assert.deepEqual([none.status, none.body], [404, { error: "USER_NOT_FOUND" }]);
    assert.deepEqual(none.authActions, []);
    assert.equal(audits(none).length, 0);
  }
});

test("an impersonation link that would sign in to a different account is never returned", async () => {
  const a = admins();
  a.w.linkUserId = a.superadmin; // the address moved to another account in between
  const r = await impersonate(a, a.superadmin, a.target);
  // Production contract (hotfix 232e17e): LINK_MISMATCH, and the rejection itself is audited —
  // by account id, without the link.
  assert.deepEqual([r.status, r.body], [502, { error: "LINK_MISMATCH" }]);
  assert.doesNotMatch(r.text, /action_link|token|https:/);
  const rejected = audits(r);
  assert.equal(rejected.length, 1);
  assert.equal(
    (rejected[0].body as Record<string, unknown>).action,
    "user_impersonation_link_rejected",
  );
  assert.doesNotMatch(JSON.stringify(rejected[0].body), /action_link|token|https:|@/);
});

test("the role hierarchy is still decided first: a refused request asks nothing of Supabase Auth", async () => {
  for (const action of [impersonate, resetPassword]) {
    const a = admins();
    // An Owner against the Superadmin, whose profile copy names a plain user's address: refused
    // at the console gate (Superadmin only) before anything else.
    profile(a.w, a.superadmin).email = "target@example.com";
    const r = await action(a, a.owner, a.superadmin);
    assert.deepEqual([r.status, r.body], [403, { error: "ADMIN_REQUIRED" }]);
    assert.deepEqual(r.authActions, []);
    assert.deepEqual(r.authTargets, []);
    assert.deepEqual(r.writes, []);
  }
});

// ---------- workspace invitations ----------
//
// Inviting creates a link invitation and joins nobody. Accepting follows the address Supabase
// Auth holds for the signed-in account (confirmed), never a profile's own copy of it.

function team() {
  const w = emptyWorld();
  const owner = addUser(w, "owner@x.test");
  const ws = addPaidWorkspace(w, owner); // Scale: team management
  return { w, owner, ws };
}
type Team = ReturnType<typeof team>;
const invite = (t: Team, email: string) =>
  callTeamApi(routes.members, t.w, {
    as: t.owner,
    method: "POST",
    path: "/api/workspace/members",
    body: { email, role: "editor" },
  });
const tokenOf = (r: CallResult) =>
  String((r.body.data as { inviteUrl: string }).inviteUrl).split("/invite/")[1];
const accept = (t: Team, as: string, token: string) =>
  callTeamApi(routes.invitations, t.w, {
    as,
    method: "POST",
    path: "/api/invitations",
    body: { action: "accept", token },
  });
const membershipOf = (t: Team, userId: string) =>
  t.w.workspace_members.find((m) => m.workspace_id === t.ws && m.user_id === userId);

test("invitations: an account that only claims the address in its profile cannot accept", async () => {
  const t = team();
  const squatter = addUser(t.w, "squatter@x.test");
  profile(t.w, squatter).auth_email = "squatter@x.test"; // what Auth holds…
  profile(t.w, squatter).email = "invitee@x.test"; // …and the profile copy they rewrote
  const r = await invite(t, "invitee@x.test");
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.invitesSent, [], "nothing emailed");
  const refused = await accept(t, squatter, tokenOf(r));
  assert.equal(refused.status, 403);
  assert.equal(membershipOf(t, squatter), undefined, "the squatter gained nothing");
});

test("invitations: matching follows the address Auth holds now, not a stale profile copy", async () => {
  const t = team();
  const mover = addUser(t.w, "old@x.test");
  profile(t.w, mover).auth_email = "new@x.test"; // changed in Auth; the profile copy is stale
  const old = await invite(t, "old@x.test");
  assert.equal((await accept(t, mover, tokenOf(old))).status, 403);
  assert.equal(membershipOf(t, mover), undefined, "the old address no longer reaches them");

  const fresh = await invite(t, "NEW@x.test");
  const joined = await accept(t, mover, tokenOf(fresh));
  assert.equal(joined.status, 200, joined.text);
  assert.equal(
    membershipOf(t, mover)?.status,
    "active",
    "matched case-insensitively, as Auth does",
  );
});

test("invitations: an account whose address Auth has not confirmed cannot accept, and nothing is written", async () => {
  const t = team();
  const unconfirmed = addUser(t.w, "pending@x.test");
  profile(t.w, unconfirmed).email_confirmed = false;
  const r = await invite(t, "pending@x.test");
  const refused = await accept(t, unconfirmed, tokenOf(r));
  assert.deepEqual([refused.status, refused.body.error], [403, "EMAIL_NOT_CONFIRMED"]);
  assert.ok(
    !t.w.workspace_members.some((m) => m.workspace_id === t.ws && m.user_id === unconfirmed),
  );
  assert.equal(
    t.w.workspace_invitations![0].status,
    "pending",
    "the real inbox holder can still accept",
  );
});

test("invitations: the verified account joins with the invited role; one with a workspace in use is refused", async () => {
  const t = team();
  const invitee = addUser(t.w, "invitee@x.test");
  const r = await accept(t, invitee, tokenOf(await invite(t, "invitee@x.test")));
  assert.equal(r.status, 200, r.text);
  assert.equal(membershipOf(t, invitee)?.status, "active");
  assert.equal(membershipOf(t, invitee)?.role, "editor");
  // …and one already in another team is still refused.
  const u = team();
  const busy = addUser(u.w, "busy@x.test");
  const elsewhere = addPaidWorkspace(u.w, addUser(u.w, "other-owner@x.test"));
  addMember(u.w, elsewhere, busy, "editor");
  const refused = await accept(u, busy, tokenOf(await invite(u, "busy@x.test")));
  assert.deepEqual([refused.status, refused.body], [409, { error: "has_own_workspace" }]);
});
