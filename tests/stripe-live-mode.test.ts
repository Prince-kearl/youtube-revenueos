import {
  addMember,
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
import { readFileSync } from "node:fs";

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
      stripe_customer_id: "cus_1",
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
  const stripe = { calls: [] as string[], subscriptionLivemode: true as boolean | undefined };
  w.external = (url, init) => {
    if (url.origin !== "https://api.stripe.com") return undefined;
    stripe.calls.push(`${init.method} ${url.pathname}`);
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

test("production with a live key, and previews, honour stored subscriptions as before", async () => {
  for (const vars of [PRODUCTION_LIVE, PREVIEW_TEST])
    await withEnv(vars, async () => {
      const f = world();
      grantPlan(f.w, f.owner, "scale");
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
