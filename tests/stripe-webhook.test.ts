import { addUser, callTeamApi, emptyWorld, uuid, type World } from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// The Stripe webhook (src/routes/api.stripe.webhook.ts): the only path by which a payment becomes
// a subscription in Tubify. What it must never do:
//
//   * acknowledge an event (200, so Stripe stops delivering it) while the subscription was not
//     recorded — a failure to read or write is a 500, so Stripe delivers the event again;
//   * record a state Stripe no longer holds — events arrive in any order, so the subscription is
//     read again from Stripe and its CURRENT state is written, never the event's snapshot;
//   * act on an event not signed with the endpoint's secret — refused, nothing read or written.
//
// A repeated event changes nothing, and a paid invoice is counted for a referrer once.

const SECRET = "whsec_test_secret";
const env = (globalThis as Record<string, unknown>).__env__ as Record<string, string>;
env.STRIPE_WEBHOOK_SECRET = SECRET;
env.STRIPE_SECRET_KEY = "sk_test_key";

const route = await import("../src/routes/api.stripe.webhook");

const PRICE = "price_pro_month";
const SCALE_PRICE = "price_scale_month";

type Sub = {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number | null;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string }; current_period_end?: number | null }> };
  metadata?: Record<string, string>;
};

function world() {
  const w: World = emptyWorld();
  const owner = addUser(w, "owner@x.test");
  const rows = w as unknown as Record<string, Array<Record<string, unknown>>>;
  const plan = (slug: string, price: string) => {
    const id = uuid();
    rows.plans.push({
      id,
      name: slug,
      slug,
      description: null,
      currency: "usd",
      features: [],
      limits: {},
      is_active: true,
      is_public: true,
      sort_order: 1,
      stripe_product_id: `prod_${slug}`,
    });
    rows.plan_prices.push({
      id: uuid(),
      plan_id: id,
      billing_interval: "month",
      amount_cents: 7900,
      currency: "usd",
      stripe_price_id: price,
      is_active: true,
    });
  };
  rows.plans = [];
  rows.plan_prices = [];
  plan("pro", PRICE);
  plan("scale", SCALE_PRICE);
  rows.referral_commissions = [];
  const subscription = (status = "active", price = PRICE, extra: Partial<Sub> = {}): Sub => ({
    id: "sub_1",
    status,
    customer: "cus_1",
    current_period_end: 1_900_000_000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: price } }] },
    metadata: { user_id: owner },
    ...extra,
  });
  // What Stripe holds now; "missing" answers 404, "down" a 500.
  // `current` is sub_1; `others` any further subscriptions, by id.
  const stripe: {
    current: Sub | "missing" | "down";
    others: Record<string, Sub>;
    reads: number;
  } = { current: subscription(), others: {}, reads: 0 };
  w.external = (url, init) => {
    if (url.origin !== "https://api.stripe.com" || init.method !== "GET") return undefined;
    const id = /^\/v1\/subscriptions\/(\w+)$/.exec(url.pathname)?.[1];
    if (!id) return undefined;
    stripe.reads++;
    const held = id === "sub_1" ? stripe.current : (stripe.others[id] ?? "missing");
    if (held === "missing")
      return new Response(JSON.stringify({ error: { code: "resource_missing" } }), { status: 404 });
    if (held === "down") return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(held), { status: 200 });
  };
  return { w, owner, rows, subscription, stripe };
}
type F = ReturnType<typeof world>;

