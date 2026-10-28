import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fillHeatmapDays } from "../src/lib/engagement-heatmap";
import { syncNewlyConnectedChannels } from "../src/lib/youtube-post-connect-sync";

// Two issues seen on production after the multichannel release:
//   * a channel with no views in the last five weeks showed "Daily engagement data isn't
//     available yet" (and was logged as a failed request) — YouTube simply returns no rows;
//   * a just-connected or reconnected channel stayed "Not synced yet" until the nightly job.

test("heatmap: an empty but successful answer is five weeks of zero views, not 'unavailable'", () => {
  const start = new Date("2026-09-23T10:00:00Z");
  const end = new Date("2026-10-27T22:00:00Z");
  const days = fillHeatmapDays([], start, end);
  assert.equal(days.length, 35);
  assert.equal(days[0].date, "2026-09-23");
  assert.equal(days.at(-1)!.date, "2026-10-27");
  assert.ok(days.every((d) => d.views === 0));
});

test("heatmap: days YouTube reported keep their views; missing days are filled with 0", () => {
  const days = fillHeatmapDays(
    [
      { date: "2026-10-02", views: 7 },
      { date: "2026-10-04", views: 3 },
    ],
    new Date("2026-10-01T00:00:00Z"),
    new Date("2026-10-05T23:59:00Z"),
  );
  assert.deepEqual(
    days.map((d) => [d.date, d.views]),
    [
      ["2026-10-01", 0],
      ["2026-10-02", 7],
      ["2026-10-03", 0],
      ["2026-10-04", 3],
      ["2026-10-05", 0],
    ],
  );
});

test("heatmap: the dashboard route fills the days and logs a request as failed only when it failed", () => {
  const route = readFileSync("src/routes/api.youtube.dashboard.ts", "utf8").replace(/\s+/g, " ");
  assert.match(route, /engagementHeatmap = fillHeatmapDays\(/);
  assert.doesNotMatch(
    route,
    /if \(!engagementHeatmap\.length\) engagementHeatmapStatus = "unavailable";/,
  );
});

function fakeFetch(
  channels: Array<{ id: string; channel_name: string; last_sync_status: string }>,
  syncStatus = "success",
) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/youtube/channels") return Response.json({ data: channels, canManage: true });
    if (url.startsWith("/api/youtube/sync?channelId="))
      return Response.json({ status: syncStatus, revenueData: { status: "complete" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

test("post-connect sync: only never-synced channels are synced, one request each", async () => {
  const { fetcher, calls } = fakeFetch([
    { id: "a", channel_name: "Alice", last_sync_status: "success" },
    { id: "b", channel_name: "Brand", last_sync_status: "never_synced" },
    { id: "c", channel_name: "Cooks", last_sync_status: "reauth_required" },
  ]);
  const notes: string[] = [];
  const synced = await syncNewlyConnectedChannels(
    (kind, text) => notes.push(`${kind}: ${text}`),
    fetcher,
  );
  assert.equal(synced, 1);
  assert.deepEqual(calls, ["GET /api/youtube/channels", "POST /api/youtube/sync?channelId=b"]);
  assert.deepEqual(notes, ["success: Brand: your channel data is up to date"]);
});

test("post-connect sync: nothing to sync, or the list cannot be read — no sync request at all", async () => {
  const none = fakeFetch([{ id: "a", channel_name: "Alice", last_sync_status: "success" }]);
  assert.equal(await syncNewlyConnectedChannels(() => {}, none.fetcher), 0);
  assert.deepEqual(none.calls, ["GET /api/youtube/channels"]);
  const failing = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  assert.equal(await syncNewlyConnectedChannels(() => {}, failing), 0);
});

test("post-connect sync runs after every way a channel is connected", () => {
  const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
  const settings = flat("src/routes/settings.tsx");
  // Back from Google on Settings (connected, or a renewed authorization), and after the picker.
  assert.match(
    settings,
    /if \(status && POST_CONNECT_STATUSES\.has\(status\)\) \{ setSyncing\(true\); void syncNewlyConnectedChannels\(/,
  );
  assert.match(
    settings,
    /onAdded=\{\(\) => \{ void loadChannels\(\); \/\/ The picked channel was just added: sync it now/,
  );
  // Back from Google on any other page.
  assert.match(
    flat("src/components/YoutubeChannelSwitcher.tsx"),
    /if \(POST_CONNECT_STATUSES\.has\(status\)\) void syncNewlyConnectedChannels\(/,
  );
});
