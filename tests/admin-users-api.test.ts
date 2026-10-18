import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Admin console → Users at scale (Phase 1A). Runs the real /api/admin/users list handler and the
// /api/admin/users/detail handler with every outside call (Supabase auth, PostgREST, the auth
// admin API) answered by a stub, and records exactly what the server asks the database for.

import { CALLER, TARGET, call, directoryRow, rows, type Row } from "./helpers/admin-users-fake-api";

const users = await import("../src/routes/api.admin.users");
const detail = await import("../src/routes/api.admin.users.detail");
const lib = await import("../src/lib/server/admin-users");

// ---------- authorization ----------

test("signed out: 401, and the database is never asked for users", async () => {
  const { status, recorded } = await call(users, "/api/admin/users", { signedIn: false });
  assert.equal(status, 401);
  assert.equal(recorded.rpc.length, 0);
});

test("roles without manage_users (manager, setter, editor, user) are refused before any read", async () => {
  for (const role of ["manager", "setter", "editor", "user", null]) {
    const list = await call(users, "/api/admin/users", { callerRole: role });
    assert.equal(list.status, 403, String(role));
    assert.equal(list.body.error, "PERMISSION_REQUIRED");
    assert.equal(list.recorded.rpc.length, 0, `${role}: no list read`);
    const one = await call(detail, `/api/admin/users/detail?id=${TARGET}`, { callerRole: role });
    assert.equal(one.status, 403, `${role} detail`);
    assert.equal(one.recorded.authAdmin.length, 0, `${role}: no auth admin read`);
    assert.ok(
      !one.recorded.rest.some((url) => url.pathname !== "/rest/v1/profiles"),
      `${role}: nothing but the caller's own role lookup`,
    );
  }
});

test("owner and superadmin may list users", async () => {
  for (const role of ["owner", "superadmin"]) {
    const { status } = await call(users, "/api/admin/users", { callerRole: role });
    assert.equal(status, 200, role);
  }
});

// ---------- request validation ----------

test("invalid requests are refused with 422 and never reach the database", async () => {
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=abc",
    "sort=name",
    "sort=created_at%3B%20drop",
    "role=god",
    "status=deleted",
    "q=a",
    `q=${"x".repeat(101)}`,
    "q=ab%00cd",
    "unknown=1",
    "cursor=not-a-cursor",
  ]) {
    const { status, body, recorded } = await call(users, `/api/admin/users?${query}`);
    assert.equal(status, 422, query);
    assert.ok(["VALIDATION_ERROR", "INVALID_CURSOR"].includes(String(body.error)), query);
    assert.equal(recorded.rpc.length, 0, `${query}: no database call`);
  }
});

test("defaults: 25 per page, newest first, one extra row asked for to detect the next page", async () => {
  const { status, recorded } = await call(users, "/api/admin/users");
  assert.equal(status, 200);
  const list = recorded.rpc.find((r) => r.name === "admin_list_users")!;
  assert.deepEqual(list.args, {
    p_limit: 26,
    p_sort: "newest",
    p_search_kind: null,
    p_search: null,
    p_role: null,
    p_status: null,
    p_cursor_created: null,
    p_cursor_email: null,
    p_cursor_id: null,
  });
});

test("search, role, status and sort are passed to the database, not applied in memory", async () => {
  const { recorded } = await call(
    users,
    "/api/admin/users?q=Kofi&role=manager&status=pending&sort=email&limit=50",
  );
  const list = recorded.rpc.find((r) => r.name === "admin_list_users")!;
  assert.equal(list.args.p_limit, 51);
  assert.equal(list.args.p_sort, "email");
  assert.equal(list.args.p_search_kind, "text");
  assert.equal(list.args.p_search, "Kofi");
  assert.equal(list.args.p_role, "manager");
  assert.equal(list.args.p_status, "pending");
  const count = recorded.rpc.find((r) => r.name === "admin_count_users")!;
  assert.deepEqual(count.args, {
    p_search_kind: "text",
    p_search: "Kofi",
    p_role: "manager",
    p_status: "pending",
  });
});

test("search kinds: a UUID is an exact id, '@' searches emails, anything else names and emails", () => {
  assert.equal(lib.searchKindFor(TARGET), "id");
  assert.equal(lib.searchKindFor("ama@"), "email");
  assert.equal(lib.searchKindFor("Ama Mensah"), "text");
  // LIKE wildcards are sent as typed; the database escapes them (see the migration test).
  const q = lib.parseAdminUsersQuery(new URLSearchParams({ q: "50%_off" }));
  assert.deepEqual(q.search, { kind: "text", text: "50%_off" });
});

// ---------- pagination boundaries ----------

test("exactly one page of rows: no next page", async () => {
  const { body } = await call(users, "/api/admin/users?limit=3", { listRows: rows(3), count: 3 });
  assert.equal((body.data as Row[]).length, 3);
  assert.deepEqual(body.page, { limit: 3, nextCursor: null, total: 3 });
});

