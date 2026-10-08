import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runRoute } from "./helpers/live-youtube-stub";

// An optional Dashboard section whose YouTube request fails must say the right thing:
//
//   YouTube API 401 that survived the forced refresh and single retry → "temporarily_unavailable"
//     (the refresh succeeded, so the authorization is intact; reconnecting would not help)
//   Google rejected the token refresh, or YouTube answered 403         → "forbidden"
//     (the creator has to reconnect)
//   anything else                                                      → "unavailable"
//
// These run the real GET /api/youtube/dashboard handler against stubbed Google and Supabase.

const dashboard = await import("../src/routes/api.youtube.dashboard");
const { optionalSectionFailureStatus } = dashboard;

const PAGE = "/api/youtube/dashboard?revenue=0";
const SECTIONS = [
  "analyticsStatus",
  "watchTimeStatus",
  "audienceStatus",
  "engagementHeatmapStatus",
] as const;

type Body = { data?: Record<string, unknown>; error?: string };
type Run = Awaited<ReturnType<typeof runRoute>>;
const reauthWrites = (run: Run) =>
  run.writes.filter((write) => JSON.stringify(write.body ?? "").includes("reauth_required"));

test("classification: only a rejected refresh or a 403 asks the creator to reconnect", () => {
  assert.equal(
    optionalSectionFailureStatus(new Error("YOUTUBE_ANALYTICS_QUERY_FAILED:401")),
    "temporarily_unavailable",
  );
  assert.equal(
    optionalSectionFailureStatus(new Error("YOUTUBE_PLAYLISTITEMS_FAILED:401")),
    "temporarily_unavailable",
  );
  assert.equal(optionalSectionFailureStatus(new Error("YOUTUBE_REAUTH_REQUIRED")), "forbidden");
  assert.equal(
    optionalSectionFailureStatus(new Error("GOOGLE_TOKEN_REQUEST_FAILED:400:invalid_grant")),
    "forbidden",
  );
  assert.equal(
    optionalSectionFailureStatus(new Error("YOUTUBE_ANALYTICS_QUERY_FAILED:403")),
    "forbidden",
  );
  for (const code of [400, 404, 429, 500, 503])
    assert.equal(
      optionalSectionFailureStatus(new Error(`YOUTUBE_ANALYTICS_QUERY_FAILED:${code}`)),
      "unavailable",
    );
  assert.equal(optionalSectionFailureStatus(new Error("fetch failed")), "unavailable");
  assert.equal(optionalSectionFailureStatus("not an error"), "unavailable");
});

test("optional sections + persistent API 401: temporarily unavailable, the rest of the Dashboard still served", async () => {
  // Every Analytics report is answered 401, before and after the forced refresh.
  const run = await runRoute(dashboard, "GET", PAGE, {
    api: ({ resource }) => (resource === "reports" ? 401 : undefined),
  });
  const body = run.body as Body;
  assert.equal(run.status, 200);
  assert.equal(body.error, undefined);
  assert.ok(body.data?.channel, "the channel (required data) is still returned");
  for (const section of SECTIONS)
    assert.equal(body.data?.[section], "temporarily_unavailable", section);
  assert.equal(run.tokenRefreshes, 1, "the refresh succeeded: the authorization is intact");
  assert.deepEqual(run.connectionStatuses, []);
  assert.deepEqual(run.syncStatuses, []);
  assert.deepEqual(reauthWrites(run), [], "nothing anywhere records reauth_required");
  assert.doesNotMatch(JSON.stringify(run.body), /forbidden|REAUTH|reauth/);
});

test("one optional section failing with 401 leaves the others alone", async () => {
  // Only the audience age/gender reports are rejected.
  const run = await runRoute(dashboard, "GET", PAGE, {
    api: ({ resource, metrics }) =>
      resource === "reports" && metrics === "viewerPercentage" ? 401 : undefined,
  });
  const body = run.body as Body;
  assert.equal(run.status, 200);
  assert.equal(body.data?.audienceStatus, "temporarily_unavailable");
  for (const section of SECTIONS.filter((name) => name !== "audienceStatus"))
    assert.notEqual(body.data?.[section], "temporarily_unavailable", section);
  assert.deepEqual(reauthWrites(run), []);
});

test("optional section + genuine reauthorization (Google rejects the refresh): reconnect state", async () => {
  const run = await runRoute(dashboard, "GET", PAGE, {
    api: ({ resource }) => (resource === "reports" ? 401 : undefined),
    refresh: [400],
  });
  const body = run.body as Body;
  assert.equal(run.status, 200);
  for (const section of SECTIONS) assert.equal(body.data?.[section], "forbidden", section);
  // The token layer, and only it, recorded the genuine condition.
  assert.ok(run.connectionStatuses.includes("reauth_required"));
  assert.ok(run.syncStatuses.includes("reauth_required"));
});

test("an expired token whose refresh Google rejects still answers YOUTUBE_REAUTH_REQUIRED", async () => {
  const run = await runRoute(dashboard, "GET", PAGE, { tokenValid: false, refresh: [400] });
  assert.equal(run.status, 401);
  assert.equal((run.body as Body).error, "YOUTUBE_REAUTH_REQUIRED");
});

test("optional section + 403 keeps the reconnect state; other failures stay plain unavailable", async () => {
  const denied = await runRoute(dashboard, "GET", PAGE, {
    api: ({ resource }) => (resource === "reports" ? 403 : undefined),
  });
  for (const section of SECTIONS)
    assert.equal((denied.body as Body).data?.[section], "forbidden", section);
  assert.equal(denied.tokenRefreshes, 0, "a 403 is never refreshed or retried");

  const broken = await runRoute(dashboard, "GET", PAGE, {
    api: ({ resource }) => (resource === "reports" ? 500 : undefined),
  });
  assert.equal(broken.status, 200);
  for (const section of SECTIONS)
    assert.equal((broken.body as Body).data?.[section], "unavailable", section);
  assert.equal(broken.tokenRefreshes, 0);
  assert.deepEqual(reauthWrites(denied), []);
  assert.deepEqual(reauthWrites(broken), []);
});

test("required request + persistent 401: still the required-data failure, never reauth", async () => {
  const run = await runRoute(dashboard, "GET", PAGE, {
    api: ({ resource }) => (resource === "channels" ? 401 : undefined),
  });
  assert.equal(run.status, 502);
  assert.equal((run.body as Body).error, "YOUTUBE_DATA_UNAVAILABLE");
  assert.equal((run.body as Body).data, undefined, "not weakened into a partial success");
  assert.deepEqual(reauthWrites(run), []);
});

test("the Dashboard words a temporary failure without asking to reconnect", () => {
  const source = readFileSync(new URL("../src/routes/dashboard.tsx", import.meta.url), "utf8");
  const messages = [...source.matchAll(/temporarily_unavailable:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(messages.length, 3, "audience, video insights and daily engagement");
  for (const message of messages) {
    assert.match(message, /temporarily unavailable\. Please try again later\.$/);
    assert.doesNotMatch(message, /reconnect|renew|authoriz/i);
  }
  // The reconnect wording is still there for the state that needs it.
  assert.equal([...source.matchAll(/forbidden: "Reconnect YouTube/g)].length, 3);
});

test("the optional-section classifier cannot write anything", () => {
  const source = readFileSync(
    new URL("../src/routes/api.youtube.dashboard.ts", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const start = source.indexOf("export function optionalSectionFailureStatus");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.doesNotMatch(body, /\.update\(|\.insert\(|\.upsert\(|await /);
  assert.doesNotMatch(source, /last_sync_status/, "the Dashboard route never sets a sync status");
});
