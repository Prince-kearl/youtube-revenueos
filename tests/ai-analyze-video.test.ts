import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateVideoAnalysis,
  analyzeVideoPromptFor,
  getActiveProviderInfo,
  type AnalyzeVideoInput,
  type AnalyzeVideoResult,
} from "../src/lib/server/ai-generation";
import {
  checkAiRateLimit,
  recordAiUsage,
  hashForCacheKey,
  getCachedAiResult,
  setCachedAiResult,
  AiRateLimitError,
  AI_LIMITS,
} from "../src/lib/server/ai-usage";
import { inputSchema } from "../src/routes/api.ai.analyze-video";

// ============================================================
// Test fixtures
// ============================================================

const sampleInput: AnalyzeVideoInput = {
  video: {
    videoId: "abcdefghijk",
    title: "How to grow on YouTube in 2026",
    description: "A full guide to channel growth.",
    publishedAt: "2026-01-01T00:00:00Z",
    durationSeconds: 600,
    channelName: "Test Channel",
  },
  transcript: "Welcome back to the channel. Today we're talking about growth strategies.",
  performance: {
    views: 10_000,
    likes: 500,
    comments: 42,
    watchTimeMinutes: null,
    averageViewDurationSeconds: null,
    averageViewPercentage: null,
    estimatedRevenueUsd: null,
  },
  channel: { subscriberCount: 25_000 },
};

const validAiResult = {
  summary: "A solid growth-focused video with a clear structure.",
  overallScore: 7.5,
  scores: { hook: 8, title: 7, seo: 6.5, content: 7, engagement: 7.5 },
  strengths: ["Clear hook in the first 10 seconds"],
  weaknesses: ["Title could better signal the specific outcome"],
  titleSuggestions: ["3 YouTube Growth Tactics That Actually Work in 2026"],
  descriptionSuggestion: "In this video, we cover three growth tactics...",
  keywordSuggestions: ["youtube growth", "channel growth 2026"],
  recommendations: ["Add timestamps to improve retention"],
  contentIdeas: ["Follow-up: analyzing 3 channels that used these tactics"],
};

// Minimal in-memory fake mirroring the .from(...).select/insert/eq/gte/order/limit/maybeSingle
// chain this codebase's server modules actually use — same style as
// tests/youtube-auth-reliability.test.ts's fakeSupabaseClient, extended for the additional
// query shapes ai-usage.ts needs (count queries, upsert).
function fakeServiceClient(options: {
  countByTable?: Partial<Record<string, number>>;
  cacheRows?: Record<string, { result: unknown; expires_at: string }>;
  insertedRows?: Array<{ table: string; values: Record<string, unknown> }>;
  filtersSeen?: Array<{ table: string; column: string; value: unknown }>;
}): SupabaseClient {
  const { countByTable = {}, cacheRows = {}, insertedRows = [], filtersSeen = [] } = options;

  function countQuery(table: string) {
    const chain = {
      eq(column: string, value: unknown) {
        filtersSeen.push({ table, column, value });
        return chain;
      },
      gte() {
        return chain;
      },
      then(resolve: (v: { count: number | null }) => void) {
        resolve({ count: countByTable[table] ?? 0 });
      },
    };
    return chain;
  }

  function cacheReadQuery() {
    let key = "";
    const chain = {
      eq(_column: string, value: string) {
        key = value;
        return chain;
      },
      async maybeSingle() {
        return { data: cacheRows[key] ?? null };
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      return {
        select(_columns: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.count) return countQuery(table);
          if (table === "ai_response_cache") return cacheReadQuery();
          return { maybeSingle: async () => ({ data: null }) };
        },
        insert(values: Record<string, unknown>) {
          insertedRows.push({ table, values });
          return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
        },
        upsert(values: Record<string, unknown>) {
          insertedRows.push({ table, values });
          return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function mockFetchOnce(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

function openAiStyleResponse(
  body: unknown,
  status = 200,
  usage?: { prompt_tokens: number; completion_tokens: number; cost: number },
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(body) } }],
      ...(usage ? { usage } : {}),
    }),
    { status },
  );
}

// ============================================================
// 1. Input validation
// ============================================================

test("analyze-video input schema accepts a well-formed request", () => {
  const result = inputSchema.safeParse({ videoId: "abcdefghijk" });
  assert.equal(result.success, true);
});

