import assert from "node:assert/strict";
import { test } from "node:test";

// Runs the real GET /api/youtube/videos handler with every outside call (Supabase auth,
// PostgREST, YouTube Data API, YouTube Analytics) answered by a stub, and records which YouTube
// Analytics reports it asks for. This shows that the Videos page's request (enrich=0) makes no
// revenue, CPM or trend request while still returning the full video list, and that every other
// caller of the route gets exactly what it always got.

const SUPABASE = "https://testref.supabase.co";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  // 32 zero bytes, base64 — a throwaway key for this test only.
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const { Route, videosWantLiveEnrichment } = await import("../src/routes/api.youtube.videos");

const CHANNEL_ROW = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000002";
const VIDEO_IDS = ["VIDEOAAAAA1", "VIDEOBBBBB2", "VIDEOCCCCC3"];

interface AnalyticsCall {
  metrics: string;
  dimensions: string | null;
  filters: string | null;
}

interface ListedVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  duration: string | null;
  views: number;
  likes: number | null;
  url: string;
  estimatedRevenue: number | null;
  cpm: number | null;
  changePercent: number | null;
  status: string | null;
}

interface VideosData {
  channel: { id: string; title: string; videoCount: number };
  videos: ListedVideo[];
  nextPageToken: string | null;
  videosStatus: string;
  totalVideoCount: number;
  revenueAvailable: boolean;
}

async function callVideos(query: string) {
  const analytics: AnalyticsCall[] = [];
  const dataApi: string[] = [];
  const channelRow = {
    id: CHANNEL_ROW,
    user_id: USER,
    youtube_channel_id: "UCtestchannel0000000000000",
    uploads_playlist_id: "UUtestchannel0000000000000",
    channel_name: "Test",
    channel_handle: "@test",
    thumbnail: null,
    subscriber_count: 10,
    view_count: 500,
    video_count: 3,
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
      if (method !== "GET") return json([], 201);
      const table = url.pathname.slice("/rest/v1/".length);
      if (table === "youtube_channels") return json(wantsObject ? channelRow : [channelRow]);
      if (table === "youtube_integration_settings") {
        const settings = { auto_sync_videos: true, import_analytics: true };
        return json(wantsObject ? settings : [settings]);
      }
      return json(wantsObject ? null : []);
    }
    if (url.hostname === "www.googleapis.com") {
      const resource = url.pathname.split("/").pop()!;
      dataApi.push(resource);
      if (resource === "channels")
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
      if (resource === "playlistItems")
        return json({
          items: VIDEO_IDS.map((videoId) => ({ contentDetails: { videoId } })),
          nextPageToken: "NEXTPAGE",
        });
      if (resource === "videos")
        return json({
          items: VIDEO_IDS.map((id, index) => ({
            id,
            snippet: {
              title: `Video ${index + 1}`,
              publishedAt: `2026-09-0${index + 1}T00:00:00Z`,
              channelId: channelRow.youtube_channel_id,
              thumbnails: { medium: { url: `https://img.test/${id}.jpg` } },
            },
            contentDetails: { duration: "PT4M5S" },
            statistics: { viewCount: String(100 * (index + 1)), likeCount: "7", commentCount: "2" },
            status: { privacyStatus: "public" },
          })),
        });
    }
    if (url.hostname === "youtubeanalytics.googleapis.com") {
      const metrics = url.searchParams.get("metrics") ?? "";
      analytics.push({
        metrics,
        dimensions: url.searchParams.get("dimensions"),
        filters: url.searchParams.get("filters"),
      });
      const names = ["video", ...metrics.split(",")];
      return json({
        columnHeaders: names.map((name) => ({ name })),
        rows: VIDEO_IDS.map((id, index) =>
          names.map((name) => (name === "video" ? id : 10 * (index + 1))),
        ),
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
      request: new Request(`https://app.test/api/youtube/videos${query}`, {
        headers: { Cookie: cookie },
      }),
    });
    const body = (await response.json()) as { status?: string; data?: VideosData; error?: string };
    return { status: response.status, body, data: body.data as VideosData, analytics, dataApi };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the opt-out is exactly enrich=0", () => {
  const wants = (query: string) =>
    videosWantLiveEnrichment(new URL(`https://app.test/api/youtube/videos${query}`));
  assert.equal(wants(""), true);
  assert.equal(wants("?limit=50"), true);
  assert.equal(wants("?enrich=1"), true);
  assert.equal(wants("?enrich="), true);
  assert.equal(wants("?revenue=0"), true, "another route's parameter does not apply here");
  assert.equal(wants("?limit=50&enrich=0"), false);
  assert.equal(wants("?pageToken=abc&limit=50&enrich=0"), false);
});

