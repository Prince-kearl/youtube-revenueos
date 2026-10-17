import {
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  grantPlan,
  uuid,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

// Stripe test mode can never buy a plan in production (src/lib/server/stripe-mode.ts). A test-mode
// subscription is paid with a test card. In production:
//   * checkout and the portal run only with a LIVE key — with a test key nothing is sent to Stripe;
//   * a test-mode webhook event is acknowledged (200, no retries) and nothing is read or written;
//   * stored subscriptions grant a plan or team management only while the key is live — and an
//     eligible workspace keeps its existing-customer transition meanwhile.
// Outside production (local development, Vercel previews) test mode works exactly as before.
// Every Stripe answer here is a local stub: no session, charge or webhook is real.

const env = (globalThis as Record<string, unknown>).__env__ as Record<string, string | undefined>;
const SECRET = "whsec_live_mode_tests";
env.STRIPE_WEBHOOK_SECRET = SECRET;

const mode = await import("../src/lib/server/stripe-mode");
const routes = {
  checkout: await import("../src/routes/api.billing.checkout"),
  portal: await import("../src/routes/api.billing.portal"),
  subscription: await import("../src/routes/api.billing.subscription"),
  webhook: await import("../src/routes/api.stripe.webhook"),
  affiliate: await import("../src/routes/api.affiliate.summary"),
  adminWorkspaces: await import("../src/routes/api.admin.workspaces"),
  adminDashboard: await import("../src/routes/api.admin.dashboard"),
  commandCenter: await import("../src/routes/api.revenue.command-center"),
  members: await import("../src/routes/api.workspace.members"),
};

const TEST_KEY = "sk_test_example";
const LIVE_KEY = "sk_live_example";

/** Runs `body` with these deployment variables, then restores them. */
async function withEnv(vars: Record<string, string | undefined>, body: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = env[key];
  for (const [key, value] of Object.entries(vars))
    if (value === undefined) delete env[key];
    else env[key] = value;
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete env[key];
      else env[key] = value;
  }
}
const PRODUCTION_TEST = { VERCEL: "1", VERCEL_ENV: "production", STRIPE_SECRET_KEY: TEST_KEY };
const PRODUCTION_LIVE = { VERCEL: "1", VERCEL_ENV: "production", STRIPE_SECRET_KEY: LIVE_KEY };
const PREVIEW_TEST = { VERCEL: "1", VERCEL_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY };

function world() {
  const w: World = emptyWorld();
  w.features.push({ id: "feature-links", key: "link_tracking", is_active: true });
  const owner = addUser(w, "owner@x.test");
  const editor = addUser(w, "editor@x.test");
  const ws = addWorkspace(w, owner);
  addMember(w, ws, editor, "editor");
  Object.assign(
    w.profiles.find((p) => p.id === owner)!,
    {
      email: "owner@x.test",
      // One customer id per mode (migration 202610170001): live, and test.
      stripe_customer_id: "cus_1",
      stripe_test_customer_id: "cus_test_1",
    },
  );
  const rows = w as unknown as Record<string, Array<Record<string, unknown>>>;
  const planId = uuid();
  const price = {
    id: uuid(),
    plan_id: planId,
    billing_interval: "month",
    amount_cents: 19900,
    currency: "usd",
    stripe_price_id: "price_scale_month",
    is_active: true,
  };
  rows.plans = [
    {
      id: planId,
      name: "Scale",
      slug: "scale",
      description: null,
      currency: "usd",
      features: [],
      limits: {},
      is_active: true,
      is_public: true,
      sort_order: 2,
      stripe_product_id: "prod_scale",
      plan_prices: [price],
    },
  ];
  rows.plan_prices = [price];
  rows.youtube_channels = [];
  const stripe = {
    calls: [] as string[],
    /** Every request sent to Stripe: its path, query and form body. */
    requests: [] as string[],
    subscriptionLivemode: true as boolean | undefined,
  };
  w.external = (url, init) => {
    if (url.origin !== "https://api.stripe.com") return undefined;
    stripe.calls.push(`${init.method} ${url.pathname}`);
    stripe.requests.push(`${init.method} ${url.pathname}${url.search} ${init.body ?? ""}`);
    if (url.pathname === "/v1/subscriptions" && init.method === "GET")
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (url.pathname === "/v1/checkout/sessions")
      return new Response(JSON.stringify({ id: "cs", url: "https://checkout.stripe.com/c/cs" }), {
        status: 200,
      });
    if (url.pathname === "/v1/billing_portal/sessions")
      return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/s" }), {
        status: 200,
      });
    if (url.pathname === "/v1/subscriptions/sub_1")
      return new Response(
        JSON.stringify({
          id: "sub_1",
          status: "active",
          customer: "cus_1",
          current_period_end: 1_900_000_000,
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_scale_month" } }] },
          metadata: { user_id: owner },
          ...(stripe.subscriptionLivemode === undefined
            ? {}
            : { livemode: stripe.subscriptionLivemode }),
        }),
        { status: 200 },
      );
    return undefined;
  };
  return { w, owner, editor, ws, rows, stripe };
}
type F = ReturnType<typeof world>;

