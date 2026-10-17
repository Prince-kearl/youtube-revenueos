import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUBSCRIPTIONS_UNAVAILABLE_MESSAGE,
  billingErrorMessage,
  planCheckoutState,
} from "../src/lib/billing-availability";
import { CheckoutUnavailableNotice } from "../src/components/CheckoutUnavailableNotice";
import { planNotice, type WorkspaceAccess } from "../src/lib/plan-notice";

// While Stripe checkout is unavailable (production with a test key, or no key — the server answers
// stripeConfigured: false and STRIPE_NOT_CONFIGURED), a creator is told so plainly: no developer
// instructions, no plan button that only fails, no invitation to start a trial. With checkout
// available, everything reads exactly as before. The server's rules are untouched.

const source = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// ---------- the Billing page ----------

test("the STRIPE_NOT_CONFIGURED message is customer-facing", () => {
  assert.equal(
    billingErrorMessage("STRIPE_NOT_CONFIGURED"),
    "Subscriptions aren't available yet. Please check back soon or contact support.",
  );
  assert.equal(SUBSCRIPTIONS_UNAVAILABLE_MESSAGE, billingErrorMessage("STRIPE_NOT_CONFIGURED"));
  assert.doesNotMatch(billingErrorMessage("STRIPE_NOT_CONFIGURED"), /api key|stripe|set up/i);
  // The other messages are unchanged.
  assert.equal(
    billingErrorMessage("SUBSCRIPTION_EXISTS"),
    "You already have a subscription. Use Manage billing to change or renew it.",
  );
  assert.equal(
    billingErrorMessage("STRIPE_CHECKOUT_FAILED"),
    "We couldn't start checkout. Please try again.",
  );
  assert.equal(billingErrorMessage("ANYTHING_ELSE"), "Something went wrong. Try again.");
});

test("plan buttons are disabled — with the reason shown — while checkout is unavailable", () => {
  for (const available of [true, false])
    for (const checkingOut of [true, false])
      assert.deepEqual(
        planCheckoutState({ available }, { stripeConfigured: false, checkingOut }),
        { disabled: true, note: "New subscriptions aren't available yet." },
        `available=${available} checkingOut=${checkingOut}`,
      );
});

test("with checkout available, plan selection works exactly as before", () => {
  assert.deepEqual(
    planCheckoutState({ available: true }, { stripeConfigured: true, checkingOut: false }),
    {
      disabled: false,
      note: null,
    },
  );
  assert.deepEqual(
    planCheckoutState({ available: true }, { stripeConfigured: true, checkingOut: true }),
    {
      disabled: true,
      note: null,
    },
  );
  assert.deepEqual(
    planCheckoutState({ available: false }, { stripeConfigured: true, checkingOut: false }),
    {
      disabled: true,
      note: "Not available for checkout yet.",
    },
  );
});

