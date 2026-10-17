import { addUser, callTeamApi, emptyWorld, uuid, type World } from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";

// POST /api/billing/checkout (src/routes/api.billing.checkout.ts): a new Checkout session always
// creates a new subscription, so it is refused while the caller has one that is live or pending —
// in Tubify's record or in Stripe's — and refused as well when that cannot be established. The
// billing page hiding its plan cards is not the control.

const env = (globalThis as Record<string, unknown>).__env__ as Record<string, string>;
env.STRIPE_SECRET_KEY = "sk_test_key";

const route = await import("../src/routes/api.billing.checkout");

type StripeList = Array<{ id: string; status: string }> | "down";

function world(options: { customer?: string | null } = {}) {
  const w: World = emptyWorld();
  const me = addUser(w, "me@x.test");
  const other = addUser(w, "other@x.test");
  Object.assign(
    w.profiles.find((p) => p.id === me)!,
    {
      email: "me@x.test",
      stripe_customer_id: options.customer ?? null,
    },
  );
  const planId = uuid();
  const rows = w as unknown as Record<string, Array<Record<string, unknown>>>;
  // The plan as the plans query returns it, its prices embedded.
  rows.plans = [
    {
      id: planId,
      name: "Pro",
      slug: "pro",
      description: null,
      currency: "usd",
      features: [],
      limits: {},
      is_active: true,
      is_public: true,
      sort_order: 1,
      stripe_product_id: "prod_pro",
      plan_prices: [
        {
          id: uuid(),
          plan_id: planId,
          billing_interval: "month",
          amount_cents: 7900,
          currency: "usd",
          stripe_price_id: "price_pro_month",
          is_active: true,
        },
      ],
    },
  ];
  const stripe = {
    list: [] as StripeList,
    listed: [] as string[],
    sessionsCreated: [] as string[],
  };
  w.external = (url, init) => {
    if (url.origin !== "https://api.stripe.com") return undefined;
    if (init.method === "GET" && url.pathname === "/v1/subscriptions") {
      stripe.listed.push(url.searchParams.get("customer") ?? "");
      if (stripe.list === "down") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ data: stripe.list }), { status: 200 });
    }
    if (init.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      stripe.sessionsCreated.push("cs");
      return new Response(
        JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }),
        { status: 200 },
      );
    }
    return undefined;
  };
  const subscribe = (userId: string, status: string, id = `sub_${status}`) =>
    w.subscriptions.push({
      id: uuid(),
      user_id: userId,
      stripe_subscription_id: id,
      stripe_price_id: "price_pro_month",
      plan_id: "pro",
      billing_interval: "month",
      status,
      created_at: "2026-10-01T00:00:00Z",
    });
  return { w, me, other, stripe, subscribe };
}
type F = ReturnType<typeof world>;

const checkout = (f: F, as: string | null = f.me) =>
  callTeamApi(route, f.w, {
    as,
    method: "POST",
    path: "/api/billing/checkout",
    body: { planId: "pro", interval: "month" },
  });

test("a first purchase opens Checkout, with no extra Stripe request", async () => {
  const f = world();
  const r = await checkout(f);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.url, "https://checkout.stripe.com/c/cs_1");
  assert.equal(f.stripe.sessionsCreated.length, 1);
  assert.deepEqual(f.stripe.listed, [], "no Stripe customer yet: nothing to ask Stripe");
});

test("a live subscription in Tubify's record refuses Checkout with 409 and 'use Manage billing'", async () => {
  for (const status of ["active", "trialing", "past_due", "unpaid"]) {
    const f = world();
    f.subscribe(f.me, status);
    const r = await checkout(f);
    assert.equal(r.status, 409, status);
    assert.equal(r.body.error, "SUBSCRIPTION_EXISTS", status);
    assert.match(r.body.message, /Manage billing/);
    assert.equal(f.stripe.sessionsCreated.length, 0, `${status}: no second subscription`);
  }
  const pending = world();
  pending.subscribe(pending.me, "incomplete");
  const r = await checkout(pending);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "SUBSCRIPTION_PENDING");
  assert.equal(pending.stripe.sessionsCreated.length, 0);
});

test("a subscription that is over does not block a new one", async () => {
  for (const status of ["canceled", "incomplete_expired"]) {
    const f = world({ customer: "cus_me" });
    f.subscribe(f.me, status);
    f.stripe.list = [{ id: `sub_${status}`, status }];
    const r = await checkout(f);
    assert.equal(r.status, 200, `${status}: ${r.text}`);
    assert.equal(f.stripe.sessionsCreated.length, 1);
  }
});

test("a live subscription only Stripe knows about (a webhook not yet delivered) blocks it too", async () => {
  const f = world({ customer: "cus_me" });
  f.stripe.list = [{ id: "sub_new", status: "active" }];
  const r = await checkout(f);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "SUBSCRIPTION_EXISTS");
  assert.deepEqual(f.stripe.listed, ["cus_me"], "only the caller's own customer is asked about");
  assert.equal(f.stripe.sessionsCreated.length, 0);
  const g = world({ customer: "cus_me" });
  g.stripe.list = [{ id: "sub_paused", status: "paused" }];
  const paused = await checkout(g);
  assert.equal(paused.status, 409);
  assert.equal(paused.body.error, "SUBSCRIPTION_PENDING");
});

test("when the current state cannot be established, Checkout is refused (503), never guessed", async () => {
  const stripeDown = world({ customer: "cus_me" });
  stripeDown.stripe.list = "down";
  const a = await checkout(stripeDown);
  assert.equal(a.status, 503, a.text);
  assert.equal(a.body.error, "BILLING_STATE_UNAVAILABLE");
  assert.equal(stripeDown.stripe.sessionsCreated.length, 0);
  for (const table of ["subscriptions", "profiles"]) {
    const f = world();
    f.w.failingReads = [table];
    const r = await checkout(f);
    assert.equal(r.status, 503, `${table}: ${r.text}`);
    assert.equal(r.body.error, "BILLING_STATE_UNAVAILABLE");
    assert.equal(f.stripe.sessionsCreated.length, 0, table);
  }
});

test("only the caller's own subscriptions count, and a signed-out request is refused", async () => {
  const f = world();
  f.subscribe(f.other, "active");
  const mine = await checkout(f);
  assert.equal(mine.status, 200, "another user's subscription does not block mine");
  const theirs = await checkout(f, f.other);
  assert.equal(theirs.status, 409);
  const signedOut = await checkout(f, null);
  assert.equal(signedOut.status, 401);
  assert.equal(f.stripe.sessionsCreated.length, 1);
});
