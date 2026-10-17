import {
  addMember,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  grantPlan,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Phase 4B-2: what a workspace's subscription gives it, decided on the server
// (src/lib/server/plan-access.ts) — Starter 1 channel and 5 AI analyses a month, Pro 3 and 50,
// Scale 10 and 250 plus team management; a 14-day trial gets its plan in full; without an active
// or trialing subscription the paid routes refuse (402) and nothing is read, while billing,
// settings, team and recovery stay open and no data is touched.

const env = (globalThis as Record<string, unknown>).__env__ as Record<string, string>;
env.OPENROUTER_API_KEY = "or-test-key";
env.STRIPE_WEBHOOK_SECRET = "whsec_plan_tests";
env.STRIPE_SECRET_KEY = "sk_test_key";

const routes = {
  commandCenter: await import("../src/routes/api.revenue.command-center"),
  trackingLinks: await import("../src/routes/api.tracking-links"),
  notifications: await import("../src/routes/api.notifications"),
  members: await import("../src/routes/api.workspace.members"),
  subscription: await import("../src/routes/api.billing.subscription"),
  youtubeVideos: await import("../src/routes/api.youtube.videos"),
  connections: await import("../src/routes/api.youtube.connections"),
  analyzeContent: await import("../src/routes/api.videos.analyze-content"),
  webhook: await import("../src/routes/api.stripe.webhook"),
};
const { PLAN_LIMITS, aiMonthStart, resolveWorkspacePlan } =
  await import("../src/lib/server/plan-access");
const { reserveAiAnalysis } = await import("../src/lib/server/ai-usage");

type Plan = "starter" | "pro" | "scale";

function world(options: { plan?: Plan | null; status?: string } = {}) {
  const w: World = emptyWorld();
  w.features.push({ id: "feature-links", key: "link_tracking", is_active: true });
  const owner = addUser(w, "owner@x.test");
  const editor = addUser(w, "editor@x.test");
  const stranger = addUser(w, "stranger@x.test");
  const ws = addWorkspace(w, owner);
  addMember(w, ws, editor, "editor");
  const other = addWorkspace(w, stranger);
  grantPlan(w, stranger, "scale");
  if (options.plan !== null)
    grantPlan(w, owner, options.plan ?? "scale", options.status ?? "active");
  const rows = w as unknown as Record<string, Array<Record<string, unknown>>>;
  rows.youtube_channels = [];
  rows.ai_usage = [];
  rows.plans = [];
  // The AI provider: counts its calls; "fail" answers with an error.
  const provider = { calls: 0, fail: false };
  w.external = (url, init) => {
    if (url.hostname === "openrouter.ai" && init.method === "POST") {
      provider.calls++;
      if (provider.fail) return new Response("{}", { status: 500 });
      const analysis = {
        mainTopic: "Design",
        contentType: "Tutorial",
        audienceIntent: "Learn how to design",
        complexity: "Beginner",
        engagementPotential: "Medium",
        summary: "A tutorial.",
        topics: ["design"],
        strengths: ["clear"],
        opportunities: ["shorter intro"],
      };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }),
        { status: 200 },
      );
    }
    return undefined;
  };
  return { w, owner, editor, stranger, ws, other, rows, provider };
}
type F = ReturnType<typeof world>;

const get = (f: F, who: string, route: { Route: unknown }, path: string, query = "") =>
  callTeamApi(route, f.w, { as: who, method: "GET", path, query });
const PLAN_TABLES = new Set(["workspace_members", "workspaces", "subscriptions", "profiles"]);
const onlyPlanReads = (r: CallResult) =>
  r.reads.every((read) => PLAN_TABLES.has(String(read.table)));

// ---------- plan resolution ----------

test("the approved limits", () => {
  assert.deepEqual(PLAN_LIMITS, {
    starter: { channels: 1, aiAnalysesPerMonth: 5, teamManagement: false },
    pro: { channels: 3, aiAnalysesPerMonth: 50, teamManagement: false },
    scale: { channels: 10, aiAnalysesPerMonth: 250, teamManagement: true },
  });
});

test("paid routes: an active or trialing subscription opens them; anything else is 402 and nothing is read", async () => {
  for (const [plan, status, expected] of [
    ["starter", "active", 200],
    ["pro", "trialing", 200],
    ["scale", "active", 200],
    ["scale", "past_due", 402],
    ["scale", "unpaid", 402],
    ["scale", "canceled", 402],
    ["scale", "incomplete", 402],
    ["scale", "incomplete_expired", 402],
  ] as const) {
    const f = world({ plan, status });
    const r = await get(f, f.owner, routes.commandCenter, "/api/revenue/command-center");
    assert.equal(r.status, expected, `${plan} ${status}: ${r.text}`);
    if (expected === 402) {
      assert.equal(r.body.error, "SUBSCRIPTION_REQUIRED");
      assert.match(r.body.message, /14-day trial/);
      assert.ok(onlyPlanReads(r), `${status}: no workspace data is read`);
    }
  }
  const none = world({ plan: null });
  for (const [route, path] of [
    [routes.commandCenter, "/api/revenue/command-center"],
    [routes.trackingLinks, "/api/tracking-links"],
    [routes.youtubeVideos, "/api/youtube/videos"],
  ] as const) {
    const r = await get(none, none.owner, route, path);
    assert.equal(r.status, 402, path);
    assert.ok(onlyPlanReads(r), `${path}: nothing but the plan check is read`);
    assert.equal(r.writes.length, 0);
  }
});

