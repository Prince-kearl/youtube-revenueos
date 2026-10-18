import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SHORT_TIMELINE_DAYS,
  isShortTimeline,
  shortTimelineNote,
  timelineDayLabel,
} from "../src/lib/video-timeline-view";

// A video's "Performance over time" chart: a short history (a new video, a quiet period) is one bar
// per day with readable dates and a note saying why it is short; a long one stays a smooth curve.

test("up to two weeks of days is a short history; more is a curve", () => {
  assert.equal(SHORT_TIMELINE_DAYS, 14);
  assert.equal(isShortTimeline(0), false, "no days: nothing to draw, not a short chart");
  for (const days of [1, 3, 14]) assert.equal(isShortTimeline(days), true, String(days));
  for (const days of [15, 90, 365]) assert.equal(isShortTimeline(days), false, String(days));
});

test("dates read as 'Oct 8', the calendar day YouTube reported — not shifted by time zone", () => {
  assert.equal(timelineDayLabel("2026-10-08"), "Oct 8");
  assert.equal(timelineDayLabel("2026-01-01"), "Jan 1");
  assert.equal(timelineDayLabel("2026-12-31T00:00:00Z"), "Dec 31");
  assert.equal(timelineDayLabel("not a date"), "not a date");
});

test("a short history says why it is short; a long one says nothing", () => {
  assert.equal(
    shortTimelineNote(3),
    "Only 3 days of data so far — the video is new or had little activity in this period.",
  );
  assert.match(shortTimelineNote(1) ?? "", /Only 1 day of data/);
  assert.equal(shortTimelineNote(30), null);
  assert.equal(shortTimelineNote(0), null);
});

test("the chart uses it: bars for a short history, the smooth area otherwise", () => {
  const page = readFileSync("src/routes/videos.$videoId.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(page, /date: timelineDayLabel\(row\.date\)/);
  assert.match(page, /\{isShortTimeline\(timelineChart\.length\) \? \( <Bar dataKey="views"/);
  assert.match(page, /: \( <Area type="monotone" dataKey="views"/);
  assert.match(page, /\{shortTimelineNote\(timelineChart\.length\)\}/);
});
