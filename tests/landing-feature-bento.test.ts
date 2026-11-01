import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bento = readFileSync("src/components/landing/FeatureBento.tsx", "utf8");
const landing = readFileSync("src/routes/landing.tsx", "utf8");

test("the landing page shows the feature bento right after the problem section", () => {
  assert.match(landing, /<ProblemSection \/>\s+<FeatureBento \/>/);
  assert.match(landing, /import \{ FeatureBento \} from "@\/components\/landing\/FeatureBento";/);
});

test("the bento: headline, two calls to action, eight real tools and the closing line", () => {
  assert.match(
    bento,
    /Run your channel\s*<br \/>\s*<span className="text-primary">Grow your revenue<\/span>/,
  );
  assert.match(bento, /<Link\s+to="\/dashboard"[\s\S]*?Start for free/);
  assert.match(bento, /href="#how-it-works"[\s\S]*?See how it works/);
  const titles = [...bento.matchAll(/title="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles, [
    "Revenue Analytics",
    "AI Descriptions",
    "Comment Automation",
    "Link Tracking",
    "Lead Inbox",
    "Brand Deals",
    "Audience",
    "Team",
  ]);
  assert.match(bento, /Use one or all\./);
});

test("illustrations are decorative; on phones the revenue chart gives way to its checklist", () => {
  assert.match(bento, /<div className="relative mt-auto flex-1" aria-hidden="true">/);
  assert.match(bento, /absolute bottom-6 right-8 top-4 hidden w-\[46%\][^"]* sm:flex/);
});