const checkout = (f: F) =>
  callTeamApi(routes.checkout, f.w, {
    as: f.owner,
    method: "POST",
    path: "/api/billing/checkout",
    body: { planId: "scale", interval: "month" },
  });
const portal = (f: F) =>
  callTeamApi(routes.portal, f.w, { as: f.owner, method: "POST", path: "/api/billing/portal" });
const paid = (f: F, who = f.owner) =>
  callTeamApi(routes.commandCenter, f.w, {
    as: who,
    method: "GET",
    path: "/api/revenue/command-center",
  });
const invite = (f: F) =>
  callTeamApi(routes.members, f.w, {
    as: f.owner,
    method: "POST",
    path: "/api/workspace/members",
    body: { email: "new@x.test", role: "editor" },
  });
function deliver(f: F, livemode: boolean | undefined) {
  const event: Record<string, unknown> = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        client_reference_id: f.owner,
        customer: "cus_1",
        subscription: "sub_1",
        customer_email: null,
      },
    },
  };
  if (livemode !== undefined) event.livemode = livemode;
  const at = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return callTeamApi(routes.webhook, f.w, {
    as: null,
    method: "POST",
    path: "/api/stripe/webhook",
    body: event,
    headers: {
      "stripe-signature": `t=${at},v1=${createHmac("sha256", SECRET).update(`${at}.${body}`).digest("hex")}`,
    },
  });
}

// ---------- the policy ----------

test("mode: key prefixes, the production deployment (failing closed) and livemode", async () => {
  assert.equal(mode.stripeKeyMode("sk_live_abc"), "live");
  assert.equal(mode.stripeKeyMode("rk_live_abc"), "live");
  assert.equal(mode.stripeKeyMode("sk_test_abc"), "test");
  assert.equal(mode.stripeKeyMode("rk_test_abc"), "test");
  for (const key of ["", undefined, "pk_live_abc", "live_sk_abc", "sk_livex"])
    assert.equal(mode.stripeKeyMode(key), "unknown", String(key));
  await withEnv({ VERCEL: undefined, VERCEL_ENV: undefined }, () => {
    assert.equal(mode.isProductionDeployment(), false, "local development");
  });
  await withEnv({ VERCEL: "1", VERCEL_ENV: "preview" }, () => {
    assert.equal(mode.isProductionDeployment(), false);
  });
  await withEnv({ VERCEL: "1", VERCEL_ENV: "development" }, () => {
    assert.equal(mode.isProductionDeployment(), false);
  });
  await withEnv({ VERCEL: "1", VERCEL_ENV: "production" }, () => {
    assert.equal(mode.isProductionDeployment(), true);
    assert.equal(mode.livemodeAccepted(true), true);
    for (const value of [false, undefined, null, "true", 1])
      assert.equal(mode.livemodeAccepted(value), false, String(value));
  });
  await withEnv({ VERCEL: "1", VERCEL_ENV: undefined }, () => {
    assert.equal(mode.isProductionDeployment(), true, "on Vercel without a known env: production");
  });
  for (const environment of ["staging", "Production", "prod", " production"])
    await withEnv({ VERCEL: "1", VERCEL_ENV: environment }, () => {
      assert.equal(mode.isProductionDeployment(), true, `unrecognised VERCEL_ENV ${environment}`);
    });
  await withEnv({ VERCEL: undefined, VERCEL_ENV: "production" }, () => {
    assert.equal(mode.isProductionDeployment(), true, "VERCEL_ENV production alone suffices");
  });
  await withEnv({ VERCEL: undefined, VERCEL_ENV: "staging" }, () => {
    // Outside a production build (this suite) with no Vercel signal: not production.
    assert.equal(mode.isProductionDeployment(), false);
  });
  await withEnv({ VERCEL: "1", VERCEL_ENV: "preview" }, () => {
    assert.equal(mode.livemodeAccepted(false), true, "a preview accepts test mode");
  });
  await withEnv({ ...PRODUCTION_LIVE, STRIPE_SECRET_KEY: "not-a-key" }, () => {
    assert.equal(mode.stripeModeAllowed(), false, "an unrecognised key fails closed");
  });
  await withEnv({ ...PRODUCTION_LIVE, STRIPE_SECRET_KEY: undefined }, () => {
    assert.equal(mode.storedSubscriptionsTrusted(), false, "no key fails closed");
  });
});

