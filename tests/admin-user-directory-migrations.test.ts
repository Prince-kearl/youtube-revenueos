import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The admin user directory's three migrations: what each contains, the order, the locking
// discipline, and the security properties. (Behaviour — triggers, backfill, repair, privileges,
// locks — is exercised against a real local PostgreSQL by scripts/db/validate-admin-user-directory.mjs;
// these checks keep the files themselves from drifting.)

const m1 = readFileSync("supabase/migrations/202610180001_admin_user_directory.sql", "utf8");
const m2 = readFileSync(
  "supabase/migrations/202610180002_admin_user_directory_triggers.sql",
  "utf8",
);
const m3 = readFileSync(
  "supabase/migrations/202610180003_admin_audit_log_target_index.sql",
  "utf8",
);
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const fn = (name: string) => {
  const start = m1.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return m1.slice(start, m1.indexOf("\n$$;", start));
};

test("step 1 creates the empty directory, indexes and functions — no triggers, no backfill", () => {
  const sql = code(m1);
  assert.match(
    sql,
    /^begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '60s';/m,
  );
  assert.match(sql.trimEnd(), /commit;$/);
  assert.doesNotMatch(sql, /create trigger/i);
  assert.doesNotMatch(sql, /concurrently/i);
  // Nothing populates the directory here: the only INSERT ... SELECT statements live inside
  // function bodies (triggers, backfill step, repair), never at the top level.
  const topLevel = sql.replace(/as \$\$[\s\S]*?\$\$;/g, "");
  assert.doesNotMatch(topLevel, /insert into public\.admin_user_directory\b/);
  assert.match(topLevel, /insert into public\.admin_user_directory_state \(id\) values \(true\)/);
  // Every index is created here, on the empty table.
  for (const index of [
    "admin_user_directory_created_idx",
    "admin_user_directory_email_idx",
    "admin_user_directory_name_idx",
    "admin_user_directory_role_idx",
    "admin_user_directory_banned_idx",
    "admin_user_directory_unconfirmed_idx",
  ])
    assert.match(topLevel, new RegExp(`create index if not exists ${index}`));
});

test("step 2 only creates the two triggers, in a short transaction with a lock timeout", () => {
  const sql = code(m2).trim();
  assert.match(
    sql,
    /^begin;\nset local lock_timeout = '3s';\nset local statement_timeout = '15s';/,
  );
  assert.match(sql, /commit;$/);
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(
    statements.map((s) => s.split(/\s+/).slice(0, 2).join(" ").toLowerCase()),
    [
      "begin",
      "set local",
      "set local",
      "drop trigger",
      "create trigger",
      "drop trigger",
      "create trigger",
      "commit",
    ],
  );
  assert.match(sql, /after insert or update of name, role on public\.profiles/);
  assert.match(
    sql,
    /after update of email, email_confirmed_at, banned_until, last_sign_in_at, raw_user_meta_data\s+on auth\.users/,
  );
  // The comment tells the operator to roll back an aborted attempt before retrying.
  assert.match(m2, /lock timeout/);
});

test("step 3 is a single CREATE INDEX CONCURRENTLY statement (cannot run in a transaction)", () => {
  const statements = code(m3)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(
    statements[0],
    /^create index concurrently if not exists admin_audit_log_target_created_idx\s+on public\.admin_audit_log \(target, created_at desc\)$/,
  );
});

