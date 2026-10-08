import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONNECTION_ROW,
  STORED_ACCESS_TOKEN,
  STORED_REFRESH_TOKEN,
  runRoute,
  type RunResult,
} from "./helpers/live-youtube-stub";

// A YouTube API 401 is not proof that the creator's authorization has been revoked. These tests
// run the real sync and page routes against a stubbed Google and check the one rule that
// matters: only a REJECTED TOKEN REFRESH may produce "reauth_required" — an API 401 is answered
// with one forced refresh and one retry, and if it persists it is an ordinary failure.

const tokens = await import("../src/lib/server/youtube-tokens");
const sync = await import("../src/routes/api.youtube.sync");
const videos = await import("../src/routes/api.youtube.videos");
const dashboard = await import("../src/routes/api.youtube.dashboard");
const breakdowns = await import("../src/routes/api.youtube.breakdowns");

const SYNC = `/api/youtube/sync`;
const calls = (run: RunResult, resource: string) =>
  run.google.filter((c) => c.resource === resource);
const everyWrite = (run: RunResult) => JSON.stringify(run.writes);

// ---------- the two concepts are separate ----------

test("an API 401 and a rejected token refresh are classified as different things", () => {
  const { isYoutubeTokenRefreshReauthError, isYoutubeApiUnauthorizedError } = tokens;
  // Genuine: Google refused the credential at the token endpoint.
  for (const message of [
    "YOUTUBE_REAUTH_REQUIRED",
    "GOOGLE_TOKEN_REQUEST_FAILED:400",
    "GOOGLE_TOKEN_REQUEST_FAILED:400:invalid_grant",
    "GOOGLE_TOKEN_REQUEST_FAILED:401",
  ]) {
    assert.equal(isYoutubeTokenRefreshReauthError(new Error(message)), true, message);
    assert.equal(isYoutubeApiUnauthorizedError(new Error(message)), false, message);
  }
  // Not genuine: a YouTube API endpoint answered 401.
  for (const message of [
    "YOUTUBE_PLAYLISTITEMS_FAILED:401",
    "YOUTUBE_CHANNEL_FETCH_FAILED:401",
    "YOUTUBE_ANALYTICS_QUERY_FAILED:401",
    "YOUTUBE_VIDEOS_FAILED:401",
    "YOUTUBE_COMMENT_REPLY_FAILED:401",
  ]) {
    assert.equal(isYoutubeTokenRefreshReauthError(new Error(message)), false, message);
    assert.equal(isYoutubeApiUnauthorizedError(new Error(message)), true, message);
  }
  // Neither: other API failures, and this app's own OAuth client being misconfigured.
  for (const message of [
    "YOUTUBE_PLAYLISTITEMS_FAILED:403",
    "YOUTUBE_ANALYTICS_QUERY_FAILED:500",
    "GOOGLE_TOKEN_REQUEST_FAILED:401:invalid_client",
    "GOOGLE_TOKEN_REQUEST_FAILED:500",
    "something else",
  ]) {
    assert.equal(isYoutubeTokenRefreshReauthError(new Error(message)), false, message);
    assert.equal(isYoutubeApiUnauthorizedError(new Error(message)), false, message);
  }
  assert.equal("isYoutubeReauthError" in tokens, false, "the ambiguous helper no longer exists");
});

// ---------- token refresh (1–4) ----------

test("an expired access token is refreshed, the new one is persisted, and the request succeeds", async () => {
  const run = await runRoute(sync, "POST", SYNC, { tokenValid: false });
  assert.equal(run.status, 200);
  assert.equal(run.tokenRefreshes, 1);
  assert.ok(
    calls(run, "channels").every((c) => c.bearer === "refreshed-1"),
    "the API was called with the refreshed token",
  );
  const persisted = run.writes.find(
    (w) => w.table === "youtube_connections" && w.body && "access_token_ciphertext" in w.body,
  );
  assert.ok(persisted, "the new access token was written to the connection");
  assert.ok(
    !("refresh_token_ciphertext" in (persisted!.body as object)),
    "the refresh token is left alone",
  );
  assert.deepEqual(run.syncStatuses, ["syncing", "success"]);
  assert.deepEqual(run.connectionStatuses, []);
});