test("one more row than the page: shows `limit` rows and a cursor from the last one shown", async () => {
  const { body } = await call(users, "/api/admin/users?limit=3", { listRows: rows(4), count: 9 });
  const data = body.data as Row[];
  assert.equal(data.length, 3);
  const page = body.page as { nextCursor: string; total: number };
  assert.equal(page.total, 9);
  assert.ok(page.nextCursor);
  const decoded = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8"));
  assert.equal(decoded.i, data[2].id);
  // The timestamp keeps its microseconds: a millisecond-rounded cursor would skip or repeat rows.
  assert.equal(decoded.c, "2026-10-13T08:00:00.123456+00:00");
});

test("the next page sends the cursor back; total and stats are only computed for page 1", async () => {
  const first = await call(users, "/api/admin/users?limit=3&stats=1", {
    listRows: rows(4),
    count: 9,
  });
  assert.ok(first.recorded.rpc.some((r) => r.name === "admin_count_users"));
  assert.ok(first.recorded.rpc.some((r) => r.name === "admin_user_stats"));
  assert.deepEqual(first.body.stats, { total: 10, active: 7, pending: 2, banned: 1 });
  const cursor = (first.body.page as { nextCursor: string }).nextCursor;

  const second = await call(
    users,
    `/api/admin/users?limit=3&stats=1&cursor=${encodeURIComponent(cursor)}`,
    { listRows: rows(2, 4) },
  );
  assert.equal(second.status, 200);
  const list = second.recorded.rpc.find((r) => r.name === "admin_list_users")!;
  assert.equal(list.args.p_cursor_id, (first.body.data as Row[])[2].id);
  assert.equal(list.args.p_cursor_created, "2026-10-13T08:00:00.123456+00:00");
  assert.equal(list.args.p_cursor_email, null);
  assert.ok(!second.recorded.rpc.some((r) => r.name === "admin_count_users"), "no recount");
  assert.ok(!second.recorded.rpc.some((r) => r.name === "admin_user_stats"), "no stats");
  assert.equal((second.body.page as { total: number | null }).total, null);
  assert.equal((second.body.page as { nextCursor: string | null }).nextCursor, null);
});

test("email ordering pages on the lower-cased email", async () => {
  const first = await call(users, "/api/admin/users?limit=2&sort=email", { listRows: rows(3) });
  const cursor = (first.body.page as { nextCursor: string }).nextCursor;
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  assert.equal(decoded.s, "email");
  assert.equal(decoded.e, "user2@example.com");
  assert.equal(decoded.c, null);
});

test("a cursor only works for the list it came from (same sort, same filters)", async () => {
  const first = await call(users, "/api/admin/users?limit=2&q=kofi", { listRows: rows(3) });
  const cursor = encodeURIComponent((first.body.page as { nextCursor: string }).nextCursor);
  for (const query of [
    `limit=2&q=ama&cursor=${cursor}`,
    `limit=2&q=kofi&sort=oldest&cursor=${cursor}`,
    `limit=2&q=kofi&role=owner&cursor=${cursor}`,
    `limit=2&cursor=${cursor}`,
  ]) {
    const { status, body, recorded } = await call(users, `/api/admin/users?${query}`);
    assert.equal(status, 422, query);
    assert.equal(body.error, "INVALID_CURSOR");
    assert.equal(recorded.rpc.length, 0);
  }
  // The same list accepts it (search is case-insensitive).
  const ok = await call(users, `/api/admin/users?limit=2&q=KOFI&cursor=${cursor}`);
  assert.equal(ok.status, 200);
});

test("a tampered cursor is refused", async () => {
  const forged = Buffer.from(
    JSON.stringify({
      v: 1,
      s: "newest",
      f: "[null,null,null,null]",
      c: "x' or 1=1",
      e: null,
      i: TARGET,
    }),
  ).toString("base64url");
  const { status, body } = await call(users, `/api/admin/users?cursor=${forged}`);
  assert.equal(status, 422);
  assert.equal(body.error, "INVALID_CURSOR");
});

// ---------- response shape ----------

test("each row carries identity, role and status only", async () => {
  const banned = directoryRow(1, {
    banned_until: "2099-01-01T00:00:00+00:00",
    creator_verified: true,
  });
  const pending = directoryRow(2, { email_confirmed_at: null, role: "admin" });
  const { body } = await call(users, "/api/admin/users", { listRows: [banned, pending] });
  const [a, b] = body.data as Row[];
  assert.deepEqual(Object.keys(a).sort(), [
    "avatar",
    "bannedUntil",
    "created_at",
    "creatorVerified",
    "email",
    "emailVerified",
    "id",
    "lastSignInAt",
    "name",
    "role",
    "status",
  ]);
  assert.equal(a.status, "Banned");
  assert.equal(a.creatorVerified, true);
  assert.equal(b.status, "Pending");
  assert.equal(b.role, "superadmin", "the legacy 'admin' value maps as before");
  assert.ok(!("email_lower" in a), "internal sort key not returned");
});

test("before the migration is applied: a clear 503, not a crash or an empty list", async () => {
  const { status, body } = await call(users, "/api/admin/users", { missingFunctions: true });
  assert.equal(status, 503);
  assert.equal(body.error, "ADMIN_USERS_MIGRATION_REQUIRED");
});

