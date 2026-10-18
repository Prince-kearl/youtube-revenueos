import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { videoInsightsNotice } from "../src/lib/video-insights-view";

// The dashboard's Video Insights card: it shows what it has for the latest video, and says exactly
// why anything is missing — the cause decides the message and what the reader can do about it.

test("no latest video: the message names the cause, with the action that fixes it", () => {
  assert.deepEqual(
    videoInsightsNotice({
      hasLatestVideo: false,
      videosStatus: "unavailable",
      insightsStatus: "unavailable",
    }),
    {
      kind: "empty",
      message: "We couldn't load your latest videos from YouTube. Please try again.",
      action: "retry",
    },
  );
  assert.deepEqual(
    videoInsightsNotice({
      hasLatestVideo: false,
      videosStatus: "disabled",
      insightsStatus: "disabled",
    }),
    {
      kind: "empty",
      message: "Recent video sync is turned off in YouTube Integration settings.",
      action: "settings",
    },
  );
  const none = videoInsightsNotice({
    hasLatestVideo: false,
    videosStatus: "available",
    insightsStatus: "unavailable",
  });
  assert.equal(none.kind, "empty");
  assert.match(none.kind === "empty" ? none.message : "", /No public videos were found/);
  assert.equal(none.kind === "empty" && none.action, null);
});

test("a latest video always shows its own figures; only missing analytics is noted", () => {
  assert.deepEqual(
    videoInsightsNotice({
      hasLatestVideo: true,
      videosStatus: "available",
      insightsStatus: "available",
    }),
    { kind: "none" },
  );
  // A new upload: YouTube has not reported its analytics yet — views and engagement still show.
  const fresh = videoInsightsNotice({
    hasLatestVideo: true,
    videosStatus: "available",
    insightsStatus: "unavailable",
  });
  assert.equal(fresh.kind, "partial");
  assert.match(fresh.kind === "partial" ? fresh.message : "", /a day or two after publishing/);
  for (const [status, action] of [
    ["disabled", "settings"],
    ["forbidden", "reconnect"],
    ["temporarily_unavailable", null],
  ] as const) {
    const notice = videoInsightsNotice({
      hasLatestVideo: true,
      videosStatus: "available",
      insightsStatus: status,
    });
    assert.equal(notice.kind, "partial", status);
    assert.equal(notice.kind === "partial" && notice.action, action, status);
  }
});

test("the card uses it: views and engagement are not hidden behind the analytics status", () => {
  const page = readFileSync("src/routes/dashboard.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(page, /videoInsightsNotice\(\{/);
  assert.match(page, /videosStatus=\{dashboardData\?\.videosStatus\}/);
  assert.match(page, /\{notice\.kind === "empty" \? \(/);
  assert.match(page, /\{notice\.kind === "none" && deviceTotal > 0 && \(/);
  assert.doesNotMatch(
    page,
    /VIDEO_INSIGHTS_UNAVAILABLE_MESSAGE/,
    "the one-message-for-all is gone",
  );
});