test("the plan is the workspace owner's: a member's own subscription neither grants nor removes it", async () => {
  const unpaid = world({ plan: null });
  grantPlan(unpaid.w, unpaid.editor, "scale"); // the editor pays for Scale personally …
  assert.equal(
    (await get(unpaid, unpaid.editor, routes.commandCenter, "/api/revenue/command-center")).status,
    402,
    "… which buys nothing inside someone else's workspace",
  );
  const paid = world({ plan: "starter" });
  assert.equal(
    (await get(paid, paid.editor, routes.commandCenter, "/api/revenue/command-center")).status,
    200,
    "a member of a paid workspace has its plan without paying",
  );
  // Another workspace's plan opens nothing here, and this one's nothing there.
  assert.equal(
    (await get(unpaid, unpaid.stranger, routes.commandCenter, "/api/revenue/command-center"))
      .status,
    200,
  );
});

test("a plan that cannot be read is refused (503), never assumed", async () => {
  const f = world({ plan: "scale" });
  f.w.failingReads = ["subscriptions"];
  const r = await get(f, f.owner, routes.commandCenter, "/api/revenue/command-center");
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "ENTITLEMENT_UNAVAILABLE");
});

test("platform staff get Scale in a workspace they belong to (the existing staff exception), nowhere else", async () => {
  const f = world({ plan: null });
  const staff = addUser(f.w, "staff@tubify.test", "superadmin");
  addMember(f.w, f.ws, staff, "editor");
  assert.equal(
    (await get(f, staff, routes.commandCenter, "/api/revenue/command-center")).status,
    200,
  );
  // The owner of that same workspace, not staff, is still refused.
  assert.equal(
    (await get(f, f.owner, routes.commandCenter, "/api/revenue/command-center")).status,
    402,
  );
});

test("without a plan, billing, team, notifications and the plan notice stay open — and data is kept", async () => {
  const f = world({ plan: null });
  f.rows.youtube_channels.push({
    id: uuid(),
    workspace_id: f.ws,
    youtube_channel_id: "UCkept",
    connection_id: uuid(),
  });
  const before = JSON.stringify(f.rows.youtube_channels);
  for (const [route, path] of [
    [routes.notifications, "/api/notifications"],
    [routes.members, "/api/workspace/members"],
    [routes.subscription, "/api/billing/subscription"],
  ] as const) {
    const r = await get(f, f.owner, route, path);
    assert.equal(r.status, 200, `${path}: ${r.text}`);
  }
  const sub = await get(f, f.owner, routes.subscription, "/api/billing/subscription");
  assert.deepEqual(sub.body.data.access, {
    plan: null,
    status: null,
    source: "none",
    periodEnd: null,
    isOwner: true,
  });
  const member = await get(f, f.editor, routes.subscription, "/api/billing/subscription");
  assert.equal(member.body.data.access.isOwner, false);
  assert.equal(JSON.stringify(f.rows.youtube_channels), before, "nothing is deleted or changed");
  // With a trial, the notice knows when it ends.
  const t = world({ plan: "pro", status: "trialing" });
  t.w.subscriptions.find((s) => s.user_id === t.owner)!.current_period_end =
    "2026-11-01T00:00:00.000Z";
  const trial = await get(t, t.owner, routes.subscription, "/api/billing/subscription");
  assert.deepEqual(trial.body.data.access, {
    plan: "pro",
    status: "trialing",
    source: "subscription",
    periodEnd: "2026-11-01T00:00:00.000Z",
    isOwner: true,
  });
});

// ---------- channels ----------

const connect = (f: F, who: string, channelId: string) =>
  callTeamApi(routes.connections, f.w, {
    as: who,
    method: "POST",
    path: "/api/youtube/connections",
    body: { connectionId: uuid(), channelId },
  });
const connectedChannels = (f: F, workspaceId: string, count: number, prefix = "UCown") => {
  for (let i = 0; i < count; i++)
    f.rows.youtube_channels.push({
      id: uuid(),
      workspace_id: workspaceId,
      youtube_channel_id: `${prefix}${i}`,
      connection_id: uuid(),
    });
};
const channelWrites = (r: CallResult) => r.writes.filter((x) => x.table === "youtube_channels");

test("each plan's channel limit: a new channel beyond it is refused before Google is asked", async () => {
  for (const plan of ["starter", "pro", "scale"] as const) {
    const limit = PLAN_LIMITS[plan].channels;
    const f = world({ plan });
    connectedChannels(f, f.ws, limit);
    const r = await connect(f, f.owner, "UCnew");
    assert.equal(r.status, 409, `${plan}: ${r.text}`);
    assert.equal(r.body.error, "CHANNEL_LIMIT_REACHED");
    assert.equal(r.body.limit, limit);
    assert.match(r.body.message, /Disconnect one or upgrade/);
    assert.deepEqual(channelWrites(r), []);
    // One below the limit, the same request goes on (to the connection lookup, past the limit).
    const g = world({ plan });
    connectedChannels(g, g.ws, limit - 1);
    const allowed = await connect(g, g.owner, "UCnew");
    assert.ok(![402, 409].includes(allowed.status), `${plan}: under the limit (${allowed.status})`);
  }
});

test("renewing a connected channel is always allowed; disconnected channels and other workspaces do not count", async () => {
  const f = world({ plan: "starter" });
  connectedChannels(f, f.ws, 1);
  const renew = await connect(f, f.owner, "UCown0");
  assert.ok(![402, 409].includes(renew.status), `renewal is not a new channel (${renew.status})`);
  // A disconnected channel (connection_id null) keeps its row and does not count …
  const g = world({ plan: "starter" });
  g.rows.youtube_channels.push({
    id: uuid(),
    workspace_id: g.ws,
    youtube_channel_id: "UCgone",
    connection_id: null,
  });
  // … nor do another workspace's ten.
  connectedChannels(g, g.other, 10, "UCtheirs");
  const r = await connect(g, g.owner, "UCnew");
  assert.ok(![402, 409].includes(r.status), `${r.status}`);
});

