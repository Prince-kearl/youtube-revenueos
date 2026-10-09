import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Tubify's public legal pages: the Privacy Policy and the Terms of Service. These checks protect
// the things that must not quietly regress: that both can be read signed out, that the
// statements Google and YouTube require are present with their links, that each document keeps
// its numbered sections, and that links to them from elsewhere in the app still land.

const read = (file: string) => readFileSync(file, "utf8");
const shell = read("src/components/LegalDocument.tsx");
const privacy = read("src/routes/privacy.tsx");
const terms = read("src/routes/terms.tsx");

// Prose is checked with line wrapping removed, so reformatting a file cannot break a check.
const flat = (source: string) => source.replace(/\s+/g, " ");
const titlesOf = (source: string) =>
  [...source.matchAll(/\n {4}title: "([^"]+)",/g)].map((match) => match[1]);
const idsOf = (source: string) =>
  [...source.matchAll(/\n {4}id: "([^"]+)",/g)].map((match) => match[1]);

// ---------- both pages ----------

test("the legal pages are public: neither renders inside the signed-in app layout", () => {
  // DashboardLayout redirects signed-out visitors to the landing page.
  for (const [name, source] of [
    ["shell", shell],
    ["privacy", privacy],
    ["terms", terms],
  ] as const) {
    assert.ok(!source.includes("@/components/DashboardLayout"), `${name}: layout not imported`);
    assert.ok(!source.includes("<DashboardLayout"), `${name}: layout not rendered`);
  }
  assert.match(privacy, /createFileRoute\("\/privacy"\)/);
  assert.match(terms, /createFileRoute\("\/terms"\)/);
  for (const source of [privacy, terms]) assert.match(source, /<LegalDocument\s/);
});

test("both routes are registered and cross-linked", () => {
  const routeTree = read("src/routeTree.gen.ts");
  for (const route of ["/privacy", "/terms"]) {
    assert.ok(existsSync(`src/routes${route}.tsx`), route);
    assert.ok(routeTree.includes(`'${route}'`), `${route} is registered`);
  }
  assert.match(shell, /\{ to: "\/privacy", label: "Privacy Policy" \}/);
  assert.match(shell, /\{ to: "\/terms", label: "Terms of Service" \}/);
  assert.match(privacy, /path="\/privacy"/);
  assert.match(terms, /path="\/terms"/);
});

test("external links open safely and email links are real mailto links", () => {
  assert.match(shell, /target="_blank" rel="noopener noreferrer"/);
  assert.match(shell, /href=\{`mailto:\$\{address\}`\}/);
  for (const source of [privacy, terms]) {
    assert.ok(!source.includes("mailto\\:"), "no escaped mailto left over from the source text");
    assert.doesNotMatch(source, /<a href="http/, "external links go through <External>");
  }
  assert.match(shell, /LEGAL_CONTACT_EMAIL = "youtubesoftware5@gmail\.com"/);
  assert.match(shell, /LEGAL_WEBSITE_URL = "https:\/\/youtube-revenueos\.vercel\.app\/"/);
});

test("the app links to both documents where people look for them", () => {
  const landing = read("src/routes/landing.tsx");
  assert.match(landing, /<Link to="\/privacy"/);
  assert.match(landing, /<Link to="\/terms"/);
  // Agreement is stated at the point an account is created.
  const signup = read("src/routes/signup.tsx");
  assert.match(signup, /By creating an account, you agree to our/);
  assert.match(signup, /<Link to="\/terms"/);
  assert.match(signup, /<Link to="\/privacy"/);
  const settings = read("src/routes/settings.tsx");
  assert.match(settings, /<Link to="\/terms"/);
});

// ---------- Privacy Policy ----------

test("Privacy Policy: the date and the fourteen numbered sections", () => {
  assert.match(privacy, /const LAST_UPDATED = "October 9, 2026";/);
  assert.deepEqual(titlesOf(privacy), [
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
  assert.equal(new Set(idsOf(privacy)).size, 14, "every section has its own anchor");
});

test("Privacy Policy: the Google and YouTube API Services disclosures, with their links", () => {
  for (const href of [
    "https://www.youtube.com/t/terms",
    "https://policies.google.com/privacy",
    "https://developers.google.com/terms/api-services-user-data-policy",
    "https://myaccount.google.com/connections",
  ])
    assert.ok(privacy.includes(`href="${href}"`), href);
  assert.match(
    privacy,
    /YouTube API Services, including the YouTube Data API and YouTube Analytics\s+API/,
  );
  assert.match(privacy, /agree to be bound by the/);
  assert.match(privacy, /including its Limited Use requirements/);
  assert.match(privacy, /We do not sell Google user data, transfer it to data brokers/);
  assert.match(privacy, /seven-calendar-day requirement/);
  assert.match(flat(privacy), /not affiliated with or endorsed by Google or YouTube/);
  assert.match(privacy, /const PRIVACY_EMAIL = "hey@tubify\.app";/);
});

test("Privacy Policy: links into it from Settings still land on a section", () => {
  const settings = read("src/routes/settings.tsx");
  const anchors = [...settings.matchAll(/href="\/privacy#([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(anchors.length > 0);
  for (const anchor of anchors) assert.ok(privacy.includes(`id: "${anchor}"`), `#${anchor}`);
});

// ---------- Terms of Service ----------

test("Terms of Service: the date and the nineteen numbered sections", () => {
  assert.match(terms, /const LAST_UPDATED = "October 9, 2026";/);
  assert.deepEqual(titlesOf(terms), [
    "Eligibility and Accounts",
    "Description of the Service",
    "YouTube and Google Integration",
    "Revenue Data and Analytics",
    "AI-Assisted Features",
    "Your Content and Data",
    "Workspaces and Team Members",
    "Acceptable Use",
    "Subscriptions and Billing",
    "Service Availability and Changes",
    "Intellectual Property",
    "Third-Party Services",
    "Suspension and Termination",
    "Disclaimers",
    "Limitation of Liability",
    "Privacy and Data Protection",
    "Changes to These Terms",
    "Governing Law and Disputes",
    "Contact Information",
  ]);
  assert.equal(new Set(idsOf(terms)).size, 19, "every section has its own anchor");
});

test("Terms of Service: the YouTube and Google terms it binds users to, with their links", () => {
  for (const href of [
    "https://www.youtube.com/t/terms",
    "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    "https://myaccount.google.com/connections",
  ])
    assert.ok(terms.includes(`href="${href}"`), href);
  assert.match(terms, /Tubify uses Google OAuth and YouTube API Services/);
  assert.match(flat(terms), /not affiliated with, sponsored by, or endorsed by Google or YouTube/);
  assert.match(terms, /at least 18 years old/);
  assert.match(flat(terms), /subscriptions renew automatically until canceled/);
  assert.match(flat(terms), /does not guarantee increased views, subscribers, conversions/);
});

test("Terms of Service: every reference to the Privacy Policy is a link to it", () => {
  const links = terms.match(/<LegalLink to="\/privacy">Privacy Policy<\/LegalLink>/g) ?? [];
  assert.equal(links.length, 6);
  // No bare mention is left unlinked.
  const mentions = terms.match(/Privacy Policy/g) ?? [];
  assert.equal(mentions.length, links.length);
});
