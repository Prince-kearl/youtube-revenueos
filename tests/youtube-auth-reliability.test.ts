import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getValidAccessTokenWithDependencies,
  isYoutubeReauthError,
  YoutubeReauthRequiredError,
} from "../src/lib/server/youtube-tokens";

type Json = Record<string, unknown>;

const baseUrl = process.env.YRO_E2E_BASE_URL?.replace(/\/$/, "");
const sessionCookie = process.env.YRO_E2E_SESSION_COOKIE;
const configuredChannelIds = (process.env.YRO_E2E_CHANNEL_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function fakeSupabaseClient(updates: Array<{ values: Json; id: string }>): SupabaseClient {
  return {
    from: () => ({
      update: (values: Json) => ({
        eq: async (_column: string, id: string) => {
          updates.push({ values, id });
          return { data: null, error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
}

function channel(tokenExpiry: string): {
  id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expiry: string;
} {
  return {
    id: "channel-row-1",
    access_token_ciphertext: "access-ciphertext",
    refresh_token_ciphertext: "refresh-ciphertext",
    token_expiry: tokenExpiry,
  };
}

test("token lifecycle reuses an access token that is safely valid", async () => {
  const updates: Array<{ values: Json; id: string }> = [];
  let refreshCalls = 0;
  const token = await getValidAccessTokenWithDependencies(
    fakeSupabaseClient(updates),
    channel(new Date(Date.now() + 10 * 60_000).toISOString()),
    {
      decrypt: async (value) => (value === "access-ciphertext" ? "access-token" : "refresh-token"),
      encrypt: async (value) => `encrypted:${value}`,
      refresh: async () => {
        refreshCalls += 1;
        return { access_token: "unexpected", expires_in: 3600, scope: "", token_type: "Bearer" };
      },
      now: () => Date.now(),
    },
  );

  assert.equal(token, "access-token");
  assert.equal(refreshCalls, 0);
  assert.equal(updates.length, 0);
});

test("token lifecycle refreshes an expired token and persists the replacement", async () => {
  const updates: Array<{ values: Json; id: string }> = [];
  let receivedRefreshToken = "";
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  const token = await getValidAccessTokenWithDependencies(
    fakeSupabaseClient(updates),
    channel("2026-08-29T11:00:00.000Z"),
    {
      decrypt: async (value) => (value === "access-ciphertext" ? "old-access" : "refresh-token"),
      encrypt: async (value) => `encrypted:${value}`,
      refresh: async (refreshToken) => {
        receivedRefreshToken = refreshToken;
        return { access_token: "new-access", expires_in: 3600, scope: "", token_type: "Bearer" };
      },
      now: () => now,
    },
  );

  assert.equal(token, "new-access");
  assert.equal(receivedRefreshToken, "refresh-token");
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.id, "channel-row-1");
  assert.equal(updates[0]?.values.access_token_ciphertext, "encrypted:new-access");
  assert.equal(updates[0]?.values.token_expiry, new Date(now + 3600_000).toISOString());
});

test("token lifecycle marks reauthentication when Google rejects the refresh token", async () => {
  const updates: Array<{ values: Json; id: string }> = [];
  await assert.rejects(
    getValidAccessTokenWithDependencies(
      fakeSupabaseClient(updates),
      channel("2026-08-29T11:00:00.000Z"),
      {
        decrypt: async (value) => (value === "access-ciphertext" ? "old-access" : "refresh-token"),
        encrypt: async (value) => `encrypted:${value}`,
        refresh: async () => {
          throw new Error("GOOGLE_TOKEN_REQUEST_FAILED:400");
        },
        now: () => Date.parse("2026-08-29T12:00:00.000Z"),
      },
    ),
    (error) => error instanceof YoutubeReauthRequiredError,
  );

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    id: "channel-row-1",
    values: { last_sync_status: "reauth_required", last_sync_error: null },
  });
  assert.equal(isYoutubeReauthError(new Error("GOOGLE_TOKEN_REQUEST_FAILED:401")), true);
});

async function request(
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: Json }> {
  const headers = new Headers(init?.headers);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

function requireHttpEnvironment(t: { skip: (reason: string) => void }): boolean {
  if (!baseUrl) {
    t.skip("Set YRO_E2E_BASE_URL to run authenticated HTTP checks");
    return false;
  }
  return true;
}

function isVercelSsoRedirect(response: Response): boolean {
  return (
    response.status === 302 &&
    (response.headers.get("location") ?? "").includes("vercel.com/sso-api")
  );
}

function skipIfVercelSso(t: { skip: (reason: string) => void }, response: Response): boolean {
  if (!isVercelSsoRedirect(response)) return false;
  t.skip(
    "Vercel SSO protects this deployment; run the authenticated checks against a session-accessible staging URL",
  );
  return true;
}

function requireSession(t: { skip: (reason: string) => void }): boolean {
  if (!sessionCookie) {
    t.skip("Set YRO_E2E_SESSION_COOKIE to run authenticated HTTP checks");
    return false;
  }
  return true;
}

test("browser API routes reject unauthenticated requests", async (t) => {
  if (!requireHttpEnvironment(t)) return;
  const unauthenticated = await fetch(`${baseUrl}/api/youtube/channels`, { redirect: "manual" });
  if (skipIfVercelSso(t, unauthenticated)) return;
  assert.equal(unauthenticated.status, 401);
});

test("authenticated channel inventory never returns token fields", async (t) => {
  if (!requireHttpEnvironment(t) || !requireSession(t)) return;
  const { response, body } = await request("/api/youtube/channels");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data));
  for (const item of body.data) {
    assert.equal("access_token_ciphertext" in item, false);
    assert.equal("refresh_token_ciphertext" in item, false);
    assert.equal("client_secret" in item, false);
  }
});

test("authenticated active-channel requests return only the requested owned channel", async (t) => {
  if (!requireHttpEnvironment(t) || !requireSession(t)) return;
  const { body: channelsBody } = await request("/api/youtube/channels");
  const channels = Array.isArray(channelsBody.data) ? channelsBody.data : [];
  if (channels.length === 0) {
    t.skip("The test account has no connected YouTube channel");
    return;
  }

  const channelIds = configuredChannelIds.length > 0 ? configuredChannelIds : [channels[0].id];
  for (const channelId of channelIds) {
    const { response, body } = await request(
      `/api/youtube/videos?channelId=${encodeURIComponent(channelId)}`,
    );
    assert.ok([200, 401, 502].includes(response.status), `unexpected status ${response.status}`);
    if (response.status === 200 && body.data?.channel) {
      assert.equal(body.data.channel.id, channelId);
    }
    if (response.status === 401) assert.notEqual(body.error, "AUTH_REQUIRED");
  }
});

test("a second connected channel can be selected without changing the first channel response", async (t) => {
  if (!requireHttpEnvironment(t) || !requireSession(t)) return;
  const { body } = await request("/api/youtube/channels");
  const channels = Array.isArray(body.data) ? body.data : [];
  if (channels.length < 2) {
    t.skip("Connect at least two YouTube channels to run switching assertions");
    return;
  }

  const [first, second] = channels;
  const firstResult = await request(
    `/api/youtube/videos?channelId=${encodeURIComponent(first.id)}`,
  );
  const secondResult = await request(
    `/api/youtube/videos?channelId=${encodeURIComponent(second.id)}`,
  );
  if (firstResult.response.status === 200 && firstResult.body.data?.channel) {
    assert.equal(firstResult.body.data.channel.id, first.id);
  }
  if (secondResult.response.status === 200 && secondResult.body.data?.channel) {
    assert.equal(secondResult.body.data.channel.id, second.id);
  }
});

test("OAuth start requires a signed-in session and returns a redirect when configured", async (t) => {
  if (!requireHttpEnvironment(t) || !requireSession(t)) return;
  const { response } = await request("/api/youtube/auth?returnTo=/settings");
  assert.ok([302, 500].includes(response.status));
  if (response.status === 302)
    assert.match(response.headers.get("location") ?? "", /accounts\.google\.com/);
});

test("OAuth callback rejects a missing or mismatched state without exchanging a code", async (t) => {
  if (!requireHttpEnvironment(t)) return;
  const { response } = await request("/api/youtube/callback?code=fake-code&state=fake-state");
  if (skipIfVercelSso(t, response)) return;
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /youtube=invalid_state/);
});

test("channel disconnect validation rejects malformed IDs without mutating data", async (t) => {
  if (!requireHttpEnvironment(t) || !requireSession(t)) return;
  const { response, body } = await request("/api/youtube/channels?id=not-a-uuid", {
    method: "DELETE",
  });
  assert.equal(response.status, 422);
  assert.equal(body.error, "VALIDATION_ERROR");
});
