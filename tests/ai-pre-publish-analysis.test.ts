import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generatePrePublishVideoAnalysis,
  prePublishAnalysisPromptFor,
  parseChapterTimestampSeconds,
  sanitizeChapters,
  PrePublishAnalysisResultSchema,
  type PrePublishAnalysisInput,
  type PrePublishAnalysisResult,
} from "../src/lib/server/ai-generation";
import { createSchema as prePublishCreateSchema } from "../src/routes/api.pre-publish-videos";

// ============================================================
// Test fixtures — same shape/mocking conventions as tests/ai-analyze-video.test.ts.
// ============================================================

const sampleInput: PrePublishAnalysisInput = {
  video: { fileName: "my-video-final-v3.mp4", durationSeconds: 620 },
  transcript: "Welcome back. Today I'm showing you my full editing workflow from start to finish.",
  context: {
    topic: "My video editing workflow",
    audience: "New YouTube creators",
    tone: "Educational",
    goal: "Build authority",
  },
  channel: { name: "Test Channel", subscriberCount: 5_000 },
};

const validAiResult: PrePublishAnalysisResult = {
  summary: "A clear walkthrough of an editing workflow aimed at new creators.",
  recommendedTitle: "My Full YouTube Editing Workflow (Start to Finish)",
  titleIdeas: [
    {
      title: "My Full YouTube Editing Workflow (Start to Finish)",
      angle: "Outcome-focused",
      rationale: "Signals a complete, followable process.",
    },
    {
      title: "How I Edit Every YouTube Video",
      angle: "Curiosity",
      rationale: "Shorter, curiosity-driven alternative.",
    },
  ],
  description: "In this video I walk through my full editing workflow...",
  tags: {
    primary: ["video editing", "youtube workflow"],
    secondary: ["editing tips", "creator workflow"],
    longTail: ["how to edit youtube videos faster"],
  },
  chapters: [
    { timestamp: "00:00", title: "Intro" },
    { timestamp: "01:30", title: "Importing footage" },
    { timestamp: "05:00", title: "Rough cut" },
  ],
  ctaIdeas: [
    { type: "Subscribe", text: "Subscribe for more editing breakdowns", placement: "End" },
    { type: "Comment", text: "What editing software do you use?", placement: "Mid-video" },
  ],
  optimizationNotes: ["Consider a stronger hook in the first 5 seconds."],
};

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

function openAiStyleResponse(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    { status },
  );
}

// ============================================================
// 1. Input validation — POST /api/pre-publish-videos
// ============================================================

test("pre-publish create schema accepts a well-formed request", () => {
  const result = prePublishCreateSchema.safeParse({
    fileName: "video.mp4",
    fileSize: 1_000_000,
    mimeType: "video/mp4",
  });
  assert.equal(result.success, true);
});

test("pre-publish create schema rejects a file over the size limit", () => {
  const result = prePublishCreateSchema.safeParse({
    fileName: "video.mp4",
    fileSize: 3 * 1024 * 1024 * 1024, // 3GB, over the 2GB limit
    mimeType: "video/mp4",
  });
  assert.equal(result.success, false);
});

test("pre-publish create schema rejects an invalid channelId", () => {
  const result = prePublishCreateSchema.safeParse({
    fileName: "video.mp4",
    fileSize: 1000,
    mimeType: "video/mp4",
    channelId: "not-a-uuid",
  });
  assert.equal(result.success, false);
});

test("pre-publish create schema does not require a channelId — a video may exist with no YouTube channel association at all", () => {
  const result = prePublishCreateSchema.safeParse({
    fileName: "video.mp4",
    fileSize: 1000,
    mimeType: "video/mp4",
  });
  assert.equal(result.success, true);
});

// ============================================================
// 2. Missing API key handled safely (same behavior as generateVideoAnalysis)
// ============================================================

test("generatePrePublishVideoAnalysis throws AI_PROVIDER_NOT_CONFIGURED with no provider key set", async () => {
  await withEnv(
    {
      AI_PROVIDER: undefined,
      OPENROUTER_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
    },
    async () => {
      await assert.rejects(
        () => generatePrePublishVideoAnalysis(sampleInput),
        /AI_PROVIDER_NOT_CONFIGURED/,
      );
    },
  );
});

// ============================================================
// 3. Successful generation, structured-output request, validation
// ============================================================

test("generatePrePublishVideoAnalysis returns a validated result on a successful provider response", async () => {
  const restore = mockFetchOnce(async () => openAiStyleResponse(validAiResult));
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      const { result } = await generatePrePublishVideoAnalysis(sampleInput);
      assert.equal(result.recommendedTitle, validAiResult.recommendedTitle);
      assert.equal(result.titleIdeas.length, 2);
      assert.deepEqual(result.tags, validAiResult.tags);
      assert.equal(result.chapters.length, 3);
    });
  } finally {
    restore();
  }
});