test("the Videos page's request (enrich=0) makes no YouTube Analytics request at all", async () => {
  const { status, analytics } = await callVideos("?limit=50&enrich=0");
  assert.equal(status, 200);
  assert.deepEqual(analytics, [], "no revenue, no CPM, no 30-day view reports");
});

test("with enrich=0 the video list is complete: identity, thumbnail, views, likes, duration, paging", async () => {
  const { data, dataApi } = await callVideos("?limit=50&enrich=0");
  assert.deepEqual(
    dataApi,
    ["channels", "playlistItems", "videos"],
    "the Data API listing still runs",
  );
  assert.equal(data.videosStatus, "available");
  assert.equal(data.channel.id, CHANNEL_ROW, "the channel the page scopes its revenue to");
  assert.equal(data.nextPageToken, "NEXTPAGE");
  assert.equal(data.totalVideoCount, 3);
  assert.deepEqual(data.videos.map((v) => v.id).sort(), [...VIDEO_IDS].sort());
  const first = data.videos.find((v) => v.id === "VIDEOAAAAA1")!;
  assert.equal(first.title, "Video 1");
  assert.equal(first.thumbnail, "https://img.test/VIDEOAAAAA1.jpg");
  assert.equal(first.views, 100);
  assert.equal(first.likes, 7);
  assert.equal(first.duration, "4:05");
  assert.equal(first.url, "https://www.youtube.com/watch?v=VIDEOAAAAA1");
  // The enrichment fields are present but empty: nothing is fabricated.
  for (const item of data.videos)
    assert.deepEqual(
      [item.estimatedRevenue, item.cpm, item.changePercent, item.status],
      [null, null, null, null],
    );
  assert.equal(data.revenueAvailable, false);
});

test("every other caller (no parameter) still gets the live enrichment, unchanged", async () => {
  const live = await callVideos("?limit=50");
  const off = await callVideos("?limit=50&enrich=0");
  assert.equal(live.status, 200);
  assert.deepEqual(
    live.analytics.map((call) => `${call.metrics} by ${call.dimensions}`),
    ["views,estimatedRevenue,cpm by video", "views by video", "views by video"],
  );
  assert.ok(live.analytics.every((call) => call.filters?.startsWith("video==")));
  assert.equal(live.data.revenueAvailable, true);
  const top = live.data.videos.find((v) => v.id === "VIDEOCCCCC3")!;
  assert.equal(top.estimatedRevenue, 30);
  assert.equal(top.cpm, 30);
  assert.equal(top.status, "Top Performer");
  // Same list and same response shape either way: the opt-out removes requests, not fields.
  assert.deepEqual(Object.keys(off.data).sort(), Object.keys(live.data).sort());
  assert.deepEqual(Object.keys(off.data.videos[0]).sort(), Object.keys(live.data.videos[0]).sort());
  const identity = (v: ListedVideo) => [
    v.id,
    v.title,
    v.thumbnail,
    v.views,
    v.likes,
    v.duration,
    v.url,
  ];
  assert.deepEqual(off.data.videos.map(identity), live.data.videos.map(identity));
  assert.deepEqual(off.dataApi, live.dataApi);
  assert.equal(live.analytics.length - off.analytics.length, 3, "three Analytics requests fewer");
});

test("search, Add Video and AI Lab still call the route without the opt-out", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "src/components/DashboardLayout.tsx",
    "src/routes/add-video.tsx",
    "src/routes/ai-lab.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /\/api\/youtube\/videos\?/, `${file} still calls the route`);
    assert.ok(!source.includes("enrich"), `${file} is untouched by the opt-out`);
    assert.ok(
      !/estimatedRevenue|changePercent|\.cpm\b/.test(source),
      `${file} uses no enrichment field`,
    );
  }
});
