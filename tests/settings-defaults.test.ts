import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Settings: every YouTube Integration and Notification switch starts on for a user who has not
// chosen otherwise, and the "Google & YouTube Access" panel is gone.

const read = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");
const settings = read("src/routes/settings.tsx");

test("YouTube Integration: all four switches default to on, on the page and on the server", () => {
  const on =
    /auto_sync_videos: true, import_analytics: true, sync_comments: true, import_chapters: true,/;
  assert.match(settings, on, "the page before the saved settings arrive");
  // A channel with no saved settings gets these defaults from the API and from the sync itself.
  assert.match(read("src/routes/api.youtube.settings.ts"), on);
  assert.match(read("src/routes/api.youtube.sync.ts"), on);
  // A saved choice still wins over the defaults.
  assert.match(
    read("src/routes/api.youtube.settings.ts"),
    /data: \{ \.\.\.defaults, \.\.\.\(data \?\? \{\}\) \}/,
  );
});

test("Notifications: every preference defaults to on", () => {
  const start = settings.indexOf("const notificationOptions = [");
  const options = settings.slice(start, settings.indexOf("];", start));
  assert.equal(options.match(/enabled: true/g)?.length, 6);
  assert.doesNotMatch(options, /enabled: false/);
});

test("the Google & YouTube Access panel is removed from Settings", () => {
  assert.doesNotMatch(settings, /Google & YouTube Access|Google &amp; YouTube Access/);
  assert.doesNotMatch(settings, /OAuthScopesPanel/);
});
