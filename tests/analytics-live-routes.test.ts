import assert from "node:assert/strict";
import { test } from "node:test";

// Runs the real live YouTube route handlers the Analytics page still calls, with every outside
// call (Supabase auth, PostgREST, YouTube Data API, YouTube Analytics) answered by a stub, and
// records exactly which YouTube Analytics reports they ask for. This shows that neither route
// makes a live revenue or CPM request for the surfaces that read stored revenue — with or without
// the old revenue=0 / videoRevenue=0 parameters — while the non-revenue data still arrives and
// traffic sources keep the live revenue that has no stored equivalent.

const SUPABASE = "https://testref.supabase.co";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  // 32 zero bytes, base64 — a throwaway key for this test only.
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const dashboard = await import("../src/routes/api.youtube.dashboard");
const breakdowns = await import("../src/routes/api.youtube.breakdowns");

const CHANNEL_ROW = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000002";

interface AnalyticsCall {
  metrics: string;
  dimensions: string | null;
}

type RouteModule = { Route: unknown };

interface BreakdownSection {
  rows: Array<Record<string, unknown>>;
  revenueAvailable: boolean;
}

/** The fields of the two routes' responses that these tests read. */
interface RouteData {
  [key: string]: unknown;
  video: BreakdownSection;
  trafficSources: BreakdownSection;
}

