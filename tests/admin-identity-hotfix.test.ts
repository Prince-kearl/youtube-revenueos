import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { APP_ROLES, canActOnUser, canImpersonate, type AppRole } from "../src/lib/server/roles";
import {
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";

// Emergency security patch: account identity is decided by Supabase Auth, never by the
// user-editable profiles.email (profiles_self_update does not protect it).
//
// Reproduced attacks, each run against the real route handlers with Auth and the database
// simulated — no real sign-in link or reset email is ever produced:
//   1. Impersonation: an Owner impersonates an ordinary account whose profile email was set to a
//      Superadmin's address, and receives a sign-in link for the Superadmin.
//   2. Password reset: the same spoof points an admin's reset at someone else's inbox.
//   3. Workspace invite: a user whose profile email was set to an invitee's address is activated
//      in the inviter's workspace in the invitee's place.

const impersonate = await import("../src/routes/api.admin.users.impersonate");
const reset = await import("../src/routes/api.admin.users.reset-password");
const members = await import("../src/routes/api.workspace.members");
const invitations = await import("../src/routes/api.invitations");

const EMAIL_OR_LINK = /@|action_link|token|https?:\/\//i;

function staff() {
  const world = emptyWorld();
  const ids = {
    superadmin: addUser(world, "boss@tubify.test", "superadmin"),
    superadmin2: addUser(world, "boss2@tubify.test", "superadmin"),
    owner: addUser(world, "owner@tubify.test", "owner"),
    owner2: addUser(world, "owner2@tubify.test", "owner"),
    manager: addUser(world, "manager@tubify.test", "manager"),
    user: addUser(world, "user@tubify.test", "user"),
    // An ordinary account whose owner rewrote its profile email to the Superadmin's address.
    spoofer: addUser(world, "boss@tubify.test", "user"),
  };
  world.authEmails = { [ids.spoofer]: "mallory@evil.test" };
  return { world, ids };
}

const callImpersonate = (world: World, as: string | null, id: string) =>
  callTeamApi(impersonate, world, {
    as,
    method: "POST",
    path: "/api/admin/users/impersonate",
    body: { id },
  });
const callReset = (world: World, as: string | null, id: string) =>
  callTeamApi(reset, world, {
    as,
    method: "POST",
    path: "/api/admin/users/reset-password",
    body: { id },
  });
const audits = (result: CallResult) =>
  result.writes
    .filter((w) => w.table === "admin_audit_log")
    .map((w) => w.body as Record<string, unknown>);

// ---------- the policy ----------

test("impersonation policy: strictly outrank the target; resets keep the existing hierarchy", () => {
  for (const acting of APP_ROLES)
    for (const target of APP_ROLES) {
      // Only the console role may impersonate at all, and never an equal: a Superadmin may sign
      // in as anyone but another Superadmin; nobody else may impersonate anyone.
      const expected = acting === "superadmin" && target !== "superadmin";
      assert.equal(canImpersonate(acting, target), expected, `${acting} → ${target}`);
    }
  // Never more permissive than the general rule.
  for (const acting of APP_ROLES)
    for (const target of APP_ROLES)
      if (canImpersonate(acting, target))
        assert.ok(canActOnUser(acting as AppRole, target as AppRole), `${acting} → ${target}`);
  // The two explicit decisions.
  assert.equal(canImpersonate("owner", "superadmin"), false, "an Owner never a Superadmin");
  assert.equal(canImpersonate("superadmin", "superadmin"), false, "nor one Superadmin another");
});

// ---------- impersonation ----------

test("ATTACK: impersonating a spoofed account yields a link for its OWN Auth account, never the Superadmin's", async () => {
  const { world, ids } = staff();
  const result = await callImpersonate(world, ids.superadmin, ids.spoofer);
  assert.equal(result.status, 200);
  assert.deepEqual(result.authRecipients, ["mallory@evil.test"]);
  assert.ok(!result.authRecipients.includes("boss@tubify.test"));
  assert.doesNotMatch(result.text, /boss@tubify/);
});

test("an Owner cannot impersonate a Superadmin or another Owner: nothing is generated or audited", async () => {
  const { world, ids } = staff();
  for (const target of [ids.superadmin, ids.owner2]) {
    const result = await callImpersonate(world, ids.owner, target);
    // The admin console is Superadmin only: refused at the gate, before any lookup.
    assert.deepEqual([result.status, result.body], [403, { error: "ADMIN_REQUIRED" }]);
    assert.deepEqual(result.authActions, []);
    assert.deepEqual(result.writes, []);
  }
});

test("a Superadmin cannot impersonate another Superadmin; it may impersonate an Owner", async () => {
  const { world, ids } = staff();
  const peer = await callImpersonate(world, ids.superadmin, ids.superadmin2);
  assert.deepEqual([peer.status, peer.body], [403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }]);
  assert.deepEqual(peer.authActions, []);
  const owner = await callImpersonate(world, ids.superadmin, ids.owner);
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.authRecipients, ["owner@tubify.test"]);
});

