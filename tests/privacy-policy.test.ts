import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The Privacy Policy is a public legal page. These checks protect the things that must not
// quietly regress: that it can be read signed out, that the statements Google and YouTube
// require are present with their links, and that links into the page from elsewhere still land.

const page = readFileSync("src/routes/privacy.tsx", "utf8");

test("the policy is public: it does not render inside the signed-in app layout", () => {
  // DashboardLayout redirects signed-out visitors to the landing page.
  assert.ok(!page.includes("@/components/DashboardLayout"), "the app layout is not imported");
  assert.ok(!page.includes("<DashboardLayout"), "the app layout is not rendered");
  assert.match(page, /createFileRoute\("\/privacy"\)/);
});

test("it carries the date and the fourteen numbered sections", () => {
  assert.match(page, /const LAST_UPDATED = "October 9, 2026";/);
  const titles = [...page.matchAll(/\n {4}title: "([^"]+)",/g)].map((match) => match[1]);
  assert.deepEqual(titles, [
    "Information We Collect",
    "How We Use Information",
    "Google and YouTube API Services",
    "AI-Assisted Features",
    "Service Providers and Data Sharing",
    "Cookies and Local Storage",
    "Data Security",
    "Data Storage and International Processing",
    "Data Retention",
    "Disconnecting YouTube and Deleting Data",
    "Your Privacy Rights",
    "Children's Privacy",
    "Changes to This Policy",
    "Contact Us",
  ]);
  const ids = [...page.matchAll(/\n {4}id: "([^"]+)",/g)].map((match) => match[1]);
  assert.equal(ids.length, 14);
  assert.equal(new Set(ids).size, 14, "every section has its own anchor");
});

test("the Google and YouTube API Services disclosures are present, with their links", () => {
  for (const href of [
    "https://www.youtube.com/t/terms",
    "https://policies.google.com/privacy",
    "https://developers.google.com/terms/api-services-user-data-policy",
    "https://myaccount.google.com/connections",
  ])
    assert.ok(page.includes(`href="${href}"`), href);
  assert.match(
    page,
    /YouTube API Services, including the YouTube Data API and YouTube Analytics\s+API/,
  );
  assert.match(page, /agree to be bound by the/);
  assert.match(page, /including its Limited Use requirements/);
  assert.match(page, /We do not sell Google user data, transfer it to data brokers/);
  assert.match(page, /seven-calendar-day requirement/);
  assert.match(page, /not affiliated with or endorsed by Google or\s+YouTube/);
});

test("external links open safely and email links are real mailto links", () => {
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /href=\{`mailto:\$\{address\}`\}/);
  assert.doesNotMatch(page, /mailto\\:/, "no escaped mailto left over from the source text");
  assert.match(page, /const PRIVACY_EMAIL = "hey@tubify\.app";/);
  assert.match(page, /const CONTACT_EMAIL = "youtubesoftware5@gmail\.com";/);
});

test("links into the policy from elsewhere in the app still land on a section", () => {
  const settings = readFileSync("src/routes/settings.tsx", "utf8");
  const anchors = [...settings.matchAll(/href="\/privacy#([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(anchors.length > 0);
  for (const anchor of anchors) assert.ok(page.includes(`id: "${anchor}"`), `#${anchor}`);
  assert.match(readFileSync("src/routes/landing.tsx", "utf8"), /<Link to="\/privacy"/);
});
