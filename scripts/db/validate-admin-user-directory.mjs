// Validates the admin user directory migrations (supabase/migrations/20261018000{1,2,3}_*.sql)
// against a REAL local PostgreSQL 17, with several concurrent sessions: authoritative email and
// the profiles.email spoofing attack, migration locking and retry, backfill under concurrent
// sign-ups/sign-ins/email changes/renames/role changes/deletions, interruption and failure
// recovery, drift detection and repair, privileges, pagination guarantees, timings and rollback.
//
// Supabase is SIMULATED by stand-ins (roles, the auth schema, auth.uid(), a handle_new_user
// sign-up trigger, the production profiles policies). Passing here is development evidence, not
// Supabase staging verification. Nothing here connects to any remote database.
//
// Dependencies are not part of the app; install them without touching package.json:
//   npm install --no-save embedded-postgres@17.10.0-beta.17 pg@8.16.3
// Run (from the repository root):
//   node scripts/db/validate-admin-user-directory.mjs [accounts=20000]
//   SKIP_WALK=1 node scripts/db/validate-admin-user-directory.mjs 1000000   # scale run
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
// Timestamps stay text, exactly as PostgREST hands them to the app (microseconds kept).
pg.types.setTypeParser(1184, (v) => v);
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repo = process.cwd();
const [seedArg = "20000"] = process.argv.slice(2);
const SEED = Number(seedArg);
const M1 = readFileSync(
  join(repo, "supabase/migrations/202610180001_admin_user_directory.sql"),
  "utf8",
);
const M2 = readFileSync(
  join(repo, "supabase/migrations/202610180002_admin_user_directory_triggers.sql"),
  "utf8",
);
const M3 = readFileSync(
  join(repo, "supabase/migrations/202610180003_admin_audit_log_target_index.sql"),
  "utf8",
);