// ---------- checkout and portal ----------

test("production with a test key: no checkout or portal session is ever created", async () => {
  await withEnv(PRODUCTION_TEST, async () => {
    const f = world();
    const c = await checkout(f);
    assert.equal(c.status, 503);
    assert.equal(c.body.error, "STRIPE_NOT_CONFIGURED");
    const p = await portal(f);
    assert.equal(p.status, 503);
    assert.equal(p.body.error, "STRIPE_NOT_CONFIGURED");
    assert.deepEqual(f.stripe.calls, [], "nothing was sent to Stripe");
    const sub = await callTeamApi(routes.subscription, f.w, {
      as: f.owner,
      method: "GET",
      path: "/api/billing/subscription",
    });
    assert.equal(sub.body.data.stripeConfigured, false, "the billing page says checkout is off");
  });
});

test("production with a live key, and previews with a test key, keep checkout and portal working", async () => {
  for (const vars of [PRODUCTION_LIVE, PREVIEW_TEST])
    await withEnv(vars, async () => {
      const f = world();
      assert.equal((await checkout(f)).status, 200, vars.VERCEL_ENV);
      assert.equal((await portal(f)).status, 200, vars.VERCEL_ENV);
      assert.ok(f.stripe.calls.includes("POST /v1/checkout/sessions"));
    });
});

// ---------- the webhook ----------

const subscriptionsOf = (f: F) => f.w.subscriptions.filter((s) => s.user_id === f.owner);

test("production: a test-mode event is acknowledged (200, no retry) and nothing is read or written", async () => {
  for (const vars of [PRODUCTION_TEST, PRODUCTION_LIVE])
    await withEnv(vars, async () => {
      for (const livemode of [false, undefined]) {
        const f = world();
        const r = await deliver(f, livemode);
        assert.equal(r.status, 200, `${vars.STRIPE_SECRET_KEY} ${livemode}`);
        assert.deepEqual(r.body, { received: true, ignored: "test_mode" });
        assert.equal(r.writes.length, 0);
        assert.equal(r.reads.length, 0);
        assert.deepEqual(f.stripe.calls, []);
        assert.equal(subscriptionsOf(f).length, 0);
      }
    });
});

test("production: a live event without a live key is a retryable 503, never a silent loss", async () => {
  await withEnv(PRODUCTION_TEST, async () => {
    const f = world();
    const r = await deliver(f, true);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "STRIPE_MODE_MISMATCH");
    assert.equal(r.writes.length, 0);
  });
});

test("production with a live key records live subscriptions — and never a test one Stripe returns", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    const f = world();
    assert.equal((await deliver(f, true)).status, 200);
    assert.equal(subscriptionsOf(f)[0]?.status, "active");
    // A live event whose subscription Stripe reports as test mode (or without the flag): ignored.
    for (const livemode of [false, undefined]) {
      const g = world();
      g.stripe.subscriptionLivemode = livemode;
      const r = await deliver(g, true);
      assert.equal(r.status, 200);
      assert.equal(subscriptionsOf(g).length, 0, String(livemode));
    }
  });
});

test("previews still record test-mode subscriptions", async () => {
  await withEnv(PREVIEW_TEST, async () => {
    const f = world();
    f.stripe.subscriptionLivemode = false;
    assert.equal((await deliver(f, false)).status, 200);
    assert.equal(subscriptionsOf(f)[0]?.status, "active");
  });
});

// ---------- stored subscriptions and entitlements ----------

test("production with a test key: a stored subscription grants no plan, no team management and is not shown", async () => {
  await withEnv(PRODUCTION_TEST, async () => {
    const f = world();
    grantPlan(f.w, f.owner, "scale"); // an "active" Scale record — necessarily test mode here
    const r = await paid(f);
    assert.equal(r.status, 402);
    assert.equal(r.body.error, "SUBSCRIPTION_REQUIRED");
    const team = await invite(f);
    assert.equal(team.status, 403);
    assert.equal(team.body.error, "PLAN_REQUIRED");
    const sub = await callTeamApi(routes.subscription, f.w, {
      as: f.owner,
      method: "GET",
      path: "/api/billing/subscription",
    });
    assert.equal(sub.body.data.subscription, null);
    assert.equal(sub.body.data.access.source, "none");
  });
});