test("analyze-video input schema rejects an invalid video id", () => {
  const result = inputSchema.safeParse({ videoId: "not-a-valid-id!!" });
  assert.equal(result.success, false);
});

test("analyze-video input schema rejects an invalid channelId", () => {
  const result = inputSchema.safeParse({ videoId: "abcdefghijk", channelId: "not-a-uuid" });
  assert.equal(result.success, false);
});

// ============================================================
// 2. Missing API key handled safely
// ============================================================

test("generateVideoAnalysis throws AI_PROVIDER_NOT_CONFIGURED with no provider key set", async () => {
  await withEnv(
    {
      AI_PROVIDER: undefined,
      OPENROUTER_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
    },
    async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_NOT_CONFIGURED/);
    },
  );
});

// ============================================================
// 3. Authenticated call succeeds with a mocked provider
// ============================================================

test("generateVideoAnalysis returns a validated result on a successful provider response", async () => {
  const restore = mockFetchOnce(async () => openAiStyleResponse(validAiResult));
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      const { result, usage } = await generateVideoAnalysis(sampleInput);
      assert.equal(result.overallScore, 7.5);
      assert.equal(result.scores.hook, 8);
      assert.deepEqual(result.titleSuggestions, validAiResult.titleSuggestions);
      assert.equal(usage, null); // no usage block in this mocked response
    });
  } finally {
    restore();
  }
});

test("generateVideoAnalysis captures real token/cost usage when the provider reports it", async () => {
  const restore = mockFetchOnce(async () =>
    openAiStyleResponse(validAiResult, 200, {
      prompt_tokens: 1227,
      completion_tokens: 380,
      cost: 0.00041205,
    }),
  );
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      const { usage } = await generateVideoAnalysis(sampleInput);
      assert.deepEqual(usage, { inputTokens: 1227, outputTokens: 380, costUsd: 0.00041205 });
    });
  } finally {
    restore();
  }
});

test("generateVideoAnalysis requests strict JSON-schema structured output, not just json_object", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const restore = mockFetchOnce(async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return openAiStyleResponse(validAiResult);
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await generateVideoAnalysis(sampleInput);
    });
  } finally {
    restore();
  }
  const responseFormat = capturedBody?.response_format as
    { type?: string; json_schema?: { name?: string; strict?: boolean } } | undefined;
  assert.equal(responseFormat?.type, "json_schema");
  assert.equal(responseFormat?.json_schema?.name, "analyze_video_result");
  assert.equal(responseFormat?.json_schema?.strict, true);
});

// ============================================================
// 4. Malformed provider response rejected, never passed to the caller
// ============================================================

test("generateVideoAnalysis rejects a response that isn't valid JSON", async () => {
  const restore = mockFetchOnce(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not json at all" } }] })),
  );
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_FAILED/);
    });
  } finally {
    restore();
  }
});

test("generateVideoAnalysis rejects a response with an out-of-range score", async () => {
  const restore = mockFetchOnce(async () =>
    openAiStyleResponse({ ...validAiResult, overallScore: 99 }),
  );
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_FAILED/);
    });
  } finally {
    restore();
  }
});

test("generateVideoAnalysis rejects a response missing a required field", async () => {
  const { titleSuggestions: _drop, ...incomplete } = validAiResult;
  const restore = mockFetchOnce(async () => openAiStyleResponse(incomplete));
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_FAILED/);
    });
  } finally {
    restore();
  }
});

// ============================================================
// 5. Provider 429 handled — retried, then eventually a clean rate-limit-mappable error
// ============================================================

test("generateVideoAnalysis retries a transient 429 and succeeds on the next attempt", async () => {
  let calls = 0;
  const restore = mockFetchOnce(async () => {
    calls += 1;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return openAiStyleResponse(validAiResult);
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      const { result } = await generateVideoAnalysis(sampleInput);
      assert.equal(result.overallScore, 7.5);
      assert.equal(calls, 2);
    });
  } finally {
    restore();
  }
});

test("generateVideoAnalysis fails with a :429-suffixed error after exhausting retries", async () => {
  let calls = 0;
  const restore = mockFetchOnce(async () => {
    calls += 1;
    return new Response("rate limited", { status: 429 });
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(
        () => generateVideoAnalysis(sampleInput),
        /AI_PROVIDER_FAILED:openrouter:429/,
      );
      assert.equal(calls, 3); // maxAttempts
    });
  } finally {
    restore();
  }
});

