import {
  addGrant,
  addMember,
  addSubscription,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Admin-granted subscriptions: platform staff give a user a paid plan for a number of days or
// with no end, without payment (no Stripe); extend or revoke it; it expires on its own. Access is
// decided on the server (plan-access.ts), the admin API is manage_billing only, every change is
// audited in the same transaction, and a user has at most one active subscription.

const env = (globalThis as Record<string, unknown>).__env__ as Record<string, string>;
env.STRIPE_SECRET_KEY = "sk_test_key";

const grantsApi = await import("../src/routes/api.admin.subscription-grants");
const commandCenter = await import("../src/routes/api.revenue.command-center");
const billingSubscription = await import("../src/routes/api.billing.subscription");
const checkoutRoute = await import("../src/routes/api.billing.checkout");
const { resolveWorkspacePlan, PLAN_LIMITS } = await import("../src/lib/server/plan-access");
const { createServiceSupabaseClient } = await import("../src/lib/server/supabase");
const { resolvePlanTier } = await import("../src/lib/server/subscription-tier");
const { hasWorkspaceAppAccess, planNotice } = await import("../src/lib/plan-notice");

const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function world() {
  const w: World = emptyWorld();
  const admin = addUser(w, "boss@tubify.test", "superadmin");
  const owner = addUser(w, "owner@tubify.test", "owner"); // platform "owner" role: console-less
  const manager = addUser(w, "manager@tubify.test", "manager");
  const creator = addUser(w, "creator@x.test");
  const editor = addUser(w, "editor@x.test");
  const other = addUser(w, "other@x.test");
  const ws = addWorkspace(w, creator);
  addMember(w, ws, editor, "editor");
  return { w, admin, owner, manager, creator, editor, other, ws };
}
type F = ReturnType<typeof world>;

const post = (f: F, as: string | null, body: unknown) =>
  callTeamApi(grantsApi, f.w, {
    as,
    method: "POST",
    path: "/api/admin/subscription-grants",
    body,
  });
const getGrants = (f: F, as: string | null, userId: string) =>
  callTeamApi(grantsApi, f.w, {
    as,
    method: "GET",
    path: "/api/admin/subscription-grants",
    query: `?userId=${userId}`,
  });
const app = (f: F, as: string) =>
  callTeamApi(commandCenter, f.w, {
    as,
    method: "GET",
    path: "/api/revenue/command-center",
  });
const grantBody = (f: F, extra: Record<string, unknown> = {}) => ({
  action: "grant",
  userId: f.creator,
  plan: "pro",
  duration: { days: 30 },
  reason: "Partner creator",
  ...extra,
});
const grants = (f: F) => f.w.subscription_grants ?? [];
const audits = (f: F) => (f.w.admin_audit_log ?? []).map((row) => row.action);
const nothingChanged = (r: CallResult) =>
  r.writes.length === 0 && !r.rpcCalls.some((name) => name.includes("subscription"));

// ---------- access ----------

test("an active grant gives the owner's workspaces its plan, for every member", async () => {
  const f = world();
  addGrant(f.w, f.creator, "pro", inDays(10));
  for (const who of [f.creator, f.editor]) {
    const r = await app(f, who);
    assert.equal(r.status, 200, r.text);
  }
  const plan = await inWorld(f, (service) =>
    resolveWorkspacePlan(service, { workspaceId: f.ws, userId: f.editor }),
  );
  assert.equal(plan.source, "grant");
  assert.equal(plan.plan, "pro");
  assert.deepEqual(plan.limits, PLAN_LIMITS.pro);
  assert.equal(await inWorld(f, (service) => resolvePlanTier(service, f.creator)), "pro");
});

test("a grant with no end works; an expired or revoked one gives nothing, even before the sweep", async () => {
  const lifetime = world();
  addGrant(lifetime.w, lifetime.creator, "scale", null);
  assert.equal((await app(lifetime, lifetime.creator)).status, 200);

  const expired = world();
  // Still "active" in the table: the daily sweep has not recorded it yet. Access ends anyway.
  addGrant(expired.w, expired.creator, "pro", new Date(Date.now() - 60_000).toISOString());
  const r = await app(expired, expired.creator);
  assert.equal(r.status, 402);
  assert.equal(r.body.error, "SUBSCRIPTION_REQUIRED");

  const revoked = world();
  addGrant(revoked.w, revoked.creator, "pro", inDays(10), "revoked");
  assert.equal((await app(revoked, revoked.creator)).status, 402);
  assert.equal(
    await inWorld(revoked, (service) => resolvePlanTier(service, revoked.creator)),
    "free",
  );
});

test("a grant is the user's own: a member's grant does not open someone else's workspace", async () => {
  const f = world();
  addGrant(f.w, f.editor, "scale", inDays(30));
  assert.equal((await app(f, f.editor)).status, 402, "the workspace owner has no plan");
});

test("a paid subscription takes precedence over a grant", async () => {
  const f = world();
  addSubscription(f.w, f.creator, "starter", "active");
  addGrant(f.w, f.creator, "scale", inDays(30));
  const plan = await inWorld(f, (service) =>
    resolveWorkspacePlan(service, { workspaceId: f.ws, userId: f.creator }),
  );
  assert.equal(plan.source, "subscription");
  assert.equal(plan.plan, "starter");
});

test("a grant that cannot be read is refused (503), never assumed", async () => {
  const f = world();
  addGrant(f.w, f.creator, "pro", inDays(10));
  f.w.failingReads = ["subscription_grants"];
  const r = await app(f, f.creator);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "ENTITLEMENT_UNAVAILABLE");
});

