import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { runRoute } from "./helpers/live-youtube-stub";

// P1 Step 4D. Revenue is read from stored data through the canonical revenue API; the live
// revenue / CPM paths the pages used before are retired. These tests pin what was removed and,
// just as importantly, what was deliberately kept.

const sync = await import("../src/routes/api.youtube.sync");
const read = (file: string) => readFileSync(file, "utf8");
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );

// ---------- removed ----------

test("the channel sync no longer writes the analytics snapshot, and asks Analytics for nothing", async () => {
  const run = await runRoute(sync, "POST", "/api/youtube/sync");
  assert.equal(run.status, 200);
  assert.equal(run.body.status, "success");
  assert.deepEqual(
    run.writes.filter((write) => write.table === "youtube_analytics_snapshots"),
    [],
  );
  assert.deepEqual(Object.keys(run.body.result as Record<string, unknown>).sort(), [
    "chapters",
    "comments",
    "videos",
  ]);
  // Every Analytics request in the run belongs to the stored revenue-data sync, which asks for
  // revenue in USD explicitly; the channel sync's own request never did.
  const source = read("src/routes/api.youtube.sync.ts");
  assert.doesNotMatch(source, /queryYoutubeAnalytics|youtube_analytics_snapshots|estimatedRevenue/);
});

test("nothing in the application reads or writes youtube_analytics_snapshots any more", () => {
  const users = sourceFiles("src").filter((file) =>
    read(file).includes("youtube_analytics_snapshots"),
  );
  assert.deepEqual(users, [], "the table itself is kept for now; only migrations mention it");
});

test("the /api/youtube/analytics route is gone and nothing refers to it", () => {
  assert.equal(existsSync("src/routes/api.youtube.analytics.ts"), false);
  for (const file of sourceFiles("src"))
    assert.doesNotMatch(read(file), /api\/youtube\/analytics\b/, file);
  assert.doesNotMatch(read("src/lib/server/google-oauth.ts"), /aggregateYoutubeAnalyticsByMonth/);
});

test("no live route names a CPM metric except the video detail page's, which is not migrated yet", () => {
  const withCpm = sourceFiles("src/routes")
    .filter((file) => /\/api\.[^/]+\.ts$/.test(file))
    .filter((file) => /["'`]cpm["'`]|playbackBasedCpm/.test(read(file)));
  assert.deepEqual(withCpm, ["src/routes/api.youtube.video.ts"]);
});

// ---------- kept on purpose ----------

test("live Analytics is still used where there is no stored equivalent", () => {
  const stillLive: Record<string, RegExp> = {
    // AI Analyze Video: one video's performance, including its revenue, for the prompt.
    "src/routes/api.ai.analyze-video.ts": /queryYoutubeAnalytics[\s\S]*estimatedRevenue/,
    // The video detail page (its own later migration).
    "src/routes/api.youtube.video.ts": /queryYoutubeAnalytics/,
    // Audience demographics.
    "src/routes/api.youtube.audience.ts": /queryYoutubeAnalytics/,
    // Traffic sources, including what each source earned.
    "src/routes/api.youtube.breakdowns.ts": /queryYoutubeAnalytics[\s\S]*estimatedRevenue/,
    // Views, subscribers, watch time, audience, video insights and the engagement heatmap.
    "src/routes/api.youtube.dashboard.ts": /queryYoutubeAnalytics/,
    // The stored revenue-data sync — the one place revenue is collected.
    "src/lib/server/youtube-stats-store.ts": /queryYoutubeAnalytics/,
  };
  for (const [file, pattern] of Object.entries(stillLive)) assert.match(read(file), pattern, file);
});

test("Dashboard, Analytics and Videos still read revenue from the canonical API only", () => {
  assert.match(read("src/lib/dashboard-revenue.ts"), /\/api\/revenue\/summary\?/);
  assert.match(read("src/lib/dashboard-revenue.ts"), /\/api\/revenue\/videos\?/);
  assert.match(read("src/lib/analytics-revenue.ts"), /\/api\/revenue\/(summary|videos)\?/);
  assert.match(read("src/lib/videos-revenue.ts"), /\/api\/revenue\/videos\?/);
  for (const page of ["dashboard", "analytics", "videos"]) {
    const source = read(`src/routes/${page}.tsx`);
    assert.doesNotMatch(source, /\bCPM\b|cpmByMonth|topRevenueVideosStatus|revenueStatus/, page);
  }
});
