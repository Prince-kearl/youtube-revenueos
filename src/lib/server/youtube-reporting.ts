// YouTube Reporting API (bulk daily report files) — the ONLY source of thumbnail impressions and
// click-through rate per video per day. The Analytics API used everywhere else does not expose
// them, and conversely the Reporting API's channel reports contain no revenue.
//
// STATUS: NOT VALIDATED AGAINST A REAL REPORT FILE.
// Everything below follows Google's published documentation (verified 2026-10-06) plus one live
// read confirming that the report types exist and that existing OAuth grants can list them. No
// real CSV had been seen when this was written: jobs take up to 48 hours to produce their first
// file. So:
//   - there is deliberately NO function here that writes impressions/CTR to the database;
//   - parseReachReportCsv refuses anything that does not match the documented format rather than
//     guessing, so a format difference surfaces as an error instead of as wrong numbers;
//   - isReportingIngestionEnabled() is the switch a future write path must check, and it is off
//     unless explicitly turned on.
// Before enabling: download a real report, compare its headers/rows with the expectations in
// this file, check the date interpretation against a known day, and only then add the write.
//
// Documented lifecycle this module implements:
//   jobs.create (once per report type) → wait ≤48h → jobs.reports.list → download each report's
//   downloadUrl (CSV) → keep the newest file per reporting day → parse.
// Documented facts relied on: each report covers one 24h day in Pacific time; when Google
// revises a day it publishes a NEW report with the same startTime/endTime and a later
// createTime, so "newest createTime wins" and re-importing a day is idempotent; reports stay
// available for 60 days (30 for backfilled history); a new job backfills the previous 30 days.

import { getServerEnv } from "./env";

const REPORTING_API = "https://youtubereporting.googleapis.com/v1";

export const REPORT_TYPES = {
  /** dimensions: date, channel_id, video_id — metrics: video_thumbnail_impressions,
   * video_thumbnail_impressions_ctr. Already one row per video per day. */
  reachBasic: "channel_reach_basic_a1",
  /** Per-video daily activity split by country/subscribed status/live — not needed for
   * impressions; created so a real file is available to evaluate as a bulk activity source. */
  basic: "channel_basic_a3",
} as const;

export const REACH_REPORT_COLUMNS = [
  "date",
  "channel_id",
  "video_id",
  "video_thumbnail_impressions",
  "video_thumbnail_impressions_ctr",
] as const;

export function isReportingIngestionEnabled(): boolean {
  return getServerEnv("YOUTUBE_REPORTING_INGESTION_ENABLED") === "true";
}

export interface ReportingJob {
  id: string;
  reportTypeId: string;
  name: string;
  createTime: string;
}

export interface ReportingReport {
  id: string;
  jobId: string;
  startTime: string;
  endTime: string;
  createTime: string;
  downloadUrl: string;
}

