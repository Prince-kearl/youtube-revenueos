// What the two revenue-visibility migrations say. Kept apart from the behaviour tests so that it
// travels with the SQL it describes.
//
// These read the files; they do not run them. The effective privileges were verified separately
// by applying the files, on top of the repository's whole migration history, to a disposable
// Postgres and querying it as each role.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const STEP_1 = "supabase/migrations/202610110001_workspace_revenue_visibility.sql";
const STEP_2 = "supabase/migrations/202610110002_revenue_column_privacy.sql";

/** The SQL with comments removed and whitespace collapsed. */
const statements = (file: string) =>
  readFileSync(file, "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ");

const grantedColumns = (sql: string, table: string) =>
  new RegExp(`grant select \\(([^)]+)\\) on table public\\.${table} to anon, authenticated;`)
    .exec(sql)![1]
    .split(",")
    .map((column) => column.trim());

test("step 1 adds the two settings, off by default, and closes direct writes to workspaces", () => {
  const sql = statements(STEP_1);
  assert.match(
    sql,
    /alter table public\.workspaces add column if not exists editor_revenue_visible boolean not null default false, add column if not exists setter_revenue_visible boolean not null default false;/,
  );
  assert.ok(
    sql.includes(
      "revoke insert, update, delete, truncate on table public.workspaces from anon, authenticated;",
    ),
  );
  // Nothing else: no read privilege is touched, no policy, no data.
  const rest = sql
    .replace(/comment on column [^;]+;/g, "")
    .replace(/alter table public\.workspaces add column[^;]+;/, "")
    .replace(/revoke insert, update, delete, truncate on table public\.workspaces[^;]+;/, "");
  assert.equal(rest.trim(), "");
});

// Step 2 is deliberately applied — and may be committed — after the application code. When it
// is not in the checkout there is nothing to check.
const step2 = { skip: existsSync(STEP_2) ? false : "the step-2 migration is not in this checkout" };

test("step 2 says, at the top, that it must follow the application code", step2, () => {
  const head = readFileSync(STEP_2, "utf8").split("\n").slice(0, 8).join("\n");
  assert.match(head, /DO NOT APPLY UNTIL THE APPLICATION CODE/);
});

test("step 2 withholds exactly the money columns from reading", step2, () => {
  const sql = statements(STEP_2);
  const withheld: Record<string, string[]> = {
    channel_daily_stats: ["estimated_revenue_usd", "ad_revenue_usd", "premium_revenue_usd"],
    video_daily_stats: ["estimated_revenue_usd", "ad_revenue_usd", "premium_revenue_usd"],
    deals: ["value"],
  };
  for (const [table, columns] of Object.entries(withheld)) {
    const granted = grantedColumns(sql, table);
    for (const column of columns) assert.ok(!granted.includes(column), `${table}.${column}`);
  }
  for (const table of ["channel_daily_stats", "video_daily_stats"])
    for (const column of ["channel_id", "day", "views", "watch_minutes", "likes", "fetched_at"])
      assert.ok(grantedColumns(sql, table).includes(column), `${table}.${column} stays readable`);
  assert.ok(grantedColumns(sql, "video_daily_stats").includes("video_id"));
  for (const column of [
    "id",
    "workspace_id",
    "name",
    "stage",
    "currency",
    "closed_at",
    "created_at",
    "assigned_member_id",
    "notes",
  ])
    assert.ok(grantedColumns(sql, "deals").includes(column), `deals.${column} stays readable`);
  // No statement hands back a whole table.
  assert.doesNotMatch(sql, /grant (select|all)( privileges)? on table/i);
});

test("step 2 leaves no member-facing write on any table that holds money", step2, () => {
  const sql = statements(STEP_2);
  for (const table of [
    "channel_daily_stats",
    "video_daily_stats",
    "deals",
    "youtube_analytics_snapshots",
  ])
    assert.ok(
      sql.includes(
        `revoke select, insert, update, delete, truncate on table public.${table} from anon, authenticated;`,
      ),
      table,
    );
  assert.doesNotMatch(sql, /grant[^;]*\b(insert|update|delete|truncate|all)\b/i);
  // The FOR ALL member policy on deals is replaced by a read-only one.
  assert.ok(sql.includes("drop policy if exists deals_workspace on public.deals;"));
  assert.match(
    sql,
    /create policy deals_workspace_read on public\.deals for select using \( public\.is_active_workspace_member\(workspace_id\) \);/,
  );
  assert.doesNotMatch(sql, /for (all|insert|update|delete)\b/i);
});

test("step 2 changes no data or schema and does not touch compensation privacy", step2, () => {
  const sql = statements(STEP_2);
  assert.doesNotMatch(sql, /workspace_members/);
  assert.doesNotMatch(
    sql,
    /\b(alter table|drop table|drop column|delete from|update public|truncate table|insert into)\b/i,
  );
  // Safe to apply twice: every statement is a revoke, a column grant, or a drop-if-exists/create pair.
  assert.ok(sql.includes("drop policy if exists deals_workspace_read on public.deals;"));
});

test("the undo instructions are marked as a last resort", step2, () => {
  assert.match(readFileSync(STEP_2, "utf8"), /To undo\. LAST RESORT ONLY/);
});
