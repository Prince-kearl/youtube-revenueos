import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, fetchJson } from "../src/lib/api-client";
import { clearSessionQueryData, createAppQueryClient } from "../src/lib/query-client";
import { queryKeys } from "../src/lib/query-keys";

test("dashboard query keys isolate both account and selected YouTube channel", () => {
  assert.notDeepEqual(
    queryKeys.dashboard.revenue("viewer-a", "channel-1"),
    queryKeys.dashboard.revenue("viewer-b", "channel-1"),
  );
  assert.notDeepEqual(
    queryKeys.dashboard.youtube("viewer-a", "channel-1"),
    queryKeys.dashboard.youtube("viewer-a", "channel-2"),
  );
});

test("account changes evict prior-session queries and logout clears the whole cache", () => {
  const client = createAppQueryClient();
  const priorAccountKey = queryKeys.dashboard.revenue("viewer-a", "channel-1");
  const currentAccountKey = queryKeys.dashboard.revenue("viewer-b", "channel-1");
  client.setQueryData(priorAccountKey, { private: "prior-account" });
  client.setQueryData(currentAccountKey, { private: "current-account" });

  clearSessionQueryData(client, "viewer-b");
  assert.equal(client.getQueryData(priorAccountKey), undefined);
  assert.deepEqual(client.getQueryData(currentAccountKey), { private: "current-account" });

  clearSessionQueryData(client, null);
  assert.equal(client.getQueryCache().getAll().length, 0);
});

test("API errors expose status only and do not retain sensitive response bodies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ secret: "sensitive payload" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(fetchJson("/api/private"), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 403);
      assert.equal(error.message.includes("sensitive payload"), false);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
