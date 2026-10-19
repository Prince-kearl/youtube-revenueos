import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPABASE, CALLER } from "./helpers/admin-users-fake-api";
import { safeAppPath } from "../src/lib/server/safe-redirect";

// A redirect target from a request is used only when it is a path inside this app. The old check
// ("starts with / but not //") let "/\evil.com" through, which a browser follows to evil.com.

const ATTACKS = [
  "/\\evil.com",
  "/\\/evil.com",
  "\\\\evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r//evil.com",
  "//evil.com",
  "///evil.com",
  "https://evil.com",
  "javascript:alert(1)",
  "evil.com",
  "",
  `/${"a".repeat(2100)}`,
];

test("anything that is not plainly an app path gets the fallback", () => {
  for (const attack of ATTACKS)
    assert.equal(
      safeAppPath(attack, "/settings"),
      "/settings",
      JSON.stringify(attack.slice(0, 30)),
    );
  assert.equal(safeAppPath(null, "/settings"), "/settings");
  assert.equal(safeAppPath(undefined, "/settings"), "/settings");
});

test("real app paths are kept, with their query and fragment", () => {
  for (const path of [
    "/settings",
    "/dashboard",
    "/videos/abc?tab=links#top",
    "/settings?youtube=1",
  ])
    assert.equal(safeAppPath(path, "/settings"), path);
  // A path that only looks odd is still resolved on this app.
  assert.equal(safeAppPath("/a/../dashboard", "/settings"), "/dashboard");
});

// The real route: a signed-in creator with a connected channel, sent to
// /api/youtube/auth?ifNeeded=1&returnTo=<attack>, must land on an app page.
const authRoute = await import("../src/routes/api.youtube.auth");

async function youtubeAuth(returnTo: string) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.origin === SUPABASE && url.pathname === "/auth/v1/user")
      return json({ id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" });
    if (url.origin === SUPABASE && url.pathname === "/rest/v1/youtube_channels")
      return json([{ id: "11111111-1111-4111-8111-111111111111" }]);
    throw new Error(`unexpected request: ${url}`);
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
      authRoute.Route as unknown as {
        options: { server: { handlers: { GET: (c: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers;
    const url = new URL("https://app.test/api/youtube/auth");
    url.searchParams.set("ifNeeded", "1");
    url.searchParams.set("returnTo", returnTo);
    return await handlers.GET({ request: new Request(url, { headers: { Cookie: cookie } }) });
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("ATTACK: /api/youtube/auth never redirects off the app", async () => {
  for (const attack of ATTACKS) {
    const response = await youtubeAuth(attack);
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "/settings",
      JSON.stringify(attack.slice(0, 30)),
    );
  }
  const ok = await youtubeAuth("/dashboard");
  assert.equal(ok.headers.get("location"), "/dashboard");
});

test("both YouTube OAuth steps use the strict check; the old prefix check is gone", () => {
  for (const file of ["src/routes/api.youtube.auth.ts", "src/routes/api.youtube.callback.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /safeAppPath\(/, file);
    assert.doesNotMatch(source, /startsWith\("\/\/"\)/, file);
  }
});
