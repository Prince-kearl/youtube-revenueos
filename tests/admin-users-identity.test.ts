import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CALLER, TARGET, call } from "./helpers/admin-users-fake-api";

// Admin Users: authoritative identity, the partially built directory, and its maintenance.
//
// The attack these tests reproduce: profiles.email is user-editable (profiles_self_update does not
// protect it). A user sets theirs to someone else's address — a Superadmin's, say. Before this
// change, "Get impersonation link" and "Send password reset" took the address from profiles, so an
// Owner-level admin acting on that ordinary account got a sign-in link for the Superadmin.

const users = await import("../src/routes/api.admin.users");
const detail = await import("../src/routes/api.admin.users.detail");
const impersonate = await import("../src/routes/api.admin.users.impersonate");
const reset = await import("../src/routes/api.admin.users.reset-password");
const directory = await import("../src/routes/api.admin.users.directory");

const SPOOFED = {
  id: TARGET,
  name: "Totally The Superadmin",
  email: "superadmin@tubify.com", // rewritten by the account's owner
  avatar: null,
  role: "user",
  created_at: "2026-09-01T00:00:00+00:00",
};
const REAL_AUTH = {
  id: TARGET,
  email: "attacker@evil.com", // what the account actually signs in with
  email_confirmed_at: "2026-09-02T00:00:00Z",
  banned_until: null,
  last_sign_in_at: null,
  user_metadata: {},
};
const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;

// ---------- the attack ----------

test("ATTACK: impersonation signs in as the account's Auth email, never the profile's", async () => {
  const { status, body, recorded } = await call(impersonate, "/api/admin/users/impersonate", {
    method: "POST",
    body: { id: TARGET },
    callerRole: "owner",
    targetProfile: SPOOFED,
    authUser: REAL_AUTH,
  });
  assert.equal(status, 200);
  assert.equal(recorded.generateLink.length, 1);
  assert.equal(recorded.generateLink[0].email, "attacker@evil.com");
  assert.doesNotMatch(JSON.stringify(recorded.generateLink), /superadmin@tubify\.com/);
  assert.match(String((body.data as { url: string }).url), /attacker%40evil\.com/);
  // The role check still reads the protected profiles.role, and the identity lookup is by id.
  assert.deepEqual(recorded.authAdmin, [`/auth/v1/admin/users/${TARGET}`]);
});

test("ATTACK: a password reset goes to the account's Auth email, never the profile's", async () => {
  const { status, recorded } = await call(reset, "/api/admin/users/reset-password", {
    method: "POST",
    body: { id: TARGET },
    targetProfile: SPOOFED,
    authUser: REAL_AUTH,
  });
  assert.equal(status, 200);
  assert.equal(recorded.recover.length, 1);
  assert.equal(recorded.recover[0].email, "attacker@evil.com");
});

test("no Auth account behind the profile: no link, no email, 404", async () => {
  for (const [route, path] of [
    [impersonate, "/api/admin/users/impersonate"],
    [reset, "/api/admin/users/reset-password"],
  ] as const) {
    const { status, body, recorded } = await call(route, path, {
      method: "POST",
      body: { id: TARGET },
      targetProfile: SPOOFED,
      authUser: null,
    });
    assert.equal(status, 404, path);
    assert.equal(body.error, "USER_NOT_FOUND");
    assert.equal(recorded.generateLink.length + recorded.recover.length, 0, path);
    assert.equal(recorded.audit.length, 0, `${path}: nothing audited for a refused request`);
  }
});

test("the outrank rule still applies to impersonation and resets (owner cannot act on an owner)", async () => {
  for (const [route, path] of [
    [impersonate, "/api/admin/users/impersonate"],
    [reset, "/api/admin/users/reset-password"],
  ] as const) {
    const { status, recorded } = await call(route, path, {
      method: "POST",
      body: { id: TARGET },
      callerRole: "owner",
      targetProfile: { ...SPOOFED, role: "owner" },
      authUser: REAL_AUTH,
    });
    assert.equal(status, 403, path);
    assert.equal(recorded.generateLink.length + recorded.recover.length, 0);
  }
});