test("the unavailable banner explains it and offers the support address", () => {
  const html = renderToStaticMarkup(
    createElement(CheckoutUnavailableNotice, { contactEmail: "help@example.com" }),
  );
  assert.match(html, /New subscriptions aren(&#x27;|')t available yet\./);
  assert.match(html, /Plan selection is turned off/);
  assert.match(html, /Please check back soon/);
  const text = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /data|safe|kept|restor/i, "no retention promise");
  assert.match(html, /href="mailto:help@example\.com"/);
  assert.match(html, /role="status"/);
  // Without a configured address it still says how to get help.
  const fallback = renderToStaticMarkup(createElement(CheckoutUnavailableNotice, {}));
  assert.match(fallback, /or contact support\./);
  assert.doesNotMatch(fallback, /mailto:/);
});

test("the Billing page uses all of it, and only while checkout is unavailable", () => {
  const page = source("src/routes/billing.tsx");
  assert.match(
    page,
    /\{!data\.stripeConfigured && \(\s*<CheckoutUnavailableNotice contactEmail=\{content\.contactEmail\} \/>/,
  );
  assert.match(
    page,
    /planCheckoutState\(p, \{\s*stripeConfigured: data\.stripeConfigured,\s*checkingOut: isCheckingOut,\s*\}\)/,
  );
  assert.match(page, /disabled=\{checkoutState\.disabled\}/);
  assert.match(page, /\{hasPrice && checkoutState\.note && \(/);
  assert.match(page, /billingErrorMessage\(/);
  // The trial line is shown only when a trial can actually be started.
  assert.match(
    page,
    /\{data\.stripeConfigured && \(\s*<p[^>]*>\s*Your first subscription starts with a 14-day free trial/,
  );
  // No developer instruction is left anywhere a customer can see it.
  for (const dir of ["src/routes", "src/components", "src/lib"])
    for (const name of readdirSync(dir).filter((n) => /\.tsx?$/.test(n)))
      assert.doesNotMatch(source(`${dir}/${name}`), /add Stripe API keys/i, `${dir}/${name}`);
});

// ---------- the paywall notice ----------

const owner = (extra: Partial<WorkspaceAccess> = {}): WorkspaceAccess => ({
  plan: null,
  status: null,
  source: "none",
  periodEnd: null,
  isOwner: true,
  ...extra,
});
const NOW = new Date("2026-10-25T00:00:00Z");

test("paywall: while checkout is unavailable, an owner is not invited to start a trial", () => {
  const notice = planNotice(owner(), NOW, { checkoutAvailable: false })!;
  assert.equal(notice.title, "Your workspace doesn't have an active subscription");
  assert.match(notice.body, /Subscription payments aren't available yet/);
  assert.match(notice.body, /check back soon or contact support/);
  assert.doesNotMatch(notice.body, /data|kept|comes back|restor/i, "no retention promise");
  assert.doesNotMatch(notice.body, /trial|Choose a plan/i);
  assert.equal(notice.action, null, "no button to a checkout that cannot start");
});

test("paywall: with checkout available (or not stated), the notice and its trial invitation are unchanged", () => {
  const unchanged = {
    tone: "warning",
    title: "Your workspace doesn't have an active subscription",
    body: "Choose a plan to use Tubify's analytics, revenue tools and AI — a first subscription starts with a 14-day free trial. Your data is kept and comes back as soon as a plan is active.",
    action: { label: "View plans", to: "/billing" },
  };
  assert.deepEqual(planNotice(owner(), NOW), unchanged);
  assert.deepEqual(planNotice(owner(), NOW, { checkoutAvailable: true }), unchanged);
  assert.deepEqual(planNotice(owner(), NOW, {}), unchanged);
});

test("transition: the access period and its end date are unchanged; only the trial invitation goes", () => {
  const access = owner({
    source: "transition",
    plan: "scale",
    status: "active",
    periodEnd: "2026-11-03T15:00:00.000Z",
  });
  const available = planNotice(access, NOW)!;
  assert.equal(available.title, "Your current access continues until Nov 3, 2026, 15:00 UTC");
  assert.equal(
    available.body,
    "Tubify now has paid plans. Choose a plan before then to keep using paid features — a first subscription starts with a 14-day free trial. After that date a subscription is required. Your data is kept either way.",
  );
  assert.deepEqual(available.action, { label: "View plans", to: "/billing" });

  const unavailable = planNotice(access, NOW, { checkoutAvailable: false })!;
  assert.equal(unavailable.title, available.title, "the same date, the same access");
  assert.equal(unavailable.tone, "info");
  assert.match(unavailable.body, /subscription payments aren't available yet/);
  assert.match(unavailable.body, /After that date a subscription is required/);
  assert.doesNotMatch(unavailable.body, /data|kept|restor/i, "no retention promise");
  assert.doesNotMatch(unavailable.body, /trial/);
  assert.equal(unavailable.action, null);
});

test("notices that never invite a purchase are the same either way", () => {
  const cases: WorkspaceAccess[] = [
    owner({ isOwner: false }),
    owner({
      source: "transition",
      plan: "scale",
      status: "active",
      periodEnd: "2026-11-03T15:00:00.000Z",
      isOwner: false,
    }),
    owner({
      plan: "pro",
      status: "trialing",
      source: "subscription",
      periodEnd: "2026-11-01T00:00:00Z",
    }),
    owner({ plan: "scale", status: "active", source: "subscription" }),
    owner({ source: "unavailable" }),
  ];
  for (const access of cases)
    assert.deepEqual(
      planNotice(access, NOW, { checkoutAvailable: false }),
      planNotice(access, NOW),
      JSON.stringify(access),
    );
});

test("the notice component passes the server's checkout availability through", () => {
  const component = source("src/components/SubscriptionNotice.tsx");
  assert.match(component, /checkoutAvailable: body\.data\?\.stripeConfigured !== false/);
});
