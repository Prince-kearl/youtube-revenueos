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
  assert.match(bento, /<Link\s+to="\/signup"[\s\S]*?Start for free/);
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

test("the landing page's links lead somewhere real", () => {
  // Every "get started" goes to sign-up (a signed-out visitor sent to /dashboard lands on sign-in).
  assert.doesNotMatch(landing, /to="\/dashboard"/);
  assert.doesNotMatch(bento, /to="\/dashboard"/);
  assert.equal(
    landing.match(/to="\/signup"/g)?.length,
    4,
    "nav, mobile menu, hero, final call to action",
  );
  // There is no public demo: the secondary hero button shows the product tour on this page.
  assert.match(landing, /href="#product"[\s\S]{0,400}\{content\.heroSecondaryCta\}/);
  // No dead "#" links in the footer, and every in-page target exists.
  assert.doesNotMatch(landing, /href="#"\s+className="flex items-center gap-1 text-sm/);
  for (const id of ["features", "how-it-works", "product", "faq", "contact"]) {
    const where = id === "features" ? bento : landing;
    assert.match(
      where,
      new RegExp(`id="${id}"[^>]*scroll-mt-`),
      `#${id} exists and clears the fixed nav`,
    );
  }
  assert.doesNotMatch(
    landing,
    /Changelog|Roadmap|"Docs"|"Blog"/,
    "no links to pages that do not exist",
  );
});

test("the landing page describes the product as it is", () => {
  assert.match(bento, /\/r\/\{slug\}/, "short links are /r/<slug>");
  assert.doesNotMatch(bento, /devices/, "Audience shows countries, age groups and gender");
  for (const missing of ["Real Time", "Campaigns", "AI Assistant"])
    assert.doesNotMatch(
      landing,
      new RegExp(`label: "${missing}"`),
      `${missing} is not a Tubify page`,
    );
  assert.doesNotMatch(landing, /FloatingStatCard/, "no unused components");
});

test("the contact form is labelled and reports a network failure", () => {
  for (const id of ["contact-name", "contact-email", "contact-message"]) {
    assert.match(landing, new RegExp(`htmlFor="${id}"`));
    assert.match(landing, new RegExp(`id="${id}"`));
  }
  assert.match(landing, /\} catch \{\s*toast\.error\("Couldn't reach us/);
});