test("generatePrePublishVideoAnalysis requests strict JSON-schema structured output", async () => {
  let capturedBody: Record<string, unknown> = {};
  const restore = mockFetchOnce(async (_url, init) => {
    capturedBody = JSON.parse(String((init as RequestInit).body));
    return openAiStyleResponse(validAiResult);
  });
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await generatePrePublishVideoAnalysis(sampleInput);
      const responseFormat = capturedBody.response_format as { type?: string } | undefined;
      assert.equal(responseFormat?.type, "json_schema");
    });
  } finally {
    restore();
  }
});

test("generatePrePublishVideoAnalysis rejects a response missing a required field", async () => {
  const { recommendedTitle: _drop, ...incomplete } = validAiResult;
  const restore = mockFetchOnce(async () => openAiStyleResponse(incomplete));
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(
        () => generatePrePublishVideoAnalysis(sampleInput),
        /AI_PROVIDER_FAILED/,
      );
    });
  } finally {
    restore();
  }
});

test("generatePrePublishVideoAnalysis rejects a response with a malformed tags shape", async () => {
  const malformed = { ...validAiResult, tags: ["not", "the", "right", "shape"] };
  const restore = mockFetchOnce(async () => openAiStyleResponse(malformed));
  try {
    await withEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" }, async () => {
      await assert.rejects(
        () => generatePrePublishVideoAnalysis(sampleInput),
        /AI_PROVIDER_FAILED/,
      );
    });
  } finally {
    restore();
  }
});

test("PrePublishAnalysisResultSchema accepts an empty chapters array (no transcript structure to draw from)", () => {
  const result = PrePublishAnalysisResultSchema.safeParse({ ...validAiResult, chapters: [] });
  assert.equal(result.success, true);
});

// ============================================================
// 4. Prompt grounding — never fabricate when context is missing
// ============================================================

test("the prompt marks a missing transcript as unavailable, not fabricated", () => {
  const { user } = prePublishAnalysisPromptFor({ ...sampleInput, transcript: null });
  assert.match(user, /Not available — the creator did not paste a transcript/);
});

test("the prompt includes real supplied context verbatim", () => {
  const { user } = prePublishAnalysisPromptFor(sampleInput);
  assert.match(user, /My video editing workflow/);
  assert.match(user, /New YouTube creators/);
  assert.match(user, /Educational/);
  assert.match(user, /Build authority/);
});

test("the prompt marks missing context fields as not provided rather than blank", () => {
  const { user } = prePublishAnalysisPromptFor({
    ...sampleInput,
    context: { topic: null, audience: null, tone: null, goal: null },
  });
  assert.match(user, /Topic: Not provided/);
});

test("the prompt tells the model this video is not yet published", () => {
  const { system } = prePublishAnalysisPromptFor(sampleInput);
  assert.match(system, /has not yet been published to YouTube/);
  assert.match(system, /Do not invent claims/);
});

test("the prompt reports no channel selected when none is supplied", () => {
  const { user } = prePublishAnalysisPromptFor({ ...sampleInput, channel: null });
  assert.match(user, /No channel selected for this analysis/);
});

// ============================================================
// 5. Chapter timestamp parsing/validation — never trust the model's timestamps blindly
// ============================================================

test("parseChapterTimestampSeconds parses M:SS", () => {
  assert.equal(parseChapterTimestampSeconds("01:30"), 90);
});

test("parseChapterTimestampSeconds parses H:MM:SS", () => {
  assert.equal(parseChapterTimestampSeconds("1:02:03"), 3723);
});

test("parseChapterTimestampSeconds rejects garbage input", () => {
  assert.equal(parseChapterTimestampSeconds("not a timestamp"), null);
  assert.equal(parseChapterTimestampSeconds(""), null);
  assert.equal(parseChapterTimestampSeconds("1:2:3:4"), null);
});

test("parseChapterTimestampSeconds rejects an out-of-range minutes/seconds component", () => {
  assert.equal(parseChapterTimestampSeconds("1:75"), null);
});

test("sanitizeChapters drops a chapter whose timestamp exceeds the real video duration", () => {
  const chapters = [
    { timestamp: "00:00", title: "Intro" },
    { timestamp: "20:00", title: "Fabricated — video is only 10 minutes" },
  ];
  const sanitized = sanitizeChapters(chapters, 600); // 10 minutes
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].title, "Intro");
});

test("sanitizeChapters drops unparseable timestamps even when duration is unknown", () => {
  const chapters = [
    { timestamp: "00:00", title: "Intro" },
    { timestamp: "garbage", title: "Bad" },
  ];
  const sanitized = sanitizeChapters(chapters, null);
  assert.equal(sanitized.length, 1);
});

test("sanitizeChapters sorts chapters by timestamp", () => {
  const chapters = [
    { timestamp: "05:00", title: "Third" },
    { timestamp: "00:00", title: "First" },
    { timestamp: "02:00", title: "Second" },
  ];
  const sanitized = sanitizeChapters(chapters, null);
  assert.deepEqual(
    sanitized.map((c) => c.title),
    ["First", "Second", "Third"],
  );
});

test("sanitizeChapters keeps a chapter timestamp exactly equal to the video duration", () => {
  const chapters = [{ timestamp: "10:00", title: "Outro" }];
  const sanitized = sanitizeChapters(chapters, 600);
  assert.equal(sanitized.length, 1);
});
