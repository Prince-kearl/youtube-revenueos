import assert from "node:assert/strict";
import { test } from "node:test";

// Runs the real GET /api/youtube/dashboard handler with every outside call (Supabase auth,
// PostgREST, YouTube Data API, YouTube Analytics) answered by a stub, and records exactly which
// YouTube Analytics reports it asks for. This is what shows that the route makes no live revenue
// or CPM request for anyone: revenue is read from the canonical revenue API (stored data), and
// the old revenue=0 opt-out the pages still send is simply ignored.

const SUPABASE = "https://testref.supabase.co";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  // 32 zero bytes, base64 — a throwaway key for this test only.
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const dashboardRoute = await import("../src/routes/api.youtube.dashboard");
const { Route } = dashboardRoute;

const CHANNEL_ROW = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000002";

interface AnalyticsCall {
  metrics: string;
  dimensions: string | null;
  filters: string | null;
}

async function callDashboard(query: string) {
  const analytics: AnalyticsCall[] = [];
  const writes: string[] = [];
  const channelRow = {
    id: CHANNEL_ROW,
    user_id: USER,
    youtube_channel_id: "UCtestchannel0000000000000",
    channel_name: "Test",
    channel_handle: "@test",
    thumbnail: null,
    subscriber_count: 10,
    connection: {
      id: "conn-1",
      access_token_ciphertext: await encryptSecretToBytea("access-token"),
      refresh_token_ciphertext: await encryptSecretToBytea("refresh-token"),
      token_expiry: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const wantsObject = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");

    if (url.origin === SUPABASE && url.pathname === "/auth/v1/user")
      return json({ id: USER, aud: "authenticated", role: "authenticated", email: "t@test" });
    if (url.origin === SUPABASE && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (method !== "GET") {
        writes.push(`${method} ${table}`);
        return json([], 201);
      }
      if (table === "youtube_channels") return json(wantsObject ? channelRow : [channelRow]);
      if (table === "youtube_integration_settings") {
        const settings = { auto_sync_videos: true, import_analytics: true };
        return json(wantsObject ? settings : [settings]);
      }
      return json(wantsObject ? null : []);
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/channels"))
      return json({
        items: [
          {
            id: channelRow.youtube_channel_id,
            snippet: { title: "Test", customUrl: "@test", thumbnails: {} },
            statistics: { subscriberCount: "10", viewCount: "500", videoCount: "3" },
            contentDetails: { relatedPlaylists: { uploads: "UUtestchannel0000000000000" } },
          },
        ],
      });
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/playlistItems"))
      return json({ items: [] });
    if (url.hostname === "youtubeanalytics.googleapis.com") {
      analytics.push({
        metrics: url.searchParams.get("metrics") ?? "",
        dimensions: url.searchParams.get("dimensions"),
        filters: url.searchParams.get("filters"),
      });
      const names = [
        ...(url.searchParams.get("dimensions")?.split(",") ?? []),
        ...(url.searchParams.get("metrics")?.split(",") ?? []),
      ];
      // One row of data for day reports so the route treats them as available.
      const isDay = url.searchParams.get("dimensions") === "day";
      return json({
        columnHeaders: names.map((name) => ({ name })),
        rows: isDay ? [names.map((name) => (name === "day" ? "2026-09-01" : 5))] : [],
      });
    }
    throw new Error(`unexpected request in test: ${method} ${url.origin}${url.pathname}`);
  }) as typeof fetch;

  try {
    const session = {
      access_token: "session-token",
      refresh_token: "session-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER, aud: "authenticated", role: "authenticated", email: "t@test" },
    };
    const cookie = `sb-testref-auth-token=${encodeURIComponent(
      `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    )}`;
    const handler = (
      Route as unknown as {
        options: {
          server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } };
        };
      }
    ).options.server.handlers.GET;
    const response = await handler({
      request: new Request(`https://app.test/api/youtube/dashboard${query}`, {
        headers: { Cookie: cookie },
      }),
    });
    const body = (await response.json()) as { status?: string; data?: Record<string, unknown> };
    return { status: response.status, body, data: body.data ?? {}, analytics, writes };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const isRevenueCall = (call: AnalyticsCall) =>
  /estimatedRevenue|estimatedAdRevenue|estimatedRedPartnerRevenue|cpm/i.test(call.metrics);

