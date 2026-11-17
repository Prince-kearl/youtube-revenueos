import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  addMember,
  addPaidWorkspace,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";

// Shareable workspace invitations: an owner/manager creates a link for one address; the person
// opens it, signs in with that (confirmed) address and accepts. The real route handlers run
// against the in-memory database; accept_workspace_invitation is mirrored step for step in the
// fake (its SQL is checked separately below and rehearsed on a real database before release).

const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
env.APP_URL = "https://app.tubify.test";

const members = await import("../src/routes/api.workspace.members");
const manage = await import("../src/routes/api.workspace.invitations");
const publicApi = await import("../src/routes/api.invitations");
const share = await import("../src/lib/invitations");

type Row = Record<string, unknown>;

function agency() {
  const world: World = emptyWorld();
  const owner = addUser(world, "owner@agency.test");
  const workspace = addPaidWorkspace(world, owner); // Scale: team management
  const manager = addUser(world, "manager@agency.test");
  addMember(world, workspace, manager, "manager");
  const editor = addUser(world, "editor@agency.test");
  addMember(world, workspace, editor, "editor");
  world.workspace_invitations = [];
  world.audit_events = [];
  return { world, owner, workspace, manager, editor };
}
type Agency = ReturnType<typeof agency>;

/** A person who signed up (their own new, empty workspace, as handle_new_user creates). */
function newcomer(world: World, email: string) {
  const id = addUser(world, email);
  const own = addWorkspace(world, id);
  return { id, own };
}

const invite = (a: Agency, as: string, body: Row) =>
  callTeamApi(members, a.world, { as, method: "POST", body });
const tokenOf = (r: CallResult) =>
  String((r.body.data as { inviteUrl: string }).inviteUrl).split("/invite/")[1];
const lookup = (a: Agency, as: string | null, token: string) =>
  callTeamApi(publicApi, a.world, {
    as,
    method: "POST",
    path: "/api/invitations",
    body: { action: "lookup", token },
  });
const accept = (a: Agency, as: string | null, token: string) =>
  callTeamApi(publicApi, a.world, {
    as,
    method: "POST",
    path: "/api/invitations",
    body: { action: "accept", token },
  });
const act = (a: Agency, as: string, body: Row) =>
  callTeamApi(manage, a.world, { as, method: "POST", path: "/api/workspace/invitations", body });
const listInvites = (a: Agency, as: string) =>
  callTeamApi(manage, a.world, { as, method: "GET", path: "/api/workspace/invitations" });
const invitations = (a: Agency) => a.world.workspace_invitations as Row[];
const membership = (a: Agency, userId: string, workspace = a.workspace) =>
  a.world.workspace_members.find((m) => m.workspace_id === workspace && m.user_id === userId);
const writesExceptReads = (r: CallResult) => r.writes.filter((w) => w.method !== "GET");

async function invited(a: Agency, email: string, role = "editor", as = a.owner) {
  const r = await invite(a, as, { email, role });
  assert.equal(r.status, 201, r.text);
  return tokenOf(r);
}

// ---------- creating ----------

test("an owner creates an invitation: stored with a SHA-256 hash, the raw token only in the returned link", async () => {
  const a = agency();
  const r = await invite(a, a.owner, {
    email: "Client@Brand.test",
    role: "editor",
    jobTitle: "Client",
  });
  assert.equal(r.status, 201, r.text);
  const url = String((r.body.data as { inviteUrl: string }).inviteUrl);
  assert.match(
    url,
    /^https:\/\/app\.tubify\.test\/invite\/[A-Za-z0-9_-]{43}$/,
    "the configured app URL",
  );
  const token = tokenOf(r);
  const [row] = invitations(a);
  assert.equal(row.email, "client@brand.test", "stored lower-case");
  assert.equal(row.workspace_id, a.workspace);
  assert.equal(row.invited_by, a.owner);
  assert.equal(row.role, "editor");
  assert.equal(row.status, "pending");
  assert.equal(row.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(a.world).includes(token), "the raw token is stored nowhere");
  const days = (Date.parse(String(row.expires_at)) - Date.now()) / 86_400_000;
  assert.ok(days > 6.9 && days <= 7, "expires in 7 days");
  assert.deepEqual(r.invitesSent, [], "no email");
  assert.doesNotMatch(r.text, /token_hash/);
  const audit = (a.world.audit_events as Row[]).find(
    (e) => e.action === "workspace_invitation.created",
  )!;
  assert.equal(audit.resource_id, row.id);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(token));
});