test("impersonation and reset audit entries name the account by id, with no email", async () => {
  for (const [route, path] of [
    [impersonate, "/api/admin/users/impersonate"],
    [reset, "/api/admin/users/reset-password"],
  ] as const) {
    const { recorded } = await call(route, path, {
      method: "POST",
      body: { id: TARGET },
      targetProfile: SPOOFED,
      authUser: REAL_AUTH,
    });
    assert.equal(recorded.audit.length, 1, path);
    assert.equal(recorded.audit[0].target, TARGET);
    assert.doesNotMatch(JSON.stringify(recorded.audit[0]), EMAIL);
  }
});

test("ATTACK: the detail view shows the Auth email, not the spoofed profile email", async () => {
  const { status, body, recorded } = await call(detail, `/api/admin/users/detail?id=${TARGET}`, {
    targetProfile: SPOOFED,
    authUser: REAL_AUTH,
  });
  assert.equal(status, 200);
  const identity = (body.data as { identity: { email: string; name: string } }).identity;
  assert.equal(identity.email, "attacker@evil.com");
  assert.doesNotMatch(JSON.stringify(body), /superadmin@tubify\.com/);
  // The profile email is not even read.
  const profileRead = recorded.rest.find(
    (u) => u.pathname === "/rest/v1/profiles" && u.searchParams.get("id") === `eq.${TARGET}`,
  )!;
  assert.doesNotMatch(profileRead.searchParams.get("select") ?? "", /email/);
});

test("historical audit entries that only match by email are not attributed to the account", async () => {
  const { body, recorded } = await call(detail, `/api/admin/users/detail?id=${TARGET}`, {
    targetProfile: SPOOFED,
    authUser: REAL_AUTH,
  });
  const audit = recorded.rest.find((u) => u.pathname === "/rest/v1/admin_audit_log")!;
  // Only target = <this account's id>: an entry whose target is an email address — even this
  // account's own Auth email, let alone the spoofed one — is never pulled in by matching it.
  assert.equal(audit.searchParams.get("target"), `eq.${TARGET}`);
  assert.doesNotMatch(audit.search, /attacker|superadmin|%40|@/);
  assert.ok(Array.isArray((body.data as { recentAdminActions: unknown[] }).recentAdminActions));
});

test("user-management audit entries are written with the account id, never an email", () => {
  const source = readFileSync("src/routes/api.admin.users.ts", "utf8");
  assert.doesNotMatch(source, /target: target\.email/);
  assert.doesNotMatch(source, /target: input\.email/);
  assert.equal((source.match(/target: target\.id,/g) ?? []).length, 5);
  assert.match(source, /action: "user_invited",\s+target: data\.user\.id,/);
  for (const file of [
    "src/routes/api.admin.users.impersonate.ts",
    "src/routes/api.admin.users.reset-password.ts",
  ]) {
    const route = readFileSync(file, "utf8");
    assert.doesNotMatch(route, /\.select\("email, role"\)/, file);
    assert.match(route, /service\.auth\.admin\.getUserById\(id\)/, file);
  }
});

// ---------- the directory while it is being built ----------

test("while the directory is incomplete the list says so, with progress — never a partial list", async () => {
  const { status, body, recorded } = await call(users, "/api/admin/users?stats=1", {
    directoryIncomplete: true,
  });
  assert.equal(status, 503);
  assert.equal(body.error, "ADMIN_USERS_DIRECTORY_INCOMPLETE");
  assert.ok(!("data" in body), "no rows");
  assert.ok(!("page" in body), "no total");
  assert.deepEqual(body.directory, {
    status: "backfilling",
    processed: 4000,
    inserted: 3990,
    startedAt: "2026-10-18T05:00:00Z",
    completedAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    syncFailures24h: 0,
  });
  assert.ok(recorded.rpc.some((r) => r.name === "admin_user_directory_status"));
});

// ---------- maintenance endpoint ----------

test("directory status: anyone who may manage users; only a Superadmin may maintain", async () => {
  const owner = await call(directory, "/api/admin/users/directory", { callerRole: "owner" });
  assert.equal(owner.status, 200);
  assert.equal((owner.body.data as { canMaintain: boolean }).canMaintain, false);
  const superadmin = await call(directory, "/api/admin/users/directory");
  assert.equal((superadmin.body.data as { canMaintain: boolean }).canMaintain, true);
  for (const role of ["manager", "editor", "user", null]) {
    const refused = await call(directory, "/api/admin/users/directory", { callerRole: role });
    assert.equal(refused.status, 403, String(role));
    assert.equal(refused.recorded.rpc.length, 0);
  }
  const signedOut = await call(directory, "/api/admin/users/directory", { signedIn: false });
  assert.equal(signedOut.status, 401);
});

