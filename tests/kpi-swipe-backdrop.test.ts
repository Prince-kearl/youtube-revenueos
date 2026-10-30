import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/dashboard.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");
const TONES = ["green", "blue", "purple", "pink", "yellow", "red"];

test("the carousel's dots hand the current card's colour to the shell, without re-rendering Dashboard", () => {
  assert.match(
    page,
    /const KPI_TONES = \["green", "blue", "purple", "pink", "yellow", "red"\] as const;/,
  );
  assert.match(page, /if \(shell && tone\) shell\.dataset\.kpiTone = tone;/);
  assert.match(
    page,
    /if \(shell\) delete shell\.dataset\.kpiTone;/,
    "cleared when leaving the Dashboard",
  );
  // still no active-card state in Dashboard itself
  assert.doesNotMatch(page, /activeKpiIndex|setActiveKpiIndex/);
});

test("the tint uses the backdrop's gradient style, cross-fades, and only on phones in light mode", () => {
  const block = styles.slice(
    styles.indexOf("/* Phone KPI carousel: the backdrop takes the colour"),
  );
  assert.match(
    block,
    /^\/\*[\s\S]*?\*\/\n@media \(max-width: 639\.98px\) \{\n {2}html:not\(\.dark\) \.dashboard-shell \{\n {4}isolation: isolate;/,
  );
  assert.match(block, /transition: background-color 0\.6s ease;/);
  // same shapes as the backdrop: its vertical fade and its corner glow + top patch
  assert.match(
    block,
    /mask-image: linear-gradient\(\n {6}180deg,\n {6}#000 0px,[\s\S]*?rgba\(0, 0, 0, 0\.08\) 440px/,
  );
  assert.match(block, /radial-gradient\(\n {8}24% 36% at 100% 0%,/);
  assert.match(block, /radial-gradient\(36% 13% at 30% 0%,/);
  for (const tone of TONES) {
    assert.ok(block.includes(`[data-kpi-tone="${tone}"]::before {`), tone);
    assert.ok(block.includes(`[data-kpi-tone="${tone}"]::after {`), tone);
  }
  assert.match(block, /@media \(max-width: 639\.98px\) and \(prefers-reduced-motion: reduce\)/);
});