test("a sign-in link issued for any other user is discarded, and the rejection is audited without it", async () => {
  const { world, ids } = staff();
  world.generateLinkUserId = ids.superadmin; // Auth answers with a link for the wrong account.
  const result = await callImpersonate(world, ids.superadmin, ids.user);
  assert.deepEqual([result.status, result.body], [502, { error: "LINK_MISMATCH" }]);
  assert.doesNotMatch(result.text, /action_link|token|https?:\/\//);
  const [entry] = audits(result);
  assert.equal(entry.action, "user_impersonation_link_rejected");
  assert.equal(entry.target, ids.user);
  assert.doesNotMatch(JSON.stringify(entry), EMAIL_OR_LINK);
});

test("legitimate impersonation: link for the requested account, audited by id with no link or email", async () => {
  const { world, ids } = staff();
  const result = await callImpersonate(world, ids.superadmin, ids.user);
  assert.equal(result.status, 200);
  assert.match(String((result.body.data as { url: string }).url), /^https:\/\//);
  assert.deepEqual(result.authRecipients, ["user@tubify.test"]);
  const entries = audits(result);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "user_impersonation_link_generated");
  assert.equal(entries[0].target, ids.user);
  assert.doesNotMatch(JSON.stringify(entries[0]), EMAIL_OR_LINK);
});

// ---------- password reset ----------

test("ATTACK: a reset for a spoofed account goes to its Auth email, never the address the profile claims", async () => {
  const { world, ids } = staff();
  const result = await callReset(world, ids.superadmin, ids.spoofer);
  assert.equal(result.status, 200);
  assert.deepEqual(result.authRecipients, ["mallory@evil.test"]);
});

test("an Owner cannot reset a Superadmin's or another Owner's password", async () => {
  const { world, ids } = staff();
  for (const target of [ids.superadmin, ids.owner2]) {
    const result = await callReset(world, ids.owner, target);
    assert.deepEqual([result.status, result.body], [403, { error: "ADMIN_REQUIRED" }]);
    assert.deepEqual(result.authRecipients, []);
    assert.deepEqual(result.writes, []);
  }
});

test("legitimate reset: sent to the verified Auth email, audited by id with no email", async () => {
  const { world, ids } = staff();
  const result = await callReset(world, ids.superadmin, ids.user);
  assert.equal(result.status, 200);
  assert.deepEqual(result.authRecipients, ["user@tubify.test"]);
  const entries = audits(result);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "user_password_reset_sent");
  assert.equal(entries[0].target, ids.user);
  assert.doesNotMatch(JSON.stringify(entries[0]), EMAIL_OR_LINK);
  // A Superadmin may still send a reset to another Superadmin (it only goes to their own inbox).
  const peer = await callReset(world, ids.superadmin, ids.superadmin2);
  assert.equal(peer.status, 200);
  assert.deepEqual(peer.authRecipients, ["boss2@tubify.test"]);
});

