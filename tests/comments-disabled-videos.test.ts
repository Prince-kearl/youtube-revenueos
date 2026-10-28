import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fetchRecentYoutubeComments,
  fetchRecentYoutubeCommentsDetailed,
  YoutubeQuotaExceededError,
} from "../src/lib/server/google-oauth";

// A channel showed "Partially synced" on every sync: its comments step failed because ONE video
// has comments turned off (YouTube answers 403 commentsDisabled — e.g. every video made for
// kids), and that error failed the read for every video.

const thread = (id: string, videoId: string) => ({
  id,
  snippet: {
    videoId,
    canReply: true,
    topLevelComment: { snippet: { textDisplay: `comment ${id}`, authorDisplayName: "Viewer" } },
  },
});

function withYoutube(answers: Record<string, () => Response>, fn: () => Promise<void>) {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const videoId = url.searchParams.get("videoId") ?? "";
    asked.push(videoId);
    return (answers[videoId] ?? (() => Response.json({ items: [] })))();
  }) as typeof fetch;
  return fn()
    .then(() => asked)
    .finally(() => {
      globalThis.fetch = real;
    });
}

const youtubeError = (status: number, reason?: string) =>
  Response.json({ error: { code: status, errors: reason ? [{ reason }] : [] } }, { status });

test("a video with comments turned off (or deleted) is skipped; the others' comments are kept", async () => {
  const asked = await withYoutube(
    {
      vidOpen0001: () => Response.json({ items: [thread("c1", "vidOpen0001")] }),
      vidKids0001: () => youtubeError(403, "commentsDisabled"),
      vidGone0001: () => youtubeError(404, "videoNotFound"),
      vidOpen0002: () => Response.json({ items: [thread("c2", "vidOpen0002")] }),
    },
    async () => {
      const result = await fetchRecentYoutubeCommentsDetailed("token", [
        "vidOpen0001",
        "vidKids0001",
        "vidGone0001",
        "vidOpen0002",
      ]);
      assert.deepEqual(
        result.comments.map((c) => c.id),
        ["c1", "c2"],
      );
      assert.deepEqual(result.skippedVideoIds, ["vidKids0001", "vidGone0001"]);
      // The plain form (used by the sync) returns the comments, with no error.
      assert.equal(
        (await fetchRecentYoutubeComments("token", ["vidKids0001", "vidOpen0001"])).length,
        1,
      );
    },
  );
  assert.ok(asked.includes("vidOpen0002"), "kept going after the skipped videos");
});

test("quota and other failures still fail the read (they are not 'comments off')", async () => {
  await withYoutube({ vidX: () => youtubeError(403, "quotaExceeded") }, async () => {
    await assert.rejects(
      fetchRecentYoutubeCommentsDetailed("token", ["vidX"]),
      YoutubeQuotaExceededError,
    );
  });
  await withYoutube({ vidX: () => youtubeError(403, "forbidden") }, async () => {
    await assert.rejects(
      fetchRecentYoutubeCommentsDetailed("token", ["vidX"]),
      /YOUTUBE_COMMENTTHREADS_FAILED:403/,
    );
  });
  await withYoutube({ vidX: () => youtubeError(500) }, async () => {
    await assert.rejects(
      fetchRecentYoutubeCommentsDetailed("token", ["vidX"]),
      /YOUTUBE_COMMENTTHREADS_FAILED:500/,
    );
  });
});

test("the one-video comments view says comments are turned off, and Settings explains a partial update in plain words", () => {
  const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
  assert.match(
    flat("src/routes/api.youtube.comments.ts"),
    /commentsDisabled: skippedVideoIds\.includes\(video\.id\),/,
  );
  const page = flat("src/routes/comments.tsx");
  assert.match(page, /"Comments are turned off for this video"/);
  // Settings words a partial update in plain language (see channel-sync-status.test.ts).
  assert.match(flat("src/routes/settings.tsx"), /const view = channelSyncView\(channel\);/);
});