test("the live-revenue switch is gone: there is nothing left to opt out of", () => {
  assert.equal("dashboardWantsLiveRevenue" in dashboardRoute, false);
});

test("the Dashboard page's request (revenue=0) asks YouTube for no revenue report at all", async () => {
  const { status, data, analytics } = await callDashboard("?revenue=0");
  assert.equal(status, 200);
  assert.deepEqual(analytics.filter(isRevenueCall), [], "no revenue or CPM metric is requested");
  assert.ok(
    !analytics.some((call) => call.dimensions === "video"),
    "the top-videos-by-revenue report is not requested",
  );
  // What remains is the non-revenue set the other cards need.
  assert.deepEqual(
    analytics.map((call) => `${call.metrics} by ${call.dimensions}`).sort(),
    [
      "estimatedMinutesWatched by day",
      "viewerPercentage by ageGroup",
      "viewerPercentage by gender",
      "views by country",
      "views by day", // weekly engagement heatmap
      "views,subscribersGained by day",
    ].sort(),
  );
  // The response no longer carries the live revenue fields at all.
  for (const field of [
    "revenueStatus",
    "cpmStatus",
    "cpmByMonth",
    "topRevenueVideos",
    "topRevenueVideosStatus",
  ])
    assert.equal(field in data, false, field);
  const sections = data.sections as Record<string, unknown>;
  assert.equal("revenue" in sections, false);
  assert.equal("topRevenueVideos" in sections, false);
});

test("with revenue=0 the non-revenue Dashboard data is still all there", async () => {
  const { data } = await callDashboard("?revenue=0");
  assert.equal(data.analyticsStatus, "available");
  assert.equal(data.watchTimeStatus, "available");
  const rows = data.analytics as Array<Record<string, unknown>>;
  assert.deepEqual(rows, [
    { month: "2026-09", views: 5, subscribersGained: 5, watchTimeMinutes: 5 },
  ]);
  assert.ok(!("estimatedRevenue" in rows[0]), "no revenue column is fabricated");
  const channel = data.channel as Record<string, unknown>;
  assert.equal(channel.subscriberCount, 10);
  assert.equal(channel.viewCount, 500);
  assert.equal(channel.videoCount, 3);
  assert.ok(Array.isArray(data.engagementHeatmap));
  assert.equal(data.engagementHeatmapStatus, "available");
  assert.ok(data.audience && typeof data.audience === "object");
  assert.ok(Array.isArray(data.videos));
});

test("without the parameter the route makes exactly the same requests: no live revenue for anyone", async () => {
  const plain = await callDashboard("");
  const withOptOut = await callDashboard("?revenue=0");
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.analytics.filter(isRevenueCall), [], "no revenue or CPM metric");
  assert.ok(!plain.analytics.some((call) => call.dimensions === "video"));
  const requests = (run: typeof plain) =>
    run.analytics.map((call) => `${call.metrics} by ${call.dimensions}`).sort();
  assert.deepEqual(requests(plain), requests(withOptOut));
  assert.equal(plain.analytics.length, 6, "the six non-revenue reports the cards need");
  assert.deepEqual(Object.keys(plain.data).sort(), Object.keys(withOptOut.data).sort());
  const rows = plain.data.analytics as Array<Record<string, unknown>>;
  assert.ok(!("estimatedRevenue" in rows[0]), "no revenue column in the trend rows");
  assert.deepEqual([...new Set(plain.writes)].sort(), [...new Set(withOptOut.writes)].sort());
});

test("the route's source asks YouTube Analytics for no revenue or CPM metric", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/routes/api.youtube.dashboard.ts", "utf8");
  assert.doesNotMatch(source, /estimatedRevenue|estimatedAdRevenue|RedPartner|"cpm"|cpmByMonth/);
  assert.doesNotMatch(source, /topRevenueVideos/);
});