function signature(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${v1}`;
}

const deliver = (f: F, event: Record<string, unknown>, sig?: string) =>
  callTeamApi(route, f.w, {
    as: null,
    method: "POST",
    path: "/api/stripe/webhook",
    body: event,
    headers: { "stripe-signature": sig ?? signature(JSON.stringify(event)) },
  });

const checkoutCompleted = (f: F) => ({
  id: "evt_checkout",
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
});
const subscriptionEvent = (type: "updated" | "deleted", snapshot: Sub, id = `evt_${type}`) => ({
  id,
  type: `customer.subscription.${type}`,
  data: { object: snapshot },
});

const subscriptionsOf = (f: F) => f.w.subscriptions.filter((s) => s.user_id === f.owner);
const recorded = (f: F) => {
  const [row] = subscriptionsOf(f);
  return (
    row && { plan: row.plan_id, status: row.status, cancelAtPeriodEnd: row.cancel_at_period_end }
  );
};

// ---------- signature, duplicates, failed writes (Phase 4A) ----------

test("a signed checkout records the subscription once, however often Stripe delivers it", async () => {
  const f = world();
  const first = await deliver(f, checkoutCompleted(f));
  assert.equal(first.status, 200, first.text);
  assert.equal(subscriptionsOf(f).length, 1);
  assert.deepEqual(
    {
      plan: subscriptionsOf(f)[0].plan_id,
      status: subscriptionsOf(f)[0].status,
      interval: subscriptionsOf(f)[0].billing_interval,
      periodEnd: subscriptionsOf(f)[0].current_period_end,
    },
    { plan: "pro", status: "active", interval: "month", periodEnd: "2030-03-17T17:46:40.000Z" },
  );
  assert.equal(f.w.profiles.find((p) => p.id === f.owner)?.stripe_customer_id, "cus_1");
  const again = await deliver(f, checkoutCompleted(f));
  assert.equal(again.status, 200);
  assert.equal(subscriptionsOf(f).length, 1, "a repeated event is not a second subscription");
});

test("an unsigned, wrongly signed or stale event is refused and nothing is read or written", async () => {
  const f = world();
  const event = checkoutCompleted(f);
  const body = JSON.stringify(event);
  for (const sig of [
    "",
    "t=1,v1=deadbeef",
    signature(body, "whsec_someone_else"),
    signature(body, SECRET, Math.floor(Date.now() / 1000) - 3600),
  ]) {
    const r = await deliver(f, event, sig);
    assert.equal(r.status, 400, sig);
    assert.equal(r.writes.length, 0);
    assert.equal(r.reads.length, 0);
  }
  assert.equal(f.stripe.reads, 0, "not even Stripe is asked");
  assert.equal(subscriptionsOf(f).length, 0);
});

test("a failed write is answered with a 500 so Stripe delivers the event again — never a silent 200", async () => {
  const f = world();
  f.w.refuseWrites = { subscriptions: "57014" };
  const failed = await deliver(f, checkoutCompleted(f));
  assert.equal(failed.status, 500, failed.text);
  assert.deepEqual(failed.body, { error: "WEBHOOK_HANDLER_FAILED" });
  assert.equal(subscriptionsOf(f).length, 0);
  // Stripe's retry, once the database answers again, records it.
  f.w.refuseWrites = {};
  const retried = await deliver(f, checkoutCompleted(f));
  assert.equal(retried.status, 200);
  assert.equal(subscriptionsOf(f)[0]?.status, "active");
});

test("a failed plan lookup is a retry, not 'not one of our prices'", async () => {
  const f = world();
  f.w.failingReads = ["plan_prices"];
  const failed = await deliver(f, checkoutCompleted(f));
  assert.equal(failed.status, 500, failed.text);
  assert.equal(subscriptionsOf(f).length, 0);
  // A price that really is no plan's is still acknowledged (and logged): retrying cannot help.
  const g = world();
  g.stripe.current = g.subscription("active", "price_unknown");
  const unknown = await deliver(g, checkoutCompleted(g));
  assert.equal(unknown.status, 200);
  assert.equal(subscriptionsOf(g).length, 0);
  assert.ok(unknown.logs.some((entry) => String(entry[0]).includes("not mapped")));
});

// ---------- out of order: the current state, never the event's snapshot ----------

test("an older event delivered after a newer one does not undo it", async () => {
  const f = world();
  await deliver(f, checkoutCompleted(f));
  // The customer upgraded to Scale; that event arrives first …
  f.stripe.current = f.subscription("active", SCALE_PRICE);
  await deliver(f, subscriptionEvent("updated", f.subscription("active", SCALE_PRICE), "evt_2"));
  assert.deepEqual(recorded(f), { plan: "scale", status: "active", cancelAtPeriodEnd: false });
  // … and an older event (still Pro, past due) arrives afterwards.
  const stale = await deliver(
    f,
    subscriptionEvent("updated", f.subscription("past_due", PRICE), "evt_1"),
  );
  assert.equal(stale.status, 200, stale.text);
  assert.deepEqual(recorded(f), { plan: "scale", status: "active", cancelAtPeriodEnd: false });
});

test("a canceled subscription is never reactivated by an older event", async () => {
  const f = world();
  await deliver(f, checkoutCompleted(f));
  f.stripe.current = f.subscription("canceled");
  await deliver(f, subscriptionEvent("deleted", f.subscription("canceled")));
  assert.equal(recorded(f)?.status, "canceled");
  // An "active" update from before the cancellation, delivered late.
  const late = await deliver(f, subscriptionEvent("updated", f.subscription("active"), "evt_old"));
  assert.equal(late.status, 200);
  assert.equal(recorded(f)?.status, "canceled");
  // Delivered again and again: the same state every time.
  for (let i = 0; i < 3; i++)
    await deliver(f, subscriptionEvent("updated", f.subscription("active"), "evt_old"));
  assert.equal(subscriptionsOf(f).length, 1);
  assert.equal(recorded(f)?.status, "canceled");
});

test("cancellation at period end and a failed payment are recorded as Stripe holds them", async () => {
  const f = world();
  await deliver(f, checkoutCompleted(f));
  f.stripe.current = f.subscription("active", PRICE, { cancel_at_period_end: true });
  await deliver(f, subscriptionEvent("updated", f.subscription("active")));
  assert.deepEqual(recorded(f), { plan: "pro", status: "active", cancelAtPeriodEnd: true });
  f.stripe.current = f.subscription("past_due");
  await deliver(f, subscriptionEvent("updated", f.subscription("past_due")));
  assert.equal(recorded(f)?.status, "past_due", "plan resolution counts only active/trialing");
});

// ---------- deletion, and subscriptions Stripe no longer returns ----------

test("a deleted subscription Stripe no longer returns is recorded as canceled from the event", async () => {
  const f = world();
  await deliver(f, checkoutCompleted(f));
  f.stripe.current = "missing";
  const r = await deliver(f, subscriptionEvent("deleted", f.subscription("canceled")));
  assert.equal(r.status, 200, r.text);
  assert.equal(recorded(f)?.status, "canceled");
});

test("a live state that cannot be confirmed with Stripe is a retry, and nothing is written", async () => {
  const f = world();
  await deliver(f, checkoutCompleted(f));
  const before = recorded(f);
  // Stripe does not return it, but the event says it is live: not trusted.
  f.stripe.current = "missing";
  const missing = await deliver(f, subscriptionEvent("updated", f.subscription("trialing")));
  assert.equal(missing.status, 500);
  // Stripe is unavailable: the same, for any event.
  f.stripe.current = "down";
  for (const event of [
    subscriptionEvent("updated", f.subscription("active")),
    subscriptionEvent("deleted", f.subscription("canceled")),
    checkoutCompleted(f),
  ]) {
    const r = await deliver(f, event);
    assert.equal(r.status, 500, String(event.type));
    assert.ok(!r.writes.some((x) => x.table === "subscriptions"), String(event.type));
  }
  assert.deepEqual(recorded(f), before);
});

test("updates for a subscription without our metadata use the recorded owner; that lookup can fail", async () => {
  const f = world();
  await deliver(f, checkoutCompleted(f));
  const { metadata: _drop, ...noMetadata } = f.subscription("past_due");
  void _drop;
  f.stripe.current = noMetadata;
  f.w.failingReads = ["subscriptions"];
  const failed = await deliver(f, subscriptionEvent("updated", noMetadata));
  assert.equal(failed.status, 500, failed.text);
  f.w.failingReads = [];
  const ok = await deliver(f, subscriptionEvent("updated", noMetadata));
  assert.equal(ok.status, 200);
  assert.equal(recorded(f)?.status, "past_due");
  // One nobody here owns is acknowledged and recorded nowhere.
  const g = world();
  g.stripe.current = noMetadata;
  const stranger = await deliver(g, subscriptionEvent("updated", noMetadata));
  assert.equal(stranger.status, 200);
  assert.equal(g.w.subscriptions.length, 0);
});

test("the period end is read wherever the account's API version puts it", async () => {
  const f = world();
  f.stripe.current = {
    ...f.subscription(),
    current_period_end: undefined,
    items: { data: [{ price: { id: PRICE }, current_period_end: 1_900_000_000 }] },
  };
  assert.equal((await deliver(f, checkoutCompleted(f))).status, 200);
  assert.equal(subscriptionsOf(f)[0].current_period_end, "2030-03-17T17:46:40.000Z");
  const g = world();
  g.stripe.current = { ...g.subscription(), current_period_end: undefined };
  assert.equal((await deliver(g, checkoutCompleted(g))).status, 200);
  assert.equal(subscriptionsOf(g)[0].current_period_end, null, "unknown is not a made-up date");
});

// ---------- referral commissions ----------

test("a referral commission that cannot be written is a retry; a repeated invoice is counted once", async () => {
  const f = world();
  const referrer = addUser(f.w, "referrer@x.test");
  Object.assign(
    f.w.profiles.find((p) => p.id === f.owner)!,
    {
      stripe_customer_id: "cus_1",
      referred_by: referrer,
    },
  );
  const invoice = {
    id: "evt_invoice",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
        subscription: "sub_1",
        amount_paid: 7900,
        currency: "usd",
        status: "paid",
      },
    },
  };
  f.w.refuseWrites = { referral_commissions: "57014" };
  assert.equal((await deliver(f, invoice)).status, 500);
  assert.equal(f.rows.referral_commissions.length, 0);
  f.w.refuseWrites = {};
  assert.equal((await deliver(f, invoice)).status, 200);
  assert.equal((await deliver(f, invoice)).status, 200);
  assert.equal(f.rows.referral_commissions.length, 1);
  assert.equal(f.rows.referral_commissions[0].commission_cents, 1580);
  // Subscription events never create commissions.
  await deliver(f, subscriptionEvent("updated", f.subscription()));
  assert.equal(f.rows.referral_commissions.length, 1);
});

// ---------- subscription identity: one subscription's event never touches another ----------

const checkoutFor = (userId: string, customer: string, subscription: string) => ({
  id: `evt_checkout_${subscription}`,
  type: "checkout.session.completed",
  data: {
    object: {
      id: `cs_${subscription}`,
      client_reference_id: userId,
      customer,
      subscription,
      customer_email: null,
    },
  },
});
const rowOf = (f: F, stripeSubscriptionId: string) => {
  const row = f.w.subscriptions.find((s) => s.stripe_subscription_id === stripeSubscriptionId);
  return row && { user: row.user_id, plan: row.plan_id, status: row.status };
};
const liveRowsOf = (f: F, userId: string) =>
  f.w.subscriptions
    .filter((s) => s.user_id === userId && ["active", "trialing"].includes(String(s.status)))
    .map((s) => `${s.stripe_subscription_id}:${s.plan_id}`);

test("a delayed event for a canceled subscription A never touches the customer's new subscription B", async () => {
  const f = world();
  // A: Pro, then canceled.
  await deliver(f, checkoutCompleted(f));
  f.stripe.current = f.subscription("canceled");
  await deliver(f, subscriptionEvent("deleted", f.subscription("canceled")));
  // B: a new purchase, on Scale.
  f.stripe.others.sub_2 = { ...f.subscription("active", SCALE_PRICE), id: "sub_2" };
  assert.equal((await deliver(f, checkoutFor(f.owner, "cus_1", "sub_2"))).status, 200);
  const b = { user: f.owner, plan: "scale", status: "active" };
  assert.deepEqual(rowOf(f, "sub_2"), b);
  // A delayed "active, Pro" update for A, and a delayed cancellation of A, arrive now. Stripe
  // returns A as it is — canceled — and only A's own row is written.
  for (const event of [
    subscriptionEvent("updated", f.subscription("active", PRICE), "evt_a_old_update"),
    subscriptionEvent("deleted", f.subscription("canceled"), "evt_a_old_delete"),
  ]) {
    const r = await deliver(f, event);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(rowOf(f, "sub_1"), { user: f.owner, plan: "pro", status: "canceled" });
    assert.deepEqual(rowOf(f, "sub_2"), b, `${event.id}: B's state, plan and id are untouched`);
  }
  assert.equal(f.w.subscriptions.length, 2);
  // What the plan is resolved from (the live rows): Scale, through B alone.
  assert.deepEqual(liveRowsOf(f, f.owner), ["sub_2:scale"]);
});