test("production with a live key, and previews, honour stored subscriptions of their own mode as before", async () => {
  for (const vars of [PRODUCTION_LIVE, PREVIEW_TEST])
    await withEnv(vars, async () => {
      const f = world();
      grantPlan(f.w, f.owner, "scale", "active", vars === PRODUCTION_LIVE);
      assert.equal((await paid(f)).status, 200, vars.VERCEL_ENV);
      assert.equal((await paid(f, f.editor)).status, 200, "the member inherits it");
    });
});

test("production with a test key: an eligible workspace keeps its transition despite a test record", async () => {
  const start = new Date(Date.now() - 3 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await withEnv({ ...PRODUCTION_TEST, PAYWALL_TRANSITION_START: start }, async () => {
    const f = world();
    f.w.workspaces.find((w) => w.id === f.ws)!.created_at = "2026-09-15T00:00:00Z";
    grantPlan(f.w, f.owner, "scale"); // a test-mode record must not hide the transition
    const r = await paid(f);
    assert.equal(r.status, 200, r.text);
    const sub = await callTeamApi(routes.subscription, f.w, {
      as: f.owner,
      method: "GET",
      path: "/api/billing/subscription",
    });
    assert.equal(sub.body.data.access.source, "transition");
    assert.equal(
      sub.body.data.access.periodEnd,
      new Date(Date.parse(start) + 14 * 86_400_000).toISOString(),
    );
    // …and the transition still never brings team management.
    const team = await invite(f);
    assert.equal(team.status, 403);
    assert.equal(team.body.error, "PLAN_REQUIRED");
  });
});

test("hidden Vercel variables: a production build alone is treated as production", () => {
  // Vercel exposes VERCEL and VERCEL_ENV only while its system-variable setting is on. The fallback
  // that keeps production closed without them is the build-time flag Vite inlines — this suite runs
  // without Vite, so the built server is checked separately; here, that the fallback stays wired.
  const source = readFileSync("src/lib/server/stripe-mode.ts", "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /return import\.meta\.env\?\.PROD === true;/);
  assert.match(source, /return getServerEnv\("VERCEL"\) === "1" \|\| isProductionBuild\(\);/);
});

// ---------- stored records carry their mode (migration 202610170001) ----------
//
// subscriptions.livemode and referral_commissions.livemode hold the mode Stripe reported, and
// customer ids live in one column per mode. A record counts only when its mode is exactly the mode
// this deployment bills in; a NULL (unclassified) record never counts.

/** Sends a signed webhook event exactly as given. */
function send(f: F, event: Record<string, unknown>) {
  const at = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return callTeamApi(routes.webhook, f.w, {
    as: null,
    method: "POST",
    path: "/api/stripe/webhook",
    body: event,
    headers: {
      "stripe-signature": `t=${at},v1=${createHmac("sha256", SECRET).update(`${at}.${body}`).digest("hex")}`,
    },
  });
}
const billingStatus = (f: F) =>
  callTeamApi(routes.subscription, f.w, {
    as: f.owner,
    method: "GET",
    path: "/api/billing/subscription",
  });
const profileOf = (f: F, id = f.owner) => f.w.profiles.find((p) => p.id === id)!;
/** A Scale subscription row for the owner with exactly this livemode (undefined: no field). */
function recordSubscription(f: F, livemode: boolean | null | undefined, extra = {}) {
  grantPlan(f.w, f.owner, "scale", "active", livemode ?? null);
  const row = f.w.subscriptions[f.w.subscriptions.length - 1];
  if (livemode === undefined) delete row.livemode;
  Object.assign(row, extra);
  return row;
}

test("mode policy: which stored records count, which customer column is used", async () => {
  await withEnv(PRODUCTION_LIVE, () => assert.equal(mode.trustedLivemode(), true));
  await withEnv(PRODUCTION_TEST, () => assert.equal(mode.trustedLivemode(), null, "none count"));
  await withEnv({ ...PRODUCTION_LIVE, STRIPE_SECRET_KEY: undefined }, () =>
    assert.equal(mode.trustedLivemode(), null),
  );
  await withEnv({ ...PRODUCTION_LIVE, STRIPE_SECRET_KEY: "not-a-key" }, () =>
    assert.equal(mode.trustedLivemode(), null),
  );
  await withEnv(PREVIEW_TEST, () => assert.equal(mode.trustedLivemode(), false));
  await withEnv({ ...PREVIEW_TEST, STRIPE_SECRET_KEY: LIVE_KEY }, () =>
    assert.equal(mode.trustedLivemode(), true, "a preview with a live key counts live records"),
  );
  await withEnv({ VERCEL: undefined, VERCEL_ENV: undefined, STRIPE_SECRET_KEY: undefined }, () =>
    assert.equal(mode.trustedLivemode(), false, "local development: test records"),
  );
  assert.equal(mode.customerIdColumn(true), "stripe_customer_id");
  assert.equal(mode.customerIdColumn(false), "stripe_test_customer_id");
  assert.equal(mode.reportedLivemode({ livemode: true }), true);
  assert.equal(mode.reportedLivemode({ livemode: false }), false);
  for (const value of [undefined, null, "true", 1, 0])
    assert.equal(mode.reportedLivemode({ livemode: value }), null, String(value));
});

test("production: only a subscription marked livemode = true grants a plan, team management or a billing status", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    for (const livemode of [false, null, undefined]) {
      const f = world();
      recordSubscription(f, livemode);
      const label = String(livemode);
      const r = await paid(f);
      assert.equal(r.status, 402, label);
      assert.equal(r.body.error, "SUBSCRIPTION_REQUIRED", label);
      assert.equal((await paid(f, f.editor)).status, 402, `${label}: nor for a member`);
      const team = await invite(f);
      assert.equal(team.status, 403, label);
      assert.equal(team.body.error, "PLAN_REQUIRED", label);
      assert.equal(team.invitesSent.length, 0, label);
      const status = await billingStatus(f);
      assert.equal(status.body.data.subscription, null, label);
      assert.equal(status.body.data.access.source, "none", label);
    }
    const f = world();
    recordSubscription(f, true);
    assert.equal((await paid(f)).status, 200);
    assert.equal((await paid(f, f.editor)).status, 200, "the member inherits it");
    const team = await invite(f);
    assert.equal(team.status, 201, team.text);
    const status = await billingStatus(f);
    assert.equal(status.body.data.subscription.plan_id, "scale");
    assert.equal(status.body.data.access.source, "subscription");
  });
});

