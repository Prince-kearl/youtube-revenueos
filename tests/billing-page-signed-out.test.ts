import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Signed out, /billing sends the visitor to sign-in ("/", as the app-shell pages do) instead of
// "We couldn't load billing information". The subscription API still refuses the request
// (AUTH_REQUIRED, 401); the page only decides where to go, and never reads the refused body.

const page = readFileSync("src/routes/billing.tsx", "utf8").replace(/\s+/g, " ");
const load = page.slice(
  page.indexOf('fetch("/api/billing/subscription"'),
  page.indexOf('.catch(() => setStatus("error"))'),
);

test("a 401 from the subscription API goes to sign-in, replacing the history entry", () => {
  assert.match(
    load,
    /if \(response\.status === 401\) \{ navigate\(\{ to: "\/", replace: true \}\); return; \}/,
  );
});

test("the 401 check comes before the body is read or any state is set", () => {
  const check = load.indexOf("response.status === 401");
  assert.ok(check > 0);
  assert.ok(check < load.indexOf("response.json()"));
  assert.ok(check < load.indexOf("setData("));
  assert.ok(check < load.indexOf('setStatus("ready")'));
});

test("other failures still show the error screen with Try again", () => {
  assert.match(load, /if \(!response\.ok \|\| !body\.data\) throw new Error\(\);/);
  assert.match(page, /We couldn't load billing information\./);
  assert.match(page, /Try again/);
});