// ============================================================
// 6. Provider timeout / network failure handled — retried, never hangs indefinitely
// ============================================================

test("generateVideoAnalysis retries a network failure and eventually fails cleanly", async () => {
  let calls = 0;
  const restore = mockFetchOnce(async () => {
    calls += 1;
    throw new TypeError("network error");
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_FAILED/);
      assert.equal(calls, 3);
    });
  } finally {
    restore();
  }
});

// ============================================================
// 7. Non-transient failures (bad request / invalid key) are never retried
// ============================================================

test("generateVideoAnalysis does not retry a 401 (invalid API key)", async () => {
  let calls = 0;
  const restore = mockFetchOnce(async () => {
    calls += 1;
    return new Response("unauthorized", { status: 401 });
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_FAILED/);
      assert.equal(calls, 1);
    });
  } finally {
    restore();
  }
});

test("generateVideoAnalysis does not retry a 400 (malformed request)", async () => {
  let calls = 0;
  const restore = mockFetchOnce(async () => {
    calls += 1;
    return new Response("bad request", { status: 400 });
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(() => generateVideoAnalysis(sampleInput), /AI_PROVIDER_FAILED/);
      assert.equal(calls, 1);
    });
  } finally {
    restore();
  }
});

// ============================================================
// 8. Unavailable YouTube metrics stay unavailable — never fabricated, never silently zero
// ============================================================

test("the prompt marks missing metrics as unavailable rather than zero", () => {
  const { user } = analyzeVideoPromptFor(sampleInput);
  assert.match(user, /Watch time \(minutes, recent period\): Not available/);
  assert.match(user, /Estimated revenue \(USD\): Not available/);
  assert.doesNotMatch(user, /Estimated revenue \(USD\): 0/);
});

test("the prompt reports a real supplied metric verbatim, not recomputed", () => {
  const { user } = analyzeVideoPromptFor(sampleInput);
  assert.match(user, /Views: 10,000/);
  assert.match(user, /Likes: 500/);
});

test("the prompt tells the model never to fabricate revenue when it's unavailable", () => {
  const { system } = analyzeVideoPromptFor(sampleInput);
  assert.match(system.toLowerCase(), /never invent|never fabricate/);
});

test("the prompt marks a missing transcript as unavailable, not fabricated", () => {
  const { user } = analyzeVideoPromptFor({ ...sampleInput, transcript: null });
  assert.match(
    user,
    /Not available — base content-quality judgments only on the title and description/,
  );
});

// ============================================================
// 9. Cache prevents unnecessary duplicate provider calls
// ============================================================

test("hashForCacheKey is deterministic for identical inputs", async () => {
  const a = await hashForCacheKey(["analyze_video", "v1", "openrouter/free", "abc123"]);
  const b = await hashForCacheKey(["analyze_video", "v1", "openrouter/free", "abc123"]);
  assert.equal(a, b);
});

test("hashForCacheKey differs when any input changes", async () => {
  const a = await hashForCacheKey(["analyze_video", "v1", "openrouter/free", "abc123"]);
  const b = await hashForCacheKey(["analyze_video", "v1", "openrouter/free", "different-video"]);
  assert.notEqual(a, b);
});

test("getCachedAiResult returns a non-expired cached entry", async () => {
  const client = fakeServiceClient({
    cacheRows: {
      "key-1": { result: validAiResult, expires_at: new Date(Date.now() + 60_000).toISOString() },
    },
  });
  const result = await getCachedAiResult(client, "key-1");
  assert.deepEqual(result, validAiResult);
});

test("getCachedAiResult ignores an expired cached entry", async () => {
  const client = fakeServiceClient({
    cacheRows: {
      "key-1": { result: validAiResult, expires_at: new Date(Date.now() - 60_000).toISOString() },
    },
  });
  const result = await getCachedAiResult(client, "key-1");
  assert.equal(result, null);
});

test("setCachedAiResult writes to ai_response_cache", async () => {
  const insertedRows: Array<{ table: string; values: Record<string, unknown> }> = [];
  const client = fakeServiceClient({ insertedRows });
  await setCachedAiResult(client, "key-1", "analyze_video", validAiResult);
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].table, "ai_response_cache");
  assert.equal(insertedRows[0].values.cache_key, "key-1");
});

