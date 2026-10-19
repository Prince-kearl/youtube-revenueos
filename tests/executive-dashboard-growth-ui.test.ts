import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Executive Dashboard: User Growth and Subscription Growth each take a full row (not side by
// side), and each has its own range and view filters, fetched from the growth endpoint.

const page = readFileSync("src/components/admin/sections/ExecutiveDashboard.tsx", "utf8").replace(
  /\s+/g,
  " ",
);

test("both growth charts are stacked, one per row", () => {
  assert.match(
    page,
    /<div className="mt-6 space-y-4"> <GrowthCard metric="users"[^>]*\/> <GrowthCard metric="subscriptions"[^>]*\/> <\/div>/,
  );
  assert.doesNotMatch(page, /<ChartCard title="(User|Subscription) Growth/);
});

test("each chart has range filters and a running-total / new-per-period view", () => {
  for (const label of ["30D", "90D", "6M", "12M", "All"])
    assert.match(page, new RegExp(`label: "${label}"`));
  assert.match(page, /Running total/);
  assert.match(page, /New per \{period\}/);
  assert.match(page, /aria-pressed=\{range === r\.value\}/);
});

test("each chart loads its own series for the chosen range, and drops stale answers", () => {
  assert.match(
    page,
    /fetch\(`\/api\/admin\/dashboard\/growth\?metric=\$\{metric\}&range=\$\{range\}`/,
  );
  assert.match(page, /return \(\) => controller\.abort\(\);/);
});