test("Billing shows the user their own grant: plan and end only, never the reason or the admin", async () => {
  const f = world();
  addGrant(f.w, f.creator, "pro", inDays(10));
  (f.w as unknown as Record<string, unknown[]>).plans = []; // the price list Billing also reads
  const r = await callTeamApi(billingSubscription, f.w, {
    as: f.creator,
    method: "GET",
    path: "/api/billing/subscription",
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.grant.plan_id, "pro");
  assert.ok(r.body.data.grant.expires_at);
  assert.deepEqual(Object.keys(r.body.data.grant).sort(), ["expires_at", "plan_id"]);
  assert.doesNotMatch(r.text, /test grant/, "the internal reason is not returned");
  assert.equal(r.body.data.access.source, "grant");
  // another user sees none of it
  const other = await callTeamApi(billingSubscription, f.w, {
    as: f.other,
    method: "GET",
    path: "/api/billing/subscription",
  });
  assert.equal(other.body.data.grant, null);
});

// ---------- the admin API: who may call it ----------

test("only a Superadmin may use the grants API; everyone else is refused and nothing is read or written", async () => {
  const f = world();
  const cases: Array<[string | null, number]> = [
    [null, 401],
    [f.creator, 403],
    [f.manager, 403],
    [f.owner, 403],
  ];
  for (const [as, status] of cases) {
    const r = await post(f, as, grantBody(f));
    assert.equal(r.status, status, `${as}: ${r.text}`);
    assert.ok(nothingChanged(r), `${as}: nothing written`);
    assert.ok(
      !r.reads.some((read) => String(read.table).startsWith("subscription")),
      `${as}: no grant read`,
    );
    const g = await getGrants(f, as, f.creator);
    assert.equal(g.status, status);
  }
  assert.equal(grants(f).length, 0);
});

test("requests are validated strictly; a refused request changes nothing", async () => {
  const f = world();
  const bad = [
    grantBody(f, { reason: "" }),
    grantBody(f, { reason: "  x " }),
    grantBody(f, { reason: "x".repeat(501) }),
    grantBody(f, { plan: "premium" }),
    grantBody(f, { duration: { days: 0 } }),
    grantBody(f, { duration: { days: 3651 } }),
    grantBody(f, { duration: { days: 1.5 } }),
    grantBody(f, { duration: "forever" }),
    grantBody(f, { userId: "not-a-uuid" }),
    grantBody(f, { extra: true }),
    { action: "delete", userId: f.creator, reason: "nope" },
    { action: "revoke", userId: f.creator, reason: "missing grant id" },
  ];
  for (const body of bad) {
    const r = await post(f, f.admin, body);
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.ok(nothingChanged(r));
  }
  assert.equal(grants(f).length, 0);
});

// ---------- grant ----------

test("granting: one active grant, written with its history and audit entry", async () => {
  const f = world();
  const r = await post(f, f.admin, grantBody(f));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.plan, "pro");
  const end = Date.parse(r.body.data.expiresAt);
  assert.ok(Math.abs(end - (Date.now() + 30 * DAY)) < 60_000, "30 days from now");
  assert.equal(grants(f).length, 1);
  assert.equal(grants(f)[0].granted_by, f.admin);
  assert.equal(grants(f)[0].reason, "Partner creator");
  assert.deepEqual(audits(f), ["subscription_grant_created"]);
  assert.equal(f.w.admin_audit_log![0].target, f.creator);
  assert.deepEqual(
    (f.w.subscription_grant_events ?? []).map((e) => e.event),
    ["granted"],
  );
  // and the user now has the plan
  assert.equal((await app(f, f.creator)).status, 200);

  // a second active grant is refused
  const again = await post(f, f.admin, grantBody(f, { plan: "scale" }));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "ACTIVE_GRANT_EXISTS");
  assert.equal(grants(f).length, 1);
});

