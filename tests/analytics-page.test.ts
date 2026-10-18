import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The YouTube Analytics page has no "YouTube Analytics · Estimated YouTube revenue through …"
// banner under its header: the page title already says where the data is from.

test("the analytics page has no data-source banner under the header", () => {
  const page = readFileSync("src/routes/analytics.tsx", "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(
    page,
    /<span className="font-semibold text-brand-amber">YouTube Analytics<\/span>/,
  );
  assert.doesNotMatch(page, /Revenue may lag and can be unavailable for non-monetized channels/);
  // The page title stays.
  assert.match(page, /<h1 className="text-3xl font-bold tracking-tight">YouTube Analytics<\/h1>/);
});