// ============================================================
// 10. Usage tracking
// ============================================================

test("recordAiUsage inserts a row with the expected shape, no transcript/key content", async () => {
  const insertedRows: Array<{ table: string; values: Record<string, unknown> }> = [];
  const client = fakeServiceClient({ insertedRows });
  await recordAiUsage(client, {
    userId: "user-1",
    provider: "openrouter",
    model: "openrouter/free",
    task: "analyze_video",
    cacheHit: false,
  });
  assert.equal(insertedRows.length, 1);
  const row = insertedRows[0];
  assert.equal(row.table, "ai_usage");
  assert.equal(row.values.user_id, "user-1");
  assert.equal(row.values.provider, "openrouter");
  assert.equal(row.values.task, "analyze_video");
  assert.equal(row.values.cache_hit, false);
  assert.equal("transcript" in row.values, false);
  assert.equal("api_key" in row.values, false);
});

// ============================================================
// 11. Rate limiting / quota enforcement, and user isolation
// ============================================================

test("checkAiRateLimit allows a request under both limits", async () => {
  const client = fakeServiceClient({ countByTable: { ai_usage: 0 } });
  await assert.doesNotReject(() => checkAiRateLimit(client, "user-1", "analyze_video", "free"));
});

test("checkAiRateLimit throws once the per-minute limit is reached", async () => {
  const client = fakeServiceClient({ countByTable: { ai_usage: AI_LIMITS.free.perMinute } });
  await assert.rejects(
    () => checkAiRateLimit(client, "user-1", "analyze_video", "free"),
    (error: unknown) => error instanceof AiRateLimitError && error.window === "minute",
  );
});

test("checkAiRateLimit scopes its query to the requesting user (isolation)", async () => {
  const filtersSeen: Array<{ table: string; column: string; value: unknown }> = [];
  const client = fakeServiceClient({ countByTable: { ai_usage: 0 }, filtersSeen });
  await checkAiRateLimit(client, "user-specific-id", "analyze_video", "free");
  const userFilters = filtersSeen.filter((f) => f.column === "user_id");
  assert.ok(userFilters.length > 0);
  assert.ok(userFilters.every((f) => f.value === "user-specific-id"));
});

test("checkAiRateLimit degrades to allowing the request if ai_usage is unavailable", async () => {
  const brokenClient = {
    from() {
      throw new Error('relation "ai_usage" does not exist');
    },
  } as unknown as SupabaseClient;
  await assert.doesNotReject(() =>
    checkAiRateLimit(brokenClient, "user-1", "analyze_video", "free"),
  );
});

// ============================================================
// 12. Real HTTP-level auth/RBAC checks, opt-in only — same convention as
// tests/youtube-auth-reliability.test.ts (YRO_E2E_BASE_URL / YRO_E2E_SESSION_COOKIE), skipped by
// default so the normal test run never needs a live server or a real Supabase session. Set
// YRO_E2E_BASE_URL against a local `npm run dev` to exercise these; add YRO_E2E_SESSION_COOKIE
// (a signed-in browser's Cookie header) to additionally exercise the authenticated path — this
// is the one place a real OpenRouter call can happen, since it's an explicit, opt-in integration
// environment rather than the default automated run.
// ============================================================

const baseUrl = process.env.YRO_E2E_BASE_URL?.replace(/\/$/, "");
const sessionCookie = process.env.YRO_E2E_SESSION_COOKIE;

function requireHttpEnvironment(t: { skip: (reason: string) => void }): boolean {
  if (!baseUrl) {
    t.skip("Set YRO_E2E_BASE_URL to run authenticated HTTP checks");
    return false;
  }
  return true;
}

function requireSession(t: { skip: (reason: string) => void }): boolean {
  if (!sessionCookie) {
    t.skip("Set YRO_E2E_SESSION_COOKIE to run authenticated HTTP checks");
    return false;
  }
  return true;
}