test("previews count test-mode records only: a live or unclassified one grants nothing there", async () => {
  await withEnv(PREVIEW_TEST, async () => {
    for (const [livemode, expected] of [
      [true, 402],
      [null, 402],
      [undefined, 402],
      [false, 200],
    ] as const) {
      const f = world();
      recordSubscription(f, livemode);
      assert.equal((await paid(f)).status, expected, String(livemode));
    }
  });
});

test("production: a newer test record never hides or replaces the live plan", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    const f = world();
    grantPlan(f.w, f.owner, "pro", "active", true); // created 2026-01-01
    addSubscription(f.w, f.owner, "scale", "active", "2026-09-01T00:00:00Z", false);
    addSubscription(f.w, f.owner, "scale", "active", "2026-09-02T00:00:00Z", null);
    const status = await billingStatus(f);
    assert.equal(status.body.data.access.plan, "pro");
    assert.equal(status.body.data.subscription.plan_id, "pro");
    // Team management is Scale-only: the newer test-mode Scale record does not unlock it.
    const team = await invite(f);
    assert.equal(team.status, 403);
    assert.equal(team.body.error, "PLAN_REQUIRED");
  });
});

test("existing records at Checkout (live key): a test record neither blocks nor uses the trial; an unclassified one uses the trial", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    const testMode = world();
    recordSubscription(testMode, false);
    const a = await checkout(testMode);
    assert.equal(a.status, 200, a.text);
    assert.equal(a.body.data.trialDays, 14, "a test-mode history leaves the live trial");

    const unclassified = world();
    recordSubscription(unclassified, null);
    const b = await checkout(unclassified);
    assert.equal(b.status, 200, "an unclassified record does not block a live purchase");
    assert.equal(b.body.data.trialDays, 0, "…but, unverified, it is not a reason for a new trial");

    const live = world();
    recordSubscription(live, true);
    const c = await checkout(live);
    assert.equal(c.status, 409, "a live subscription still blocks a second one");
    assert.ok(!live.stripe.calls.includes("POST /v1/checkout/sessions"));
  });
});

test("customer ids: production never sends a test customer id to Stripe, previews never send a live one", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    // Only a test customer on file: as if there were none.
    const f = world();
    profileOf(f).stripe_customer_id = null;
    const p = await portal(f);
    assert.equal(p.status, 404);
    assert.equal(p.body.error, "NO_STRIPE_CUSTOMER");
    assert.deepEqual(f.stripe.calls, [], "the portal sent nothing to Stripe");
    assert.equal((await checkout(f)).status, 200);
    assert.ok(!f.stripe.requests.some((r) => r.includes("cus_test_1")), "never the test id");
    assert.ok(!f.stripe.calls.includes("GET /v1/subscriptions"), "no listing for it either");
    const session = f.stripe.requests.find((r) => r.startsWith("POST /v1/checkout/sessions"))!;
    assert.match(session, /customer_email=owner%40x\.test/);

    // Both on file: the live one, only.
    const g = world();
    assert.equal((await portal(g)).status, 200);
    assert.equal((await checkout(g)).status, 200);
    assert.ok(g.stripe.requests.some((r) => r.includes("customer=cus_1")));
    assert.ok(!g.stripe.requests.some((r) => r.includes("cus_test_1")));
  });
  await withEnv(PREVIEW_TEST, async () => {
    const f = world();
    assert.equal((await portal(f)).status, 200);
    assert.equal((await checkout(f)).status, 200);
    assert.ok(f.stripe.requests.some((r) => r.includes("customer=cus_test_1")));
    assert.ok(!f.stripe.requests.some((r) => /customer=cus_1\b/.test(r)), "never the live id");
  });
});