test("stale profile email: impersonation and reset use the current Auth email", async () => {
  const { world, ids } = staff();
  world.authEmails![ids.user] = "user.new@tubify.test"; // profile still says user@tubify.test
  const link = await callImpersonate(world, ids.superadmin, ids.user);
  assert.equal(link.status, 200);
  assert.deepEqual(link.authRecipients, ["user.new@tubify.test"]);
  const sent = await callReset(world, ids.superadmin, ids.user);
  assert.deepEqual(sent.authRecipients, ["user.new@tubify.test"]);
});

test("missing Auth identity: 404, no link, no email, nothing audited", async () => {
  const { world, ids } = staff();
  world.authEmails![ids.user] = null;
  for (const call of [callImpersonate, callReset]) {
    const result = await call(world, ids.superadmin, ids.user);
    assert.deepEqual([result.status, result.body], [404, { error: "USER_NOT_FOUND" }]);
    assert.deepEqual(result.authActions, []);
    assert.deepEqual(result.writes, []);
  }
});

test("unauthorized callers are refused before any lookup, link or email", async () => {
  const { world, ids } = staff();
  for (const call of [callImpersonate, callReset]) {
    const manager = await call(world, ids.manager, ids.user);
    assert.deepEqual([manager.status, manager.body], [403, { error: "ADMIN_REQUIRED" }]);
    const owner = await call(world, ids.owner, ids.user);
    assert.deepEqual([owner.status, owner.body], [403, { error: "ADMIN_REQUIRED" }]);
    assert.deepEqual(owner.authActions, []);
    assert.deepEqual(owner.writes, []);
    assert.deepEqual(manager.authActions, []);
    const signedOut = await call(world, null, ids.user);
    assert.equal(signedOut.status, 401);
    assert.deepEqual(signedOut.authActions, []);
    assert.deepEqual([...manager.writes, ...signedOut.writes], []);
  }
});

// ---------- workspace invitations ----------
//
// Inviting creates a shareable link invitation and never joins, activates or emails anyone. Who
// may join is decided when the link is accepted, from the address Supabase Auth holds for the
// signed-in account (confirmed) — never from profiles.email, which its owner can rewrite.

function inviter() {
  const world = emptyWorld();
  const owner = addUser(world, "owner@team.test");
  const workspace = addWorkspace(world, owner);
  addSubscription(world, owner, "scale");
  return { world, owner, workspace };
}
/** An account with no active membership anywhere (e.g. removed from a team), so it may join. */
function freeAccount(world: World, profileEmail: string, authEmail?: string | null) {
  const id = addUser(world, profileEmail);
  const elsewhere = addWorkspace(world, addUser(world, `host-${profileEmail}`));
  addMember(world, elsewhere, id, "editor", { status: "removed" });
  if (authEmail !== undefined) (world.authEmails ??= {})[id] = authEmail;
  return id;
}
const invite = (world: World, as: string, email: string) =>
  callTeamApi(members, world, { as, method: "POST", body: { email, role: "manager" } });
const tokenOf = (result: Awaited<ReturnType<typeof invite>>) =>
  String((result.body.data as { inviteUrl: string }).inviteUrl).split("/invite/")[1];
const accept = (world: World, as: string, token: string) =>
  callTeamApi(invitations, world, {
    as,
    method: "POST",
    path: "/api/invitations",
    body: { action: "accept", token },
  });
const activeIn = (world: World, workspace: string) =>
  world.workspace_members
    .filter((m) => m.workspace_id === workspace && m.status === "active")
    .map((m) => m.user_id);

test("inviting joins, activates and emails nobody — even an existing account with that address", async () => {
  const { world, owner, workspace } = inviter();
  const existing = freeAccount(world, "victim@team.test");
  const result = await invite(world, owner, "victim@team.test");
  assert.equal(result.status, 201);
  assert.deepEqual(result.invitesSent, [], "no email");
  assert.deepEqual(result.authActions, [], "nothing asked of Supabase Auth");
  assert.deepEqual(activeIn(world, workspace), [owner], "nobody joined");
  assert.ok(
    !world.workspace_members.some((m) => m.user_id === existing && m.workspace_id === workspace),
  );
  assert.equal(world.workspace_invitations?.length, 1);
});