// ---------- detail ----------

test("detail: unknown and invalid ids", async () => {
  const missing = await call(detail, `/api/admin/users/detail?id=${TARGET}`, {
    targetProfile: null,
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "USER_NOT_FOUND");
  assert.equal(missing.recorded.authAdmin.length, 0, "nothing else read for an unknown id");
  const bad = await call(detail, "/api/admin/users/detail?id=not-a-uuid");
  assert.equal(bad.status, 422);
  assert.equal(
    bad.recorded.rest.filter((u) => u.searchParams.get("id") !== `eq.${CALLER}`).length,
    0,
  );
});

test("detail: every related read is limited and filtered to this one user", async () => {
  const { status, recorded } = await call(detail, `/api/admin/users/detail?id=${TARGET}`);
  assert.equal(status, 200);
  const byTable = (table: string) => recorded.rest.find((u) => u.pathname === `/rest/v1/${table}`)!;
  for (const [table, limit] of [
    ["workspace_members", "20"],
    ["youtube_channels", "20"],
    ["subscriptions", "1"],
    ["admin_audit_log", "10"],
  ] as const) {
    const url = byTable(table);
    assert.ok(url, table);
    assert.equal(url.searchParams.get("limit"), limit, `${table} limit`);
    if (table !== "admin_audit_log")
      assert.equal(url.searchParams.get("user_id"), `eq.${TARGET}`, `${table} filter`);
  }
  // Recent admin actions: by the account's immutable id only.
  assert.equal(byTable("admin_audit_log").searchParams.get("target"), `eq.${TARGET}`);
  assert.deepEqual(recorded.authAdmin, [`/auth/v1/admin/users/${TARGET}`]);
});

test("detail: no compensation, money, tokens, connection ids or raw auth metadata", async () => {
  const { body, recorded } = await call(detail, `/api/admin/users/detail?id=${TARGET}`);
  const selects = recorded.rest.map((u) => u.searchParams.get("select") ?? "").join(" ");
  assert.doesNotMatch(selects, /commission|lead_share|cost|amount|price|token|ciphertext/);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /secret_note|app_metadata|conn-1|ciphertext|amount_cents/);
  const data = body.data as {
    account: { status: string; creatorVerified: boolean };
    subscription: { plan: string };
    channels: { items: Row[] };
    workspaces: { total: number; items: Row[] };
  };
  assert.equal(data.account.status, "Active");
  assert.equal(data.account.creatorVerified, true);
  assert.equal(data.subscription.plan, "Pro");
  assert.equal(data.channels.items[0].connected, true);
  assert.ok(!("connection_id" in data.channels.items[0]));
  assert.equal(data.workspaces.total, 1);
  assert.equal(data.workspaces.items[0].isOwner, true);
});

// ---------- the console screens ----------

test("the Users screen asks the server for one page; it never filters or counts all users itself", () => {
  const screen = readFileSync("src/components/admin/sections/UsersSection.tsx", "utf8");
  assert.match(screen, /new URLSearchParams\(\{ limit: String\(PAGE_SIZE\), sort \}\)/);
  assert.match(
    screen,
    /if \(cursor\) params\.set\("cursor", cursor\);\s+else params\.set\("stats", "1"\);/,
  );
  assert.doesNotMatch(screen, /\.toLowerCase\(\)\.includes\(query/, "no in-browser search");
  assert.doesNotMatch(screen, /users\.filter\(\(u\) => u\.status ===/, "no in-browser counting");
  assert.match(
    screen,
    /fetch\(`\/api\/admin\/users\/detail\?\$\{new URLSearchParams\(\{ id: user\.id \}\)\}`/,
  );
});

test("the role manager searches on the server and shows at most 50", () => {
  const screen = readFileSync("src/components/admin/sections/UserRolesManager.tsx", "utf8");
  assert.match(screen, /const ROLE_LIST_LIMIT = 50;/);
  assert.match(screen, /new URLSearchParams\(\{ limit: String\(ROLE_LIST_LIMIT\) \}\)/);
  assert.doesNotMatch(screen, /\.toLowerCase\(\)\.includes\(q\)/);
});

test("cursor timestamps must be exact Postgres timestamps", () => {
  const make = (c: string) =>
    Buffer.from(
      JSON.stringify({ v: 1, s: "newest", f: "[null,null,null,null]", c, e: null, i: TARGET }),
    ).toString("base64url");
  const ok = lib.parseAdminUsersQuery(
    new URLSearchParams({ cursor: make("2026-10-13T08:00:00.123456+00:00") }),
  );
  assert.equal(ok.cursor?.created, "2026-10-13T08:00:00.123456+00:00");
  for (const bad of ["x' or 1=1", "October 13 2026", "2026-10-13", "1"])
    assert.throws(
      () => lib.parseAdminUsersQuery(new URLSearchParams({ cursor: make(bad) })),
      lib.AdminUsersQueryError,
      bad,
    );
});
