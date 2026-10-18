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

// "Earnings by video" on a phone: the four-column table is wider than the screen, so phones get one
// stacked row per video with every figure visible, and the table is kept for wider screens.
test("Earnings by video: phones get stacked rows with every figure; wider screens keep the table", () => {
  const page = readFileSync("src/routes/analytics.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(page, /<ul className="divide-y divide-border sm:hidden">/);
  assert.match(page, /<table className="hidden w-full text-left text-sm sm:table">/);
  assert.match(page, /<dt className="text-muted-foreground">Views<\/dt>/);
  assert.match(page, /<dt className="text-muted-foreground">Watch time<\/dt>/);
  assert.match(page, /<dt className="text-muted-foreground">Earnings<\/dt>/);
  // Both layouts show earnings through the same helper, so hidden revenue stays hidden on a phone.
  assert.equal(page.match(/videoEarningsText\(videoEarnings\.byVideo, row\.video\)/g)?.length, 2);
});
