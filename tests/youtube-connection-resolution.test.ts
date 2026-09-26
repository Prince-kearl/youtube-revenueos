import assert from "node:assert/strict";
import { test } from "node:test";
import { planYoutubeConnectionResolution } from "../src/lib/server/youtube-connection-resolution";

// ============================================================
// Test A — existing modern connection: exact google_subject_id match always wins and is reused
// as-is, regardless of what legacy candidates happen to also be present.
// ============================================================
test("reuses an existing connection with a matching google_subject_id", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: "conn-modern-1",
    eligibleLegacyConnections: [{ id: "conn-legacy-unrelated", hasTokenPair: true }],
  });
  assert.deepEqual(plan, { action: "reuse", connectionId: "conn-modern-1" });
});

// ============================================================
// Test B — migrated legacy connection: no exact match, exactly one eligible legacy connection ->
// reconcile it (adopt it), never create a new row.
// ============================================================
test("reconciles the single eligible legacy connection when there is no exact match", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: null,
    eligibleLegacyConnections: [{ id: "conn-legacy-1", hasTokenPair: true }],
  });
  assert.deepEqual(plan, { action: "reconcile", connectionId: "conn-legacy-1" });
});

// ============================================================
// Test C — multiple channels already point at the SAME legacy connection: that still collapses to
// exactly one eligible candidate (the route de-dupes connection ids before calling this), so it
// still reconciles cleanly rather than being treated as ambiguous.
// ============================================================
test("still reconciles cleanly when multiple discovered channels resolve to the same legacy connection", () => {
  // The route de-duplicates candidate connection ids before building eligibleLegacyConnections
  // (two channels sharing one connection_id contribute the same id only once) — this test locks in
  // that a single deduplicated candidate is what this function receives and how it must behave.
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: null,
    eligibleLegacyConnections: [{ id: "conn-legacy-shared", hasTokenPair: true }],
  });
  assert.deepEqual(plan, { action: "reconcile", connectionId: "conn-legacy-shared" });
});

// ============================================================
// Test D — an unrelated NULL-subject legacy connection exists in the workspace, but none of the
// channels this identity discovered reference it, so it never appears as an eligible candidate at
// all. With zero eligible candidates, a new connection is created.
// ============================================================
test("creates a new connection when no legacy connection is referenced by a discovered channel", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: null,
    eligibleLegacyConnections: [],
  });
  assert.deepEqual(plan, { action: "create" });
});

// ============================================================
// Test E — ambiguous: two or more distinct legacy connections are each backing a channel this
// identity can see, with no deterministic way to prove which one is "the" match. Must never guess,
// merge, or overwrite either one.
// ============================================================
test("refuses to guess and reports ambiguous when multiple legacy connections are eligible", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: null,
    eligibleLegacyConnections: [
      { id: "conn-legacy-a", hasTokenPair: true },
      { id: "conn-legacy-b", hasTokenPair: true },
    ],
  });
  assert.deepEqual(plan, {
    action: "ambiguous",
    candidateConnectionIds: ["conn-legacy-a", "conn-legacy-b"],
  });
});

test("ambiguous candidate ids only include usable (token-pair-present) legacy connections", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: null,
    eligibleLegacyConnections: [
      { id: "conn-legacy-a", hasTokenPair: true },
      { id: "conn-legacy-b", hasTokenPair: true },
      { id: "conn-legacy-missing-tokens", hasTokenPair: false },
    ],
  });
  assert.deepEqual(plan, {
    action: "ambiguous",
    candidateConnectionIds: ["conn-legacy-a", "conn-legacy-b"],
  });
});

test("a legacy connection missing a token pair is never reconciled, even as the sole candidate", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: null,
    eligibleLegacyConnections: [{ id: "conn-legacy-broken", hasTokenPair: false }],
  });
  assert.deepEqual(plan, { action: "create" });
});

// ============================================================
// Test F — repeated reconnect: once a legacy connection has been reconciled (so it now has a real
// google_subject_id in the database), the NEXT callback for that identity finds it via the exact
// match path, not legacy reconciliation, and never creates another row. This is exercised here as
// "exact match beats any legacy candidates", matching what the second call's inputs look like.
// ============================================================
test("a second callback for the same now-reconciled identity reuses it via exact match, not reconciliation", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: "conn-legacy-1", // now has a real sub after Test B's reconciliation
    eligibleLegacyConnections: [], // route only computes this when there's no exact match
  });
  assert.deepEqual(plan, { action: "reuse", connectionId: "conn-legacy-1" });
});

// ============================================================
// Test G — "Find more channels": an existing connection with a real Google subject discovers an
// additional channel. That's always an exact-match reuse (the connection already has its sub) —
// legacy reconciliation never enters into it.
// ============================================================
test("finding more channels on an already-modern connection is a plain reuse", () => {
  const plan = planYoutubeConnectionResolution({
    exactMatchConnectionId: "conn-modern-1",
    eligibleLegacyConnections: [],
  });
  assert.deepEqual(plan, { action: "reuse", connectionId: "conn-modern-1" });
});