test("tokens are 256-bit random values: never repeated", async () => {
  const a = agency();
  const tokens = new Set<string>();
  for (let n = 0; n < 15; n++) tokens.add(await invited(a, `person${n}@x.test`));
  assert.equal(tokens.size, 15);
});

test("an editor or setter cannot invite; a manager cannot invite a manager or owner — nothing is written", async () => {
  const a = agency();
  const setter = addUser(a.world, "setter@agency.test");
  addMember(a.world, a.workspace, setter, "setter");
  for (const [as, role] of [
    [a.editor, "editor"],
    [setter, "editor"],
    [a.manager, "manager"],
    [a.manager, "owner"],
  ] as const) {
    const r = await invite(a, as, { email: "x@x.test", role });
    assert.equal(r.status, 403, `${role} by ${as}`);
    assert.deepEqual(writesExceptReads(r), []);
  }
  assert.equal(invitations(a).length, 0);
  assert.equal((await invite(a, a.manager, { email: "s@x.test", role: "setter" })).status, 201);
});

test("signed out, or an invalid address: refused before anything is written", async () => {
  const a = agency();
  assert.equal(
    (await invite(a, null as unknown as string, { email: "x@x.test", role: "editor" })).status,
    401,
  );
  for (const email of ["not-an-email", "", "a@b", "x".repeat(330) + "@x.test"]) {
    const r = await invite(a, a.owner, { email, role: "editor" });
    assert.equal(r.status, 422, email);
  }
  assert.equal(invitations(a).length, 0);
});

test("one open invitation per address: a second is refused with the existing one's id (to regenerate it)", async () => {
  const a = agency();
  await invited(a, "client@x.test");
  const again = await invite(a, a.owner, { email: "CLIENT@x.test", role: "manager" });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "ALREADY_INVITED");
  assert.equal(again.body.invitationId, invitations(a)[0].id);
  assert.equal(invitations(a).length, 1);
  // Someone already on the team is not invited at all.
  const r = await invite(a, a.owner, { email: "editor@agency.test", role: "editor" });
  assert.deepEqual([r.status, r.body.error], [409, "ALREADY_A_MEMBER"]);
});

test("issuing is rate limited per workspace (and the limit fails closed)", async () => {
  const a = agency();
  for (let n = 0; n < 20; n++)
    (a.world.audit_events as Row[]).push({
      id: uuid(),
      action: "workspace_invitation.created",
      resource_type: "workspace_invitation",
      metadata: { workspaceId: a.workspace },
      created_at: new Date().toISOString(),
    });
  const r = await invite(a, a.owner, { email: "one-more@x.test", role: "editor" });
  assert.deepEqual([r.status, r.body.error], [429, "INVITATION_RATE_LIMITED"]);
  assert.equal(invitations(a).length, 0);
  // Another workspace's invitations do not count against this one.
  const b = agency();
  b.world.audit_events = a.world.audit_events;
  assert.equal((await invite(b, b.owner, { email: "fine@x.test", role: "editor" })).status, 201);
});

// ---------- looking a link up ----------

test("signed out: whether the link works and a masked address — no workspace, inviter or role", async () => {
  const a = agency();
  const token = await invited(a, "client@brand.test");
  const r = await lookup(a, null, token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { state: "pending", emailHint: "c***@brand.test" });
  assert.doesNotMatch(r.text, /agency|Workspace|editor|owner@/);
});

