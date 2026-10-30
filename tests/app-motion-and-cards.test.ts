import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");
const glow = readFileSync("src/components/ui/glowing-effect.tsx", "utf8");
const card = readFileSync("src/components/DashboardKpiCard.tsx", "utf8");

const block = (start: string) =>
  styles.slice(styles.indexOf(start), styles.indexOf("\n}\n", styles.indexOf(start)));

test("every app page: cards lose their outline and glow, titles take the brand colour", () => {
  assert.match(
    block(":root .dashboard-main .card-gradient-outline {"),
    /border-color: transparent;/,
  );
  assert.match(block(":root .dashboard-main .card-frost {"), /border-color: transparent;/);
  assert.match(block(".dashboard-main .glowing-effect {"), /display: none !important;/);
  assert.equal(
    glow.match(/ glowing-effect",/g)?.length,
    2,
    "both glow layers carry the hook class",
  );
  assert.match(
    styles,
    /\.dashboard-main\n {2}:is\(h2, h3\)\.font-semibold:not\(\[class\*="text-destructive"\]\):not\(\[class\*="text-white"\]\)/,
  );
});

test("motion: entrances are one-off and only fill backwards, so hover transforms still apply", () => {
  assert.match(
    styles,
    /\.dashboard-kpi-card \{\n {2}animation: dash-rise 0\.55s cubic-bezier\(0\.2, 0\.7, 0\.2, 1\) backwards;\n {2}animation-delay: calc\(var\(--i, 0\) \* 70ms\);/,
  );
  assert.match(
    styles,
    /\.dashboard-main \.card-gradient-outline \{\n {2}animation: dash-rise 0\.6s cubic-bezier\(0\.2, 0\.7, 0\.2, 1\) 0\.35s backwards;/,
  );
  assert.doesNotMatch(
    styles.slice(styles.indexOf("@keyframes dash-rise")),
    /dash-(rise|grow-y|grow-x|pop) [^;]* both;/,
  );
  // hovers use the individual transform properties, which compose with running animations
  assert.match(styles, /\.dashboard-kpi-card:hover \{\n {4}translate: 0 -3px;/);
});

test("nothing loops; hovers only with a mouse; everything stops for reduced motion", () => {
  const motion = styles.slice(
    styles.indexOf("/* ============ App motion"),
    styles.indexOf("/* ============ App motion") + 7000,
  );
  assert.doesNotMatch(motion, /infinite/);
  assert.doesNotMatch(styles, /kpi-rays|kpi-float|kpi-mascot/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\) \{\n {2}\/\* hover uses/);
  const reduced = styles.slice(
    styles.lastIndexOf("@media (prefers-reduced-motion: reduce) {\n  .dashboard-kpi-card,"),
  );
  assert.match(reduced, /animation: none !important;\n {4}transition: none !important;/);
  const selectors = reduced.slice(
    reduced.indexOf("{") + 1,
    reduced.indexOf("{", reduced.indexOf("{") + 1),
  );
  for (const sel of [
    ".kpi-dot-chart",
    ".dash-bar-fill",
    ".dash-cell",
    ".dashboard-main .card-frost",
  ])
    assert.ok(selectors.includes(sel), sel);
});

test("KPI cards are staggered by their index; their dot chart grows in", () => {
  assert.match(card, /"--i": index,/);
  assert.match(card, /className="kpi-dot-chart h-\[76px\] w-full"/);
  assert.match(
    styles,
    /\.kpi-dot-chart \{\n {2}transform-origin: bottom;\n {2}animation: dash-grow-y/,
  );
});