test("after a downgrade the workspace keeps every channel; it only cannot add another", async () => {
  const f = world({ plan: "starter" }); // was Scale, with four channels
  connectedChannels(f, f.ws, 4);
  const before = JSON.stringify(f.rows.youtube_channels);
  const r = await connect(f, f.owner, "UCnew");
  assert.equal(r.status, 409);
  assert.deepEqual(channelWrites(r), []);
  assert.equal(JSON.stringify(f.rows.youtube_channels), before, "no channel deleted or detached");
  assert.equal(
    f.rows.youtube_channels.filter((c) => c.connection_id !== null).length,
    4,
    "all four stay connected",
  );
  const renew = await connect(f, f.owner, "UCown2");
  assert.ok(![402, 409].includes(renew.status), "renewing one of them still works");
});

test("connecting a channel needs a subscription; renewing one does not", async () => {
  const f = world({ plan: null });
  connectedChannels(f, f.ws, 1);
  const r = await connect(f, f.owner, "UCnew");
  assert.equal(r.status, 402);
  assert.equal(r.body.error, "SUBSCRIPTION_REQUIRED");
  assert.deepEqual(channelWrites(r), []);
  const renew = await connect(f, f.owner, "UCown0");
  assert.ok(![402, 409].includes(renew.status), `${renew.status}`);
  // A channel list that cannot be read refuses (never "probably under the limit").
  const g = world({ plan: "scale" });
  g.w.failingReads = ["youtube_channels"];
  assert.equal((await connect(g, g.owner, "UCnew")).status, 500);
});

test("both connect paths check the limit before writing, and re-check it after (connections at the same moment)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "src/routes/api.youtube.connections.ts",
    "src/routes/api.youtube.callback.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    const check = source.indexOf("await channelCapacity(");
    const upsert =
      source.indexOf('.from("youtube_channels")\n', check) >= 0
        ? source.indexOf('onConflict: "workspace_id,youtube_channel_id"', check)
        : -1;
    const recheck = source.indexOf("await overChannelLimit(");
    assert.ok(check > 0 && upsert > check && recheck > upsert, file);
    assert.match(
      source,
      /\.update\(\{ connection_id: null \}\)/,
      `${file}: detaches, never deletes`,
    );
  }
});

// ---------- AI: one monthly allowance per workspace ----------

const analyze = (f: F, who: string) =>
  callTeamApi(routes.analyzeContent, f.w, {
    as: who,
    method: "POST",
    path: "/api/videos/analyze-content",
    body: { title: "How to design" },
  });
const usage = (f: F, userId: string, count: number, extra: Record<string, unknown> = {}) => {
  for (let i = 0; i < count; i++)
    f.rows.ai_usage.push({
      id: uuid(),
      user_id: userId,
      provider: "openrouter",
      model: "m",
      task: "content_analysis",
      cache_hit: false,
      created_at: earlierThisMonth(),
      ...extra,
    });
};
// Earlier this month, but not within the last minute (that would be the burst limit's window).
const earlierThisMonth = () =>
  new Date(
    Math.max(aiMonthStart(new Date()).getTime() + 1000, Date.now() - 10 * 60_000),
  ).toISOString();
const lastMonth = () => {
  const start = aiMonthStart(new Date());
  return new Date(start.getTime() - 86_400_000).toISOString();
};

test("each plan's monthly allowance: the last analysis is allowed, the next is refused before the provider is called", async () => {
  for (const plan of ["starter", "pro", "scale"] as const) {
    const limit = PLAN_LIMITS[plan].aiAnalysesPerMonth;
    const f = world({ plan });
    usage(f, f.owner, limit - 1);
    const last = await analyze(f, f.owner);
    assert.equal(last.status, 200, `${plan}: ${last.text}`);
    assert.equal(f.provider.calls, 1);
    const over = await analyze(f, f.owner);
    assert.equal(over.status, 429, plan);
    assert.equal(over.body.error, "AI_QUOTA_EXCEEDED");
    assert.equal(over.body.limit, limit);
    assert.equal(f.provider.calls, 1, `${plan}: the provider is not called`);
    assert.equal(
      f.rows.ai_usage.filter((u) => u.cache_hit === false).length,
      limit,
      "the refused request leaves nothing counted",
    );
  }
});

test("the allowance is the workspace's: shared by its members, untouched by other workspaces, cache hits and last month", async () => {
  const f = world({ plan: "starter" });
  usage(f, f.owner, 2);
  usage(f, f.editor, 2);
  usage(f, f.owner, 6, { cache_hit: true }); // answered from the cache: free
  usage(f, f.owner, 9, { created_at: lastMonth() }); // last month: reset
  usage(f, f.stranger, 30); // another workspace
  assert.equal((await analyze(f, f.editor)).status, 200, "the 5th of 5");
  const over = await analyze(f, f.owner);
  assert.equal(over.status, 429, "the owner shares the editor's allowance");
  assert.equal(new Date(over.body.resetsAt).getUTCDate(), 1, "it resets on the 1st, UTC");
  assert.ok(new Date(over.body.resetsAt) > new Date());
  // The other workspace's own allowance is its own.
  const g = world({ plan: "scale" });
  usage(g, g.owner, 30);
  assert.equal((await analyze(g, g.owner)).status, 200);
});

test("a failed provider call gives the analysis back; an allowance that cannot be checked refuses", async () => {
  const f = world({ plan: "starter" });
  usage(f, f.owner, 4);
  f.provider.fail = true;
  const failed = await analyze(f, f.owner);
  assert.ok(failed.status >= 500, failed.text);
  assert.equal(f.rows.ai_usage.length, 4, "not counted");
  f.provider.fail = false;
  assert.equal((await analyze(f, f.owner)).status, 200, "the 5th is still there");
  const g = world({ plan: "scale" });
  g.w.failingReads = ["ai_usage"];
  const r = await analyze(g, g.owner);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "AI_QUOTA_UNAVAILABLE");
  assert.equal(g.provider.calls, 0);
  const none = world({ plan: null });
  assert.equal((await analyze(none, none.owner)).status, 402);
  assert.equal(none.provider.calls, 0);
});