test("one customer's events never modify another customer's billing record", async () => {
  const f = world();
  const second = addUser(f.w, "second@x.test");
  await deliver(f, checkoutCompleted(f));
  const mine = rowOf(f, "sub_1");
  // Another customer's subscription, its own events.
  const theirs = {
    ...f.subscription("active", SCALE_PRICE),
    id: "sub_3",
    customer: "cus_2",
    metadata: { user_id: second },
  };
  f.stripe.others.sub_3 = theirs;
  assert.equal((await deliver(f, checkoutFor(second, "cus_2", "sub_3"))).status, 200);
  f.stripe.others.sub_3 = { ...theirs, status: "past_due" };
  await deliver(f, subscriptionEvent("updated", theirs, "evt_theirs"));
  assert.deepEqual(rowOf(f, "sub_3"), { user: second, plan: "scale", status: "past_due" });
  assert.deepEqual(rowOf(f, "sub_1"), mine);
  assert.equal(f.w.profiles.find((p) => p.id === f.owner)?.stripe_customer_id, "cus_1");
  assert.equal(f.w.profiles.find((p) => p.id === second)?.stripe_customer_id, "cus_2");
  // Even a subscription whose metadata names another user (edited in Stripe) is not moved to
  // them: the recorded owner is kept, and the named user gains nothing.
  f.stripe.others.sub_3 = { ...theirs, status: "active", metadata: { user_id: f.owner } };
  const moved = await deliver(f, subscriptionEvent("updated", theirs, "evt_relabelled"));
  assert.equal(moved.status, 200);
  assert.deepEqual(rowOf(f, "sub_3"), { user: second, plan: "scale", status: "active" });
  assert.deepEqual(liveRowsOf(f, f.owner), ["sub_1:pro"]);
  assert.ok(moved.logs.some((entry) => String(entry[0]).includes("recorded owner is kept")));
});
