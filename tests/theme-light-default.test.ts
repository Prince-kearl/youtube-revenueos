import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const theme = readFileSync("src/lib/theme.ts", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");

test("the theme is light by default, under a new key that resets everyone", () => {
  assert.match(theme, /useLocalStore<ThemeMode>\("yroos\.theme\.v2", "light"\)/);
  assert.doesNotMatch(
    theme,
    /useLocalStore<ThemeMode>\("yroos\.theme"/,
    "the old key is no longer read",
  );
});

// Runs the real first-paint script (from __root.tsx) against a fake browser.
function firstPaintIsDark(storage: Record<string, string>, osPrefersDark: boolean): boolean {
  const script = root.match(/const NO_FLASH_THEME_SCRIPT = `([\s\S]*?)`;/)?.[1];
  assert.ok(script, "NO_FLASH_THEME_SCRIPT found");
  const classes = new Set<string>();
  vm.runInNewContext(script, {
    localStorage: { getItem: (k: string) => (k in storage ? storage[k] : null) },
    window: { matchMedia: () => ({ matches: osPrefersDark }) },
    document: { documentElement: { classList: { add: (c: string) => classes.add(c) } } },
  });
  return classes.has("dark");
}

test("first paint: new visitors and people on the old dark/system setting get light", () => {
  assert.equal(firstPaintIsDark({}, true), false, "new visitor with a dark OS");
  assert.equal(firstPaintIsDark({ "yroos.theme": '"dark"' }, false), false, "was in dark mode");
  assert.equal(
    firstPaintIsDark({ "yroos.theme": '"system"' }, true),
    false,
    "was on system + dark OS",
  );
});

test("first paint: a choice made after the reset is respected", () => {
  assert.equal(firstPaintIsDark({ "yroos.theme.v2": '"dark"' }, false), true);
  assert.equal(firstPaintIsDark({ "yroos.theme.v2": '"light"' }, true), false);
  assert.equal(firstPaintIsDark({ "yroos.theme.v2": '"system"' }, true), true);
  assert.equal(firstPaintIsDark({ "yroos.theme.v2": '"system"' }, false), false);
});
