import assert from "node:assert/strict";
import { test } from "node:test";
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

// Follow-up to the identity hotfix: act only on a VERIFIED Auth identity.
//
//   * Impersonation needs the target's Auth email to be confirmed (email_confirmed_at): using a
//     magic link proves inbox access, so it would otherwise mark an unverified address verified.
//   * An invitation activates an existing account only when Auth's own, confirmed email is the
//     invited address — an unconfirmed sign-up proves nothing about who owns the inbox.
//   * A password reset goes to the account's own Auth address whether or not it was confirmed
//     (completing it proves the inbox; blocking it would only stop legitimate recovery).
//   * When Auth cannot be asked, nothing happens: 503, no link, no email, no write, and no
//     provider message.
// Auth and the database are simulated; no real link or email is produced.

const impersonate = await import("../src/routes/api.admin.users.impersonate");
const reset = await import("../src/routes/api.admin.users.reset-password");
const members = await import("../src/routes/api.workspace.members");

function staff() {
  const world = emptyWorld();
  const ids = {
    superadmin: addUser(world, "boss@tubify.test", "superadmin"),
    superadmin2: addUser(world, "boss2@tubify.test", "superadmin"),
    owner: addUser(world, "owner@tubify.test", "owner"),
    user: addUser(world, "user@tubify.test", "user"),
    pending: addUser(world, "pending@tubify.test", "user"),
  };
  world.authUnconfirmed = [ids.pending];
  return { world, ids };
}
const post =
  (route: { Route: unknown }, path: string) => (world: World, as: string | null, id: string) =>
    callTeamApi(route, world, { as, method: "POST", path, body: { id } });
const callImpersonate = post(impersonate, "/api/admin/users/impersonate");
const callReset = post(reset, "/api/admin/users/reset-password");
const nothingHappened = (result: CallResult, label: string) => {
  assert.deepEqual(result.authActions, [], `${label}: no link or email`);
  assert.deepEqual(result.writes, [], `${label}: nothing written or audited`);
  assert.doesNotMatch(result.text, /action_link|token|upstream|unexpected_failure/, label);
};

// ---------- impersonation ----------

test("confirmed target: the link is generated for its Auth email", async () => {
  const { world, ids } = staff();
  const result = await callImpersonate(world, ids.owner, ids.user);
  assert.equal(result.status, 200);
  assert.deepEqual(result.authRecipients, ["user@tubify.test"]);
});

test("unconfirmed target: refused (409 EMAIL_UNCONFIRMED) before any link exists", async () => {
  const { world, ids } = staff();
  const result = await callImpersonate(world, ids.owner, ids.pending);
  assert.deepEqual([result.status, result.body], [409, { error: "EMAIL_UNCONFIRMED" }]);
  nothingHappened(result, "unconfirmed");
});

test("missing Auth account: 404, nothing happens", async () => {
  const { world, ids } = staff();
  world.authEmails = { [ids.user]: null };
  const result = await callImpersonate(world, ids.owner, ids.user);
  assert.deepEqual([result.status, result.body], [404, { error: "USER_NOT_FOUND" }]);
  nothingHappened(result, "missing");
});

test("Auth unavailable: 503 AUTH_UNAVAILABLE (not 'not found'), nothing happens, no provider detail", async () => {
  const { world, ids } = staff();
  world.authUnavailable = true;
  for (const call of [callImpersonate, callReset]) {
    const result = await call(world, ids.superadmin, ids.user);
    assert.deepEqual([result.status, result.body], [503, { error: "AUTH_UNAVAILABLE" }]);
    nothingHappened(result, "unavailable");
  }
});

test("an Owner cannot impersonate a Superadmin — refused on role before its email state is revealed", async () => {
  const { world, ids } = staff();
  world.authUnconfirmed = [ids.superadmin];
  const result = await callImpersonate(world, ids.owner, ids.superadmin);
  assert.deepEqual([result.status, result.body], [403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }]);
  nothingHappened(result, "owner → superadmin");
});

test("a Superadmin cannot impersonate another Superadmin", async () => {
  const { world, ids } = staff();
  const result = await callImpersonate(world, ids.superadmin, ids.superadmin2);
  assert.deepEqual([result.status, result.body], [403, { error: "PRIVILEGE_ESCALATION_BLOCKED" }]);
  nothingHappened(result, "peer");
});

test("a link issued for a different account is discarded", async () => {
  const { world, ids } = staff();
  world.generateLinkUserId = ids.superadmin;
  const result = await callImpersonate(world, ids.owner, ids.user);
  assert.deepEqual([result.status, result.body], [502, { error: "LINK_MISMATCH" }]);
  assert.doesNotMatch(result.text, /action_link|token|https?:\/\//);
});

// ---------- password reset ----------

test("legitimate reset: sent to the Auth email; an unconfirmed account can still recover", async () => {
  const { world, ids } = staff();
  const confirmed = await callReset(world, ids.owner, ids.user);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.authRecipients, ["user@tubify.test"]);
  const unconfirmed = await callReset(world, ids.owner, ids.pending);
  assert.equal(unconfirmed.status, 200);
  assert.deepEqual(unconfirmed.authRecipients, ["pending@tubify.test"]);
  // The hierarchy is unchanged: an Owner may not reset a Superadmin.
  const refused = await callReset(world, ids.owner, ids.superadmin);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.authRecipients, []);
});

