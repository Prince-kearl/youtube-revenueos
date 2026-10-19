import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Admin console → Billing shows only real data: MRR and active subscriptions from the platform's
// Stripe subscriptions (/api/admin/dashboard, platform-owner only on the server) and the real
// plans manager. The made-up MRR, payments, failed payments and coupons are gone.

const billing = readFileSync("src/components/admin/sections/BillingSection.tsx", "utf8");

test("no sample data: none of the browser-stored sample stores are read", () => {
  assert.doesNotMatch(billing, /useCoupons|usePayments|useTenants|@\/lib\/stores/);
  assert.doesNotMatch(billing, /Failed Payments|Active Coupons|New coupon|Payments \(30d\)/);
});

test("MRR and subscriptions come from the real, server-checked admin endpoint", () => {
  assert.match(billing, /fetch\("\/api\/admin\/dashboard"/);
  assert.match(billing, /mrrCents: body\.data\.mrrCents/);
  assert.match(billing, /activeSubscriptions: body\.data\.activeSubscriptions/);
  // A failed load says so instead of showing a made-up or zero figure.
  assert.match(billing, /status === "error" \? "Unavailable"/);
  // The endpoint itself requires admin console access (Superadmin only).
  assert.match(
    readFileSync("src/routes/api.admin.dashboard.ts", "utf8"),
    /await requireConsoleAccess\(request\);/,
  );
});

test("the real plans manager stays", () => {
  assert.match(billing, /<PlansManager \/>/);
});