async function reportingRequest<T>(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`${REPORTING_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new Error(`YOUTUBE_REPORTING_FAILED:${response.status}`);
  return (await response.json()) as T;
}

export async function listReportingJobs(accessToken: string): Promise<ReportingJob[]> {
  const jobs: ReportingJob[] = [];
  let pageToken: string | undefined;
  do {
    const page = await reportingRequest<{ jobs?: ReportingJob[]; nextPageToken?: string }>(
      accessToken,
      `/jobs${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    );
    jobs.push(...(page.jobs ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return jobs;
}

/**
 * Makes sure one job exists per requested report type for the channel this token belongs to.
 * Never creates a second job for a type that already has one. Creating a job is a write to the
 * connected Google account (it starts daily report generation) — callers must only do this for
 * channels whose owner has agreed to it.
 */
export async function ensureReportingJobs(
  accessToken: string,
  reportTypeIds: string[],
): Promise<{ existing: ReportingJob[]; created: ReportingJob[] }> {
  const current = await listReportingJobs(accessToken);
  const existing = current.filter((job) => reportTypeIds.includes(job.reportTypeId));
  const have = new Set(existing.map((job) => job.reportTypeId));
  const created: ReportingJob[] = [];
  for (const reportTypeId of reportTypeIds) {
    if (have.has(reportTypeId)) continue;
    created.push(
      await reportingRequest<ReportingJob>(accessToken, "/jobs", {
        method: "POST",
        body: JSON.stringify({ reportTypeId, name: `tubify_${reportTypeId}` }),
      }),
    );
  }
  return { existing, created };
}

export async function listReports(
  accessToken: string,
  jobId: string,
  options: { createdAfter?: string } = {},
): Promise<ReportingReport[]> {
  const reports: ReportingReport[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams();
    if (options.createdAfter) params.set("createdAfter", options.createdAfter);
    if (pageToken) params.set("pageToken", pageToken);
    const query = params.toString();
    const page = await reportingRequest<{ reports?: ReportingReport[]; nextPageToken?: string }>(
      accessToken,
      `/jobs/${encodeURIComponent(jobId)}/reports${query ? `?${query}` : ""}`,
    );
    reports.push(...(page.reports ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return reports;
}

/**
 * Google publishes a revised day as a NEW report with the same startTime/endTime. Keep only the
 * newest (latest createTime) report per reporting day, oldest day first.
 */
export function selectLatestReports(reports: ReportingReport[]): ReportingReport[] {
  const newest = new Map<string, ReportingReport>();
  for (const report of reports) {
    const key = `${report.startTime}|${report.endTime}`;
    const current = newest.get(key);
    if (!current || report.createTime > current.createTime) newest.set(key, report);
  }
  return [...newest.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function downloadReport(accessToken: string, downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`YOUTUBE_REPORT_DOWNLOAD_FAILED:${response.status}`);
  return response.text();
}

export class ReportFormatError extends Error {
  constructor(detail: string) {
    super(`YOUTUBE_REPORT_FORMAT_UNEXPECTED: ${detail}`);
    this.name = "ReportFormatError";
  }
}

export interface ReachRow {
  /** YYYY-MM-DD, the report's own (Pacific-time) day. */
  day: string;
  youtubeChannelId: string;
  youtubeVideoId: string;
  impressions: number;
  /** Exactly as reported. Whether this is a 0–1 fraction or a 0–100 percentage is NOT stated in
   * the documentation read so far and must be established from a real file before it is stored. */
  ctr: number;
}

function parseReportDay(value: string): string | null {
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

/**
 * Parses a channel_reach_basic_a1 CSV. Strict on purpose: unknown layout, a missing column, an
 * unparseable date or a non-numeric metric throws ReportFormatError instead of being skipped,
 * because the format has only been read about, never observed.
 */
export function parseReachReportCsv(csv: string): ReachRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((cell) => cell.trim());
  const index = Object.fromEntries(
    REACH_REPORT_COLUMNS.map((name) => [name, header.indexOf(name)]),
  );
  const missing = REACH_REPORT_COLUMNS.filter((name) => index[name] < 0);
  if (missing.length) {
    throw new ReportFormatError(
      `missing column(s) ${missing.join(", ")}; got ${header.join(", ")}`,
    );
  }

  return lines.slice(1).map((line, i) => {
    const cells = line.split(",");
    if (cells.length !== header.length) {
      throw new ReportFormatError(
        `row ${i + 2} has ${cells.length} cells, expected ${header.length}`,
      );
    }
    const day = parseReportDay(cells[index.date].trim());
    const impressions = Number(cells[index.video_thumbnail_impressions]);
    const ctr = Number(cells[index.video_thumbnail_impressions_ctr]);
    const youtubeVideoId = cells[index.video_id].trim();
    if (!day)
      throw new ReportFormatError(`row ${i + 2} has unrecognised date "${cells[index.date]}"`);
    if (!youtubeVideoId) throw new ReportFormatError(`row ${i + 2} has no video_id`);
    if (!Number.isFinite(impressions) || impressions < 0 || !Number.isFinite(ctr) || ctr < 0) {
      throw new ReportFormatError(`row ${i + 2} has non-numeric impressions or ctr`);
    }
    return {
      day,
      youtubeChannelId: cells[index.channel_id].trim(),
      youtubeVideoId,
      impressions,
      ctr,
    };
  });
}