test("an expired access token whose refresh Google rejects is a genuine reauthorization", async () => {
  const run = await runRoute(sync, "POST", SYNC, { tokenValid: false, refresh: [400] });
  assert.equal(run.body.status, "reauth_required");
  assert.deepEqual(run.connectionStatuses, ["reauth_required"], "the connection is flagged");
  assert.deepEqual(run.syncStatuses, ["syncing", "reauth_required", "reauth_required"]);
  assert.equal(calls(run, "channels").length, 0, "no API request was made without a token");
  assert.equal(run.tokenRefreshes, 1);
});

test("tokens never appear in logs, responses or anything written except as ciphertext", async () => {
  const scenarios = [
    await runRoute(sync, "POST", SYNC, { tokenValid: false, refresh: [400] }),
    await runRoute(sync, "POST", SYNC, {
      api: ({ resource }) => (resource === "channels" ? 401 : undefined),
    }),
    await runRoute(sync, "POST", SYNC, {
      api: ({ resource }) => (resource === "channels" ? 401 : undefined),
      refresh: [400],
    }),
  ];
  for (const run of scenarios) {
    const visible = `${run.logs}\n${JSON.stringify(run.body)}\n${everyWrite(run)}`;
    for (const secret of [
      STORED_REFRESH_TOKEN,
      STORED_ACCESS_TOKEN,
      "refreshed-1",
      "test-client-secret",
    ])
      assert.ok(!visible.includes(secret), `${secret.slice(0, 12)}… is not exposed`);
  }
  assert.match(scenarios[0].logs, /YouTube token refresh rejected by Google/);
  assert.match(
    scenarios[0].logs,
    new RegExp(CONNECTION_ROW),
    "the log names the connection, not the token",
  );
});

// ---------- API 401 (5–12) ----------

test("an API 401 forces one refresh and the retry succeeds with the new token", async () => {
  // The stored token is still valid on paper; YouTube rejects the first request anyway.
  const run = await runRoute(sync, "POST", SYNC, {
    api: ({ resource, attempt }) => (resource === "channels" && attempt === 1 ? 401 : undefined),
  });
  assert.equal(run.status, 200);
  assert.equal(run.tokenRefreshes, 1, "exactly one forced refresh");
  assert.deepEqual(
    calls(run, "channels").map((c) => [c.bearer, c.status]),
    [
      [STORED_ACCESS_TOKEN, 401],
      ["refreshed-1", 200],
    ],
    "one retry, carrying the refreshed token",
  );
  // Later requests in the same run use the refreshed token straight away — no second 401 needed.
  assert.ok(
    run.google
      .filter((c) => c.resource !== "token")
      .slice(2)
      .every((c) => c.bearer === "refreshed-1"),
  );
  assert.deepEqual(run.syncStatuses, ["syncing", "success"], "the sync simply succeeds");
  assert.deepEqual(run.connectionStatuses, []);
  assert.ok(!everyWrite(run).includes("reauth_required"));
});

