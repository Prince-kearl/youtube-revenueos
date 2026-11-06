import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const theme = readFileSync("src/lib/theme.ts", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");

test("iOS 26 Design is on by default, under new keys that reset everyone", () => {
  assert.match(theme, /useLocalStore<boolean>\("yroos\.ios26Design\.v3", true\)/);
  assert.doesNotMatch(theme, /useLocalStore<boolean>\("yroos\.ios26Design\.v2"/);
  assert.doesNotMatch(theme, /useIos26Wallpaper|ios26Wallpaper/);
  assert.doesNotMatch(root, /ios26-wallpaper|ios26Wallpaper/);
});

// Runs the real first-paint script (from __root.tsx) against a fake browser.
function firstPaint(storage: Record<string, string>): Set<string> {
  const script = root.match(/const NO_FLASH_THEME_SCRIPT = `([\s\S]*?)`;/)?.[1];
  assert.ok(script, "NO_FLASH_THEME_SCRIPT found");
  const classes = new Set<string>();
  vm.runInNewContext(script, {
    localStorage: { getItem: (k: string) => (k in storage ? storage[k] : null) },
    window: { matchMedia: () => ({ matches: false }) },
    document: { documentElement: { classList: { add: (c: string) => classes.add(c) } } },
  });
  return classes;
}

test("first paint: new visitors and people who had it off get the iOS look, in light mode", () => {
  for (const storage of [
    {},
    { "yroos.ios26Design.v2": "false", "yroos.ios26Wallpaper": "false" },
  ]) {
    const c = firstPaint(storage);
    assert.ok(c.has("ios26"), JSON.stringify(storage));
    assert.ok(!c.has("ios26-wallpaper"), "obsolete wallpaper setting is ignored");
    assert.ok(!c.has("dark"), "light mode");
  }
});

test("first paint: switching it off after the reset is remembered", () => {
  assert.ok(!firstPaint({ "yroos.ios26Design.v3": "false" }).has("ios26"));
});
