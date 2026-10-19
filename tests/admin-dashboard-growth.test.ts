import test from "node:test";
import assert from "node:assert/strict";
import { SUPABASE, CALLER } from "./helpers/admin-users-fake-api";

// /api/admin/dashboard/growth: one growth series (users or subscriptions) for a chosen range.
// Superadmin/Owner only; strict query validation; subscriptions counted exactly as the dashboard
// counts them (trusted Stripe mode, active/trialing); counts only, never a whole-table read.

const env = (globalThis as { __env__: Record<string, string | undefined> }).__env__;
const route = await import("../src/routes/api.admin.dashboard.growth");
const { growthBuckets } = route;

type Row = { created_at: string; livemode?: boolean | null; status?: string };
type GrowthBody = {
  error?: string;
  data: { startTotal: number; points: { label: string; total: number; added: number }[] };
};
interface Seen {
  method: string;
  table: string;
  params: URLSearchParams;
}

async function call(
  query: string,
  {
    callerRole = "superadmin",
    signedIn = true,
    profiles = [] as Row[],
    subscriptions = [] as Row[],
    failTable = null as string | null,
  } = {},
) {
  const seen: Seen[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(method === "HEAD" ? null : JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      });
    if (url.origin === SUPABASE && url.pathname === "/auth/v1/user")
      return signedIn
        ? json({ id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" })
        : json({ message: "invalid JWT" }, 401);
    if (url.origin === SUPABASE && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (table === "profiles" && url.searchParams.get("id") === `eq.${CALLER}`)
        return json({ role: callerRole });
      seen.push({ method, table, params: url.searchParams });
      if (table === failTable) return json({ message: "relation broke: secret detail" }, 500);
      let rows = table === "profiles" ? profiles : table === "subscriptions" ? subscriptions : [];
      const p = url.searchParams;
      for (const bound of p.getAll("created_at")) {
        const [op, value] = [
          bound.slice(0, bound.indexOf(".")),
          bound.slice(bound.indexOf(".") + 1),
        ];
        if (op === "lt") rows = rows.filter((r) => r.created_at < value);
        else if (op === "gte") rows = rows.filter((r) => r.created_at >= value);
        else throw new Error(`unexpected created_at filter ${bound}`);
      }
      const live = p.get("livemode");
      if (live) rows = rows.filter((r) => `eq.${r.livemode}` === live);
      const status = p.get("status");
      if (status) {
        const allowed = status.replace(/^in\.\(|\)$/g, "").split(",");
        rows = rows.filter((r) => allowed.includes(String(r.status)));
      }
      if (method === "HEAD") return json(null, 200, { "Content-Range": `*/${rows.length}` });
      const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return json(sorted.slice(0, 1).map((r) => ({ created_at: r.created_at })));
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
  try {
    const session = {
      access_token: "t",
      refresh_token: "r",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" },
    };
    const cookie = `sb-testref-auth-token=${encodeURIComponent(
      `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    )}`;
    const handlers = (
      route.Route as unknown as {
        options: { server: { handlers: { GET: (c: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers;
    const response = await handlers.GET({
      request: new Request(`https://app.test/api/admin/dashboard/growth${query}`, {
        headers: signedIn ? { Cookie: cookie } : {},
      }),
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as GrowthBody, text, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

test.beforeEach(() => {
  env.STRIPE_SECRET_KEY = "sk_test_x";
  env.VERCEL_ENV = "development";
});

test("signed out: 401 and nothing is read", async () => {
  const r = await call("?metric=users&range=6m", { signedIn: false });
  assert.equal(r.status, 401);
  assert.equal(r.seen.length, 0);
});

for (const role of ["manager", "setter", "editor", "user"])
  test(`${role}: refused (403) and nothing is read`, async () => {
    const r = await call("?metric=users&range=6m", { callerRole: role });
    assert.equal(r.status, 403);
    assert.equal(r.seen.length, 0);
  });

test("owner is allowed", async () => {
  const r = await call("?metric=users&range=6m", { callerRole: "owner" });
  assert.equal(r.status, 200);
});

for (const query of [
  "",
  "?metric=users",
  "?metric=users&range=7y",
  "?metric=revenue&range=6m",
  "?metric=users&range=6m&extra=1",
])
  test(`invalid query ${JSON.stringify(query)}: 422 and nothing is read`, async () => {
    const r = await call(query);
    assert.equal(r.status, 422);
    assert.deepEqual(r.body, { error: "VALIDATION_ERROR" });
    assert.equal(r.seen.length, 0);
  });

test("users, 30 days: daily running totals and new per day, from counts only", async () => {
  const profiles = [daysAgo(100), daysAgo(40), daysAgo(10), daysAgo(10.1), daysAgo(0)].map(
    (created_at) => ({ created_at }),
  );
  const r = await call("?metric=users&range=30d", { profiles });
  assert.equal(r.status, 200);
  const { points, startTotal } = r.body.data;
  assert.equal(points.length, 30);
  assert.equal(startTotal, 2);
  assert.equal(points.at(-1)!.total, 5);
  assert.equal(
    points.reduce((sum: number, p: { added: number }) => sum + p.added, 0),
    3,
  );
  // Every read was a HEAD count bounded by created_at — never a row listing: one for everything
  // before the range (upper bound only), then one per day bounded on both sides.
  assert.ok(r.seen.every((s) => s.method === "HEAD"));
  assert.equal(r.seen.length, 31);
  const bounds = r.seen.map((s) => s.params.getAll("created_at").map((b) => b.split(".")[0]));
  assert.equal(bounds.filter((b) => b.join() === "lt").length, 1);
  assert.equal(bounds.filter((b) => b.sort().join() === "gte,lt").length, 30);
});

test("subscriptions are scoped to the trusted mode and active/trialing, like the dashboard", async () => {
  const subscriptions: Row[] = [
    { created_at: daysAgo(20), livemode: false, status: "active" },
    { created_at: daysAgo(15), livemode: false, status: "trialing" },
    { created_at: daysAgo(12), livemode: false, status: "canceled" },
    { created_at: daysAgo(10), livemode: true, status: "active" },
    { created_at: daysAgo(8), livemode: null, status: "active" },
  ];
  const r = await call("?metric=subscriptions&range=90d", { subscriptions });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.points.at(-1)!.total, 2);
  for (const s of r.seen) {
    assert.equal(s.table, "subscriptions");
    assert.equal(s.params.get("livemode"), "eq.false");
    assert.equal(s.params.get("status"), "in.(active,trialing)");
  }
});