// ---------- invitations ----------

function inviter() {
  const world = emptyWorld();
  const owner = addUser(world, "owner@team.test");
  const workspace = addWorkspace(world, owner);
  addSubscription(world, owner, "scale");
  return { world, owner, workspace };
}
let clock = 0;
/** An account free to join (no active membership), created at a known, increasing time. */
function account(
  world: World,
  profileEmail: string,
  opts: { auth?: string | null; unconfirmed?: boolean } = {},
) {
  const id = addUser(world, profileEmail);
  world.profiles.find((p) => p.id === id)!.created_at = new Date(
    Date.UTC(2026, 0, 1, 0, 0, clock++),
  ).toISOString();
  const host = addUser(world, `host${clock}@team.test`);
  addMember(world, addWorkspace(world, host), id, "editor", { status: "removed" });
  if (opts.auth !== undefined) (world.authEmails ??= {})[id] = opts.auth;
  if (opts.unconfirmed) (world.authUnconfirmed ??= []).push(id);
  return id;
}
const invite = (world: World, as: string, email: string) =>
  callTeamApi(members, world, { as, method: "POST", body: { email, role: "manager" } });
const activeIn = (world: World, workspace: string) =>
  world.workspace_members
    .filter((m) => m.workspace_id === workspace && m.status === "active")
    .map((m) => m.user_id);

test("confirmed existing invitee: activated", async () => {
  const { world, owner, workspace } = inviter();
  const invitee = account(world, "pat@team.test");
  const result = await invite(world, owner, "pat@team.test");
  assert.equal(result.status, 201);
  assert.ok(activeIn(world, workspace).includes(invitee));
  assert.deepEqual(result.invitesSent, []);
});

test("unconfirmed existing invitee: not activated; the ordinary invite email goes to the address", async () => {
  const { world, owner, workspace } = inviter();
  const invitee = account(world, "pat@team.test", { unconfirmed: true });
  const result = await invite(world, owner, "pat@team.test");
  assert.equal(result.status, 201);
  assert.ok(!activeIn(world, workspace).includes(invitee));
  assert.deepEqual(result.invitesSent, ["pat@team.test"]);
});

test("ATTACK: an unconfirmed sign-up using someone else's address cannot claim their invitation", async () => {
  const { world, owner, workspace } = inviter();
  // The squatter's Auth email IS the address — but it was never confirmed.
  const squatter = account(world, "ceo@team.test", { auth: "ceo@team.test", unconfirmed: true });
  await invite(world, owner, "ceo@team.test");
  assert.ok(!activeIn(world, workspace).includes(squatter));
});

test("ATTACK: a spoofed profile email activates nobody", async () => {
  const { world, owner, workspace } = inviter();
  const spoofer = account(world, "ceo@team.test", { auth: "mallory@evil.test" });
  await invite(world, owner, "ceo@team.test");
  assert.ok(!activeIn(world, workspace).includes(spoofer));
});

test("candidate limit: spoofers created after the real account cannot crowd it out", async () => {
  const { world, owner, workspace } = inviter();
  const real = account(world, "ceo@team.test");
  for (let n = 0; n < 15; n++) account(world, "ceo@team.test", { auth: `spoof${n}@evil.test` });
  const result = await invite(world, owner, "ceo@team.test");
  assert.equal(result.status, 201);
  assert.ok(activeIn(world, workspace).includes(real), "the genuine (older) account joins");
});

test("candidate limit: if pre-created spoofers fill the window, the invite stops — nobody joins, nothing is sent", async () => {
  const { world, owner } = inviter();
  for (let n = 0; n < 10; n++) account(world, "ceo@team.test", { auth: `spoof${n}@evil.test` });
  account(world, "ceo@team.test"); // the genuine account, created after the spoofers
  const before = JSON.stringify(world.workspace_members);
  const result = await invite(world, owner, "ceo@team.test");
  assert.deepEqual([result.status, result.body], [409, { error: "INVITE_ADDRESS_AMBIGUOUS" }]);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.invitesSent, []);
  assert.equal(JSON.stringify(world.workspace_members), before);
});

test("Auth unavailable while inviting: 503, nothing written, nothing sent", async () => {
  const { world, owner } = inviter();
  account(world, "pat@team.test");
  world.authUnavailable = true;
  const result = await invite(world, owner, "pat@team.test");
  assert.deepEqual([result.status, result.body], [503, { error: "AUTH_UNAVAILABLE" }]);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.invitesSent, []);
});

test("legitimate new-address invitation: a pending invite and the email, unchanged", async () => {
  const { world, owner, workspace } = inviter();
  const result = await invite(world, owner, "brand.new@team.test");
  assert.equal(result.status, 201);
  assert.deepEqual(result.invitesSent, ["brand.new@team.test"]);
  assert.equal(activeIn(world, workspace).length, 1);
});