const dataDir = join(tmpdir(), "tubify-admin-directory-pg");
rmSync(dataDir, { recursive: true, force: true });
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "local",
  port: 54330,
  persistent: false,
  onLog: () => {},
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await server.initialise();
await server.start();
const connect = async () => {
  const c = new pg.Client({
    host: "127.0.0.1",
    port: 54330,
    user: "postgres",
    password: "local",
    database: "postgres",
  });
  await c.connect();
  c.on("notice", () => {});
  c.on("error", () => {});
  return c;
};
const db = await connect();
const q = (sql, params) => db.query(sql, params);
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};
const expectError = async (fn, label, pattern) => {
  try {
    await fn();
    check(false, `${label} (no error)`);
  } catch (e) {
    check(
      !pattern || pattern.test(`${e.code} ${e.message}`),
      `${label} → ${e.code} ${String(e.message).slice(0, 70)}`,
    );
  }
};
const time = async (fn) => {
  const s = performance.now();
  await fn();
  return performance.now() - s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ---------------------------------------------------------------- Supabase stand-ins
  await q(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, supabase_auth_admin;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz,
      last_sign_in_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    grant all on auth.users to supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.app_role as enum ('user','admin','editor','setter','manager','owner','superadmin');
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade, email text, name text, avatar text,
      role public.app_role not null default 'user', stripe_customer_id text,
      created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default now()
    );
    alter table public.profiles enable row level security;
    create policy profiles_self_select on public.profiles for select using (id = auth.uid());
    create policy profiles_self_update on public.profiles for update using (id = auth.uid())
      with check (id = auth.uid() and role is not distinct from (select p.role from public.profiles p where p.id = auth.uid())
                  and stripe_customer_id is not distinct from (select p.stripe_customer_id from public.profiles p where p.id = auth.uid()));
    grant select, insert, update on public.profiles to authenticated;
    -- handle_new_user stand-in: the profile is created INSIDE the auth.users insert, as in production.
    create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
    begin insert into public.profiles (id, email, name) values (new.id, new.email, new.raw_user_meta_data ->> 'name'); return new; end $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
    create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_user_id uuid, action text not null, target text, created_at timestamptz not null default now());
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);

  // Pre-existing accounts (before any migration), including identical timestamps and null emails.
  const tSeed = await time(() =>
    q(`
    insert into auth.users (id, email, email_confirmed_at, banned_until, last_sign_in_at, raw_user_meta_data)
    select gen_random_uuid(),
           case when g % 1000 = 0 then null else 'user' || g || '@mail' || (g % 97) || '.com' end,
           case when g % 20 = 0 then null else now() end,
           case when g % 500 = 0 then now() + interval '30 days' end,
           now() - (g % 1000) * interval '1 hour',
           jsonb_build_object('name', (array['Ama','Kofi','Esi','Yaw','Akosua','Kwame'])[1 + g % 6] || ' ' || substr(md5(g::text), 1, 6))
    from generate_series(1, ${SEED}) g;
    update public.profiles set created_at = timestamptz '2026-01-01 00:00:00+00' where (abs(hashtext(id::text)) % 50) = 0;
    update public.profiles set role = 'manager' where (abs(hashtext(id::text)) % 9) = 0;
    analyze;
  `),
  );
  console.log(
    `seeded ${SEED} existing accounts in ${tSeed.toFixed(0)} ms (2% share one identical created_at; 0.1% have no email)\n`,
  );

  // ---------------------------------------------------------------- Migration 1
  const tM1 = await time(() => q(M1));
  check(true, `migration 1 applied (${tM1.toFixed(0)} ms, empty directory)`);
  let r = await q(`select status from public.admin_user_directory_status()`);
  check(r.rows[0].status === "pending", "state starts as 'pending'");
  await expectError(
    () => q(`select * from public.admin_list_users(25,'newest')`),
    "list refused before backfill",
    /55000 admin_user_directory_incomplete/,
  );
  await expectError(
    () => q(`select public.admin_count_users()`),
    "count refused before backfill",
    /55000/,
  );
  await expectError(
    () => q(`select * from public.admin_user_stats()`),
    "stats refused before backfill",
    /55000/,
  );
  check(
    (await q(`select count(*)::int n from public.admin_user_directory`)).rows[0].n === 0,
    "migration 1 does not populate anything",
  );
  check(
    (await q(`select count(*)::int n from pg_trigger where tgname like 'admin_user_directory%'`))
      .rows[0].n === 0,
    "migration 1 creates no triggers",
  );
  await q(M1);
  check(true, "migration 1 is re-runnable");

  // ---------------------------------------------------------------- Migration 2 under lock contention
  const blocker = await connect();
  await blocker.query(
    "begin; update public.profiles set name = name where id = (select id from public.profiles limit 1);",
  );
  const writer = await connect();
  const t0 = performance.now();
  let writerWaited = null;
  const m2Attempt = time(() => q(M2)).then(
    (ms) => ({ ok: true, ms }),
    (e) => ({ ok: false, ms: performance.now() - t0, code: e.code, message: e.message }),
  );
  await sleep(300);
  // While migration 2 waits for its lock, an unrelated sign-up queues behind it.
  const signupDuringWait = time(() =>
    writer.query(
      `insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'queued@x.com', now())`,
    ),
  ).then((ms) => (writerWaited = ms));
  const attempt = await m2Attempt;
  await signupDuringWait;
  check(
    !attempt.ok && attempt.code === "55P03",
    `migration 2 gives up on lock timeout instead of waiting (${attempt.ms.toFixed(0)} ms, ${attempt.code})`,
  );
  await q("rollback"); // the timed-out explicit transaction stays aborted until rolled back
  check(
    writerWaited < 3500,
    `a sign-up queued behind it waited at most ~3 s (${writerWaited.toFixed(0)} ms)`,
  );
  check(
    (await q(`select count(*)::int n from pg_trigger where tgname like 'admin_user_directory%'`))
      .rows[0].n === 0,
    "the failed attempt left no triggers behind (rolled back)",
  );
  await blocker.query("rollback");
  await blocker.end();
  const tM2 = await time(() => q(M2));
  check(true, `retried after the blocker finished: migration 2 applied in ${tM2.toFixed(0)} ms`);
  await q(M2);
  check(true, "migration 2 is re-runnable");

  // ---------------------------------------------------------------- Authoritative email + spoofing
  const victimId = (
    await q(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), 'Owner@Tubify.com', now(), '{"name":"Real Owner"}') returning id`,
    )
  ).rows[0].id;
  const attackerId = (
    await q(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), 'attacker@evil.com', now(), '{"name":"Mallory"}') returning id`,
    )
  ).rows[0].id;
  r = await q(`select email, email_lower from public.admin_user_directory where user_id = $1`, [
    victimId,
  ]);
  check(
    r.rows[0]?.email === "Owner@Tubify.com" && r.rows[0]?.email_lower === "owner@tubify.com",
    "sign-up (nested in auth insert) writes the auth email",
  );
  // The attacker rewrites their own profiles.email through the API, under RLS.
  const attacker = await connect();
  await attacker.query(`select set_config('request.jwt.claim.sub', $1, false)`, [attackerId]);
  await attacker.query(`set role authenticated`);
  await attacker.query(
    `update public.profiles set email = 'owner@tubify.com', name = 'Real Owner' where id = $1`,
    [attackerId],
  );
  await attacker.end();
  r = await q(`select email, name_lower from public.admin_user_directory where user_id = $1`, [
    attackerId,
  ]);
  check(
    r.rows[0].email === "attacker@evil.com",
    "ATTACK: rewriting profiles.email does not change the directory email",
  );
  check(
    r.rows[0].name_lower === "real owner",
    "(the display name, which is user-editable by design, does change)",
  );
  // Complete the backfill first so the read functions answer.
  // ---------------------------------------------------------------- Backfill with concurrent traffic
  console.log(
    "\n-- backfill while sign-ups, sign-ins, email changes, renames, role changes and deletions run concurrently",
  );
  const traffic = await connect();
  let stopTraffic = false;
  const trafficStats = { signups: 0, signins: 0, emails: 0, renames: 0, roles: 0, deletes: 0 };
  // Random existing accounts, preloaded so the generator stays cheap at any table size.
  const pool = (
    await traffic.query(
      `select id from auth.users where email like 'user%' order by random() limit 20000`,
    )
  ).rows.map((x) => x.id);
  const pick = () => pool[Math.floor(Math.random() * pool.length)];
  const trafficLoop = (async () => {
    let i = 0;
    while (!stopTraffic) {
      i++;
      await traffic.query(
        `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), 'new' || $1 || '@x.com', now(), '{"name":"New"}')`,
        [i],
      );
      trafficStats.signups++;
      await traffic.query(`update auth.users set last_sign_in_at = now() where id = $1`, [pick()]);
      trafficStats.signins++;
      await traffic.query(
        `update auth.users set email = 'changed' || $1 || '@x.com' where id = $2`,
        [i, pick()],
      );
      trafficStats.emails++;
      await traffic.query(`update public.profiles set name = 'Renamed ' || $1 where id = $2`, [
        i,
        pick(),
      ]);
      trafficStats.renames++;
      await traffic.query(`update public.profiles set role = 'editor' where id = $1`, [pick()]);
      trafficStats.roles++;
      // An account deletion on every iteration, to stress the backfill's foreign-key race.
      const victimIndex = Math.floor(Math.random() * pool.length);
      await traffic.query(`delete from auth.users where id = $1`, [pool[victimIndex]]);
      pool.splice(victimIndex, 1);
      trafficStats.deletes++;
      // ~20 iterations a second (~120 writes/s): busy, but not a synthetic flood.
      await sleep(50);
    }
  })();

  const worker = await connect();
  let steps = 0;
  let interruptedOnce = false;
  let failedOnce = false;
  let unexpectedFailures = 0;
  const batchTimes = [];
  for (;;) {
    steps++;
    if (steps === 4 && !interruptedOnce) {
      // Interruption: the session running a batch is killed mid-batch.
      interruptedOnce = true;
      const victim = await connect();
      const pid = (await victim.query("select pg_backend_pid() pid")).rows[0].pid;
      const before = (await q(`select processed from public.admin_user_directory_status()`)).rows[0]
        .processed;
      const running = victim
        .query(`select * from public.admin_user_directory_backfill_step(5000), pg_sleep(2)`)
        .catch((e) => e);
      await sleep(400);
      await q(`select pg_terminate_backend($1)`, [pid]);
      await running;
      const after = (await q(`select processed, status from public.admin_user_directory_status()`))
        .rows[0];
      check(
        after.processed === before,
        `interrupted batch changed nothing (processed ${before} → ${after.processed}, status ${after.status})`,
      );
      continue;
    }
    if (steps === 6 && !failedOnce) {
      // Failure: the next batch hits an error (a constraint some rows violate).
      failedOnce = true;
      await q(
        `alter table public.admin_user_directory add constraint t_fail check (email_lower <> '') not valid`,
      );
      const res = (
        await worker.query(`select * from public.admin_user_directory_backfill_step(2000)`)
      ).rows[0];
      const st = (
        await q(`select status, last_error_code from public.admin_user_directory_status()`)
      ).rows[0];
      check(
        res.status === "failed" && st.status === "failed" && st.last_error_code === "23514",
        `a failing batch is recorded as failed (${st.last_error_code}) and rolled back`,
      );
      await expectError(
        () => q(`select * from public.admin_list_users(25,'newest')`),
        "list still refused while backfill is failed",
        /55000/,
      );
      await q(`alter table public.admin_user_directory drop constraint t_fail`);
      continue;
    }
    const s = performance.now();
    const res = (
      await worker.query(`select * from public.admin_user_directory_backfill_step(2000)`)
    ).rows[0];
    batchTimes.push(performance.now() - s);
    if (res.status === "failed") {
      unexpectedFailures++;
      const why = (await q(`select last_error_code from public.admin_user_directory_status()`))
        .rows[0];
      console.log(`      unexpected batch failure: SQLSTATE ${why.last_error_code}`);
    }
    if (res.status === "complete") break;
    if (steps > 100000) throw new Error("backfill did not finish");
  }
  stopTraffic = true;
  await trafficLoop;
  await traffic.end();
  batchTimes.sort((a, b) => a - b);
  const st = (await q(`select * from public.admin_user_directory_status()`)).rows[0];
  check(
    st.status === "complete",
    `backfill completed after resume (${steps} calls; batch of 2,000: median ${batchTimes[Math.floor(batchTimes.length / 2)].toFixed(0)} ms, max ${batchTimes[batchTimes.length - 1].toFixed(0)} ms)`,
  );
  console.log(`      concurrent traffic during backfill: ${JSON.stringify(trafficStats)}`);
  check(
    unexpectedFailures === 0,
    `no batch failed because of concurrent sign-ups, changes or deletions (${unexpectedFailures})`,
  );

  // Full drift check, window by window (as the API drives it).
  const fullCheck = async () => {
    let after = null;
    const total = { checked: 0, missing: 0, stale_email: 0, stale_profile: 0, stale_status: 0 };
    for (;;) {
      const w = (await q(`select * from public.admin_user_directory_check($1, 5000)`, [after]))
        .rows[0];
      for (const k of Object.keys(total)) total[k] += w[k];
      if (w.done) break;
      after = w.next_after;
    }
    return total;
  };
  let drift = await fullCheck();
  check(
    drift.missing === 0 &&
      drift.stale_email === 0 &&
      drift.stale_profile === 0 &&
      drift.stale_status === 0,
    `zero drift after backfill under concurrent traffic: ${JSON.stringify(drift)}`,
  );
  const counts = (
    await q(
      `select (select count(*) from public.profiles)::int p, (select count(*) from public.admin_user_directory)::int d`,
    )
  ).rows[0];
  check(
    counts.p === counts.d,
    `directory rows = profiles rows (${counts.d} = ${counts.p}); no duplicates possible (primary key)`,
  );

  // ---------------------------------------------------------------- Reads after completion, spoofing
  r = await q(`select id from public.admin_list_users(10,'newest','email','owner@tubify')`);
  check(
    r.rows.length === 1 && r.rows[0].id === victimId,
    "ATTACK: searching the victim's email returns only the victim",
  );
  r = await q(`select email from public.admin_list_users(10,'newest','id',$1)`, [attackerId]);
  check(
    r.rows[0].email === "attacker@evil.com",
    "ATTACK: the attacker's row shows their real sign-in email",
  );
  await q(`update auth.users set email = 'owner.new@tubify.com' where id = $1`, [victimId]);
  r = await q(`select email from public.admin_list_users(10,'newest','id',$1)`, [victimId]);
  check(r.rows[0].email === "owner.new@tubify.com", "an Auth email change updates the directory");
  r = await q(
    `select count(*)::int n from public.admin_list_users(10,'newest','email','owner@tubify')`,
  );
  check(r.rows[0].n === 0, "the old email no longer finds the account");

  // ---------------------------------------------------------------- Trigger failure → detection → repair
  await q(
    `alter table public.admin_user_directory add constraint t_break check (email_lower not like '%broken%') not valid`,
  );
  const tSignin = await time(() =>
    q(`update auth.users set email = 'broken@x.com', last_sign_in_at = now() where id = $1`, [
      victimId,
    ]),
  );
  check(
    (await q(`select email from auth.users where id = $1`, [victimId])).rows[0].email ===
      "broken@x.com",
    `the Auth update still succeeds when the directory write fails (${tSignin.toFixed(1)} ms)`,
  );
  r = await q(
    `select user_id, source, sqlstate from public.admin_user_directory_sync_failures order by id desc limit 1`,
  );
  check(
    r.rows[0]?.user_id === victimId &&
      r.rows[0]?.source === "auth" &&
      r.rows[0]?.sqlstate === "23514",
    "the failure is recorded (account id + SQLSTATE only)",
  );
  check(
    (await q(`select sync_failures_24h::int n from public.admin_user_directory_status()`)).rows[0]
      .n >= 1,
    "status reports recent sync failures",
  );
  await q(`alter table public.admin_user_directory drop constraint t_break`);
  drift = await fullCheck();
  check(drift.stale_email === 1, `drift check finds the stale email: ${JSON.stringify(drift)}`);
  await q(`delete from public.admin_user_directory where user_id = $1`, [attackerId]);
  drift = await fullCheck();
  check(drift.missing === 1, "drift check finds a missing row");
  // Repair window by window.
  let after = null;
  const repaired = { inserted: 0, updated: 0 };
  for (;;) {
    const w = (await q(`select * from public.admin_user_directory_repair($1, 5000)`, [after]))
      .rows[0];
    repaired.inserted += w.inserted;
    repaired.updated += w.updated;
    if (w.done) break;
    after = w.next_after;
  }
  check(
    repaired.inserted === 1 && repaired.updated >= 1,
    `repair inserted ${repaired.inserted}, updated ${repaired.updated}`,
  );
  drift = await fullCheck();
  check(
    drift.missing + drift.stale_email + drift.stale_profile + drift.stale_status === 0,
    "zero drift after repair",
  );
  r = await q(
    `select (select email from auth.users where id = $1) a, (select email from public.profiles where id = $1) p`,
    [attackerId],
  );
  check(
    r.rows[0].a === "attacker@evil.com" && r.rows[0].p === "owner@tubify.com",
    "repair never changes the Auth or profile source records",
  );
  // A row a trigger wrote after a repair started is never overwritten by that repair.
  await q(
    `update public.admin_user_directory set name_lower = 'stale', synced_at = clock_timestamp() + interval '1 hour' where user_id = $1`,
    [victimId],
  );
  after = null;
  for (;;) {
    const w = (await q(`select * from public.admin_user_directory_repair($1, 5000)`, [after]))
      .rows[0];
    if (w.done) break;
    after = w.next_after;
  }
  check(
    (await q(`select name_lower from public.admin_user_directory where user_id = $1`, [victimId]))
      .rows[0].name_lower === "stale",
    "repair skips rows written after it started (guard on synced_at)",
  );
  await q(
    `update public.admin_user_directory set synced_at = clock_timestamp() - interval '1 second' where user_id = $1`,
    [victimId],
  );
  await q(`select * from public.admin_user_directory_repair(null, 5000)`);

  // ---------------------------------------------------------------- Privileges
  for (const role of ["anon", "authenticated", "service_role"])
    for (const table of [
      "admin_user_directory",
      "admin_user_directory_state",
      "admin_user_directory_sync_failures",
    ])
      await expectError(
        () =>
          q(
            `begin; set local role ${role}; select 1 from public.${table} limit 1; commit;`,
          ).finally(() => q("rollback").catch(() => {})),
        `${role} cannot read ${table}`,
        /42501/,
      );
  for (const role of ["anon", "authenticated"])
    for (const fn of [
      "admin_list_users(25,'newest')",
      "admin_user_stats()",
      "admin_user_directory_status()",
      "admin_user_directory_backfill_step(10)",
      "admin_user_directory_check(null,10)",
      "admin_user_directory_repair(null,10)",
    ])
      await expectError(
        () =>
          q(`begin; set local role ${role}; select * from public.${fn}; commit;`).finally(() =>
            q("rollback").catch(() => {}),
          ),
        `${role} cannot execute ${fn.split("(")[0]}`,
        /42501/,
      );
  for (const fn of [
    "admin_user_directory_expected(null,10)",
    "admin_user_directory_where(null,null,null,null)",
    "admin_user_directory_assert_complete()",
  ])
    await expectError(
      () =>
        q(`begin; set local role service_role; select * from public.${fn}; commit;`).finally(() =>
          q("rollback").catch(() => {}),
        ),
      `service_role cannot execute internal ${fn.split("(")[0]}`,
      /42501/,
    );
  r = await q(
    `begin; set local role service_role; select count(*)::int n from public.admin_list_users(25,'newest'); `,
  );
  await q("rollback");
  check(true, "service_role can execute admin_list_users");
  r = await q(
    `select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) owner from pg_proc p where p.proname like 'admin_%' and p.pronamespace = 'public'::regnamespace order by 1`,
  );
  for (const p of r.rows)
    if (p.proname !== "admin_user_directory_where")
      check(
        p.prosecdef && (p.proconfig ?? []).some((c) => /^search_path=("")?$/.test(c)),
        `${p.proname}: security definer, empty search_path, owner ${p.owner}`,
      );

  // ---------------------------------------------------------------- Pagination guarantees
  const walk = async (sort, args = "null,null,null,null") => {
    const ids = [];
    let cursor = [null, null, null];
    for (let pages = 0; pages < 100000; pages++) {
      const rows = (
        await q(
          `select id, created_at, email_lower from public.admin_list_users(101, $1, ${args}, $2, $3, $4)`,
          [sort, ...cursor],
        )
      ).rows;
      const page = rows.slice(0, 100);
      ids.push(...page.map((x) => x.id));
      if (rows.length <= 100) break;
      const last = page[page.length - 1];
      cursor = [last.created_at, last.email_lower, last.id];
    }
    return ids;
  };
  const total = Number((await q(`select public.admin_count_users()`)).rows[0].admin_count_users);
  for (const sort of process.env.SKIP_WALK ? [] : ["newest", "oldest", "email"]) {
    const ids = await walk(sort);
    check(
      ids.length === total && new Set(ids).size === total,
      `walking every page (${sort}) returns each of ${total} accounts exactly once`,
    );
  }
  const tied = (
    await q(
      `select count(*)::int n from public.admin_user_directory where created_at = '2026-01-01 00:00:00+00'`,
    )
  ).rows[0].n;
  const blank = (
    await q(`select count(*)::int n from public.admin_user_directory where email_lower = ''`)
  ).rows[0].n;
  check(
    tied > 100 && blank >= 10,
    `ties covered: ${tied} accounts share one created_at, ${blank} share an empty email`,
  );
  // Precision: timestamps keep microseconds through the cursor.
  // (Postgres prints fractional seconds without trailing zeros, so check the value, not the text.)
  r = await q(
    `select count(*)::int n from public.admin_user_directory where (extract(microseconds from created_at)::bigint % 1000) <> 0`,
  );
  check(
    r.rows[0].n > 0,
    `created_at carries sub-millisecond precision (${r.rows[0].n} rows) — the API passes it back verbatim`,
  );

  // Concurrent changes between page requests (newest first).
  const p1 = (
    await q(`select id, created_at from public.admin_list_users(51,'newest')`)
  ).rows.slice(0, 50);
  const lastP1 = p1[49];
  const ahead = (
    await q(`select id from public.admin_list_users(5,'newest',null,null,null,null,$1,null,$2)`, [
      lastP1.created_at,
      lastP1.id,
    ])
  ).rows;
  await q(
    `insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'between@x.com', now())`,
  );
  await q(`delete from auth.users where id = $1`, [ahead[0].id]);
  const p2 = (
    await q(`select id from public.admin_list_users(50,'newest',null,null,null,null,$1,null,$2)`, [
      lastP1.created_at,
      lastP1.id,
    ])
  ).rows.map((x) => x.id);
  check(
    !p2.some((id) => p1.some((x) => x.id === id)),
    "insert between pages: no account repeats (newer rows land before the cursor)",
  );
  check(
    !p2.includes(ahead[0].id) && p2[0] === ahead[1].id,
    "delete between pages: the deleted account disappears, nothing else is skipped",
  );
  // Sort-key change between pages (email order): an account moved past the cursor is seen twice.
  const e1 = (
    await q(`select id, email_lower from public.admin_list_users(21,'email')`)
  ).rows.slice(0, 20);
  const moved = e1[0].id;
  await q(`update auth.users set email = 'zzzz-moved@x.com' where id = $1`, [moved]);
  const rest = await (async () => {
    const ids = [];
    let cur = [null, e1[19].email_lower, e1[19].id];
    for (;;) {
      const rows = (
        await q(
          `select id, email_lower from public.admin_list_users(101,'email',null,null,null,null,null,$1,$2)`,
          [cur[1], cur[2]],
        )
      ).rows;
      ids.push(...rows.slice(0, 100).map((x) => x.id));
      if (rows.length <= 100) break;
      const l = rows[99];
      cur = [null, l.email_lower, l.id];
    }
    return ids;
  })();
  check(
    rest.includes(moved),
    "DOCUMENTED LIMIT: an account whose sort key moves past the cursor between pages can appear twice",
  );

  // ---------------------------------------------------------------- Performance (native PostgreSQL 17, this laptop)
  await q("analyze public.admin_user_directory");
  console.log(`\n-- query timings at ${counts.d.toLocaleString()} accounts (median of 7)`);
  const page = (await q(`select id, created_at from public.admin_list_users(26,'newest')`))
    .rows[24];
  const cases = [
    ["first page, newest", `select * from public.admin_list_users(26,'newest')`],
    [
      "next page (cursor)",
      `select * from public.admin_list_users(26,'newest',null,null,null,null,$1,null,$2)`,
      [page.created_at, page.id],
    ],
    ["email A–Z", `select * from public.admin_list_users(26,'email')`],
    ["prefix 'kofi' (~17%)", `select * from public.admin_list_users(26,'newest','text','kofi')`],
    [
      "prefix 'us' (~99%), email A–Z",
      `select * from public.admin_list_users(26,'email','text','us')`,
    ],
    [
      "rare prefix 'user12345'",
      `select * from public.admin_list_users(26,'oldest','text','user12345')`,
    ],
    [
      "role manager, email A–Z",
      `select * from public.admin_list_users(26,'email',null,null,'manager')`,
    ],
    ["status banned", `select * from public.admin_list_users(26,'newest',null,null,null,'banned')`],
    [
      "status pending, email A–Z",
      `select * from public.admin_list_users(26,'email',null,null,null,'pending')`,
    ],
    ["count all", `select public.admin_count_users()`],
    ["count prefix 'kofi'", `select public.admin_count_users('text','kofi')`],
    ["stats", `select * from public.admin_user_stats()`],
    ["status()", `select * from public.admin_user_directory_status()`],
    ["drift check window 5,000", `select * from public.admin_user_directory_check(null,5000)`],
    [
      "repair window 5,000 (no drift)",
      `select * from public.admin_user_directory_repair(null,5000)`,
    ],
  ];
  for (const [label, sql, params] of cases) {
    const ts = [];
    for (let i = 0; i < 7; i++) ts.push(await time(() => q(sql, params)));
    ts.sort((a, b) => a - b);
    console.log(`  ${label.padEnd(32)} ${ts[3].toFixed(2).padStart(8)} ms`);
  }

  console.log("\n-- trigger overhead (5,000 operations each, native)");
  const overhead = async (label) => {
    const ids = (await q(`select id from auth.users order by id limit 5000`)).rows.map((x) => x.id);
    const signups = await time(() =>
      q(
        `insert into auth.users (id, email, email_confirmed_at) select gen_random_uuid(), 'ovh' || g || '${label}@x.com', now() from generate_series(1,5000) g`,
      ),
    );
    const signins = await time(() =>
      q(`update auth.users set last_sign_in_at = now() where id = any($1)`, [ids]),
    );
    const renames = await time(() =>
      q(`update public.profiles set name = coalesce(name,'') || '.' where id = any($1)`, [ids]),
    );
    console.log(
      `  ${label.padEnd(16)} sign-ups ${signups.toFixed(0).padStart(5)} ms   sign-ins ${signins.toFixed(0).padStart(5)} ms   renames ${renames.toFixed(0).padStart(5)} ms`,
    );
  };
  await overhead("with triggers");
  await q(
    `alter table public.profiles disable trigger admin_user_directory_profile_sync; alter table auth.users disable trigger admin_user_directory_auth_sync;`,
  );
  await overhead("without");
  await q(
    `alter table public.profiles enable trigger admin_user_directory_profile_sync; alter table auth.users enable trigger admin_user_directory_auth_sync;`,
  );

  // ---------------------------------------------------------------- Migration 3 (concurrent index)
  await expectError(
    () => q(`begin; ${M3} commit;`),
    "migration 3 refuses to run inside a transaction (as documented)",
    /25001/,
  );
  await q("rollback").catch(() => {});
  await q(M3);
  r = await q(
    `select indisvalid from pg_index where indexrelid = 'public.admin_audit_log_target_created_idx'::regclass`,
  );
  check(r.rows[0].indisvalid === true, "migration 3 applied on its own: valid concurrent index");

  // ---------------------------------------------------------------- Rollback rehearsal
  const before = (
    await q(
      `select (select count(*) from auth.users)::int a, (select count(*) from public.profiles)::int p, (select md5(string_agg(id::text || coalesce(email,''), ',' order by id)) from auth.users) h`,
    )
  ).rows[0];
  await q(`
    begin;
    set local lock_timeout = '3s';
    drop trigger if exists admin_user_directory_auth_sync on auth.users;
    drop trigger if exists admin_user_directory_profile_sync on public.profiles;
    drop function if exists public.admin_list_users(integer,text,text,text,text,text,timestamptz,text,uuid),
      public.admin_count_users(text,text,text,text), public.admin_user_stats(), public.admin_user_directory_status(),
      public.admin_user_directory_backfill_step(integer), public.admin_user_directory_check(uuid,integer),
      public.admin_user_directory_repair(uuid,integer), public.admin_user_directory_assert_complete(),
      public.admin_user_directory_where(text,text,text,text), public.admin_user_directory_expected(uuid,integer),
      public.admin_user_directory_sync_profile(), public.admin_user_directory_sync_auth();
    drop table if exists public.admin_user_directory_sync_failures, public.admin_user_directory_state, public.admin_user_directory;
    commit;`);
  await q(`drop index concurrently if exists public.admin_audit_log_target_created_idx`);
  const afterRb = (
    await q(
      `select (select count(*) from auth.users)::int a, (select count(*) from public.profiles)::int p, (select md5(string_agg(id::text || coalesce(email,''), ',' order by id)) from auth.users) h`,
    )
  ).rows[0];
  check(
    before.a === afterRb.a && before.p === afterRb.p && before.h === afterRb.h,
    "rollback removes the directory and leaves auth.users and profiles untouched",
  );
  await q(
    `insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'after-rollback@x.com', now())`,
  );
  check(true, "sign-ups still work after rollback");
  await q(M1);
  await q(M2);
  check(true, "migrations 1 and 2 can be re-applied after a rollback");
} catch (e) {
  failures++;
  console.log("ERROR", e.code, e.message);
} finally {
  await db.end().catch(() => {});
  await server.stop();
}
console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