test("lifetime grants have no end; an expired grant does not block a new one", async () => {
  const f = world();
  addGrant(f.w, f.creator, "starter", new Date(Date.now() - 1000).toISOString());
  const r = await post(f, f.admin, grantBody(f, { duration: "lifetime", plan: "scale" }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.expiresAt, null);
  assert.deepEqual(
    grants(f).map((g) => g.status),
    ["expired", "active"],
  );
});

test("no grant to an unknown user, to oneself, or to someone who already pays", async () => {
  const f = world();
  const unknown = await post(f, f.admin, grantBody(f, { userId: uuid() }));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "USER_NOT_FOUND");

  const self = await post(f, f.admin, grantBody(f, { userId: f.admin }));
  assert.equal(self.status, 403);
  assert.equal(self.body.error, "SELF_GRANT_NOT_ALLOWED");

  for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete"]) {
    const paid = world();
    addSubscription(paid.w, paid.creator, "starter", status);
    const r = await post(paid, paid.admin, grantBody(paid));
    assert.equal(r.status, 409, status);
    assert.equal(r.body.error, "PAID_SUBSCRIPTION_EXISTS");
    assert.equal(grants(paid).length, 0);
  }
  // a subscription that is over does not block a grant
  const over = world();
  addSubscription(over.w, over.creator, "starter", "canceled");
  assert.equal((await post(over, over.admin, grantBody(over))).status, 201);
  assert.ok(nothingChanged(unknown) && nothingChanged(self));
});

// ---------- extend and revoke ----------

