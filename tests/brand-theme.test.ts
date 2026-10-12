// The saved brand theme is sent with the first HTML of every page (no flash of the built-in
// default colour), and nothing unsafe can reach the <style> tag it is written into.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brandThemeCss, sanitizeBrandTheme } from "../src/lib/brand-theme";

const SAVED = {
  siteName: "Tubify",
  logoLightUrl: "data:image/png;base64,AAAA",
  primaryColor: "#dc2626",
  buttonTextColor: "#FFFFFF",
  accentColor: "#3b82f6",
  cardRadius: 12,
  buttonRadius: 24,
  inputRadius: 24,
  kpiCardRadius: 19,
};

test("only the theme tokens are taken from the saved settings", () => {
  assert.deepEqual(sanitizeBrandTheme(SAVED), {
    primaryColor: "#dc2626",
    buttonTextColor: "#FFFFFF",
    accentColor: "#3b82f6",
    cardRadius: 12,
    buttonRadius: 24,
    inputRadius: 24,
    kpiCardRadius: 19,
  });
});

test("the saved brand colour is applied in both colour schemes, ahead of the built-in defaults", () => {
  const css = brandThemeCss(SAVED);
  assert.equal(
    css,
    "html:root{--primary:#dc2626;--primary-foreground:#FFFFFF;--brand-blue:#3b82f6}" +
      "html:root:not(.ios26){--card-radius:12px;--button-radius:24px;--input-radius:24px;--kpi-card-radius:19px}",
  );
  // styles.css sets --primary under `:root` and `.dark`; `html:root` must outrank both.
  const styles = readFileSync("src/styles.css", "utf8");
  assert.match(styles, /^:root \{/m);
  assert.match(styles, /^\.dark \{/m);
});

test("nothing saved means nothing is emitted, and the defaults stand", () => {
  for (const input of [null, undefined, {}, { siteName: "x" }, "x", 4, []])
    assert.equal(brandThemeCss(input as never), "");
});

test("a value that is not a plain hex colour never reaches the stylesheet", () => {
  for (const hostile of [
    "red",
    "rgb(220, 38, 38)",
    "#dc2626;}</style><script>alert(1)</script>",
    "#dc2626}html{display:none",
    "url(https://evil.test/x)",
    "var(--destructive)",
    "#12",
    "#gggggg",
    "",
    null,
    42,
    { toString: () => "#dc2626" },
  ]) {
    const css = brandThemeCss({ ...SAVED, primaryColor: hostile as never });
    assert.ok(!css.includes("--primary:"), `accepted ${JSON.stringify(hostile)}`);
    assert.ok(!/[<>]|script|url\(|display/.test(css));
    // the other, valid tokens are still applied
    assert.ok(css.includes("--brand-blue:#3b82f6"));
  }
});

test("radii must be sane numbers", () => {
  for (const bad of [-1, 1000, Infinity, NaN, "12", "12px;}", null])
    assert.ok(!brandThemeCss({ ...SAVED, cardRadius: bad as never }).includes("--card-radius"));
  assert.ok(brandThemeCss({ cardRadius: 0 }).includes("--card-radius:0px"));
});

test("short and alpha hex forms are accepted", () => {
  for (const ok of ["#f00", "#f00a", "#ff0000", "#ff0000aa", " #DC2626 "])
    assert.ok(brandThemeCss({ primaryColor: ok }).includes(`--primary:${ok.trim()}`));
});

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

test("the root layout reads the theme on the server and renders it into <head>", () => {
  const root = flat("src/routes/__root.tsx");
  assert.match(root, /loader: async \(\)/);
  assert.match(root, /brandTheme: await getBrandTheme\(\)/);
  assert.match(
    root,
    /catch \{ return \{ brandTheme: \{\} \}; \}/,
    "a failed read cannot break the page",
  );
  assert.match(root, /styles: \[\{ children: brandThemeCss\(loaderData\?\.brandTheme\) \}\]/);
  assert.match(root, /<ThemeInjector serverTheme=\{brandTheme\} \/>/);
});

test("the running app adopts the server theme before it paints its own copy", () => {
  const injector = flat("src/components/ThemeInjector.tsx");
  assert.match(
    injector,
    /useLayoutEffect\(\(\) => \{ if \(serverTheme && Object\.keys\(serverTheme\)/,
  );
  assert.match(
    injector,
    /useLayoutEffect\(\(\) => \{ const root = document\.documentElement\.style; root\.setProperty\("--primary"/,
  );
});

test("the server read returns theme tokens only, and never throws", () => {
  const fn = flat("src/lib/brand-theme-fn.ts");
  assert.match(fn, /sanitizeBrandTheme\(data\?\.content\)/);
  assert.match(fn, /catch \{ return cached\?\.theme \?\? \{\}; \}/);
  assert.doesNotMatch(fn, /return data/);
});

// ---------- the landing page keeps one palette in both colour schemes ----------

test("the landing page is pinned to the light palette, including its dropdown menus", () => {
  const landing = flat("src/routes/landing.tsx");
  assert.match(landing, /<div className="theme-light min-h-screen bg-background text-foreground">/);
  const menus = landing.match(/<DropdownMenuContent[^>]*>/g) ?? [];
  assert.ok(menus.length > 0);
  for (const menu of menus) assert.match(menu, /className="theme-light"/, menu);
  assert.doesNotMatch(landing, /\bdark:/, "no dark-only utilities on a page that is never dark");
});

test(".theme-light restores every neutral token the dark theme changes, and no brand token", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const block = (selector: string) => {
    const start = styles.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, selector);
    const body = styles.slice(start, styles.indexOf("\n}", start));
    return new Map(
      [...body.matchAll(/^\s*(--[a-z-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
    );
  };
  const root = block(":root");
  const dark = block(".dark");
  const pinned = block(".theme-light");
  // Set by the Superadmin's Customization settings on <html>; must keep flowing through.
  const brand = ["--primary", "--primary-foreground", "--brand-blue"];
  for (const token of brand) assert.ok(!pinned.has(token), `${token} must not be pinned`);
  for (const token of dark.keys()) {
    if (brand.includes(token)) continue;
    assert.ok(pinned.has(token), `${token} is changed by .dark but not restored`);
    assert.equal(pinned.get(token), root.get(token), `${token} differs from :root`);
  }
});
