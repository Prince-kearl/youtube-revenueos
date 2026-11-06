import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");

function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return styles.slice(start, styles.indexOf("\n}\n", start));
}

test("the app shell uses a solid theme background in light and dark modes", () => {
  const shell = rule(".dashboard-shell.min-h-screen.bg-background");
  assert.match(shell, /background-color: var\(--background\);/);
  assert.match(shell, /background-image: none;/);
  assert.match(shell, /background-size: auto;/);
  assert.match(shell, /animation: none;/);
  assert.doesNotMatch(
    styles,
    /\.dashboard-shell(?:\[data-kpi-tone[^\]]*\])?::(?:before|after)/,
    "KPI carousel does not add a colored wash behind the shell",
  );
});

test("the dashboard no longer enables a wallpaper image", () => {
  assert.doesNotMatch(styles, /\.ios26\.ios26-wallpaper(?:\.dark)? body\s*\{/);
  assert.doesNotMatch(styles, /ios26_light\.png|ios26_dark\.png/);
  assert.doesNotMatch(styles, /ios26-wallpaper/);
});

test("light mode: no line under the header", () => {
  const bar = rule(":root:not(.dark) .glass-bar");
  assert.match(bar, /border-bottom-color: transparent;/);
  assert.match(bar, /backdrop-filter: none;/);
  // it comes after the rules that draw the line, so it wins
  assert.ok(styles.indexOf(":root:not(.dark) .glass-bar") > styles.indexOf(".ios26 .glass-bar {"));
});