test("POST /api/ai/analyze-video rejects an unauthenticated request", async (t) => {
  if (!requireHttpEnvironment(t)) return;
  const response = await fetch(`${baseUrl}/api/ai/analyze-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
    redirect: "manual",
  });
  assert.equal(response.status, 401);
});

test("POST /api/ai/analyze-video rejects invalid input even when authenticated", async (t) => {
  if (!requireHttpEnvironment(t) || !requireSession(t)) return;
  const response = await fetch(`${baseUrl}/api/ai/analyze-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie! },
    body: JSON.stringify({ videoId: "not-a-valid-id" }),
    redirect: "manual",
  });
  assert.equal(response.status, 422);
});

// ============================================================
// 13. Model reliability — the real Analyze Video workload against the real, configured
// OpenRouter model. Opt-in only (YRO_AI_LIVE_TEST=true + a real OPENROUTER_API_KEY already in the
// server environment, e.g. via .env) — this makes one real, billed provider call, so it never
// runs in the default `npm test`-equivalent run or CI. Unlike the mocked tests above, this is the
// only place that can catch "the configured model doesn't actually handle this prompt well",
// which is exactly the class of problem that made openrouter/free unsuitable.
// ============================================================

test("model reliability: the real configured model handles the actual Analyze Video workload", async (t) => {
  if (process.env.YRO_AI_LIVE_TEST !== "true") {
    t.skip("Set YRO_AI_LIVE_TEST=true (with a real OPENROUTER_API_KEY configured) to run this");
    return;
  }

  // Representative of a real, successful creator video — every field task 17 asks for, including
  // one metric that's genuinely unavailable (revenue) rather than a suspiciously-complete fixture.
  const realisticInput: AnalyzeVideoInput = {
    video: {
      videoId: "dQw4w9WgXcQ",
      title: "How I grew my YouTube channel to 100k subscribers in 12 months",
      description:
        "In this video I break down the exact content strategy, upload schedule, and editing workflow I used to grow from 0 to 100k subscribers in one year.",
      publishedAt: "2026-01-15T00:00:00Z",
      durationSeconds: 720,
      channelName: "Creator Growth Lab",
    },
    transcript:
      "Hey everyone, welcome back. So a year ago I had zero subscribers and today we crossed 100,000. In this video I want to break down exactly what worked. First, consistency — I posted twice a week without fail. Second, I doubled down on thumbnails and titles, testing three variants per video. Third, I studied retention graphs obsessively and cut every video's first 15 seconds down to the strongest hook I had. Let's get into the specifics of each of these.",
    performance: {
      views: 842_311,
      likes: 41_200,
      comments: 1875,
      watchTimeMinutes: 512_400,
      averageViewDurationSeconds: 365,
      averageViewPercentage: 50.7,
      estimatedRevenueUsd: null, // deliberately unavailable — this account has no monetization access
    },
    channel: { subscriberCount: 103_400 },
  };

  const activeModel = getActiveProviderInfo();
  const start = Date.now();
  let outcome: { result: AnalyzeVideoResult; usage: unknown } | null = null;
  let failure: unknown = null;
  try {
    outcome = await generateVideoAnalysis(realisticInput);
  } catch (error) {
    failure = error;
  }
  const latencyMs = Date.now() - start;

  console.log("=== Analyze Video model reliability report ===");
  console.log("provider/model:", activeModel);
  console.log("latency:", `${latencyMs}ms`);
  console.log("success:", !!outcome);
  if (failure) console.log("failure:", failure instanceof Error ? failure.message : failure);
  if (outcome) {
    console.log("usage:", JSON.stringify(outcome.usage));
    console.log("overallScore:", outcome.result.overallScore);
    console.log("titleSuggestions:", outcome.result.titleSuggestions);
  }

  assert.equal(failure, null, "generateVideoAnalysis threw — see logged failure above");
  assert.ok(outcome, "expected a result");
  // Zod validation already happened inside generateVideoAnalysis (it throws on failure, asserted
  // above) — reaching here means the response passed application-level structural validation.
  const revenueMentioned = /\$\s?\d/.test(JSON.stringify(outcome!.result));
  assert.equal(revenueMentioned, false, "response should not mention a fabricated dollar figure");
  assert.ok(outcome!.result.titleSuggestions.length > 0, "expected at least one title suggestion");
  assert.ok(outcome!.result.recommendations.length > 0, "expected at least one recommendation");
  assert.ok(latencyMs < 30_000, `latency ${latencyMs}ms exceeded the 30s provider timeout budget`);
});
