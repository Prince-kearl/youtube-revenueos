import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The two indexes behind the Executive Dashboard growth charts. Each is one CREATE INDEX
// CONCURRENTLY (no write lock on a live table; cannot run in a transaction, so alone in its file),
// and each matches exactly what /api/admin/dashboard/growth counts.

const statements = (file: string) =>
  readFileSync(`supabase/migrations/${file}`, "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

test("profiles: one concurrent index on created_at", () => {
  assert.deepEqual(statements("202610190001_profiles_created_at_index.sql"), [
    "create index concurrently if not exists profiles_created_at_idx on public.profiles (created_at)",
  ]);
});

test("subscriptions: one concurrent partial index matching the growth query's filters", () => {
  assert.deepEqual(statements("202610190002_subscriptions_growth_index.sql"), [
    "create index concurrently if not exists subscriptions_growth_idx on public.subscriptions (livemode, created_at) where status in ('active', 'trialing')",
  ]);
  // The endpoint filters by exactly this mode and status set.
  const route = readFileSync("src/routes/api.admin.dashboard.growth.ts", "utf8").replace(
    /\s+/g,
    " ",
  );
  assert.match(route, /\.eq\("livemode", livemode\) \.in\("status", \["active", "trialing"\]\)/);
});

test("the growth endpoint never counts with a lone lower bound or lists rows per point", () => {
  const route = readFileSync("src/routes/api.admin.dashboard.growth.ts", "utf8").replace(
    /\s+/g,
    " ",
  );
  assert.match(
    route,
    /\.gte\("created_at", b\.start\.toISOString\(\)\) \.lt\("created_at", b\.end\.toISOString\(\)\)/,
  );
  assert.equal(route.match(/\.lt\("created_at"/g)?.length, 2);
});