test("production without a live key: no subscriptions, and none are read", async () => {
  env.VERCEL_ENV = "production";
  env.STRIPE_SECRET_KEY = "sk_test_x";
  const r = await call("?metric=subscriptions&range=12m", {
    subscriptions: [{ created_at: daysAgo(3), livemode: false, status: "active" }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.seen.length, 0);
  assert.equal(r.body.data.points.length, 12);
  assert.ok(r.body.data.points.every((p: { total: number }) => p.total === 0));
});

test("all time starts at the earliest record", async () => {
  const profiles = [{ created_at: daysAgo(400) }, { created_at: daysAgo(5) }];
  const r = await call("?metric=users&range=all", { profiles });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.startTotal, 0);
  assert.equal(r.body.data.points.at(-1)!.total, 2);
  assert.ok(r.body.data.points.length >= 13 && r.body.data.points.length <= 15);
});

test("a database failure is a 500 with no detail passed on", async () => {
  const r = await call("?metric=users&range=6m", { failTable: "profiles" });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "DATABASE_ERROR" });
  assert.doesNotMatch(r.text, /secret detail|relation/);
});

test("buckets: day, week and month granularity; the last ends now; all time stays bounded", () => {
  const now = new Date("2026-10-19T15:00:00Z");
  const d30 = growthBuckets("30d", now, null);
  assert.equal(d30.length, 30);
  assert.equal(d30[0].start.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(d30.at(-1)!.end.getTime(), now.getTime());
  const w = growthBuckets("90d", now, null);
  assert.equal(w.length, 13);
  assert.equal(w[1].start.getTime() - w[0].start.getTime(), 7 * 86_400_000);
  const m6 = growthBuckets("6m", now, null);
  assert.deepEqual(
    m6.map((b) => b.label),
    ["May 26", "Jun 26", "Jul 26", "Aug 26", "Sep 26", "Oct 26"],
  );
  assert.equal(growthBuckets("12m", now, null).length, 12);
  const decade = growthBuckets("all", now, new Date("2016-01-15T00:00:00Z"));
  assert.ok(decade.length <= 36);
  assert.ok(decade[0].start <= new Date("2016-01-15T00:00:00Z"));
  for (let i = 1; i < decade.length; i++)
    assert.equal(decade[i].start.getTime(), decade[i - 1].end.getTime());
});