test("webhook: records the mode Stripe reported, and each customer id in its own mode's column", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    const f = world();
    profileOf(f).stripe_customer_id = null;
    const r = await deliver(f, true);
    assert.equal(r.status, 200, r.text);
    assert.equal(subscriptionsOf(f)[0].livemode, true);
    assert.equal(profileOf(f).stripe_customer_id, "cus_1");
    assert.equal(profileOf(f).stripe_test_customer_id, "cus_test_1", "the test id is untouched");
    assert.ok(
      r.writes.filter((w) => w.table === "profiles").every((w) => w.as === "service"),
      "customer ids are written by the service role only",
    );
  });
  await withEnv(PREVIEW_TEST, async () => {
    // A preview sharing the database: its test checkout cannot overwrite the live customer id.
    const testCheckout = (who: F) => ({
      id: "evt_preview",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_p",
          client_reference_id: who.owner,
          customer: "cus_test_2",
          subscription: "sub_1",
          customer_email: null,
        },
      },
    });
    const f = world();
    f.stripe.subscriptionLivemode = false;
    assert.equal((await send(f, testCheckout(f))).status, 200);
    assert.equal(profileOf(f).stripe_customer_id, "cus_1", "the live id is kept");
    assert.equal(profileOf(f).stripe_test_customer_id, "cus_test_2");
    assert.equal(subscriptionsOf(f)[0].livemode, false);

    // A subscription Stripe returns without a mode is recorded unclassified — and grants nothing.
    const g = world();
    g.stripe.subscriptionLivemode = undefined;
    assert.equal((await send(g, testCheckout(g))).status, 200);
    assert.equal(subscriptionsOf(g)[0].livemode, null);
    assert.equal((await paid(g)).status, 402);
  });
});

