import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { BRAND } from "../src/lib/brand";

const read = (path: string) => readFileSync(path, "utf8");

test("every brand image ships in public/ and stays small", () => {
  for (const url of Object.values(BRAND)) {
    const file = `public${url}`;
    assert.ok(existsSync(file), `${file} exists`);
    assert.ok(statSync(file).size < 200_000, `${file} is under 200 KB`);
  }
  // the browser's default /favicon.ico is the new app icon (an ICO wrapping a PNG)
  const ico = readFileSync("public/favicon.ico");
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(ico.subarray(22, 26).toString("latin1"), "\x89PNG");
  assert.ok(!existsSync("public/logo.png") && !existsSync("public/tubi.png"), "old logos removed");
});

test("logos saved in Customization earlier are not used anywhere", () => {
  for (const file of [
    "src/components/Logo.tsx",
    "src/routes/landing.tsx",
    "src/components/ThemeInjector.tsx",
    "src/components/admin/sections/content/GeneralTab.tsx",
  ])
    assert.doesNotMatch(read(file), /content\.(logoLightUrl|logoDarkUrl|siteIconUrl)/, file);
  // no upload fields left: Customization shows the built-in images instead
  const general = read("src/components/admin/sections/content/GeneralTab.tsx");
  assert.doesNotMatch(general, /type="file"|readAsDataURL/);
  assert.match(general, /<BrandPreview \/>/);
  for (const key of ["wordmark", "appIcon", "mascot"])
    assert.match(general, new RegExp(`src: BRAND\.${key}`));
});

test("each situation uses its image", () => {
  const logo = read("src/components/Logo.tsx");
  assert.match(logo, /src=\{BRAND\.appIcon\}/, "collapsed / compact: the app icon");
  assert.match(logo, /src=\{BRAND\.wordmark\}/, "expanded: the wordmark");

  const root = read("src/routes/__root.tsx");
  assert.match(root, /rel: "icon", type: "image\/png", href: BRAND\.favicon/);
  assert.match(root, /rel: "apple-touch-icon", href: BRAND\.appleTouchIcon/);
  assert.match(root, /property: "og:image", content: BRAND\.wordmarkPng/);

  const landing = read("src/routes/landing.tsx");
  assert.equal(landing.match(/src=\{BRAND\.wordmark\}/g)?.length, 3, "nav, footer, mock dashboard");
  assert.match(landing, /src=\{BRAND\.mascot\}/, "final call to action: the mascot");
  assert.match(
    read("src/components/DashboardLayout.tsx"),
    /src=\{BRAND\.mascot\}/,
    "the Tubi assistant",
  );
});

test("no page still points at the old logo files or writes the name as a text logo", () => {
  for (const file of [
    "src/components/Logo.tsx",
    "src/routes/landing.tsx",
    "src/components/DashboardLayout.tsx",
    "src/routes/__root.tsx",
    "src/lib/stores.ts",
    "src/lib/demo-api.ts",
    "src/lib/demo-youtube.ts",
    "src/components/admin/sections/content/GeneralTab.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /"\/(logo|tubi)\.png"|"\/favicon\.ico"/, file);
  }
  assert.doesNotMatch(read("src/routes/landing.tsx"), /font-bold">Tubify</);
});