test("requests at the same moment can never take more than the allowance", async () => {
  // An in-memory store whose every call yields, so two reservations interleave step by step.
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 4; i++)
    rows.push({
      id: `old${i}`,
      task: "content_analysis",
      user_id: "u1",
      cache_hit: false,
      created_at: new Date().toISOString(),
    });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const store = {
    from(table: string) {
      const q: {
        filters: Array<(r: Record<string, unknown>) => boolean>;
        op: string;
        row?: Record<string, unknown>;
      } = {
        filters: [],
        op: "select",
      };
      const builder = {
        select: () => builder,
        insert: (row: Record<string, unknown>) => ((q.op = "insert"), (q.row = row), builder),
        delete: () => ((q.op = "delete"), builder),
        eq: (column: string, value: unknown) => (
          q.filters.push((r) => r[column] === value),
          builder
        ),
        in: (column: string, values: unknown[]) => (
          q.filters.push((r) => values.includes(r[column])),
          builder
        ),
        gte: (column: string, value: string) => (
          q.filters.push((r) => String(r[column]) >= value),
          builder
        ),
        not: () => builder,
        single: () => builder,
        then: async (resolve: (value: unknown) => void) => {
          await tick();
          if (table === "workspace_members")
            return resolve({ data: [{ user_id: "u1" }], error: null });
          if (q.op === "insert") {
            const created = { ...q.row, id: uuid(), created_at: new Date().toISOString() };
            rows.push(created);
            return resolve({ data: { id: created.id }, error: null });
          }
          const matching = rows.filter((r) => q.filters.every((f) => f(r)));
          if (q.op === "delete") {
            for (const r of matching) rows.splice(rows.indexOf(r), 1);
            return resolve({ error: null });
          }
          return resolve({ count: matching.length, data: null, error: null });
        },
      };
      return builder;
    },
  };
  const plan = {
    plan: "starter" as const,
    limits: PLAN_LIMITS.starter,
    source: "subscription" as const,
    status: "active" as const,
    periodEnd: null,
  };
  const outcomes = await Promise.allSettled(
    [1, 2, 3].map(() =>
      reserveAiAnalysis(
        store as never,
        { userId: "u1", workspaceId: "w1", plan },
        {
          provider: "p",
          model: "m",
          task: "content_analysis",
        },
      ),
    ),
  );
  const granted = outcomes.filter((o) => o.status === "fulfilled").length;
  assert.ok(granted <= 1, `at most the one remaining analysis is granted (${granted})`);
  assert.ok(rows.length <= 5, "never more than the allowance counted");
});

// ---------- the trial through Stripe's lifecycle ----------

