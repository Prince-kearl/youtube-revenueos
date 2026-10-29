import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");

function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return styles.slice(start, styles.indexOf("\n}\n", start));
}

test("light mode: the app shell has the light red backdrop", () => {
  const sky = rule("html:not(.dark) .dashboard-shell.min-h-screen.bg-background");
  assert.match(sky, /background-color: #fef6f6;/);
  assert.match(sky, /background-size: auto;/, "not stretched by the base rule's 300% size");
  assert.match(sky, /radial-gradient\(\s*24% 36% at 100% 0%,\s*rgba\(254, 148, 148, 0\.85\)/);
  assert.match(
    sky,
    /linear-gradient\(\s*180deg,\s*#fec0c0 0px,[\s\S]*#fef4f4 440px,[\s\S]*#fef3f3 1024px/,
  );
  // it comes after the base shell rule that clears the motion background, and outranks it
  assert.ok(
    styles.indexOf("html:not(.dark) .dashboard-shell") >
      styles.indexOf(".dashboard-shell.min-h-screen.bg-background {"),
  );
});

test("dark mode and the iOS 26 wallpaper keep their own backgrounds", () => {
  const wallpaper = rule(".ios26.ios26-wallpaper .dashboard-shell.min-h-screen.bg-background");
  assert.match(wallpaper, /background-color: transparent;/);
  assert.match(wallpaper, /background-image: none;/);
  // the sky rule is scoped away from dark mode
  assert.match(styles, /html:not\(\.dark\) \.dashboard-shell\.min-h-screen\.bg-background \{/);
});

test("light mode: no line under the header", () => {
  const bar = rule(":root:not(.dark) .glass-bar");
  assert.match(bar, /border-bottom-color: transparent;/);
  assert.match(bar, /backdrop-filter: none;/);
  // it comes after the rules that draw the line, so it wins
  assert.ok(styles.indexOf(":root:not(.dark) .glass-bar") > styles.indexOf(".ios26 .glass-bar {"));
});
