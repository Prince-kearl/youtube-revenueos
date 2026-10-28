import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { channelSyncView, relativeTime } from "../src/lib/channel-sync-status";

// The channel status in Settings is written for people, not as an internal state: it says what
// happened, how recent the data is, and offers "Try again" when an update did not finish.

const now = new Date("2026-10-28T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

test("relative times", () => {
  assert.equal(relativeTime(ago(0), now), "just now");
  assert.equal(relativeTime(ago(1), now), "1 minute ago");
  assert.equal(relativeTime(ago(5), now), "5 minutes ago");
  assert.equal(relativeTime(ago(180), now), "3 hours ago");
  assert.equal(relativeTime(ago(60 * 24 * 2), now), "2 days ago");
});

test("every status reads as plain language — no bare 'Partially synced' or 'Sync failed'", () => {
  const cases = [
    { last_sync_status: "success", last_synced_at: ago(5) },
    { last_sync_status: "partial", last_sync_error: "comments", last_synced_at: ago(5) },
    { last_sync_status: "partial", last_sync_error: "videos,comments", last_synced_at: ago(5) },
    { last_sync_status: "partial", last_sync_error: null, last_synced_at: null },
    { last_sync_status: "failed", last_synced_at: ago(180) },
    { last_sync_status: "failed", last_synced_at: null },
    { last_sync_status: "never_synced", last_synced_at: null },
    { last_sync_status: "syncing" },
    { last_sync_status: "reauth_required", last_synced_at: ago(5) },
  ];
  const views = cases.map((c) => channelSyncView(c, now));
  assert.deepEqual(
    views.map((v) => [v.tone, v.text, v.retry]),
    [
      ["ok", "Connected · up to date as of 5 minutes ago", false],
      [
        "warn",
        "Up to date (5 minutes ago), except comments — YouTube didn’t send them this time",
        true,
      ],
      [
        "warn",
        "Up to date (5 minutes ago), except videos and comments — YouTube didn’t send them this time",
        true,
      ],
      ["warn", "Mostly up to date — a few details didn’t come through", true],
      ["error", "The last update didn’t finish — your data is from 3 hours ago", true],
      ["error", "The first update didn’t finish yet", true],
      ["info", "Connected · getting your channel data ready", true],
      ["info", "Updating your channel data…", false],
      ["error", "YouTube access has expired — reconnect this channel to keep it up to date", false],
    ],
  );
  for (const v of views)
    assert.doesNotMatch(v.text, /Partially synced|Sync failed|never_synced|partial/i);
});

test("Settings shows that status, with 'Try again' syncing just that channel", () => {
  const settings = readFileSync("src/routes/settings.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(settings, /const view = channelSyncView\(channel\);/);
  assert.match(settings, /onClick=\{\(\) => void syncChannel\(channel\.id\)\}/);
  assert.match(
    settings,
    /fetch\(`\/api\/youtube\/sync\?channelId=\$\{encodeURIComponent\(channelId\)\}`/,
  );
  assert.doesNotMatch(settings, /"Partially synced"|"Sync failed"|"Connected · Not synced yet"/);
});