test("signed in with the invited address: the workspace, inviter and role", async () => {
  const a = agency();
  const token = await invited(a, "client@brand.test");
  const client = newcomer(a.world, "client@brand.test");
  const r = await lookup(a, client.id, token);
  const data = r.body.data as Row;
  assert.equal(data.emailMatches, true);
  assert.equal(data.role, "editor");
  assert.equal(data.workspaceName, "Workspace");
  assert.ok(data.inviterName);
});

test("signed in with another address: told it's the wrong account, nothing about the workspace", async () => {
  const a = agency();
  const token = await invited(a, "client@brand.test");
  const other = newcomer(a.world, "someone@else.test");
  const r = await lookup(a, other.id, token);
  const data = r.body.data as Row;
  assert.equal(data.emailMatches, false);
  assert.equal(data.signedInEmail, "someone@else.test");
  assert.equal(data.workspaceName, undefined);
  assert.equal(data.role, undefined);
});

test("invalid, malformed, expired, revoked and used links say so (and nothing else)", async () => {
  const a = agency();
  assert.deepEqual((await lookup(a, null, "x".repeat(43))).body.data, { state: "invalid" });
  assert.deepEqual((await lookup(a, null, "../etc")).body.data, { state: "invalid" });

  const expired = await invited(a, "late@x.test");
  invitations(a).find((i) => i.email === "late@x.test")!.expires_at = new Date(
    Date.now() - 1000,
  ).toISOString();
  assert.equal(
    (await lookup(a, null, expired)).body.data && (await lookup(a, null, expired)).body.data!.state,
    "expired",
  );

  const revoked = await invited(a, "gone@x.test");
  await act(a, a.owner, {
    action: "revoke",
    id: invitations(a).find((i) => i.email === "gone@x.test")!.id,
  });
  assert.equal((await lookup(a, null, revoked)).body.data!.state, "revoked");

  const used = await invited(a, "used@x.test");
  const person = newcomer(a.world, "used@x.test");
  assert.equal((await accept(a, person.id, used)).status, 200);
  assert.equal((await lookup(a, null, used)).body.data!.state, "accepted");
  assert.equal((await lookup(a, null, used)).body.data!.alreadyJoined, false);
  assert.equal((await lookup(a, person.id, used)).body.data!.alreadyJoined, true);
});

// ---------- accepting ----------

test("a new user (own empty workspace) accepts: joins with the invited role, leaves the empty one", async () => {
  const a = agency();
  const r0 = await invite(a, a.owner, {
    email: "client@brand.test",
    role: "editor",
    revenueVisible: true,
    jobTitle: "Brand client",
    commission: 7,
  });
  const token = tokenOf(r0);
  const client = newcomer(a.world, "client@brand.test");
  const r = await accept(a, client.id, token);
  assert.deepEqual([r.status, r.body], [200, { data: { outcome: "accepted" } }]);
  const joined = membership(a, client.id)!;
  assert.equal(joined.status, "active");
  assert.equal(joined.role, "editor");
  assert.equal(joined.revenue_visible, true);
  assert.equal(joined.job_title, "Brand client");
  assert.equal(joined.commission, 7);
  assert.equal(
    membership(a, client.id, client.own)!.status,
    "removed",
    "the empty own workspace is left",
  );
  assert.ok(
    a.world.workspaces.some((w) => w.id === client.own),
    "and nothing was deleted",
  );
  const inv = invitations(a)[0];
  assert.equal(inv.status, "accepted");
  assert.equal(inv.accepted_by, client.id);
  assert.equal(inv.membership_id, joined.id);
  assert.ok(inv.accepted_at);
  assert.ok(
    (a.world.audit_events as Row[]).some((e) => e.action === "workspace_invitation.accepted"),
  );
  assert.ok(
    a.world.notifications.some((n) => n.user_id === a.owner && n.title === "Invitation accepted"),
  );
  // Exactly one active workspace for the account.
  assert.equal(
    a.world.workspace_members.filter((m) => m.user_id === client.id && m.status === "active")
      .length,
    1,
  );
});

