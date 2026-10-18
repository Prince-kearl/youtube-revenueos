import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// /api/youtube/location: the Settings profile's location is the country set on the YouTube
// channel the caller connected themselves. Runs the real route with every outside call stubbed
// and checks who may get an answer, which channel it comes from, and that failures say nothing.

const SUPABASE = "https://testref.supabase.co";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  // 32 zero bytes, base64 — a throwaway key for this test only.
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

const { encryptSecretToBytea } = await import("../src/lib/server/crypto");
const route = await import("../src/routes/api.youtube.location");

const USER = "bbbbbbbb-0000-4000-8000-000000000002";
const CHANNEL_ROW = "aaaaaaaa-0000-4000-8000-000000000001";

interface Scenario {
  signedIn?: boolean;
  /** The caller's own connected channel, or none. */
  ownChannel?: boolean;
  /** What YouTube reports as the channel's country (undefined: none set). */
  country?: string;
  youtubeFails?: boolean;
  /** The query string sent, e.g. "?channelId=…". */
  search?: string;
}

async function call(scenario: Scenario = {}) {
  const {
    signedIn = true,
    ownChannel = true,
    country,
    youtubeFails = false,
    search = "",
  } = scenario;
  const channelRow = {
    id: CHANNEL_ROW,
    youtube_channel_id: "UCtestchannel0000000000000",
    connection: {
      id: "conn-1",
      access_token_ciphertext: await encryptSecretToBytea("access-token"),
      refresh_token_ciphertext: await encryptSecretToBytea("refresh-token"),
      token_expiry: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
  const channelQueries: URL[] = [];
  let youtubeCalls = 0;
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
      return signedIn
        ? json({ id: USER, aud: "authenticated", role: "authenticated", email: "t@test" })
        : json({ message: "invalid JWT" }, 401);
    if (url.origin === SUPABASE && url.pathname === "/rest/v1/youtube_channels") {
      channelQueries.push(url);
      const row = ownChannel ? channelRow : null;
      return json(wantsObject ? row : row ? [row] : []);
    }
    if (url.origin === SUPABASE && url.pathname.startsWith("/rest/v1/")) {
      if (method !== "GET") return json([], 201);
      return json(wantsObject ? null : []);
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/channels")) {
      youtubeCalls++;
      if (youtubeFails) return json({ error: { message: "quota" } }, 403);
      return json({
        items: [
          {
            id: channelRow.youtube_channel_id,
            snippet: { title: "Test", ...(country === undefined ? {} : { country }) },
            statistics: {},
          },
        ],
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
      route.Route as unknown as {
        options: {
          server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } };
        };
      }
    ).options.server.handlers.GET;
    const response = await handler({
      request: new Request(`https://app.test/api/youtube/location${search}`, {
        headers: signedIn ? { Cookie: cookie } : {},
      }),
    });
    const body = (await response.json()) as { data?: { country: string | null }; error?: string };
    return { status: response.status, body, channelQueries, youtubeCalls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the caller's own channel: its YouTube country is returned", async () => {
  const { status, body, youtubeCalls } = await call({ country: "GH" });
  assert.equal(status, 200);
  assert.deepEqual(body, { data: { country: "GH" } });
  assert.equal(youtubeCalls, 1);
});

test("only a channel the caller connected is used, never a teammate's", async () => {
  const { channelQueries } = await call({ country: "GH" });
  assert.ok(channelQueries.length >= 2, "the channel and its connection are both looked up");
  for (const query of channelQueries)
    assert.equal(query.searchParams.get("user_id"), `eq.${USER}`, String(query));
});

test("no channel of their own: no location, and YouTube is not called", async () => {
  const { status, body, youtubeCalls } = await call({ ownChannel: false });
  assert.equal(status, 200);
  assert.deepEqual(body, { data: { country: null } });
  assert.equal(youtubeCalls, 0);
});

test("no country set on YouTube, or a value that is not a country code: no location", async () => {
  assert.deepEqual((await call({})).body, { data: { country: null } });
  assert.deepEqual((await call({ country: "<b>x</b>" })).body, { data: { country: null } });
});

test("a YouTube failure answers 'no location' and leaks nothing", async () => {
  const { status, body } = await call({ youtubeFails: true, country: "GH" });
  assert.equal(status, 200);
  assert.deepEqual(body, { data: { country: null } });
});

test("signed out: refused, and nothing is read from YouTube", async () => {
  const { status, body, youtubeCalls, channelQueries } = await call({
    signedIn: false,
    country: "GH",
  });
  assert.equal(status, 401);
  assert.equal(body.data, undefined);
  assert.equal(youtubeCalls, 0);
  assert.equal(channelQueries.length, 0);
});

test("the profile: no photo or banner editing; the location comes from YouTube", () => {
  const page = readFileSync("src/routes/settings.tsx", "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(page, /Edit profile photo|Edit profile cover|Upload image/);
  assert.doesNotMatch(page, /setEditor\("(avatar|cover)"\)/);
  assert.match(page, /fetch\(`\/api\/youtube\/location\$\{query\}`/);
  assert.match(page, /new URLSearchParams\(\{ channelId: activeChannelId \}\)/);
  assert.match(page, /location \|\| "Location not set"/);
  assert.doesNotMatch(page, /profile\.location \|\|/);
  // The editor no longer has a location field to type into.
  assert.doesNotMatch(page, /values\.location/);
});

test("the channel open in the switcher is used, and it must still be the caller's own", async () => {
  const { body, channelQueries } = await call({
    country: "GH",
    search: `?channelId=${CHANNEL_ROW}`,
  });
  assert.deepEqual(body, { data: { country: "GH" } });
  assert.equal(channelQueries[0].searchParams.get("id"), `eq.${CHANNEL_ROW}`);
  assert.equal(channelQueries[0].searchParams.get("user_id"), `eq.${USER}`);
});

test("a channel id that is not the caller's, or not an id at all: no location, YouTube not called", async () => {
  const notTheirs = await call({
    ownChannel: false,
    country: "GH",
    search: "?channelId=cccccccc-0000-4000-8000-000000000003",
  });
  assert.deepEqual(notTheirs.body, { data: { country: null } });
  assert.equal(notTheirs.youtubeCalls, 0);
  const malformed = await call({ country: "GH", search: "?channelId=../../etc" });
  assert.deepEqual(malformed.body, { data: { country: null } });
  assert.equal(malformed.youtubeCalls, 0);
  assert.equal(malformed.channelQueries.length, 0);
});