async function callRoute(route: RouteModule, path: string) {
  const analytics: AnalyticsCall[] = [];
  const channelRow = {
    id: CHANNEL_ROW,
    user_id: USER,
    youtube_channel_id: "UCtestchannel0000000000000",
    uploads_playlist_id: "UUtestchannel0000000000000",
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
  const tables: Record<string, unknown> = {
    youtube_channels: channelRow,
    youtube_integration_settings: { auto_sync_videos: true, import_analytics: true },
    workspace_members: { workspace_id: "ws-1", role: "owner" },
    features: { id: "feature-analytics", is_active: true },
  };

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
      if (method !== "GET") return json([], 201);
      const row = tables[url.pathname.slice("/rest/v1/".length)];
      if (row) return json(wantsObject ? row : [row]);
      return json(wantsObject ? null : []);
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/channels"))
      return json({
        items: [
          {
            id: channelRow.youtube_channel_id,
            snippet: { title: "Test", customUrl: "@test", thumbnails: {} },
            statistics: { subscriberCount: "10", viewCount: "500", videoCount: "3" },
            contentDetails: { relatedPlaylists: { uploads: channelRow.uploads_playlist_id } },
          },
        ],
      });
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/playlistItems"))
      return json({ items: [] });
    if (url.hostname === "youtubeanalytics.googleapis.com") {
      const metrics = url.searchParams.get("metrics") ?? "";
      const dimensions = url.searchParams.get("dimensions");
      analytics.push({ metrics, dimensions });
      const names = [...(dimensions?.split(",") ?? []), ...metrics.split(",")];
      const dimensionValue: Record<string, string> = {
        day: "2026-09-01",
        video: "VIDEOVIDEO1",
        insightTrafficSourceType: "YT_SEARCH",
      };
      const hasRow = dimensions !== null && dimensions in dimensionValue;
      return json({
        columnHeaders: names.map((name) => ({ name })),
        rows: hasRow ? [names.map((name) => dimensionValue[name] ?? 5)] : [],
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
      route.Route as {
        options: {
          server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } };
        };
      }
    ).options.server.handlers.GET;
    const response = await handler({
      request: new Request(`https://app.test${path}`, { headers: { Cookie: cookie } }),
    });
    const body = (await response.json()) as { data?: RouteData; error?: string };
    return { status: response.status, body, data: (body.data ?? {}) as RouteData, analytics };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const describe = (call: AnalyticsCall) => `${call.metrics} by ${call.dimensions}`;
const wantsRevenue = (call: AnalyticsCall) =>
  /estimatedRevenue|estimatedAdRevenue|estimatedRedPartnerRevenue/i.test(call.metrics);
const wantsCpm = (call: AnalyticsCall) => /cpm/i.test(call.metrics);

// ---------- KPI row: /api/youtube/dashboard?revenue=0 ----------

test("the Analytics KPI request (revenue=0) makes no revenue and no CPM request", async () => {
  const { status, data, analytics } = await callRoute(
    dashboard,
    "/api/youtube/dashboard?revenue=0",
  );
  assert.equal(status, 200);
  assert.deepEqual(analytics.filter(wantsRevenue), []);
  assert.deepEqual(analytics.filter(wantsCpm), [], "the daily CPM report is not requested");
  for (const field of ["cpmStatus", "cpmByMonth", "revenueStatus"])
    assert.equal(field in data, false, `${field} is no longer part of the response`);
});

test("views and watch time for the KPI row still arrive with revenue switched off", async () => {
  const { data, analytics } = await callRoute(dashboard, "/api/youtube/dashboard?revenue=0");
  assert.ok(analytics.some((call) => describe(call) === "views,subscribersGained by day"));
  assert.ok(analytics.some((call) => describe(call) === "estimatedMinutesWatched by day"));
  assert.equal(data.analyticsStatus, "available");
  assert.equal(data.watchTimeStatus, "available");
  assert.deepEqual(data.analytics, [
    { month: "2026-09", views: 5, subscribersGained: 5, watchTimeMinutes: 5 },
  ]);
});

// ---------- tables: /api/youtube/breakdowns?videoRevenue=0 ----------

test("the per-video revenue switch is gone: there is nothing left to opt out of", () => {
  assert.equal("breakdownWantsLiveVideoRevenue" in breakdowns, false);
});

test("the Analytics breakdown request (videoRevenue=0) asks for no per-video revenue", async () => {
  const { status, data, analytics } = await callRoute(
    breakdowns,
    "/api/youtube/breakdowns?range=12M&videoRevenue=0",
  );
  assert.equal(status, 200);
  const videoCalls = analytics.filter((call) => call.dimensions === "video");
  assert.deepEqual(videoCalls.map(describe), ["views,estimatedMinutesWatched by video"]);
  assert.ok(!videoCalls.some(wantsRevenue));
  // The video table's non-revenue columns are intact.
  assert.equal(data.video.revenueAvailable, false);
  assert.deepEqual(data.video.rows, [
    { video: "VIDEOVIDEO1", views: 5, estimatedMinutesWatched: 5 },
  ]);
  assert.ok(!("estimatedRevenue" in data.video.rows[0]), "no revenue column is fabricated");
});

test("traffic sources are untouched by the opt-out, including their live revenue", async () => {
  const { data, analytics } = await callRoute(
    breakdowns,
    "/api/youtube/breakdowns?range=12M&videoRevenue=0",
  );
  const trafficCalls = analytics.filter((call) => call.dimensions === "insightTrafficSourceType");
  assert.deepEqual(trafficCalls.map(describe), [
    "views,estimatedMinutesWatched,estimatedRevenue by insightTrafficSourceType",
  ]);
  assert.equal(data.trafficSources.revenueAvailable, true);
  assert.deepEqual(data.trafficSources.rows, [
    {
      insightTrafficSourceType: "YT_SEARCH",
      views: 5,
      estimatedMinutesWatched: 5,
      estimatedRevenue: 5,
    },
  ]);
  assert.equal(analytics.length, 2, "one request per breakdown, no retry");
});

test("without the parameter the breakdown route asks for exactly the same reports", async () => {
  const plain = await callRoute(breakdowns, "/api/youtube/breakdowns?range=12M");
  const withOptOut = await callRoute(
    breakdowns,
    "/api/youtube/breakdowns?range=12M&videoRevenue=0",
  );
  assert.deepEqual(plain.analytics.filter((call) => call.dimensions === "video").map(describe), [
    "views,estimatedMinutesWatched by video",
  ]);
  assert.deepEqual(plain.analytics.map(describe).sort(), withOptOut.analytics.map(describe).sort());
  assert.equal(plain.data.video.revenueAvailable, false);
  assert.ok(!("estimatedRevenue" in plain.data.video.rows[0]));
  assert.deepEqual(plain.data, withOptOut.data);
  // Traffic sources keep their live revenue either way.
  assert.equal(plain.data.trafficSources.revenueAvailable, true);
  assert.equal(plain.data.trafficSources.rows[0].estimatedRevenue, 5);
});

// ---------- the Dashboard's Step 4A request is unaffected ----------

test("the Dashboard's own live request behaves as it did after Step 4A", async () => {
  const { status, data, analytics } = await callRoute(
    dashboard,
    `/api/youtube/dashboard?revenue=0&channelId=${CHANNEL_ROW}`,
  );
  assert.equal(status, 200);
  assert.deepEqual(
    analytics.filter((call) => wantsRevenue(call) || wantsCpm(call)),
    [],
  );
  assert.ok(!analytics.some((call) => call.dimensions === "video"));
  assert.equal("topRevenueVideosStatus" in data, false);
  assert.equal(data.engagementHeatmapStatus, "available");
});