test("an API 401 that survives the refresh and the retry is a failure, never a reauthorization", async () => {
  // The production case: the grant is fine (the refresh succeeds) but the API keeps saying 401.
  const run = await runRoute(sync, "POST", SYNC, {
    api: ({ resource }) => (resource === "channels" ? 401 : undefined),
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.status, "failed");
  assert.deepEqual(run.syncStatuses, ["syncing", "failed"]);
  assert.deepEqual(run.connectionStatuses, [], "the connection stays active");
  assert.ok(!everyWrite(run).includes("reauth_required"), "reauth_required is written nowhere");
  assert.equal(run.tokenRefreshes, 1);
  assert.equal(calls(run, "channels").length, 2, "the original request and exactly one retry");
  const failure = run.writes.find(
    (w) =>
      w.table === "youtube_channels" &&
      (w.body as Record<string, unknown>)?.last_sync_status === "failed",
  );
  assert.equal((failure!.body as Record<string, unknown>).last_sync_error, "sync_unavailable");
});

test("there is exactly one retry per request and no refresh loop, however often the API says 401", async () => {
  // Every YouTube request is rejected, on every route that makes several of them.
  const run = await runRoute(dashboard, "GET", "/api/youtube/dashboard?revenue=0", {
    api: () => 401,
  });
  assert.equal(run.tokenRefreshes, 1, "one forced refresh for the whole request, not one per 401");
  const perResource = new Map<string, number>();
  for (const call of run.google)
    perResource.set(call.resource, (perResource.get(call.resource) ?? 0) + 1);
  assert.equal(perResource.get("channels"), 2, "the first request: once, then one retry");
  assert.ok(run.google.length < 40, `bounded number of requests (${run.google.length})`);
  // After the forced refresh, a 401 is retried with that same fresh token rather than refreshed again.
  assert.ok(
    run.google
      .filter((c) => c.resource !== "token")
      .slice(1)
      .every((c) => c.bearer === "refreshed-1"),
  );
});

test("an API 401 whose forced refresh Google rejects is a genuine reauthorization", async () => {
  const run = await runRoute(sync, "POST", SYNC, {
    api: ({ resource }) => (resource === "channels" ? 401 : undefined),
    refresh: [400],
  });
  assert.equal(run.body.status, "reauth_required");
  assert.deepEqual(run.connectionStatuses, ["reauth_required"]);
  assert.ok(run.syncStatuses.includes("reauth_required"));
  assert.equal(calls(run, "channels").length, 1, "nothing to retry with");
});

test("a refresh that fails for an unrelated reason leaves the 401 as an ordinary failure", async () => {
  // Google's token endpoint is down (500): nothing was learned about the grant.
  const run = await runRoute(sync, "POST", SYNC, {
    api: ({ resource }) => (resource === "channels" ? 401 : undefined),
    refresh: [500],
  });
  assert.equal(run.body.status, "failed");
  assert.deepEqual(run.connectionStatuses, []);
  assert.ok(!everyWrite(run).includes("reauth_required"));
});

test("errors other than 401 are not refreshed or retried", async () => {
  for (const status of [403, 404, 429, 500, 503]) {
    const run = await runRoute(sync, "POST", SYNC, {
      api: ({ resource }) => (resource === "channels" ? status : undefined),
    });
    assert.equal(run.tokenRefreshes, 0, `${status}: no refresh`);
    assert.equal(calls(run, "channels").length, 1, `${status}: no retry`);
    assert.equal(run.body.status, "failed", `${status}: an ordinary failure`);
    assert.ok(!everyWrite(run).includes("reauth_required"));
  }
});

test("successful requests never trigger a refresh", async () => {
  const run = await runRoute(sync, "POST", SYNC);
  assert.equal(run.tokenRefreshes, 0);
  assert.ok(run.google.every((c) => c.status === 200));
  assert.ok(run.google.every((c) => c.bearer === STORED_ACCESS_TOKEN));
  const counts = new Map<string, number>();
  for (const call of run.google) counts.set(call.resource, (counts.get(call.resource) ?? 0) + 1);
  assert.equal(counts.get("channels"), 1, "each request is made once");
});

// ---------- sync status (13–17) ----------

test("sync: success and partial behave exactly as before", async () => {
  const ok = await runRoute(sync, "POST", SYNC);
  assert.equal(ok.body.status, "success");
  assert.deepEqual(ok.syncStatuses, ["syncing", "success"]);

  // One optional part fails with a non-authorization error: the sync is "partial". (Only the
  // channel sync's own listing is refused; the revenue-data sync that follows asks again.)
  const partial = await runRoute(sync, "POST", SYNC, {
    api: ({ resource, attempt }) =>
      resource === "playlistItems" && attempt === 1 ? 500 : undefined,
  });
  assert.equal(partial.body.status, "partial");
  assert.deepEqual(partial.syncStatuses, ["syncing", "partial"]);
  assert.equal(partial.tokenRefreshes, 0);
});

test("sync: the channel sync asks YouTube Analytics for nothing, so an Analytics 401 cannot make it partial", async () => {
  const run = await runRoute(sync, "POST", SYNC, {
    api: ({ resource }) => (resource === "reports" ? 401 : undefined),
  });
  assert.equal(run.body.status, "success");
  assert.deepEqual(run.syncStatuses, ["syncing", "success"]);
  assert.equal("analytics" in (run.body.result as Record<string, unknown>), false);
  // The Analytics failure belongs to the revenue-data sync, which reports it separately.
  assert.equal((run.body.revenueData as { status: string }).status, "failed");
  assert.deepEqual(run.connectionStatuses, []);
  assert.ok(!everyWrite(run).includes("reauth_required"));
  assert.equal(run.tokenRefreshes, 1);
});

test("sync: the exact production failure — the uploads playlist answering 401 — no longer flags the channel", async () => {
  // YOUTUBE_PLAYLISTITEMS_FAILED:401 with an active connection and a working refresh.
  const run = await runRoute(sync, "POST", SYNC, {
    api: ({ resource }) => (resource === "playlistItems" ? 401 : undefined),
  });
  assert.ok(["partial", "failed"].includes(String(run.body.status)), String(run.body.status));
  assert.ok(!run.syncStatuses.includes("reauth_required"));
  assert.deepEqual(run.connectionStatuses, []);
  assert.ok(!everyWrite(run).includes("reauth_required"));
  assert.equal(calls(run, "playlistItems").filter((c) => c.status === 401).length >= 2, true);
});

// ---------- live routes (20) ----------

test("pages: an API 401 that persists is a retryable error, not a prompt to reconnect", async () => {
  const cases: Array<[{ Route: unknown }, string, string]> = [
    [videos, "/api/youtube/videos?limit=50&enrich=0", "YOUTUBE_DATA_UNAVAILABLE"],
    [dashboard, "/api/youtube/dashboard?revenue=0", "YOUTUBE_DATA_UNAVAILABLE"],
  ];
  for (const [route, path, expected] of cases) {
    const run = await runRoute(route, "GET", path, {
      api: ({ resource }) => (resource === "channels" ? 401 : undefined),
    });
    assert.equal(run.status, 502, `${path} → retryable upstream failure`);
    assert.equal(run.body.error, expected);
    assert.notEqual(run.body.error, "YOUTUBE_REAUTH_REQUIRED");
    assert.deepEqual(run.connectionStatuses, []);
    assert.ok(!everyWrite(run).includes("reauth_required"));
  }
});

test("pages: an API 401 that the refresh-and-retry cures is invisible to the page", async () => {
  const run = await runRoute(videos, "GET", "/api/youtube/videos?limit=50&enrich=0", {
    videoIds: ["VIDEOAAAAA1"],
    api: ({ resource, attempt }) =>
      resource === "playlistItems" && attempt === 1 ? 401 : undefined,
  });
  assert.equal(run.status, 200);
  assert.equal((run.body.data as { videos: unknown[] }).videos.length, 1);
  assert.equal(run.tokenRefreshes, 1);
});

test("pages: a rejected token refresh is still the reconnect prompt", async () => {
  for (const [route, path] of [
    [videos, "/api/youtube/videos?limit=50&enrich=0"],
    [dashboard, "/api/youtube/dashboard?revenue=0"],
    [breakdowns, "/api/youtube/breakdowns?range=12M&videoRevenue=0"],
  ] as Array<[{ Route: unknown }, string]>) {
    const expired = await runRoute(route, "GET", path, { tokenValid: false, refresh: [400] });
    assert.equal(expired.status, 401, `${path} with a rejected refresh`);
    assert.equal(expired.body.error, "YOUTUBE_REAUTH_REQUIRED");
    assert.deepEqual(expired.connectionStatuses, ["reauth_required"]);
  }
  // …including when the rejection is discovered because an API 401 forced the refresh.
  const forced = await runRoute(videos, "GET", "/api/youtube/videos?limit=50&enrich=0", {
    api: ({ resource }) => (resource === "channels" ? 401 : undefined),
    refresh: [400],
  });
  assert.equal(forced.status, 401);
  assert.equal(forced.body.error, "YOUTUBE_REAUTH_REQUIRED");
});

test("pages: healthy requests are unchanged — no refresh, no retry, same data", async () => {
  const run = await runRoute(videos, "GET", "/api/youtube/videos?limit=50&enrich=0", {
    videoIds: ["VIDEOAAAAA1", "VIDEOBBBBB2"],
  });
  assert.equal(run.status, 200);
  assert.equal(run.tokenRefreshes, 0);
  assert.deepEqual(
    run.google.map((c) => c.resource),
    ["channels", "playlistItems", "videos"],
  );
  assert.equal((run.body.data as { videos: unknown[] }).videos.length, 2);
});

test("no route or helper outside the token module can write reauth_required from an API error", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const writers: string[] = [];
  for (const dir of ["src/routes", "src/lib/server"])
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
      const source = readFileSync(`${dir}/${name}`, "utf8");
      assert.ok(
        !source.includes("isYoutubeReauthError"),
        `${name} does not use the old broad check`,
      );
      if (/"reauth_required"/.test(source)) writers.push(`${dir}/${name}`);
    }
  // The token module (genuine refresh rejection), the sync route (which now only passes on that
  // same genuine signal), and the callback (which only CLEARS the flag).
  assert.deepEqual(writers.sort(), [
    "src/lib/server/youtube-tokens.ts",
    "src/routes/api.youtube.callback.ts",
    "src/routes/api.youtube.sync.ts",
  ]);
  const syncSource = readFileSync("src/routes/api.youtube.sync.ts", "utf8");
  assert.match(
    syncSource,
    /isYoutubeTokenRefreshReauthError\(error\) \? "reauth_required" : "failed"/,
  );
});

