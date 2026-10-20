import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runRoute } from "./helpers/live-youtube-stub";

// A video's comment count on the Videos page opens Comment Automation on that video's comments
// (/comments?video=<YouTube id>). The comments API then fetches that one video — only when
// YouTube confirms it belongs to the caller's connected channel.

const route = await import("../src/routes/api.youtube.comments");
const OWN = "ownVideo000";
const OTHER = "someoneElse";
const MISSING = "doesNotExis";

const comments = (body: Record<string, unknown>) =>
  ((body.data as { comments: Array<{ videoId: string }> }).comments ?? []).map((c) => c.videoId);

test("own video: that video's comments only, whatever its age, and its title", async () => {
  const r = await runRoute(route, "GET", `/api/youtube/comments?videoId=${OWN}`, {
    tokenValid: true,
    videosById: { [OWN]: "own" },
    commentsByVideo: { [OWN]: 3, recent00001: 5 },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(comments(r.body), [OWN, OWN, OWN]);
  assert.deepEqual((r.body.data as { videos: unknown }).videos, [
    { id: OWN, title: `Title of ${OWN}` },
  ]);
  // The preview at the top of the dialog: the video's own details from YouTube.
  assert.deepEqual((r.body.data as { video: unknown }).video, {
    id: OWN,
    title: `Title of ${OWN}`,
    thumbnail: null,
    publishedAt: "2026-09-01T00:00:00Z",
    duration: "1:00",
    views: 1,
    comments: 0,
  });
  // One ownership lookup and one comments request — not the channel's recent uploads.
  assert.deepEqual(
    r.google.map((g) => g.resource),
    ["videos", "commentThreads"],
  );
});

test("a video on another channel, or one that does not exist: the same 404, no comments fetched", async () => {
  for (const id of [OTHER, MISSING]) {
    const r = await runRoute(route, "GET", `/api/youtube/comments?videoId=${id}`, {
      tokenValid: true,
      videosById: { [OTHER]: "foreign" },
      commentsByVideo: { [OTHER]: 4 },
    });
    assert.deepEqual([id, r.status, r.body], [id, 404, { error: "VIDEO_NOT_FOUND" }]);
    assert.ok(!r.google.some((g) => g.resource === "commentThreads"), `${id}: no comments read`);
  }
});

test("a malformed videoId is refused before anything is fetched", async () => {
  for (const bad of ["", "short", "has spaces!", "../../etc/pas", "x".repeat(12)]) {
    const r = await runRoute(
      route,
      "GET",
      `/api/youtube/comments?videoId=${encodeURIComponent(bad)}`,
      { tokenValid: true },
    );
    assert.deepEqual([bad, r.status, r.body], [bad, 422, { error: "VALIDATION_ERROR" }]);
    assert.deepEqual(r.google, [], bad);
  }
});

// ---------- all videos (no videoId): every video of the channel, a page at a time ----------

const OLD = "oldVideo001";
const NEW = "newVideo001";

test("without videoId: comments on every video of the caller's channel, not just recent uploads", async () => {
  const r = await runRoute(route, "GET", "/api/youtube/comments", {
    tokenValid: true,
    videosById: { [OLD]: "own", [NEW]: "own" },
    channelCommentPages: [[NEW, OLD, OLD]],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(comments(r.body), [NEW, OLD, OLD]);
  const data = r.body.data as { videos: Array<{ id: string }>; nextPageToken: string | null };
  assert.deepEqual(data.videos.map((v) => v.id).sort(), [NEW, OLD].sort());
  assert.equal(data.nextPageToken, null);
  // One channel-wide request (for the caller's own channel) and one title lookup — no walking
  // the uploads playlist, no request per video.
  const thread = r.google.find((g) => g.resource === "commentThreads")!;
  assert.equal(thread.params?.allThreadsRelatedToChannelId, "UCtestchannel0000000000000");
  assert.equal(thread.params?.maxResults, "100");
  assert.equal(thread.params?.videoId, undefined);
  assert.deepEqual(
    r.google.map((g) => g.resource),
    ["commentThreads", "videos"],
  );
});

test("more comments than one page: nextPageToken, then pageToken fetches the next page", async () => {
  const scenario = {
    tokenValid: true,
    videosById: { [OLD]: "own" as const, [NEW]: "own" as const },
    channelCommentPages: [[NEW, NEW], [OLD]],
  };
  const first = await runRoute(route, "GET", "/api/youtube/comments", scenario);
  assert.equal((first.body.data as { nextPageToken: string }).nextPageToken, "page-2");
  const second = await runRoute(route, "GET", "/api/youtube/comments?pageToken=page-2", scenario);
  assert.equal(second.status, 200);
  assert.deepEqual(comments(second.body), [OLD]);
  assert.equal((second.body.data as { nextPageToken: string | null }).nextPageToken, null);
  assert.equal(
    second.google.find((g) => g.resource === "commentThreads")?.params?.pageToken,
    "page-2",
  );
});

test("a malformed pageToken is refused before anything is fetched", async () => {
  for (const bad of ["", "has space", "../x", "a".repeat(513), "tok<script>"]) {
    const r = await runRoute(
      route,
      "GET",
      `/api/youtube/comments?pageToken=${encodeURIComponent(bad)}`,
      { tokenValid: true },
    );
    assert.deepEqual([bad.slice(0, 12), r.status], [bad.slice(0, 12), 422]);
    assert.deepEqual(r.google, [], bad.slice(0, 12));
  }
});

// ---------- the pages ----------

const videos = readFileSync("src/routes/videos.tsx", "utf8").replace(/\s+/g, " ");
const commentsPage = readFileSync("src/routes/comments.tsx", "utf8").replace(/\s+/g, " ");

test("Videos (phones): a card per video, stats as icons beside the date", () => {
  assert.match(videos, /<ul className="mt-6 space-y-3 sm:hidden">/);
  // Each video is its own card.
  assert.match(
    videos,
    /<li className="group relative flex items-center gap-3 rounded-xl card-gradient-outline px-4 py-3">/,
  );
  assert.match(videos, /<CardStat icon=\{Eye\} value=\{video\.views\} noun="views" \/>/);
  assert.match(videos, /<CardStat icon=\{ThumbsUp\} value=\{video\.likes\} noun="likes" \/>/);
  // Full wording for screen readers; the stat grid is gone.
  assert.match(videos, /<span className="sr-only">\{label\}<\/span>/);
  assert.doesNotMatch(videos, /grid grid-cols-3 gap-2 rounded-lg bg-accent\/30/);
});

test("the comment count links to Comment Automation for that video, without nesting links", () => {
  assert.match(
    videos,
    /<Link to="\/comments" search=\{\{ video: video\.id \}\} className="relative z-10[^"]*" > <CardStat icon=\{MessageCircle\} value=\{video\.comments\} noun="comments" \/> <\/Link>/,
  );
  // The row's own link is the title, stretched over the row — not a wrapper around the stats.
  assert.match(videos, /after:absolute after:inset-0 after:content-\[''\]/);
  const card = videos.slice(
    videos.indexOf("function VideoCard("),
    videos.indexOf("function CardStat("),
  );
  assert.equal(card.match(/<Link\b/g)?.length, 2);
  assert.ok(card.indexOf("{video.title} </Link>") < card.indexOf('to="/comments"'));
});

test("Comment Automation reads ?video=, fetches that video, opens its comments, and can clear it", () => {
  assert.match(commentsPage, /const VIDEO_PARAM = \/\^\[A-Za-z0-9_-\]\{1,64\}\$\/;/);
  assert.match(commentsPage, /const requestedVideo = videoParam\(Route\.useSearch\(\)\.video\);/);
  assert.match(commentsPage, /if \(videoFilter\) params\.set\("videoId", videoFilter\);/);
  assert.match(commentsPage, /if \(videoFilter\) setViewingComments\(true\);/);
  assert.match(commentsPage, /if \(!next && videoFilter\) clearVideoFilter\(\);/);
  assert.match(commentsPage, /Show all videos/);
});

// ---------- the comments dialog with many comments ----------

test("the dialog is a full-screen sheet on phones and a capped window on wider screens", () => {
  assert.match(
    commentsPage,
    /<DialogContent className="flex h-\[100dvh\] max-h-\[100dvh\] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-\[85vh\] sm:max-w-2xl sm:rounded-2xl">/,
  );
});

test("only the list scrolls: header and bulk-reply footer stay put", () => {
  assert.match(commentsPage, /<div className="shrink-0 space-y-3 border-b border-border/);
  assert.match(commentsPage, /<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(
    commentsPage,
    /className="shrink-0 space-y-2 border-t border-border bg-background\/80/,
  );
  assert.match(commentsPage, /paddingBottom: "max\(0\.75rem, env\(safe-area-inset-bottom\)\)"/);
  // The old fixed half-screen list is gone.
  assert.doesNotMatch(commentsPage, /max-h-\[50vh\]/);
});

test("long lists render a page at a time, starting over on any filter or search change", () => {
  assert.match(commentsPage, /const COMMENTS_PAGE = 40;/);
  assert.match(
    commentsPage,
    /useEffect\(\(\) => setShown\(COMMENTS_PAGE\), \[filter, q, comments, open\]\);/,
  );
  assert.match(commentsPage, /const rendered = visible\.slice\(0, shown\);/);
  assert.match(commentsPage, /Show more \(\{visible\.length - rendered\.length\} more\)/);
});

test("rows are compact: one-line reply box, capped comment text, video named only when mixed", () => {
  assert.match(commentsPage, /rows=\{1\}/);
  assert.match(commentsPage, /className="min-h-\[2\.25rem\] resize-y py-1\.5 text-sm"/);
  // Capped until the comment is opened (which also shows its replies).
  assert.match(
    commentsPage,
    /break-words text-sm text-muted-foreground \$\{open \? "" : "line-clamp-4"\}/,
  );
  assert.match(commentsPage, /showVideo=\{!videoFilter\}/);
});

test("the one-video view shows a preview of the video, and 'Show all videos' switches at once", () => {
  assert.match(commentsPage, /setVideoPreview\(body\.data\.video \?\? null\);/);
  assert.match(commentsPage, /preview: videoPreview\?\.id === videoFilter \? videoPreview : null,/);
  assert.match(commentsPage, /src=\{videoFilter\.preview\.thumbnail\}/);
  // Switching to all videos does not wait on the address changing.
  assert.match(commentsPage, /const videoFilter = showAllVideos \? undefined : requestedVideo;/);
  assert.match(
    commentsPage,
    /const clearVideoFilter = \(\) => \{ setShowAllVideos\(true\); void navigate\(\{ to: "\/comments", search: \{\}, replace: true \}\); \};/,
  );
  assert.match(commentsPage, /useEffect\(\(\) => setShowAllVideos\(false\), \[requestedVideo\]\);/);
});

test("phones: the page's three actions share one row with short labels", () => {
  assert.match(
    commentsPage,
    /<div className="flex w-full items-center gap-1\.5 sm:w-auto sm:flex-wrap sm:gap-2">/,
  );
  // Short labels on phones; the full names stay the accessible names (and show from sm up).
  assert.match(commentsPage, /aria-label="Lead Inbox"/);
  assert.match(commentsPage, /<span className="sm:hidden">Inbox<\/span>/);
  assert.match(commentsPage, /aria-label="View All Comments"/);
  assert.match(commentsPage, /<span className="sm:hidden">Comments<\/span>/);
  assert.match(commentsPage, /<span className="hidden sm:inline">View All Comments<\/span>/);
  assert.equal(
    commentsPage.match(/flex h-9 min-w-0 flex-1 items-center justify-center/g)?.length,
    3,
  );
});

test("an empty dialog says what was checked, and tells an empty filter apart from no comments", () => {
  assert.match(commentsPage, /comments\.length === 0 \?/);
  assert.match(commentsPage, /YouTube returned no comments on any of your videos\./);
  assert.match(commentsPage, /This video has no comments yet/);
  assert.match(commentsPage, /You haven&apos;t replied to any of these comments yet\./);
  assert.match(commentsPage, /Every comment here has a reply\./);
});

test("the All Comments view can load further pages from YouTube", () => {
  assert.match(commentsPage, /setNextCommentsPage\(body\.data\.nextPageToken \?\? null\);/);
  assert.match(commentsPage, /new URLSearchParams\(\{ pageToken: nextCommentsPage \}\)/);
  // New comments are added to what is shown, never duplicated.
  assert.match(commentsPage, /\.\.\.page\.comments\.filter\(\(c\) => !seen\.has\(c\.id\)\)/);
  assert.match(commentsPage, /Load more from YouTube/);
  // Counts say "+" while more remain on YouTube.
  assert.match(commentsPage, /const more = moreOnYoutube \? "\+" : "";/);
  // Only the all-videos view pages; a one-video view shows that video's comments.
  assert.match(commentsPage, /!videoFilter && nextCommentsPage/);
});