test("authoritative email: from auth.users only; profile changes never write the email", () => {
  // The shared source of truth reads the email from auth.users.
  assert.match(
    fn("admin_user_directory_expected"),
    /u\.email,\s+coalesce\(lower\(u\.email\), ''''\)/,
  );
  // Planned per call with the real cursor (EXECUTE ... USING), never a generic whole-table plan.
  assert.match(fn("admin_user_directory_expected"), /language plpgsql/);
  assert.match(
    fn("admin_user_directory_expected"),
    /where p\.id > \$1\s+order by p\.id\s+limit \$2'\s+using coalesce\(p_after, /,
  );
  assert.doesNotMatch(fn("admin_user_directory_expected"), /p\.email/);
  // The profile trigger reads the email from auth.users and, on conflict, updates name and role only.
  const profile = fn("admin_user_directory_sync_profile");
  assert.doesNotMatch(profile, /new\.email/);
  assert.match(profile, /u\.email,\s+coalesce\(lower\(u\.email\), ''\)/);
  const onConflict = profile.slice(profile.indexOf("on conflict"), profile.indexOf("return new"));
  assert.doesNotMatch(onConflict, /email/);
  // The Auth trigger is the one that writes the email.
  assert.match(
    fn("admin_user_directory_sync_auth"),
    /set email = excluded\.email,\s+email_lower = excluded\.email_lower,/,
  );
  // The list returns the directory's email, not the profile's.
  assert.match(fn("admin_list_users"), /select p\.id, p\.name, d\.email, p\.avatar/);
  assert.doesNotMatch(code(m1), /p\.email/);
});

test("backfill: bounded, resumable, serialised, never overwrites newer trigger data", () => {
  const backfill = fn("admin_user_directory_backfill_step");
  assert.match(backfill, /p_limit is null or p_limit < 1 or p_limit > 5000/);
  assert.match(backfill, /from public\.admin_user_directory_state as s where s\.id for update/);
  assert.match(backfill, /on conflict \(user_id\) do nothing/);
  assert.doesNotMatch(backfill, /do update/);
  assert.match(backfill, /backfill_cursor = coalesce\(v_last, s\.backfill_cursor\)/);
  assert.match(backfill, /status = 'failed', last_error_code = sqlstate/);
  assert.match(backfill, /v_complete := v_seen < p_limit;/);
  assert.doesNotMatch(m1, /temporary table/i);
  // A concurrent account deletion can never make a batch fail on the foreign key: the batch's
  // profiles rows are locked FOR KEY SHARE (which ordinary profile edits do not wait for) and only
  // those still present are inserted. The same holds for repairs.
  for (const name of ["admin_user_directory_backfill_step", "admin_user_directory_repair"]) {
    const body = fn(name);
    assert.match(
      body,
      /select p\.id from public\.profiles as p\s+where p\.id in \(select \w+\.user_id from \w+( as \w+)?\)\s+for key share of p/,
      name,
    );
    assert.match(
      body,
      /join live as l on l\.id = \w+\.user_id\s+on conflict \(user_id\) do nothing/,
      name,
    );
  }
  // The last error stays visible after a later batch succeeds.
  assert.doesNotMatch(backfill, /last_error_code = null/);
});

test("reads refuse a partial directory; repairs keep newer trigger writes", () => {
  for (const name of ["admin_list_users", "admin_count_users", "admin_user_stats"])
    assert.match(fn(name), /perform public\.admin_user_directory_assert_complete\(\);/, name);
  assert.match(fn("admin_user_directory_assert_complete"), /errcode = '55000'/);
  const repair = fn("admin_user_directory_repair");
  assert.match(repair, /p_limit is null or p_limit < 1 or p_limit > 5000/);
  assert.match(repair, /and d\.synced_at < v_started/);
  // Repairs write only the directory.
  assert.doesNotMatch(repair, /(update|insert into|delete from) (public\.profiles|auth\.users)/);
});

test("trigger failures never block Auth or profile writes, and log no personal data", () => {
  for (const name of ["admin_user_directory_sync_profile", "admin_user_directory_sync_auth"]) {
    const body = fn(name);
    assert.match(body, /exception when others then/, name);
    assert.match(
      body,
      /insert into public\.admin_user_directory_sync_failures \(user_id, source, sqlstate\)/,
    );
    assert.match(body, /raise warning '[^']*: SQLSTATE %', new\.id, sqlstate;/, name);
    assert.doesNotMatch(body, /sqlerrm/, `${name}: messages can carry row values`);
  }
});

test("privileges: closed tables; SECURITY DEFINER with empty search_path; service_role only", () => {
  for (const table of [
    "admin_user_directory",
    "admin_user_directory_state",
    "admin_user_directory_sync_failures",
  ]) {
    assert.match(m1, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(
      m1,
      new RegExp(
        `revoke all on table public\\.${table}\\s+from public, anon, authenticated, service_role;`,
      ),
    );
  }
  assert.doesNotMatch(m1, /create policy/i);
  const definers = [...m1.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  for (const name of definers) {
    const header = fn(name).slice(0, fn(name).indexOf("as $$"));
    if (name !== "admin_user_directory_where") assert.match(header, /security definer/, name);
    assert.match(header, /set search_path = ''/, name);
  }
  for (const internal of [
    "admin_user_directory_expected(uuid, integer)",
    "admin_user_directory_sync_profile()",
    "admin_user_directory_sync_auth()",
    "admin_user_directory_assert_complete()",
    "admin_user_directory_where(text, text, text, text)",
  ])
    assert.match(
      m1,
      new RegExp(
        `revoke all on function public\\.${internal.replace(/[()]/g, "\\$&")}\\s+from public, anon, authenticated, service_role;`,
      ),
    );
  for (const granted of [
    "admin_user_directory_status()",
    "admin_user_directory_backfill_step(integer)",
    "admin_user_directory_check(uuid, integer)",
    "admin_user_directory_repair(uuid, integer)",
    "admin_count_users(text, text, text, text)",
    "admin_user_stats()",
  ])
    assert.match(
      m1,
      new RegExp(
        `grant execute on function public\\.${granted.replace(/[()]/g, "\\$&")} to service_role;`,
      ),
    );
  assert.doesNotMatch(m1, /grant execute[^;]*to (public|anon|authenticated)/);
});

test("caller text is never SQL: fixed lists, quoted literals, escaped LIKE, prefix only", () => {
  const where = fn("admin_user_directory_where");
  assert.match(
    where,
    /replace\(replace\(replace\(lower\(p_search\), '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\) \|\| '%'/,
  );
  assert.match(where, /format\(' and d\.email_lower like %L', v_pattern\)/);
  assert.match(where, /format\(' and d\.user_id = %L::uuid', p_search\)/);
  assert.match(
    where,
    /p_role not in \('user', 'editor', 'setter', 'manager', 'owner', 'superadmin'\)/,
  );
  assert.match(
    fn("admin_list_users"),
    /using p_cursor_created, p_cursor_email, p_cursor_id, p_limit;/,
  );
  assert.doesNotMatch(m1, /like '%/);
});

test("additive only: no existing table, policy or function is altered", () => {
  for (const sql of [m1, m2, m3]) {
    assert.doesNotMatch(
      code(sql),
      /alter table (public\.profiles|auth\.users|public\.admin_audit_log)/,
    );
    assert.doesNotMatch(code(sql), /drop (table|policy|function)/i);
    assert.doesNotMatch(code(sql), /handle_new_user/);
    assert.doesNotMatch(code(sql), /profiles_self_update/);
  }
});