test("an existing user whose own workspace is in use is refused, and nothing changes", async () => {
  const a = agency();
  const token = await invited(a, "creator@x.test");
  const creator = newcomer(a.world, "creator@x.test");
  a.world.youtube_channels = [{ id: uuid(), workspace_id: creator.own, connection_id: "c" }];
  const before = JSON.stringify(a.world.workspace_members);
  const r = await accept(a, creator.id, token);
  assert.deepEqual([r.status, r.body.error], [409, "has_own_workspace"]);
  assert.equal(JSON.stringify(a.world.workspace_members), before);
  assert.equal(invitations(a)[0].status, "pending");
});

test("a different account cannot accept, signed out cannot accept, and neither changes anything", async () => {
  const a = agency();
  const token = await invited(a, "client@brand.test");
  const other = newcomer(a.world, "other@x.test");
  const before = JSON.stringify(a.world.workspace_members);
  const wrong = await accept(a, other.id, token);
  assert.deepEqual([wrong.status, wrong.body.error], [403, "wrong_account"]);
  const anonymous = await accept(a, null, token);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(anonymous.rpcCalls, []);
  assert.equal(JSON.stringify(a.world.workspace_members), before);
  assert.equal(invitations(a)[0].status, "pending");
});

test("accepting twice, or twice at once, makes one membership; the link then refuses anyone else", async () => {
  const a = agency();
  const token = await invited(a, "client@brand.test");
  const client = newcomer(a.world, "client@brand.test");
  const [first, second] = await Promise.all([
    accept(a, client.id, token),
    accept(a, client.id, token),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual([first.body.data, second.body.data].map((d) => (d as Row).outcome).sort(), [
    "accepted",
    "already_member",
  ]);
  assert.equal(
    a.world.workspace_members.filter(
      (m) => m.workspace_id === a.workspace && m.user_id === client.id,
    ).length,
    1,
  );
  // Replaying the link with another account that has the same address is impossible (one
  // account per address), but any other account is refused.
  const other = newcomer(a.world, "other@x.test");
  const replay = await accept(a, other.id, token);
  assert.deepEqual([replay.status, replay.body.error], [410, "used"]);
});

test("expired and revoked invitations cannot be accepted", async () => {
  const a = agency();
  const late = await invited(a, "late@x.test");
  invitations(a)[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const person = newcomer(a.world, "late@x.test");
  assert.deepEqual([(await accept(a, person.id, late)).status], [410]);

  const gone = await invited(a, "gone@x.test");
  const goneRow = invitations(a).find((i) => i.email === "gone@x.test")!;
  await act(a, a.owner, { action: "revoke", id: goneRow.id });
  const p2 = newcomer(a.world, "gone@x.test");
  const r = await accept(a, p2.id, gone);
  assert.deepEqual([r.status, r.body.error], [410, "revoked"]);
  assert.equal(membership(a, p2.id), undefined);
});

test("an inviter who has lost their role, or a workspace that lost Team Management, cannot let anyone in", async () => {
  const a = agency();
  const token = await invited(a, "s@x.test", "setter", a.manager);
  a.world.workspace_members.find((m) => m.user_id === a.manager)!.role = "editor";
  const p = newcomer(a.world, "s@x.test");
  const demoted = await accept(a, p.id, token);
  assert.deepEqual([demoted.status, demoted.body.error], [409, "inviter_not_allowed"]);
  assert.equal(membership(a, p.id), undefined);

  const b = agency();
  const t2 = await invited(b, "c@x.test");
  for (const sub of b.world.subscriptions) sub.status = "canceled";
  const q = newcomer(b.world, "c@x.test");
  const unentitled = await accept(b, q.id, t2);
  assert.deepEqual([unentitled.status, unentitled.body.error], [409, "WORKSPACE_NOT_ENTITLED"]);
  assert.deepEqual(
    unentitled.rpcCalls.filter((c) => c === "accept_workspace_invitation"),
    [],
  );
});

test("the role, workspace and inviter come from the invitation, never from the request", async () => {
  const a = agency();
  const token = await invited(a, "client@brand.test", "editor");
  const client = newcomer(a.world, "client@brand.test");
  const forged = await callTeamApi(publicApi, a.world, {
    as: client.id,
    method: "POST",
    path: "/api/invitations",
    body: { action: "accept", token, role: "owner", workspaceId: uuid() },
  });
  assert.equal(forged.status, 422, "unknown fields are refused");
  assert.equal((await accept(a, client.id, token)).status, 200);
  assert.equal(membership(a, client.id)!.role, "editor");
});

// ---------- managing ----------

test("revoking stops the link; regenerating replaces it (the old one stops, the new one works)", async () => {
  const a = agency();
  const oldToken = await invited(a, "client@brand.test");
  const id = String(invitations(a)[0].id);
  const renewed = await act(a, a.owner, { action: "regenerate", id });
  assert.equal(renewed.status, 200, renewed.text);
  const newToken = tokenOf(renewed);
  assert.notEqual(newToken, oldToken);
  assert.equal(
    (await lookup(a, null, oldToken)).body.data!.state,
    "invalid",
    "the old link is dead",
  );
  assert.equal((await lookup(a, null, newToken)).body.data!.state, "pending");
  const client = newcomer(a.world, "client@brand.test");
  assert.equal((await accept(a, client.id, newToken)).status, 200);
  // An accepted invitation cannot be regenerated or revoked.
  assert.deepEqual((await act(a, a.owner, { action: "regenerate", id })).body, {
    error: "INVITATION_NOT_OPEN",
  });
});

test("an expired invitation can be renewed with a fresh 7 days", async () => {
  const a = agency();
  await invited(a, "late@x.test");
  const row = invitations(a)[0];
  row.expires_at = new Date(Date.now() - 1000).toISOString();
  const renewed = await act(a, a.owner, { action: "regenerate", id: row.id });
  assert.equal(renewed.status, 200);
  assert.ok(Date.parse(String(row.expires_at)) > Date.now() + 6 * 86_400_000);
});

test("managers manage only setter/editor invitations; editors none; another workspace's ids are not found", async () => {
  const a = agency();
  await invited(a, "m@x.test", "manager");
  const managerInvite = String(invitations(a)[0].id);
  const byManager = await act(a, a.manager, { action: "revoke", id: managerInvite });
  assert.equal(byManager.status, 403);
  const byEditor = await act(a, a.editor, { action: "revoke", id: managerInvite });
  assert.equal(byEditor.status, 403);
  assert.equal((await listInvites(a, a.editor)).status, 403);
  assert.equal(invitations(a)[0].status, "pending");

  const b = agency();
  b.world = a.world; // same database, a different agency's workspace
  const other = addUser(a.world, "other-owner@x.test");
  const otherWs = addPaidWorkspace(a.world, other);
  void otherWs;
  const fromOther = await act({ ...a, owner: other }, other, {
    action: "revoke",
    id: managerInvite,
  });
  assert.deepEqual([fromOther.status, fromOther.body.error], [404, "INVITATION_NOT_FOUND"]);
  const otherList = await listInvites({ ...a, owner: other }, other);
  assert.deepEqual((otherList.body.data as unknown[]).length, 0);
});

test("the list shows state, inviter and dates — never a token hash — plus older email invites to convert", async () => {
  const a = agency();
  await invited(a, "client@brand.test");
  addMember(a.world, a.workspace, null as unknown as string, "setter", {
    status: "invited",
    invited_email: "legacy@x.test",
  });
  const legacy = a.world.workspace_members.find((m) => m.invited_email === "legacy@x.test")!;
  legacy.user_id = null;
  const r = await listInvites(a, a.owner);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /token_hash|[0-9a-f]{64}/);
  const [item] = r.body.data as Row[];
  assert.equal(item.state, "pending");
  assert.equal(item.email, "client@brand.test");
  assert.ok(item.invitedBy);
  assert.equal((r.body.legacy as Row[])[0].email, "legacy@x.test");

  const converted = await act(a, a.owner, { action: "convert", memberId: legacy.id });
  assert.equal(converted.status, 201, converted.text);
  assert.ok(tokenOf(converted));
  assert.equal(
    a.world.workspace_members.some((m) => m.id === legacy.id),
    false,
    "the old pending row is replaced",
  );
  assert.ok(invitations(a).some((i) => i.email === "legacy@x.test" && i.role === "setter"));
});

// ---------- sharing (the Team page) ----------

test("share links: WhatsApp and email carry the message and the link; nothing claims an email was sent", () => {
  const url = "https://app.tubify.test/invite/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
  const message = share.invitationMessage(url);
  assert.match(message, /You've been invited to join my Tubify workspace/);
  assert.ok(message.endsWith(url));
  const wa = new URL(share.whatsappShareUrl(url));
  assert.equal(wa.origin, "https://wa.me");
  assert.equal(wa.searchParams.get("text"), message);
  const mail = share.mailtoShareUrl(url, "client@brand.test");
  assert.match(mail, /^mailto:client@brand\.test\?subject=/);
  assert.equal(new URLSearchParams(mail.split("?")[1]).get("body"), message);
  assert.equal(share.isInvitationPath(`/invite/${url.split("/invite/")[1]}`), true);
  assert.equal(share.isInvitationPath("/invite/short"), false);
  assert.equal(share.isInvitationPath("/dashboard"), false);
  const team = readFileSync("src/routes/team.tsx", "utf8");
  assert.doesNotMatch(team, /Invite sent to/, "the Team page never claims an email was sent");
});

test("sign-in, sign-up and the auth callback keep an invitation as the destination and skip the YouTube step", () => {
  const callback = readFileSync("src/routes/auth.callback.tsx", "utf8");
  assert.match(
    callback,
    /url\.searchParams\.get\("next"\) \?\? getCookie\(request, POST_LOGIN_COOKIE\)/,
  );
  assert.match(callback, /isInvitationPath\(next\)/);
  const signup = readFileSync("src/routes/signup.tsx", "utf8");
  assert.match(signup, /referredByCode,\s*nextPath,/);
  const signin = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(signin, /isInvitationPath\(nextPath\)/);
});

// ---------- the migration ----------

test("migration: server-only table, hashed tokens, one open invite per address, locked acceptance", () => {
  const sql = readFileSync("supabase/migrations/202611170001_workspace_invitations.sql", "utf8");
  assert.match(sql, /alter table public\.workspace_invitations enable row level security/);
  assert.match(sql, /revoke all on public\.workspace_invitations from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i, "no policy: no browser session reads invitations");
  assert.match(
    sql,
    /token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
  );
  assert.match(sql, /workspace_invitations_pending_email_idx[\s\S]*where status = 'pending'/);
  const fn = sql.slice(
    sql.indexOf("create or replace function public.accept_workspace_invitation"),
  );
  assert.match(fn, /security invoker/);
  assert.match(fn, /set search_path = public, pg_temp/);
  assert.match(
    fn,
    /where i\.token_hash = p_token_hash\s+for update/,
    "the invitation row is locked",
  );
  assert.match(
    sql,
    /revoke execute on function public\.accept_workspace_invitation\(text, uuid, text\) from public/,
  );
  assert.match(sql, /from anon, authenticated/);
  // New accounts no longer join a pending invite by email at creation (before confirmation).
  const trigger = sql.slice(sql.indexOf("create or replace function public.handle_new_user"));
  assert.doesNotMatch(trigger, /status = 'invited'/);
  assert.match(trigger, /insert into public\.workspaces/);
});
