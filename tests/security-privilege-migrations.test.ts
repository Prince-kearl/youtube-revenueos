// What the two privilege-hardening migrations say, and where they sit in the migration order.
//
// These read the files; they do not run them, and nothing here touches a database. The effective
// privileges were verified separately by applying the repository's whole migration history to a
// disposable Postgres and querying it as each role.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const COUNTERS = "202610120001_counter_function_execute_privileges.sql";
const TRUNCATE = "202610120002_workspace_members_truncate_privilege.sql";

const files = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const read = (file: string) => readFileSync(`${DIR}/${file}`, "utf8");
/** The SQL with comments removed and whitespace collapsed. */
const statements = (file: string) => read(file).replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
/** The first migration (in apply order) whose SQL matches. */
const firstWith = (pattern: RegExp) => files.find((file) => pattern.test(statements(file)));

test("the counter functions: EXECUTE is taken from everyone but the service role, and nothing else changes", () => {
  assert.equal(
    statements(COUNTERS),
    [
      "REVOKE EXECUTE ON FUNCTION public.increment_link_clicks(uuid) FROM PUBLIC, anon, authenticated;",
      "REVOKE EXECUTE ON FUNCTION public.increment_lead_magnet_views(uuid) FROM PUBLIC, anon, authenticated;",
      "GRANT EXECUTE ON FUNCTION public.increment_link_clicks(uuid) TO service_role;",
      "GRANT EXECUTE ON FUNCTION public.increment_lead_magnet_views(uuid) TO service_role;",
    ].join(" "),
  );
});

test("workspace_members: only TRUNCATE is revoked, only from the member-facing roles", () => {
  assert.equal(
    statements(TRUNCATE),
    "REVOKE TRUNCATE ON TABLE public.workspace_members FROM PUBLIC, anon, authenticated;",
  );
});

test("each migration comes after the objects it names are created, with matching signatures", () => {
  const created = {
    link: firstWith(/create or replace function public\.increment_link_clicks\(p_link_id uuid\)/i),
    views: firstWith(
      /create or replace function public\.increment_lead_magnet_views\(p_lead_magnet_id uuid\)/i,
    ),
    members: firstWith(/create table public\.workspace_members \(/i),
  };
  assert.ok(created.link && created.views && created.members, JSON.stringify(created));
  assert.ok(created.link < COUNTERS && created.views < COUNTERS);
  assert.ok(created.members < TRUNCATE);
  // Recorded together, counters first.
  assert.equal(files.indexOf(COUNTERS) + 1, files.indexOf(TRUNCATE), "applied one after the other");
});

test("nothing applied later undoes them", () => {
  const later = (file: string) => files.slice(files.indexOf(file) + 1).map(statements);
  for (const sql of later(COUNTERS)) {
    // Re-creating a function after a drop restores EXECUTE to PUBLIC.
    assert.doesNotMatch(sql, /drop function[^;]*increment_(link_clicks|lead_magnet_views)/i);
    assert.doesNotMatch(
      sql,
      /grant [^;]*on function public\.increment_(link_clicks|lead_magnet_views)[^;]* to (public|anon|authenticated)/i,
    );
  }
  for (const sql of later(TRUNCATE))
    assert.doesNotMatch(
      sql,
      /grant (all|[^;]*truncate)[^;]* on (table )?public\.workspace_members to/i,
    );
});

test("the application's own callers of the counters use the service role", () => {
  for (const [file, call] of [
    ["src/routes/r.$slug.ts", 'service.rpc("increment_link_clicks"'],
    ["src/routes/api.freebies.public.ts", 'service.rpc("increment_lead_magnet_views"'],
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(call), file);
    assert.match(source, /const service = createServiceSupabaseClient\(\);/, file);
  }
});