test("webhook: an unclassified historical row is classified from Stripe by the next event about it", async () => {
  await withEnv(PRODUCTION_LIVE, async () => {
    const f = world();
    recordSubscription(f, null, { stripe_subscription_id: "sub_1" });
    assert.equal((await paid(f)).status, 402, "unclassified: no access");
    const r = await send(f, {
      id: "evt_update",
      type: "customer.subscription.updated",
      livemode: true,
      data: { object: { id: "sub_1", status: "active", livemode: true } },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(subscriptionsOf(f).length, 1, "the same row, updated");
    assert.equal(subscriptionsOf(f)[0].livemode, true, "as Stripe now reports it");
    assert.equal((await paid(f)).status, 200);
  });
});

test("referral commissions carry the invoice's mode and are matched only by that mode's customer id", async () => {
  const setup = () => {
    const f = world();
    const referrer = addUser(f.w, "referrer@x.test");
    profileOf(f).referred_by = referrer;
    f.rows.referral_commissions = [];
    return { f, referrer };
  };
  const invoice = (customer: string, livemode: boolean | undefined, id = "in_1") => ({
    id: `evt_${id}`,
    type: "invoice.paid",
    livemode: livemode ?? false,
    data: {
      object: {
        id,
        customer,
        subscription: "sub_1",
        amount_paid: 19900,
        currency: "usd",
        status: "paid",
        ...(livemode === undefined ? {} : { livemode }),
      },
    },
  });
  await withEnv(PRODUCTION_LIVE, async () => {
    const { f, referrer } = setup();
    assert.equal((await send(f, invoice("cus_1", true))).status, 200);
    assert.equal(f.rows.referral_commissions.length, 1);
    assert.equal(f.rows.referral_commissions[0].livemode, true);
    assert.equal(f.rows.referral_commissions[0].referrer_id, referrer);
    // A live event whose invoice Stripe marks as test mode: not attributed in production.
    const { f: g } = setup();
    const odd = invoice("cus_test_1", false, "in_odd");
    odd.livemode = true;
    assert.equal((await send(g, odd)).status, 200);
    assert.equal(g.rows.referral_commissions.length, 0);
  });
  await withEnv(PREVIEW_TEST, async () => {
    const { f } = setup();
    // A test invoice naming the LIVE customer id matches nobody: ids are looked up per mode.
    assert.equal((await send(f, invoice("cus_1", false, "in_a"))).status, 200);
    assert.equal(f.rows.referral_commissions.length, 0);
    assert.equal((await send(f, invoice("cus_test_1", false, "in_b"))).status, 200);
    assert.equal(f.rows.referral_commissions.length, 1);
    assert.equal(f.rows.referral_commissions[0].livemode, false);
    // An invoice without a mode is not attributed at all.
    const r = await send(f, invoice("cus_test_1", undefined, "in_c"));
    assert.equal(r.status, 200);
    assert.equal(f.rows.referral_commissions.length, 1);
    assert.ok(r.logs.some((entry) => String(entry[0]).includes("without a livemode flag")));
  });
});

test("affiliate earnings count only commissions of this deployment's mode", async () => {
  const setup = () => {
    const f = world();
    f.w.features.push({ id: "feature-affiliate", key: "affiliate", is_active: true });
    const referrer = addUser(f.w, "referrer@x.test");
    profileOf(f, referrer).referral_code = "ref123";
    const commission = (cents: number, livemode: boolean | null) => ({
      id: uuid(),
      referrer_id: referrer,
      referred_user_id: f.owner,
      stripe_invoice_id: `in_${uuid()}`,
      amount_cents: cents * 5,
      commission_cents: cents,
      currency: "usd",
      status: "pending",
      livemode,
      created_at: "2026-10-01T00:00:00Z",
    });
    f.rows.referral_commissions = [
      commission(3980, true),
      commission(1000, false),
      commission(500, null),
    ];
    return { f, referrer };
  };
  for (const [vars, expected] of [
    [PRODUCTION_LIVE, 3980],
    [PRODUCTION_TEST, 0],
    [PREVIEW_TEST, 1000],
  ] as const)
    await withEnv(vars, async () => {
      const { f, referrer } = setup();
      const r = await callTeamApi(routes.affiliate, f.w, {
        as: referrer,
        method: "GET",
        path: "/api/affiliate/summary",
      });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.data.totalEarningsCents, expected, vars.STRIPE_SECRET_KEY);
      assert.equal(r.body.data.pendingPayoutCents, expected);
    });
});

test("admin totals and workspace plans count only this deployment's mode", async () => {
  const setup = () => {
    const f = world();
    const admin = addUser(f.w, "admin@x.test", "superadmin");
    const row = (livemode: boolean | null, createdAt: string) => ({
      id: uuid(),
      user_id: f.owner,
      stripe_subscription_id: `sub_${uuid()}`,
      stripe_price_id: "price_scale_month",
      plan_id: "scale",
      billing_interval: "month",
      status: "active",
      livemode,
      created_at: createdAt,
    });
    f.w.subscriptions.push(
      row(true, "2026-08-01T00:00:00Z"),
      row(false, "2026-09-01T00:00:00Z"),
      row(null, "2026-09-02T00:00:00Z"),
    );
    f.rows.projects = [];
    f.rows.youtube_quota_events = [];
    return { f, admin };
  };
  for (const [vars, mrr, count, label] of [
    [PRODUCTION_LIVE, 19900, 1, "live"],
    [PRODUCTION_TEST, 0, 0, "none"],
    [PREVIEW_TEST, 19900, 1, "test"],
  ] as const)
    await withEnv(vars, async () => {
      const { f, admin } = setup();
      const dashboard = await callTeamApi(routes.adminDashboard, f.w, {
        as: admin,
        method: "GET",
        path: "/api/admin/dashboard",
      });
      assert.equal(dashboard.status, 200, dashboard.text);
      assert.equal(dashboard.body.data.mrrCents, mrr, label);
      assert.equal(dashboard.body.data.activeSubscriptions, count, label);
      assert.equal(dashboard.body.data.subscriptionMode, label);
      const workspaces = await callTeamApi(routes.adminWorkspaces, f.w, {
        as: admin,
        method: "GET",
        path: "/api/admin/workspaces",
      });
      assert.equal(workspaces.status, 200, workspaces.text);
      const mine = (workspaces.body.data as Array<Record<string, unknown>>).find(
        (w) => w.id === f.ws,
      )!;
      assert.equal(mine.mrrCents, mrr, label);
      assert.equal(mine.planName, mrr ? "Scale" : null, label);
    });
});

test("production with a live key: an eligible workspace keeps its transition despite test or unclassified records", async () => {
  const start = new Date(Date.now() - 3 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await withEnv({ ...PRODUCTION_LIVE, PAYWALL_TRANSITION_START: start }, async () => {
    for (const livemode of [false, null]) {
      const f = world();
      f.w.workspaces.find((w) => w.id === f.ws)!.created_at = "2026-09-15T00:00:00Z";
      recordSubscription(f, livemode);
      assert.equal((await paid(f)).status, 200, String(livemode));
      const status = await billingStatus(f);
      assert.equal(status.body.data.access.source, "transition", String(livemode));
      assert.equal((await invite(f)).body.error, "PLAN_REQUIRED", "the transition has no team");
    }
    // A workspace created after the start gets nothing from such a record.
    const late = world();
    late.w.workspaces.find((w) => w.id === late.ws)!.created_at = new Date().toISOString();
    recordSubscription(late, false);
    assert.equal((await paid(late)).status, 402);
  });
});

// ---------- the code and the migration, statically ----------

const serverSources = () =>
  ["src/routes", "src/lib/server"].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({
        file: `${dir}/${name}`,
        source: readFileSync(`${dir}/${name}`, "utf8").replace(/\r\n/g, "\n"),
      })),
  );