const PRICE = "price_pro_month";
function signed(event: Record<string, unknown>) {
  const at = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return `t=${at},v1=${createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${at}.${body}`).digest("hex")}`;
}

test("a trial gives its plan; canceling it keeps access until Stripe ends it; an unpaid end removes it", async () => {
  const f = world({ plan: null });
  const planId = uuid();
  f.rows.plans.push({
    id: planId,
    name: "Pro",
    slug: "pro",
    is_active: true,
    is_public: true,
    sort_order: 1,
  });
  f.rows.plan_prices = [
    {
      id: uuid(),
      plan_id: planId,
      billing_interval: "month",
      amount_cents: 7900,
      currency: "usd",
      stripe_price_id: PRICE,
      is_active: true,
    },
  ];
  let held = {
    id: "sub_trial",
    status: "trialing",
    customer: "cus_1",
    current_period_end: 1_900_000_000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: PRICE } }] },
    metadata: { user_id: f.owner },
  };
  const provider = f.w.external!;
  f.w.external = (url, init) =>
    url.origin === "https://api.stripe.com" && url.pathname === "/v1/subscriptions/sub_trial"
      ? new Response(JSON.stringify(held), { status: 200 })
      : provider(url, init);
  const deliver = (event: Record<string, unknown>) =>
    callTeamApi(routes.webhook, f.w, {
      as: null,
      method: "POST",
      path: "/api/stripe/webhook",
      body: event,
      headers: { "stripe-signature": signed(event) },
    });
  const access = async () =>
    (await get(f, f.owner, routes.commandCenter, "/api/revenue/command-center")).status;
  const update = (id: string) => ({
    id,
    type: "customer.subscription.updated",
    data: { object: held },
  });

  assert.equal(await access(), 402, "before Checkout");
  const checkout = {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs",
        client_reference_id: f.owner,
        customer: "cus_1",
        subscription: "sub_trial",
        customer_email: null,
      },
    },
  };
  assert.equal((await deliver(checkout)).status, 200);
  assert.equal(await access(), 200, "trialing: the Pro plan in full");
  // Canceled during the trial: Stripe keeps it trialing until the trial's end.
  held = { ...held, cancel_at_period_end: true };
  await deliver(update("evt_cancel"));
  assert.equal(await access(), 200, "access until the end Stripe keeps it for");
  // The trial ends without a payment: past due — no plan, data kept.
  held = { ...held, status: "past_due", cancel_at_period_end: false };
  await deliver(update("evt_unpaid"));
  assert.equal(await access(), 402);
  // Paid: active again, the same subscription.
  held = { ...held, status: "active" };
  await deliver(update("evt_paid"));
  assert.equal(await access(), 200);
  assert.equal(f.w.subscriptions.filter((s) => s.user_id === f.owner).length, 1);
  // Through the shared resolver as well.
  const plan = await resolveWorkspacePlan(
    {
      from: () => {
        throw new Error("the resolver is exercised through the routes above");
      },
    } as never,
    { workspaceId: f.ws, userId: f.owner },
  );
  assert.equal(plan.source, "unavailable", "a client that fails is no plan, never a guess");
});

// ---------- no way around it ----------

test("every AI analysis in the routes draws on the same monthly allowance; chat has its own limits", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const generators =
    /\b(generateVideoAnalysis|generatePrePublishVideoAnalysis|generateContentAnalysis|generateProjectConcept|generateOptimizationSuggestions|generateLeadSummary|generateAssistantReply|generateFreebieContent)\(/;
  const callers = readdirSync("src/routes")
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => generators.test(readFileSync(`src/routes/${file}`, "utf8")));
  assert.equal(callers.length, 8, callers.join(", "));
  for (const file of callers) {
    const source = readFileSync(`src/routes/${file}`, "utf8");
    // Ordinary chat has its own limits instead (approved: chat is not an analysis).
    if (file === "api.assistant.chat.ts") {
      assert.match(source, /enforceChatLimit\(/, file);
      continue;
    }
    assert.ok(
      /enforceAiQuota\(/.test(source) || /reserveAiAnalysis\(/.test(source),
      `${file} takes from the allowance`,
    );
  }
  // The old per-day window, which never matched the plans, is gone.
  const usageSource = readFileSync("src/lib/server/ai-usage.ts", "utf8");
  assert.doesNotMatch(usageSource, /perDay|oneDayAgo/);
});

test("the plan notice: why access is restricted and how to get it back, or how long a trial has left", async () => {
  const { planNotice } = await import("../src/lib/plan-notice");
  const owner = planNotice({
    plan: null,
    status: null,
    source: "none",
    periodEnd: null,
    isOwner: true,
  });
  assert.equal(owner?.action?.to, "/billing");
  assert.match(owner!.body, /14-day free trial/);
  assert.match(owner!.body, /data is kept/);
  const member = planNotice({
    plan: null,
    status: null,
    source: "none",
    periodEnd: null,
    isOwner: false,
  });
  assert.equal(member?.action, null, "a member is told to ask the owner, not shown a button");
  assert.equal(
    planNotice({ plan: null, status: null, source: "unavailable", periodEnd: null, isOwner: true }),
    null,
    "a passing failure is not presented as 'no subscription'",
  );
  const trial = planNotice(
    {
      plan: "pro",
      status: "trialing",
      source: "subscription",
      periodEnd: "2026-11-01T00:00:00Z",
      isOwner: true,
    },
    new Date("2026-10-25T00:00:00Z"),
  );
  assert.equal(trial?.title, "Pro trial — 7 days left");
  assert.match(trial!.body, /Billing starts on Nov 1, 2026 unless you cancel/);
  assert.equal(
    planNotice({
      plan: "scale",
      status: "active",
      source: "subscription",
      periodEnd: null,
      isOwner: true,
    }),
    null,
  );
});

// ---------- assistant chat: its own limits, never the analysis allowance ----------

const chatRoute = await import("../src/routes/api.assistant.chat");
const chat = (f: F, who: string) =>
  callTeamApi(chatRoute, f.w, {
    as: who,
    method: "POST",
    path: "/api/assistant/chat",
    body: { message: "How are my videos doing?" },
  });
const chatRows = (f: F) => f.rows.ai_usage.filter((u) => u.task === "assistant_chat");

test("chat works with the month's analyses used up, and chatting never uses an analysis", async () => {
  const f = world({ plan: "starter" });
  usage(f, f.owner, 5); // the month's five analyses, all used
  assert.equal((await analyze(f, f.owner)).status, 429, "analyses: none left");
  const r = await chat(f, f.owner);
  assert.equal(r.status, 200, r.text);
  assert.equal(chatRows(f).length, 1, "the message is logged");
  assert.equal((await analyze(f, f.owner)).status, 429, "chatting gave no analysis back or away");
  // The other way round: a month of chatting leaves the analyses untouched.
  const g = world({ plan: "starter" });
  usage(g, g.owner, 4);
  usage(g, g.owner, 25, { task: "assistant_chat" });
  assert.equal((await analyze(g, g.owner)).status, 200, "the 5th analysis is still there");
});

test("chat keeps its own limits: a daily cap by plan and the per-minute burst limit", async () => {
  const f = world({ plan: "starter" });
  usage(f, f.owner, 30, { task: "assistant_chat" }); // today's 30, earlier today
  const capped = await chat(f, f.owner);
  assert.equal(capped.status, 429);
  assert.equal(capped.body.error, "CHAT_LIMIT_EXCEEDED");
  assert.equal(capped.body.limit, 30);
  assert.equal(f.provider.calls, 0);
  // A larger plan, a larger cap.
  const g = world({ plan: "pro" });
  usage(g, g.owner, 30, { task: "assistant_chat" });
  assert.equal((await chat(g, g.owner)).status, 200);
  // Messages in the last minute: the burst limit.
  const h = world({ plan: "scale" });
  usage(h, h.owner, 20, { task: "assistant_chat", created_at: new Date().toISOString() });
  const burst = await chat(h, h.owner);
  assert.equal(burst.status, 429);
  assert.equal(burst.body.error, "RATE_LIMIT_EXCEEDED");
});

test("a failed chat is not counted, and chat needs a subscription like everything paid", async () => {
  const f = world({ plan: "starter" });
  f.provider.fail = true;
  const failed = await chat(f, f.owner);
  assert.ok(failed.status >= 500, failed.text);
  assert.equal(chatRows(f).length, 0);
  const none = world({ plan: null });
  assert.equal((await chat(none, none.owner)).status, 402);
  assert.equal(none.provider.calls, 0);
});

test("only the listed analysis tasks can be reserved — anything else is refused, never counted", async () => {
  const { ANALYSIS_TASKS, CHAT_TASK } = await import("../src/lib/server/ai-usage");
  assert.ok(!(ANALYSIS_TASKS as readonly string[]).includes(CHAT_TASK));
  assert.deepEqual([...ANALYSIS_TASKS].sort(), [
    "analyze_video",
    "content_analysis",
    "freebie_content",
    "lead_summary",
    "pre_publish_analysis",
    "project_concept",
    "video_optimize",
  ]);
  const plan = {
    plan: "scale" as const,
    limits: PLAN_LIMITS.scale,
    source: "subscription" as const,
    status: "active" as const,
    periodEnd: null,
  };
  await assert.rejects(
    reserveAiAnalysis(
      {} as never,
      { userId: "u", workspaceId: "w", plan },
      {
        provider: "p",
        model: "m",
        task: CHAT_TASK,
      },
    ),
    /NOT_AN_ANALYSIS_TASK/,
  );
  // Every route that calls a provider for an analysis names one of them.
  const { readFileSync } = await import("node:fs");
  for (const [file, task] of [
    ["src/routes/api.ai.analyze-video.ts", "analyze_video"],
    ["src/routes/api.pre-publish-videos.analyze.ts", "pre_publish_analysis"],
    ["src/routes/api.videos.analyze-content.ts", "content_analysis"],
    ["src/routes/api.videos.optimize.ts", "video_optimize"],
    ["src/routes/api.leads.summary.ts", "lead_summary"],
    ["src/routes/api.projects.ts", "project_concept"],
    ["src/routes/api.freebies.ts", "freebie_content"],
  ])
    assert.match(readFileSync(file, "utf8"), new RegExp(`"${task}"`), file);
  assert.match(readFileSync("src/routes/api.assistant.chat.ts", "utf8"), /enforceChatLimit\(/);
  assert.doesNotMatch(readFileSync("src/routes/api.assistant.chat.ts", "utf8"), /enforceAiQuota/);
});

// ---------- what stays open without a subscription, and what never does ----------

test("essential routes stay open without a subscription; paid routes never opt out", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file: string) => readFileSync(`src/routes/${file}`, "utf8");
  const gated =
    /requirePaidSession\(|getWorkspaceContext\(request\)|requireWorkspaceFeature\(request, "[a-z_]+"\)|revenueReadContext\(/;
  // Sign-in and recovery, billing and the trial, the billing portal, account and security
  // settings, YouTube authorization and channel settings, support, and the public pages a
  // creator's audience uses (tracked-link redirects, lead pages, opt-ins): no plan check at all.
  for (const file of [
    "api.billing.checkout.ts",
    "api.billing.portal.ts",
    "api.billing.subscription.ts",
    "api.profile.ts",
    "api.security.recovery-codes.ts",
    "api.settings.ts",
    "api.features.access.ts",
    "api.youtube.auth.ts",
    "api.youtube.channels.ts",
    "api.youtube.settings.ts",
    "api.support.contact.ts",
    "r.$slug.ts",
    "api.freebies.public.ts",
    "api.freebies.optin.ts",
    "api.referrals.click.ts",
  ])
    assert.doesNotMatch(read(file), gated, `${file} is open without a plan`);
  // Workspace routes a customer needs to subscribe, recover or manage their account opt out —
  // every call in them.
  for (const file of [
    "api.onboarding.status.ts",
    "api.notifications.ts",
    "api.workspace.members.ts",
    "api.workspace.branding.ts",
    "api.workspace.revenue-visibility.ts",
    "api.youtube.callback.ts",
    "api.youtube.connections.ts",
    "api.integrations.ts",
    "api.support.tickets.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, gated, `${file}: every call opts out`);
    assert.match(source, /requirePlan: false/, file);
  }
  // The paid routes — analytics, revenue, opportunities, links, deals, AI — never opt out.
  for (const file of [
    "api.revenue.command-center.ts",
    "api.revenue.summary.ts",
    "api.revenue.videos.ts",
    "api.videos.opportunities.ts",
    "api.tracking-links.ts",
    "api.deals.ts",
    "api.videos.deals.ts",
    "api.youtube.dashboard.ts",
    "api.youtube.videos.ts",
    "api.youtube.video.ts",
    "api.ai.analyze-video.ts",
    "api.videos.analyze-content.ts",
    "api.assistant.chat.ts",
  ])
    assert.doesNotMatch(read(file), /requirePlan: false/, `${file} stays paid`);
});

// ---------- Phase 4B-2A: the 14-day transition for workspaces that existed before the paywall ----------

const { transitionWindow, transitionApplies, TRANSITION_DAYS, TRANSITION_START_ENV } =
  await import("../src/lib/server/plan-access");
const checkoutRoute = await import("../src/routes/api.billing.checkout");
const DAY = 86_400_000;

/** Runs `body` with the transition configured to start at `start` (or unset). */
async function withTransition(start: string | undefined, body: () => Promise<void>) {
  const previous = env[TRANSITION_START_ENV];
  if (start === undefined) delete env[TRANSITION_START_ENV];
  else env[TRANSITION_START_ENV] = start;
  try {
    await body();
  } finally {
    if (previous === undefined) delete env[TRANSITION_START_ENV];
    else env[TRANSITION_START_ENV] = previous;
  }
}
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** A transition that started `daysAgo` days ago, and the owner's workspace created before it. */
function transitionWorld(daysAgo: number, options: Parameters<typeof world>[0] = { plan: null }) {
  const f = world(options);
  const start = Date.now() - daysAgo * DAY;
  f.w.workspaces.find((w) => w.id === f.ws)!.created_at = iso(start - 30 * DAY);
  // The other workspace was created after the start: never eligible.
  f.w.workspaces.find((w) => w.id === f.other)!.created_at = iso(start + 60_000);
  return {
    ...f,
    start: iso(start),
    end: new Date(Date.parse(iso(start)) + TRANSITION_DAYS * DAY),
  };
}
const cc = (f: F, who: string) => get(f, who, routes.commandCenter, "/api/revenue/command-center");

test("transition: the window is the configured start plus exactly 14 days; eligibility is created-before-start", () => {
  const window = transitionWindow("2026-10-20T15:00:00Z")!;
  assert.equal(window.start.toISOString(), "2026-10-20T15:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-11-03T15:00:00.000Z");
  const before = "2026-10-01T00:00:00Z";
  assert.equal(transitionApplies(before, new Date("2026-11-03T14:59:59.999Z"), window), true);
  assert.equal(
    transitionApplies(before, new Date("2026-11-03T15:00:00.000Z"), window),
    false,
    "ends exactly at the end",
  );
  assert.equal(
    transitionApplies(before, new Date("2026-10-19T00:00:00Z"), window),
    true,
    "no gap before the start",
  );
  assert.equal(
    transitionApplies("2026-10-20T15:00:00Z", new Date("2026-10-21T00:00:00Z"), window),
    false,
    "created at the start is not before it",
  );
  assert.equal(
    transitionApplies("2026-10-25T00:00:00Z", new Date("2026-10-26T00:00:00Z"), window),
    false,
    "created after the start: never",
  );
  assert.equal(transitionApplies(null, new Date("2026-10-21T00:00:00Z"), window), false);
});

test("transition: missing or invalid configuration means no transition — the normal paywall", async () => {
  for (const raw of [
    undefined,
    "",
    "2026-10-20",
    "2026-10-20T15:00:00",
    "2026-10-20T15:00:00+02:00",
    "soon",
    "2026-13-40T99:00:00Z",
  ])
    assert.equal(transitionWindow(raw), null, String(raw));
  const f = transitionWorld(1);
  for (const raw of [undefined, "next week", "2026-10-20 15:00"])
    await withTransition(raw, async () => {
      assert.equal((await cc(f, f.owner)).status, 402, String(raw));
    });
});

test("transition: a workspace from before the start keeps its access during the window, on every paid route", async () => {
  const f = transitionWorld(3);
  await withTransition(f.start, async () => {
    for (const [route, path] of [
      [routes.commandCenter, "/api/revenue/command-center"],
      [routes.trackingLinks, "/api/tracking-links"],
    ] as const) {
      const r = await get(f, f.owner, route, path);
      assert.equal(r.status, 200, `${path}: ${r.text}`);
    }
    // The member of that workspace too — without a subscription of their own.
    assert.equal((await cc(f, f.editor)).status, 200);
    const sub = await get(f, f.owner, routes.subscription, "/api/billing/subscription");
    assert.deepEqual(sub.body.data.access, {
      plan: null,
      status: null,
      source: "transition",
      periodEnd: f.end.toISOString(),
      isOwner: true,
    });
  });
});

test("transition: a workspace created after the start never gets it — another workspace's transition opens nothing", async () => {
  const f = transitionWorld(3);
  // The stranger's workspace was created after the start and has no subscription of its own.
  f.w.subscriptions = f.w.subscriptions.filter((s) => s.user_id !== f.stranger);
  await withTransition(f.start, async () => {
    assert.equal((await cc(f, f.stranger)).status, 402);
    assert.equal((await cc(f, f.owner)).status, 200, "only the eligible workspace");
  });
});

test("transition: it expires at its end, requests cannot extend it, and expiry deletes nothing", async () => {
  const f = transitionWorld(TRANSITION_DAYS + 1 / 86_400); // ended one second ago
  f.rows.youtube_channels.push({
    id: uuid(),
    workspace_id: f.ws,
    youtube_channel_id: "UCkept",
    connection_id: uuid(),
  });
  usage(f, f.owner, 2);
  const before = JSON.stringify([f.rows.youtube_channels, f.rows.ai_usage, f.w.workspaces]);
  await withTransition(f.start, async () => {
    for (let i = 0; i < 3; i++) {
      const r = await cc(f, f.owner);
      assert.equal(r.status, 402);
      assert.equal(r.writes.length, 0, "nothing is written, so nothing can extend it");
    }
  });
  assert.equal(
    JSON.stringify([f.rows.youtube_channels, f.rows.ai_usage, f.w.workspaces]),
    before,
    "data kept",
  );
  // During the window, repeated requests write nothing either — the end stays the configured one.
  const g = transitionWorld(13);
  await withTransition(g.start, async () => {
    const ends = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await get(g, g.owner, routes.subscription, "/api/billing/subscription");
      ends.add(r.body.data.access.periodEnd);
      assert.equal(r.writes.length, 0);
    }
    assert.deepEqual([...ends], [g.end.toISOString()]);
  });
});

test("transition: a real subscription takes precedence; a canceled one leaves the transition rules in force", async () => {
  const paid = transitionWorld(3, { plan: "pro" });
  await withTransition(paid.start, async () => {
    const sub = await get(paid, paid.owner, routes.subscription, "/api/billing/subscription");
    assert.equal(sub.body.data.access.source, "subscription");
    assert.equal(sub.body.data.access.plan, "pro");
  });
  // Canceled: during the window, the transition; after it, the paywall.
  const during = transitionWorld(3, { plan: "pro", status: "canceled" });
  await withTransition(during.start, async () => {
    assert.equal((await cc(during, during.owner)).status, 200);
  });
  const after = transitionWorld(15, { plan: "pro", status: "canceled" });
  await withTransition(after.start, async () => {
    assert.equal((await cc(after, after.owner)).status, 402);
  });
});

test("transition: the previous channel rules — every channel kept and renewable, new ones without a cap", async () => {
  const f = transitionWorld(3);
  connectedChannels(f, f.ws, 12); // more than even Scale allows
  const before = JSON.stringify(f.rows.youtube_channels);
  await withTransition(f.start, async () => {
    const added = await connect(f, f.owner, "UCnew");
    assert.ok(![402, 409].includes(added.status), `a new channel is not capped (${added.status})`);
    const renewed = await connect(f, f.owner, "UCown3");
    assert.ok(![402, 409].includes(renewed.status), `renewal works (${renewed.status})`);
  });
  assert.equal(JSON.stringify(f.rows.youtube_channels), before, "every channel kept as it was");
});

test("transition: the previous AI allowance — 10 per rolling 24 hours per user, for each AI feature", async () => {
  const f = transitionWorld(3);
  await withTransition(f.start, async () => {
    usage(f, f.owner, 9); // nine content analyses earlier today
    usage(f, f.owner, 10, { task: "video_optimize" }); // another feature's own ten
    usage(f, f.owner, 5, { cache_hit: true }); // cached answers: free
    usage(f, f.owner, 7, { created_at: new Date(Date.now() - 25 * 3600_000).toISOString() }); // over 24h ago
    usage(f, f.editor, 10); // another user's own ten
    assert.equal((await analyze(f, f.owner)).status, 200, "the 10th");
    const over = await analyze(f, f.owner);
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "AI_QUOTA_EXCEEDED");
    assert.equal(over.body.limit, 10);
    assert.equal(over.body.window, "day");
    assert.equal(f.provider.calls, 1, "the 11th never reaches the provider");
    // Chat keeps its previous limit too: 10 in 24 hours.
    usage(f, f.owner, 10, { task: "assistant_chat" });
    const chatted = await chat(f, f.owner);
    assert.equal(chatted.status, 429);
    assert.equal(chatted.body.error, "CHAT_LIMIT_EXCEEDED");
    assert.equal(chatted.body.limit, 10);
  });
});

test("transition: no team management, and a paid subscription uses its own plan's limits instead", async () => {
  const f = transitionWorld(3);
  await withTransition(f.start, async () => {
    const invite = await callTeamApi(routes.members, f.w, {
      as: f.owner,
      method: "POST",
      path: "/api/workspace/members",
      body: { email: "new@x.test", role: "editor" },
    });
    assert.equal(invite.status, 403);
    assert.equal(
      invite.body.error,
      "PLAN_REQUIRED",
      "team management stays with a real Scale plan",
    );
    assert.equal(invite.writes.filter((x) => x.table === "workspace_members").length, 0);
  });
  // The same eligible workspace on Pro: Pro's three channels and fifty analyses a month apply.
  const paid = transitionWorld(3, { plan: "pro" });
  await withTransition(paid.start, async () => {
    connectedChannels(paid, paid.ws, 3);
    const capped = await connect(paid, paid.owner, "UCnew");
    assert.equal(capped.status, 409);
    assert.equal(capped.body.limit, 3);
    usage(paid, paid.owner, 50);
    const over = await analyze(paid, paid.owner);
    assert.equal(over.status, 429);
    assert.equal(over.body.limit, 50, "the monthly allowance, not the transition's");
  });
});

test("transition: the activation boundary — created one millisecond before the start is in, at the start is out", () => {
  const window = transitionWindow("2026-10-20T15:00:00Z")!;
  const during = new Date("2026-10-25T00:00:00Z");
  assert.equal(transitionApplies("2026-10-20T14:59:59.999Z", during, window), true);
  assert.equal(transitionApplies("2026-10-20T15:00:00.000Z", during, window), false);
  assert.equal(
    transitionApplies("2026-10-20T14:59:59.999Z", new Date(window.end.getTime() - 1), window),
    true,
  );
  assert.equal(transitionApplies("2026-10-20T14:59:59.999Z", window.end, window), false);
  assert.equal(
    transitionWindow("2026-10-20T15:00:00.500Z")!.end.toISOString(),
    "2026-11-03T15:00:00.500Z",
  );
});

test("transition: revenue visibility and workspace isolation are unchanged", async () => {
  const f = transitionWorld(3);
  Object.assign(
    f.w.workspaces.find((w) => w.id === f.ws)!,
    { editor_revenue_visible: false },
  );
  await withTransition(f.start, async () => {
    const editor = await cc(f, f.editor);
    assert.equal(editor.status, 200);
    assert.equal(editor.body.visibility.revenue, "hidden", "an editor still sees no amounts");
    const owner = await cc(f, f.owner);
    assert.equal(owner.body.visibility.revenue, "visible");
  });
});

test("transition: the introductory 14-day trial stays available to an owner who has never subscribed", async () => {
  const f = transitionWorld(3);
  const planId = uuid();
  f.rows.plans.push({
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
  });
  const sent: URLSearchParams[] = [];
  const provider = f.w.external!;
  f.w.external = (url, init) => {
    if (url.origin === "https://api.stripe.com" && url.pathname === "/v1/checkout/sessions") {
      sent.push(new URLSearchParams(init.body ?? ""));
      return new Response(JSON.stringify({ id: "cs", url: "https://checkout.stripe.com/c/cs" }), {
        status: 200,
      });
    }
    return provider(url, init);
  };
  await withTransition(f.start, async () => {
    const r = await callTeamApi(checkoutRoute, f.w, {
      as: f.owner,
      method: "POST",
      path: "/api/billing/checkout",
      body: { planId: "pro", interval: "month" },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.trialDays, 14, "the transition does not use up the trial");
    assert.equal(sent[0]?.get("subscription_data[trial_period_days]"), "14");
  });
});

test("transition: the notice gives the exact end, offers Billing, and is never called a trial", async () => {
  const { planNotice } = await import("../src/lib/plan-notice");
  const access = {
    plan: null,
    status: null,
    source: "transition",
    periodEnd: "2026-11-03T15:00:00.000Z",
  };
  const owner = planNotice({ ...access, isOwner: true })!;
  assert.equal(owner.title, "Your current access continues until Nov 3, 2026, 15:00 UTC");
  assert.equal(owner.tone, "info");
  assert.equal(owner.action?.to, "/billing");
  assert.match(owner.body, /14-day free trial/);
  assert.match(owner.body, /subscription is required/);
  assert.match(owner.body, /data is kept/);
  assert.doesNotMatch(owner.title, /trial/i);
  const member = planNotice({ ...access, isOwner: false })!;
  assert.equal(member.action, null);
  assert.match(member.body, /need a subscription of your own/);
  // A workspace that is not in the transition never sees it.
  assert.doesNotMatch(
    planNotice({ plan: null, status: null, source: "none", periodEnd: null, isOwner: true })!.title,
    /continues until/,
  );
});