test("maintenance is Superadmin-only: an Owner is refused before any database work or audit", async () => {
  for (const action of ["backfill", "check", "repair"]) {
    const { status, body, recorded } = await call(directory, "/api/admin/users/directory", {
      method: "POST",
      body: { action },
      callerRole: "owner",
    });
    assert.equal(status, 403, action);
    assert.equal(body.error, "ROLE_REQUIRED");
    assert.equal(recorded.rpc.length, 0);
    assert.equal(recorded.audit.length, 0);
  }
});

test("maintenance requests are strictly validated and bounded", async () => {
  for (const bad of [
    { action: "drop" },
    { action: "repair", limit: 5000 },
    { action: "repair", limit: 0 },
    { action: "check", after: "not-a-uuid" },
    { action: "check", after: "x' or 1=1" },
    { action: "backfill", extra: true },
    "nonsense",
  ]) {
    const { status, recorded } = await call(directory, "/api/admin/users/directory", {
      method: "POST",
      body: bad,
    });
    assert.equal(status, 422, JSON.stringify(bad));
    assert.equal(recorded.rpc.length, 0);
  }
});

test("a backfill request runs one batch of at most 2,000 and is audited with counts only", async () => {
  const { status, body, recorded } = await call(directory, "/api/admin/users/directory", {
    method: "POST",
    body: { action: "backfill" },
    rpcRows: {
      admin_user_directory_backfill_step: {
        status: "backfilling",
        batch_processed: 2000,
        batch_inserted: 1998,
        total_processed: 6000,
        done: false,
      },
    },
  });
  assert.equal(status, 200);
  assert.deepEqual(
    recorded.rpc.map((r) => r.name),
    ["admin_user_directory_backfill_step"],
  );
  assert.deepEqual(recorded.rpc[0].args, { p_limit: 2000 });
  assert.deepEqual(body.data, {
    status: "backfilling",
    batchProcessed: 2000,
    batchInserted: 1998,
    totalProcessed: 6000,
    done: false,
  });
  assert.equal(recorded.audit.length, 1);
  assert.equal(recorded.audit[0].action, "user_directory_backfill_batch");
  assert.equal(recorded.audit[0].admin_user_id, CALLER);
  assert.equal(recorded.audit[0].target, "admin_user_directory");
  assert.deepEqual(recorded.audit[0].new_value, {
    status: "backfilling",
    processed: 2000,
    inserted: 1998,
  });
});

test("a drift check is read-only (not audited); a repair is audited with counts only", async () => {
  const after = "11111111-0000-4000-8000-000000000001";
  const check = await call(directory, "/api/admin/users/directory", {
    method: "POST",
    body: { action: "check", after, limit: 500 },
    rpcRows: {
      admin_user_directory_check: {
        checked: 500,
        missing: 1,
        stale_email: 2,
        stale_profile: 0,
        stale_status: 3,
        next_after: "22222222-0000-4000-8000-000000000002",
        done: false,
      },
    },
  });
  assert.deepEqual(check.recorded.rpc[0].args, { p_after: after, p_limit: 500 });
  assert.equal(check.recorded.audit.length, 0);
  assert.deepEqual(check.body.data, {
    checked: 500,
    missing: 1,
    staleEmail: 2,
    staleProfile: 0,
    staleStatus: 3,
    nextAfter: "22222222-0000-4000-8000-000000000002",
    done: false,
  });

  const repair = await call(directory, "/api/admin/users/directory", {
    method: "POST",
    body: { action: "repair", after },
    rpcRows: {
      admin_user_directory_repair: {
        checked: 2000,
        inserted: 1,
        updated: 5,
        next_after: null,
        done: true,
      },
    },
  });
  assert.deepEqual(repair.recorded.rpc[0].args, { p_after: after, p_limit: 2000 });
  assert.equal(repair.recorded.audit.length, 1);
  assert.equal(repair.recorded.audit[0].action, "user_directory_repair_batch");
  assert.deepEqual(repair.recorded.audit[0].new_value, { checked: 2000, inserted: 1, updated: 5 });
  assert.doesNotMatch(JSON.stringify(repair.recorded.audit[0]), EMAIL);
});