test("ATTACK: a profile email set to the invitee's address cannot accept the invitation", async () => {
  const { world, owner, workspace } = inviter();
  const attacker = freeAccount(world, "victim@team.test", "attacker@evil.test");
  const token = tokenOf(await invite(world, owner, "victim@team.test"));
  const result = await accept(world, attacker, token);
  assert.deepEqual([result.status, result.body.error], [403, "wrong_account"]);
  assert.ok(!activeIn(world, workspace).includes(attacker), "the attacker did not join");
  assert.equal(
    world.workspace_invitations![0].status,
    "pending",
    "the link still works for the invitee",
  );
});

test("ATTACK: with the real invitee and a spoofer sharing the address, only the real account joins", async () => {
  const { world, owner, workspace } = inviter();
  const victim = freeAccount(world, "victim@team.test");
  const attacker = freeAccount(world, "victim@team.test", "attacker@evil.test");
  const token = tokenOf(await invite(world, owner, "victim@team.test"));
  assert.equal((await accept(world, attacker, token)).status, 403);
  assert.equal((await accept(world, victim, token)).status, 200);
  const joined = activeIn(world, workspace);
  assert.ok(joined.includes(victim), "the real invitee joined");
  assert.ok(!joined.includes(attacker), "the spoofer did not");
});

test("legitimate invitation of an existing account: matched exactly, ignoring letter case", async () => {
  const { world, owner, workspace } = inviter();
  const invitee = freeAccount(world, "Jordan.Lee@team.test");
  const token = tokenOf(await invite(world, owner, "jordan.lee@TEAM.test"));
  const result = await accept(world, invitee, token);
  assert.equal(result.status, 200, result.text);
  assert.ok(activeIn(world, workspace).includes(invitee));
});

test("an address that only matches as a pattern ('_' wildcard) cannot accept", async () => {
  const { world, owner, workspace } = inviter();
  const lookalike = freeAccount(world, "aXb@team.test");
  const token = tokenOf(await invite(world, owner, "a_b@team.test"));
  const result = await accept(world, lookalike, token);
  assert.equal(result.status, 403);
  assert.ok(!activeIn(world, workspace).includes(lookalike));
});

test("a profile with no Auth account, or a stale profile email, cannot accept", async () => {
  const { world, owner, workspace } = inviter();
  const orphan = freeAccount(world, "ghost@team.test", null);
  const ghostToken = tokenOf(await invite(world, owner, "ghost@team.test"));
  assert.notEqual((await accept(world, orphan, ghostToken)).status, 200);
  assert.ok(!activeIn(world, workspace).includes(orphan), "no Auth account behind it");
  // A profile still showing an address its owner no longer signs in with.
  const moved = freeAccount(world, "old@team.test", "new@team.test");
  const oldToken = tokenOf(await invite(world, owner, "old@team.test"));
  assert.equal((await accept(world, moved, oldToken)).status, 403);
  assert.ok(!activeIn(world, workspace).includes(moved), "stale profile email is not identity");
});

test("unauthorized callers cannot invite (unchanged): an editor is refused and nothing is written", async () => {
  const { world, workspace } = inviter();
  const editor = addUser(world, "editor@team.test");
  addMember(world, workspace, editor, "editor");
  const before = JSON.stringify(world.workspace_members);
  const result = await invite(world, editor, "anyone@team.test");
  assert.equal(result.status, 403);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.invitesSent, []);
  assert.equal(JSON.stringify(world.workspace_members), before);
  assert.equal(world.workspace_invitations?.length ?? 0, 0);
});

test("impersonation and reset failures do not pass on Supabase's error text", () => {
  for (const file of [
    "src/routes/api.admin.users.impersonate.ts",
    "src/routes/api.admin.users.reset-password.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /message: error/, file);
    assert.doesNotMatch(source, /console\.(log|warn|error)/, file);
  }
});
