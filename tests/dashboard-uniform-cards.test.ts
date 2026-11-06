import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/dashboard.tsx", "utf8");
const forYou = readFileSync("src/components/RevenueCommandCenterView.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");

test("dashboard cards have subtle outlines: no hover glow, and shared card styles keep their border", () => {
  for (const source of [page, forYou]) {
    assert.doesNotMatch(source, /GlowingEffect/);
    assert.doesNotMatch(source, /card-gradient-outline (?!dashboard-card)/);
    assert.doesNotMatch(source, /card-frost (?!dashboard-card)/);
  }
  const outer = styles.slice(styles.indexOf(":root .dashboard-main .card-gradient-outline {"));
  assert.match(
    outer,
    /^:root \.dashboard-main \.card-gradient-outline \{\n {2}border-color: #d9dee5;\n {2}background: var\(--card\);/,
  );
  const inner = styles.slice(styles.indexOf(":root .dashboard-main .card-frost {"));
  assert.match(inner, /^:root \.dashboard-main \.card-frost \{\n {2}border-color: #d9dee5;/);
  const custom = styles.slice(styles.indexOf(":root .dashboard-main .dashboard-card {"));
  assert.match(
    custom,
    /^:root \.dashboard-main \.dashboard-card \{\n {2}border: 1px solid #d9dee5;/,
  );
  // after the iOS 26 variants of the shared styles, so it wins over them
  assert.ok(
    styles.indexOf(":root .dashboard-main .card-gradient-outline") >
      styles.indexOf(".ios26.dark .card-gradient-outline {"),
  );
});

test("every section title is the one brand colour", () => {
  // section titles (the connect / error notices keep their neutral heading)
  const titles = page.match(/<h3 className="text-lg[^"]*"/g) ?? [];
  assert.ok(titles.length >= 5);
  for (const t of titles) assert.match(t, /text-lg font-semibold text-primary"/, t);
  assert.match(page, /<p className="text-sm font-semibold text-primary">Subscribers<\/p>/);
  assert.match(forYou, /className="flex items-center gap-2 text-lg font-semibold text-primary"/);
  assert.doesNotMatch(page, /text-(green|amber|teal|blue|pink|purple)-600 dark:/);
});
