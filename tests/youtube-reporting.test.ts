import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ReportFormatError,
  isReportingIngestionEnabled,
  parseReachReportCsv,
  selectLatestReports,
  type ReportingReport,
} from "../src/lib/server/youtube-reporting";

// These tests pin the parser to Google's DOCUMENTED report format. They are not evidence that a
// real report looks like this — no real file existed when they were written. Their job is to
// guarantee that anything which differs from the documented format fails loudly.

const report = (id: string, day: string, createTime: string): ReportingReport => ({
  id,
  jobId: "job",
  startTime: `${day}T07:00:00Z`,
  endTime: `${day}T07:00:00Z`,
  createTime,
  downloadUrl: `https://example.invalid/${id}`,
});

test("ingestion is off unless explicitly enabled", () => {
  const previous = process.env.YOUTUBE_REPORTING_INGESTION_ENABLED;
  delete process.env.YOUTUBE_REPORTING_INGESTION_ENABLED;
  assert.equal(isReportingIngestionEnabled(), false);
  process.env.YOUTUBE_REPORTING_INGESTION_ENABLED = "yes";
  assert.equal(isReportingIngestionEnabled(), false, "only the exact value 'true' enables it");
  process.env.YOUTUBE_REPORTING_INGESTION_ENABLED = "true";
  assert.equal(isReportingIngestionEnabled(), true);
  if (previous === undefined) delete process.env.YOUTUBE_REPORTING_INGESTION_ENABLED;
  else process.env.YOUTUBE_REPORTING_INGESTION_ENABLED = previous;
});

test("a revised report replaces the earlier one for the same day", () => {
  const picked = selectLatestReports([
    report("first", "2026-10-02", "2026-10-03T10:00:00Z"),
    report("other-day", "2026-10-01", "2026-10-02T10:00:00Z"),
    report("revision", "2026-10-02", "2026-10-09T10:00:00Z"),
  ]);
  assert.deepEqual(
    picked.map((r) => r.id),
    ["other-day", "revision"],
  );
});

test("a documented-format reach report parses into one row per video per day", () => {
  const rows = parseReachReportCsv(
    [
      "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr",
      "20261002,UCabc,vid00000001,1200,0.045",
      "20261002,UCabc,vid00000002,0,0",
      "",
    ].join("\n"),
  );
  assert.deepEqual(rows, [
    {
      day: "2026-10-02",
      youtubeChannelId: "UCabc",
      youtubeVideoId: "vid00000001",
      impressions: 1200,
      ctr: 0.045,
    },
    {
      day: "2026-10-02",
      youtubeChannelId: "UCabc",
      youtubeVideoId: "vid00000002",
      impressions: 0,
      ctr: 0,
    },
  ]);
});

test("columns are located by name, so a different column order still parses", () => {
  const rows = parseReachReportCsv(
    "video_id,date,video_thumbnail_impressions_ctr,channel_id,video_thumbnail_impressions\nvid00000001,2026-10-02,0.5,UCabc,10",
  );
  assert.equal(rows[0].day, "2026-10-02");
  assert.equal(rows[0].impressions, 10);
  assert.equal(rows[0].ctr, 0.5);
});

test("a report missing an expected column is refused, not half-read", () => {
  assert.throws(
    () => parseReachReportCsv("date,channel_id,video_id,impressions\n20261002,UCabc,vid,5"),
    (error) => error instanceof ReportFormatError && /missing column/.test(error.message),
  );
});

test("an unrecognised date, a short row or a non-numeric metric is refused", () => {
  const header =
    "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr";
  for (const row of [
    "02/10/2026,UCabc,vid,5,0.1",
    "20261002,UCabc,vid,5",
    "20261002,UCabc,vid,many,0.1",
    "20261002,UCabc,,5,0.1",
  ]) {
    assert.throws(() => parseReachReportCsv(`${header}\n${row}`), ReportFormatError, row);
  }
});

test("an empty report yields no rows", () => {
  assert.deepEqual(parseReachReportCsv(""), []);
  assert.deepEqual(
    parseReachReportCsv(
      "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n",
    ),
    [],
  );
});