test("every subscription and commission reader filters by mode", () => {
  let readers = 0;
  for (const { file, source } of serverSources())
    for (const table of ["subscriptions", "referral_commissions"]) {
      let at = source.indexOf(`.from("${table}")`);
      while (at >= 0) {
        const chain = source.slice(at, at + 700).split(";")[0];
        const webhookIdentityOrWrite =
          file.endsWith("api.stripe.webhook.ts") &&
          (/\.upsert\(/.test(chain) || /\.eq\("stripe_subscription_id"/.test(chain));
        const checkoutHistory = /\.select\("status, livemode"\)/.test(chain);
        assert.ok(
          webhookIdentityOrWrite || checkoutHistory || /\.eq\("livemode", livemode\)/.test(chain),
          `${file}: a ${table} read without a mode filter`,
        );
        readers++;
        at = source.indexOf(`.from("${table}")`, at + 1);
      }
    }
  assert.ok(readers >= 12, `found ${readers}`);
});

test("customer ids are written only by the webhook", () => {
  const writers = serverSources()
    .filter(({ source }) =>
      /update\(\{[^}]*(stripe_customer_id|stripe_test_customer_id|customerIdColumn)/.test(source),
    )
    .map(({ file }) => file);
  assert.deepEqual(writers, ["src/routes/api.stripe.webhook.ts"]);
});

test("the migration is additive, backfills nothing, and protects profile billing identity in the database", () => {
  const sql = readFileSync(
    "supabase/migrations/202610170001_stripe_livemode_separation.sql",
    "utf8",
  ).replace(/\r\n/g, "\n");
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  // Additive: nullable columns, no constraint on existing rows, no data changed.
  assert.match(
    code,
    /alter table public\.subscriptions add column if not exists livemode boolean;/,
  );
  assert.match(
    code,
    /alter table public\.referral_commissions add column if not exists livemode boolean;/,
  );
  assert.match(
    code,
    /alter table public\.profiles add column if not exists stripe_test_customer_id text unique;/,
  );
  assert.doesNotMatch(code, /not null/i, "no NOT NULL until the rollout is validated");
  assert.doesNotMatch(code, /^\s*(update|delete|truncate|insert)\b/im, "no backfill or cleanup");
  assert.doesNotMatch(code, /\bdrop (table|column)\b/i, "nothing destructive");
  // The safeguard: an invoker trigger with a fixed search_path, executable by nobody.
  assert.match(code, /before insert or update on public\.profiles/);
  assert.match(code, /set search_path = ''/);
  assert.doesNotMatch(code, /security definer/i);
  assert.match(code, /current_user not in \('authenticated', 'anon'\)/);
  assert.match(
    code,
    /new\.stripe_customer_id is distinct from old\.stripe_customer_id\s+or new\.stripe_test_customer_id is distinct from old\.stripe_test_customer_id then\s+raise exception[^;]+using errcode = '42501';/,
  );
  assert.match(code, /new\.stripe_customer_id := null;\s+new\.stripe_test_customer_id := null;/);
  assert.match(
    code,
    /if new\.email is distinct from old\.email and new\.email is distinct from session_email then\s+new\.email := old\.email;/,
  );
  assert.match(
    code,
    /revoke all on function public\.protect_profile_billing_identity\(\) from public, anon, authenticated, service_role;/,
  );
  // The row-level check keeps every column it pinned, and now pins the test customer id too.
  for (const column of [
    "role",
    "stripe_customer_id",
    "stripe_test_customer_id",
    "referral_code",
    "referred_by",
  ])
    assert.match(code, new RegExp(`and ${column} is not distinct from`), column);
});
