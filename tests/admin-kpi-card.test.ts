import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The admin console's KPI cards use AdminKpiCard (tinted header strip with an icon, monospaced
// uppercase label and status dot, then the figure); creator-facing pages keep FlatKpiCard.

const dir = "src/components/admin/sections/";
const sections = readdirSync(dir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, source: readFileSync(dir + name, "utf8").replace(/\s+/g, " ") }));
const card = readFileSync("src/components/admin/AdminKpiCard.tsx", "utf8").replace(/\s+/g, " ");

test("no admin section uses FlatKpiCard any more", () => {
  for (const { name, source } of sections) assert.doesNotMatch(source, /FlatKpiCard/, name);
});

test("every admin KPI card has an icon and a tone", () => {
  const users = sections.filter(({ source }) => source.includes("<AdminKpiCard"));
  assert.equal(users.length, 11);
  for (const { name, source } of users) {
    // Icon and tone come first on every card (a value may hold an arrow function, so the tag is
    // not matched through to its end).
    const cards = source.match(/<AdminKpiCard\b/g)?.length ?? 0;
    const complete =
      source.match(/<AdminKpiCard (key=\{[^}]+\} )?icon=\{\w+\} tone=(\{|")/g)?.length ?? 0;
    assert.ok(cards > 0, name);
    assert.equal(complete, cards, name);
  }
});

test("corners follow the KPI card radius token, not the zero generic radius", () => {
  assert.match(card, /rounded-\[var\(--kpi-card-radius\)\]/);
  assert.doesNotMatch(card, /\brounded-(sm|md|lg|xl|2xl)\b/);
});

test("the header strip carries the icon, the uppercase mono label and the tone dot", () => {
  assert.match(card, /<Icon className="[^"]*" aria-hidden \/>/);
  assert.match(card, /font-mono text-xs uppercase/);
  assert.match(card, /rounded-full" style=\{\{ backgroundColor: color \}\}/);
});

test("creator pages keep FlatKpiCard", () => {
  for (const page of ["team", "reports", "support", "destinations", "link-tracking"])
    assert.match(readFileSync(`src/routes/${page}.tsx`, "utf8"), /<FlatKpiCard\b/, page);
});
