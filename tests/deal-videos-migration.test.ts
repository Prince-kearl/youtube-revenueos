// What the deal_videos migration (Phase 2B-2) says, and where it sits in the migration order.
//
// These read the file; they do not run it, and nothing here touches a database. Its EFFECTIVE
// behaviour — privileges as each role, row-level security, the workspace-integrity triggers,
// cascades and re-application — was verified separately by applying the repository's whole
// migration history to a disposable Postgres and exercising it as each role.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const FILE = "202610140001_deal_videos.sql";

const files = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();
/** The SQL with comments removed and whitespace collapsed. */
const sql = readFileSync(`${DIR}/${FILE}`, "utf8")
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim();
const statements = sql
  .split(/;(?=(?:[^$]*\$\$[^$]*\$\$)*[^$]*$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

const TRIGGER_FUNCTIONS = [
  "deal_videos_check_workspace",
  "deal_videos_guard_deal_move",
  "deal_videos_guard_video_move",
  "deal_videos_guard_channel_move",
];

test("it runs after everything it builds on, and as one transaction", () => {
  // deals and its workspace column, the membership helper the read policy uses, and the
  // revenue-column privacy that made deals writable only through the application.
  for (const earlier of [
    "202609170001_workspaces.sql",
    "202609190001_fix_workspace_rls_recursion.sql",
    "202610110002_revenue_column_privacy.sql",
  ])
    assert.ok(files.indexOf(earlier) >= 0 && files.indexOf(earlier) < files.indexOf(FILE), earlier);
  assert.equal(statements[0], "begin");
  assert.equal(statements.at(-1), "commit");
});

test("the table: a link only — two references, the workspace, who and when; no amount of any kind", () => {
  const table = statements.find((s) =>
    s.startsWith("create table if not exists public.deal_videos"),
  );
  assert.ok(table);
  assert.match(table, /deal_id uuid not null references public\.deals\(id\) on delete cascade/);
  assert.match(table, /video_id uuid not null references public\.videos\(id\) on delete cascade/);
  assert.match(
    table,
    /workspace_id uuid not null references public\.workspaces\(id\) on delete cascade/,
  );
  assert.match(table, /created_by uuid references public\.profiles\(id\) on delete set null/);
  assert.match(table, /created_at timestamptz not null default timezone\('utc', now\(\)\)/);
  assert.match(table, /primary key \(deal_id, video_id\)/);
  assert.doesNotMatch(
    table,
    /numeric|money|decimal|integer|bigint|real|double|value|amount|share/i,
  );
});

test("indexes for reads by video and by workspace (deal is covered by the primary key)", () => {
  assert.ok(
    statements.includes(
      "create index if not exists deal_videos_video_idx on public.deal_videos (video_id)",
    ),
  );
  assert.ok(
    statements.includes(
      "create index if not exists deal_videos_workspace_idx on public.deal_videos (workspace_id)",
    ),
  );
});

test("privileges are set explicitly: members read, only the service role writes, and nobody updates", () => {
  const access = statements.filter((s) =>
    /^(grant|revoke) .* on table public\.deal_videos /.test(s),
  );
  assert.deepEqual(access, [
    "revoke all on table public.deal_videos from public, anon, authenticated, service_role",
    "grant select on table public.deal_videos to authenticated",
    "grant select, insert, delete on table public.deal_videos to service_role",
  ]);
  assert.ok(statements.includes("alter table public.deal_videos enable row level security"));
  assert.ok(
    statements.includes(
      "create policy deal_videos_workspace_read on public.deal_videos for select to authenticated using (public.is_active_workspace_member(workspace_id))",
    ),
  );
  // One read policy, and no policy that would allow a member to write.
  assert.equal(statements.filter((s) => s.startsWith("create policy")).length, 1);
});

test("trigger functions: SECURITY DEFINER, empty search_path, and executable by nobody", () => {
  for (const name of TRIGGER_FUNCTIONS) {
    const fn = statements.find((s) => s.startsWith(`create or replace function public.${name}()`));
    assert.ok(fn, name);
    assert.match(
      fn,
      /returns trigger language plpgsql security definer set search_path = '' as \$\$/,
    );
    // Every relation it touches is schema-qualified.
    assert.doesNotMatch(fn, /\b(from|join) (?!public\.)\w+ \w+ (on|where)\b/);
    assert.ok(
      statements.includes(
        `revoke all on function public.${name}() from public, anon, authenticated, service_role`,
      ),
      name,
    );
  }
  assert.equal(statements.filter((s) => /^grant .* on function/.test(s)).length, 0);
});

test("workspace integrity: checked on every link, and on every later move of a linked deal, video or channel", () => {
  assert.ok(
    statements.includes(
      "create trigger deal_videos_check_workspace before insert or update on public.deal_videos for each row execute function public.deal_videos_check_workspace()",
    ),
  );
  const guards = [
    ["deal_videos_guard_deal_move", "workspace_id", "public.deals"],
    ["deal_videos_guard_video_move", "channel_id", "public.videos"],
    ["deal_videos_guard_channel_move", "workspace_id", "public.youtube_channels"],
  ];
  for (const [name, column, table] of guards)
    assert.ok(
      statements.includes(
        `create trigger ${name} before update of ${column} on ${table} for each row when (old.${column} is distinct from new.${column}) execute function public.${name}()`,
      ),
      name,
    );
  // The video's workspace is resolved through its channel.
  const check = statements.find((s) =>
    s.startsWith("create or replace function public.deal_videos_check_workspace()"),
  )!;
  assert.match(
    check,
    /from public\.videos v join public\.youtube_channels c on c\.id = v\.channel_id/,
  );
  assert.match(check, /is distinct from new\.workspace_id/);
});

test("nothing else in the database is changed: no data written, no existing table altered or dropped", () => {
  for (const statement of statements) {
    assert.doesNotMatch(statement, /^(insert|update|delete|truncate|drop table|drop function)\b/);
    if (statement.startsWith("alter table"))
      assert.equal(statement, "alter table public.deal_videos enable row level security");
    if (/^(grant|revoke)\b/.test(statement)) assert.match(statement, /public\.deal_videos/);
  }
  // Re-runnable: every create is guarded or replaces, every trigger and policy is dropped first.
  for (const statement of statements.filter((s) => s.startsWith("create "))) {
    assert.match(
      statement,
      /^create (table if not exists|index if not exists|or replace function|trigger|policy)/,
    );
  }
  for (const name of TRIGGER_FUNCTIONS)
    assert.ok(
      statements.some((s) => s.startsWith(`drop trigger if exists ${name} on `)),
      name,
    );
  assert.ok(
    statements.includes("drop policy if exists deal_videos_workspace_read on public.deal_videos"),
  );
});