// ---------- the registry itself ----------

test("registry: concurrent 401s share one forced refresh, and a freshly forced token is not refreshed again", async () => {
  const registry = await import("../src/lib/server/youtube-token-registry");
  registry.resetYoutubeTokenRegistry();
  let refreshes = 0;
  const forceRefresh = async (): Promise<string> => {
    refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const token = `forced-${refreshes}`;
    registry.registerYoutubeAccessToken(token, "conn", forceRefresh, { forced: true });
    return token;
  };
  registry.registerYoutubeAccessToken("original", "conn", forceRefresh);
  assert.equal(registry.latestYoutubeAccessToken("original"), "original");

  // Three requests get a 401 at the same moment.
  const retried = await Promise.all([
    registry.youtubeAccessTokenForRetry("original"),
    registry.youtubeAccessTokenForRetry("original"),
    registry.youtubeAccessTokenForRetry("original"),
  ]);
  assert.deepEqual(retried, ["forced-1", "forced-1", "forced-1"]);
  assert.equal(refreshes, 1);
  // The caller still holding the old string now gets the new token without another 401.
  assert.equal(registry.latestYoutubeAccessToken("original"), "forced-1");
  // A 401 on the fresh token is retried with it; refreshing again could not help.
  assert.equal(await registry.youtubeAccessTokenForRetry("forced-1"), "forced-1");
  assert.equal(await registry.youtubeAccessTokenForRetry("original"), "forced-1");
  assert.equal(refreshes, 1);
  // The normal path handing out a token again does not undo that.
  registry.registerYoutubeAccessToken("original", "conn", forceRefresh);
  assert.equal(registry.latestYoutubeAccessToken("original"), "forced-1");
  assert.equal(await registry.youtubeAccessTokenForRetry("original"), "forced-1");
  assert.equal(refreshes, 1);
  // Once the window has passed, a 401 may force a refresh again — still one at a time.
  assert.equal(
    await registry.youtubeAccessTokenForRetry("forced-1", Date.now() + 61_000),
    "forced-2",
  );
  assert.equal(refreshes, 2);
});

test("registry: a token nobody registered cannot be refreshed, and a rejected refresh is not cached", async () => {
  const registry = await import("../src/lib/server/youtube-token-registry");
  registry.resetYoutubeTokenRegistry();
  assert.equal(await registry.youtubeAccessTokenForRetry("unknown-token"), null);
  assert.equal(registry.latestYoutubeAccessToken("unknown-token"), "unknown-token");

  let attempts = 0;
  registry.registerYoutubeAccessToken("t", "conn-2", async () => {
    attempts += 1;
    throw new Error("YOUTUBE_REAUTH_REQUIRED");
  });
  await assert.rejects(registry.youtubeAccessTokenForRetry("t"), /YOUTUBE_REAUTH_REQUIRED/);
  await assert.rejects(registry.youtubeAccessTokenForRetry("t"), /YOUTUBE_REAUTH_REQUIRED/);
  assert.equal(
    attempts,
    2,
    "each later request tests the grant again rather than reusing a failure",
  );
});