test("extending adds days to the current end, or removes the end; audited", async () => {
  const f = world();
  const end = inDays(5);
  const id = addGrant(f.w, f.creator, "pro", end);
  const r = await post(f, f.admin, {
    action: "extend",
    userId: f.creator,
    grantId: id,
    duration: { days: 30 },
    reason: "Extended pilot",
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(Date.parse(r.body.data.expiresAt), Date.parse(end) + 30 * DAY);
  assert.deepEqual(audits(f), ["subscription_grant_extended"]);

  const forever = await post(f, f.admin, {
    action: "extend",
    userId: f.creator,
    grantId: id,
    duration: "lifetime",
    reason: "Ambassador",
  });
  assert.equal(forever.status, 200);
  assert.equal(forever.body.data.expiresAt, null);
  const again = await post(f, f.admin, {
    action: "extend",
    userId: f.creator,
    grantId: id,
    duration: { days: 1 },
    reason: "More",
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "GRANT_ALREADY_LIFETIME");
});

test("revoking ends access now; audited", async () => {
  const f = world();
  const id = addGrant(f.w, f.creator, "pro", inDays(20));
  const r = await post(f, f.admin, {
    action: "revoke",
    userId: f.creator,
    grantId: id,
    reason: "Partnership ended",
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(grants(f)[0].status, "revoked");
  assert.equal(grants(f)[0].revoked_by, f.admin);
  assert.deepEqual(audits(f), ["subscription_grant_revoked"]);
  assert.equal((await app(f, f.creator)).status, 402);
});

test("another user's grant id, an unknown one and an ended one all get the same 404, and nothing changes", async () => {
  const f = world();
  const othersGrant = addGrant(f.w, f.other, "pro", inDays(20));
  const ended = addGrant(f.w, f.editor, "pro", new Date(Date.now() - 1000).toISOString());
  for (const [userId, grantId] of [
    [f.creator, othersGrant],
    [f.creator, uuid()],
    [f.editor, ended],
  ]) {
    for (const action of ["extend", "revoke"]) {
      const r = await post(f, f.admin, {
        action,
        userId,
        grantId,
        ...(action === "extend" ? { duration: { days: 5 } } : {}),
        reason: "Should not apply",
      });
      assert.equal(r.status, 404, `${action} ${grantId}`);
      assert.equal(r.body.error, "GRANT_NOT_FOUND");
      assert.ok(nothingChanged(r));
    }
  }
  assert.equal(grants(f).find((g) => g.id === othersGrant)!.status, "active");
  assert.deepEqual(audits(f), []);
});

test("the admin view lists the current grant and its history", async () => {
  const f = world();
  await post(f, f.admin, grantBody(f));
  const r = await getGrants(f, f.admin, f.creator);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.current.plan, "pro");
  assert.equal(r.body.data.current.reason, "Partner creator");
  assert.equal(r.body.data.history[0].event, "granted");
  assert.equal(r.body.data.history[0].by, "boss");
  const unknown = await getGrants(f, f.admin, uuid());
  assert.equal(unknown.status, 404);
});

// ---------- expiry ----------

test("the daily sweep records ended grants as expired, and only those", async () => {
  const { expireSubscriptionGrants } = await import("../src/lib/server/subscription-grants");
  const f = world();
  addGrant(f.w, f.creator, "pro", new Date(Date.now() - 1000).toISOString());
  addGrant(f.w, f.other, "pro", inDays(3));
  addGrant(f.w, f.editor, "scale", null);
  const expired = await inWorld(f, (service) => expireSubscriptionGrants(service));
  assert.equal(expired, 1);
  assert.deepEqual(
    grants(f).map((g) => g.status),
    ["expired", "active", "active"],
  );
  assert.deepEqual(
    (f.w.subscription_grant_events ?? []).map((e) => [e.event, e.actor_id]),
    [["expired", null]],
  );
  // the cron runs it, without a second Vercel cron
  const cron = readFileSync("src/routes/api.youtube.sync.ts", "utf8");
  assert.match(cron, /await expireSubscriptionGrants\(service\)/);
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.equal(vercel.crons.length, 1);
});

// ---------- checkout: one subscription per user ----------

test("Checkout is refused while a grant is active, before Stripe is asked", async () => {
  const f = world();
  addGrant(f.w, f.creator, "pro", inDays(10));
  let stripeCalls = 0;
  f.w.external = (url) => {
    if (url.origin === "https://api.stripe.com") stripeCalls += 1;
    return undefined;
  };
  const rows = f.w as unknown as Record<string, Array<Record<string, unknown>>>;
  const planId = uuid();
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
  const r = await callTeamApi(checkoutRoute, f.w, {
    as: f.creator,
    method: "POST",
    path: "/api/billing/checkout",
    body: { planId: "pro", interval: "month" },
  });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, "GRANT_ACTIVE");
  assert.equal(stripeCalls, 0);
});

// ---------- the app shell ----------

test("the app lets a granted workspace in until the grant ends, and says when it is about to", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const base = { plan: "pro" as const, status: "active" as const, isOwner: true };
  assert.equal(
    hasWorkspaceAppAccess({ ...base, source: "grant", periodEnd: null }, now),
    true,
    "no end",
  );
  assert.equal(
    hasWorkspaceAppAccess({ ...base, source: "grant", periodEnd: "2026-11-20T00:00:00Z" }, now),
    true,
  );
  assert.equal(
    hasWorkspaceAppAccess({ ...base, source: "grant", periodEnd: "2026-11-08T11:59:00Z" }, now),
    false,
    "ended",
  );
  assert.equal(
    planNotice({ ...base, source: "grant", periodEnd: "2026-12-30T00:00:00Z" }, now),
    null,
    "no notice while more than a week is left",
  );
  const soon = planNotice({ ...base, source: "grant", periodEnd: "2026-11-12T00:00:00Z" }, now);
  assert.match(soon!.title, /complimentary Pro plan ends Nov 12, 2026/);
  assert.equal(soon!.action?.to, "/billing");
  const member = planNotice(
    { ...base, isOwner: false, source: "grant", periodEnd: "2026-11-12T00:00:00Z" },
    now,
  );
  assert.equal(member!.action, null);
});

// ---------- the migration ----------

test("the migration: no browser access, one active grant per user, service-role-only functions", () => {
  const sql = readFileSync("supabase/migrations/202611080001_subscription_grants.sql", "utf8");
  for (const table of ["subscription_grants", "subscription_grant_events"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`),
    );
  }
  assert.doesNotMatch(sql, /create policy/, "no policies: no session can read or write them");
  assert.match(
    sql,
    /create unique index subscription_grants_one_active_idx\s+on public\.subscription_grants\(user_id\) where status = 'active';/,
  );
  assert.match(
    sql,
    /reason text not null check \(char_length\(btrim\(reason\)\) between 3 and 500\)/,
  );
  assert.match(sql, /plan_id text not null check \(plan_id in \('starter', 'pro', 'scale'\)\)/);
  const functions = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(functions, [
    "admin_grant_subscription",
    "admin_extend_subscription_grant",
    "admin_revoke_subscription_grant",
    "expire_subscription_grants",
  ]);
  for (const name of functions) {
    const body = sql.slice(sql.indexOf(`function public.${name}(`));
    assert.match(body.slice(0, 600), /security invoker/, name);
    assert.match(body.slice(0, 600), /set search_path = public, pg_temp/, name);
    assert.match(
      sql,
      new RegExp(
        `revoke execute on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`,
      ),
      name,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to service_role;`),
      name,
    );
  }
  assert.doesNotMatch(sql, /security definer/i);
  // every admin change writes the audit row in the same function (transaction)
  for (const action of [
    "subscription_grant_created",
    "subscription_grant_extended",
    "subscription_grant_revoked",
  ])
    assert.match(sql, new RegExp(`'${action}'`));
});

test("the admin API is manage_billing only and never calls Stripe", () => {
  const source = readFileSync("src/routes/api.admin.subscription-grants.ts", "utf8");
  assert.equal(source.match(/requirePermission\(request, "manage_billing"\)/g)?.length, 2);
  assert.doesNotMatch(source, /stripe\.com|@\/lib\/server\/stripe"/);
});

// Runs `fn` with a service-role client inside the fake world (its requests go to the in-memory
// database for the length of the call), and returns what it returned.
async function inWorld<T>(
  f: F,
  fn: (service: ReturnType<typeof createServiceSupabaseClient>) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  const route = {
    Route: {
      options: {
        server: {
          handlers: {
            GET: async () => {
              result = await fn(createServiceSupabaseClient());
              return new Response("{}");
            },
          },
        },
      },
    },
  };
  await callTeamApi(route, f.w, { as: null, method: "GET", path: "/in-world" });
  return result as T;
}

test("the Users page actions menu offers the grant, through the same dialog and API", () => {
  const page = readFileSync("src/components/admin/sections/UsersSection.tsx", "utf8");
  // both the desktop table's menu and the phone card's menu
  assert.equal(page.match(/onSelect=\{\(\) => setGrantingUser\(u\)\}/g)?.length, 2);
  assert.match(page, /Grant complimentary plan/);
  assert.match(page, /<SubscriptionGrantDialog\s+mode=\{grantingUser \? "grant" : null\}/);
  const panel = readFileSync("src/components/admin/SubscriptionGrantPanel.tsx", "utf8");
  assert.match(panel, /export function SubscriptionGrantDialog\(/);
  // the dialog posts to the admin API, where every rule is enforced
  assert.match(panel, /fetch\("\/api\/admin\/subscription-grants", \{\s+method: "POST"/);
});
