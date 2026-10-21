import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Back from Stripe's checkout, Settings must not claim a subscription the server has not
// recorded: it shows "Confirming…", re-checks the server, and congratulates only once the
// subscription is active (or says plainly that it has not arrived yet).
const page = readFileSync("src/routes/settings.tsx", "utf8").replace(/\s+/g, " ");

test("the success toast is shown only after the server reports an active subscription", () => {
  const toastAt = page.indexOf('toast.success("Subscription confirmed — welcome aboard!")');
  assert.ok(toastAt > 0);
  const before = page.slice(Math.max(0, toastAt - 200), toastAt);
  assert.match(
    before,
    /if \(isActiveSubscription\(body\.data\.subscription\)\) \{ setConfirming\("no"\);/,
  );
  // The checkout=success address alone never triggers it.
  assert.doesNotMatch(page, /get\("checkout"\) === "success"\) \{ toast\.success/);
});

test("while waiting it says it is confirming, re-checks, and gives up honestly after a minute", () => {
  assert.match(page, /Confirming your subscription…/);
  assert.match(page, /timer = setTimeout\(\(\) => void load\(\), CHECKOUT_POLL_MS\)/);
  assert.match(page, /const CHECKOUT_CONFIRM_MS = 60_000;/);
  assert.match(page, /We haven’t received your subscription yet/);
});
