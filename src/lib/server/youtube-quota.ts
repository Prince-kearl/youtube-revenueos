// YouTube Data API quota: what each request costs, and the day it counts towards.
//
// The quota belongs to Tubify's Google Cloud project, not to each user or connection: every Data
// API request the app makes, with anyone's token, draws on the same 10,000 units a day. Google
// resets it at midnight Pacific time.
//
// Every Data API request goes through youtubeFetch (google-oauth.ts), which reports it here; the
// recorder (youtube-quota-recorder.ts) stores it as a youtube_quota_events row with source 'api'.
// Those rows are the measured usage. Older rows (source 'event') are kept: they count business
// events (a reply sent) that the per-workspace reply caps rely on, and their units were estimates.
//
// No imports, so google-oauth.ts can use it without pulling in the database.

export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;
/** Above these shares of the daily quota the admin panel warns. */
export const QUOTA_WARNING_RATIO = 0.7;
export const QUOTA_CRITICAL_RATIO = 0.9;

/** How close the day's usage is to the limit: warning from 70%, critical from 90%. */
export function quotaLevel(units: number): "ok" | "warning" | "critical" {
  if (units >= YOUTUBE_DAILY_QUOTA_UNITS * QUOTA_CRITICAL_RATIO) return "critical";
  if (units >= YOUTUBE_DAILY_QUOTA_UNITS * QUOTA_WARNING_RATIO) return "warning";
  return "ok";
}

const DATA_API_HOSTS = new Set(["www.googleapis.com", "youtube.googleapis.com"]);

// Google's published costs (developers.google.com/youtube/v3/determine_quota_cost). Every
// list (read) costs 1, except search; writes cost 50, uploads 1,600. Even a request that fails
// costs its units.
const WRITE_COST: Record<string, number> = {
  "videos.insert": 1600,
  "captions.insert": 400,
  "captions.update": 450,
  "search.list": 100,
};

/** The Data API operation a request is ("videos.list", "comments.insert"…) and its cost; null
 * for anything that is not a YouTube Data API v3 request (Analytics and Reporting have their own
 * quotas). */
export function dataApiCall(
  method: string,
  input: string | URL,
): { operation: string; units: number } | null {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }
  if (!DATA_API_HOSTS.has(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:upload\/)?youtube\/v3\/([A-Za-z]+)(?:\/([A-Za-z]+))?/);
  if (!match) return null;
  const resource = match[1];
  const sub = match[2];
  const verb =
    sub ??
    ({ GET: "list", POST: "insert", PUT: "update", DELETE: "delete" } as Record<string, string>)[
      method.toUpperCase()
    ] ??
    "list";
  const operation = `${resource}.${verb}`;
  const units = WRITE_COST[operation] ?? (verb === "list" ? 1 : 50);
  return { operation, units };
}

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pacificParts(date: Date) {
  const parts = Object.fromEntries(
    PACIFIC.formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** Pacific wall-clock time minus UTC, in ms, at `date` (−7 or −8 hours). */
function pacificOffsetMs(date: Date): number {
  const p = pacificParts(date);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** The start (midnight Pacific time) of the quota day containing `now`. */
export function quotaDayStart(now: Date = new Date()): Date {
  const p = pacificParts(now);
  const midnightAsUtc = Date.UTC(p.year, p.month - 1, p.day);
  // Two passes settle the offset across a daylight-saving change.
  let instant = midnightAsUtc - pacificOffsetMs(new Date(midnightAsUtc));
  instant = midnightAsUtc - pacificOffsetMs(new Date(instant));
  return new Date(instant);
}

/** The quota day (YYYY-MM-DD, Pacific) that `date` falls in. */
export function quotaDayKey(date: Date): string {
  const p = pacificParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// ---- reporting each request ----

export interface DataApiCall {
  operation: string;
  units: number;
  /** The HTTP status YouTube answered with. */
  status: number;
  /** The Tubify connection whose token made the request, when known. */
  connectionId: string | null;
}

type Recorder = (call: DataApiCall) => Promise<void>;
let recorder: Recorder | null = null;

/** Installs the function that stores each call (youtube-quota-recorder.ts). */
export function setYoutubeQuotaRecorder(next: Recorder | null): void {
  recorder = next;
}

/** Reports one Data API request. Never throws and never fails the request it describes. */
export async function noteYoutubeRequest(
  method: string,
  input: string | URL,
  status: number,
  connectionId: string | null,
): Promise<void> {
  const call = dataApiCall(method, input);
  if (!call || !recorder) return;
  try {
    await recorder({ ...call, status, connectionId });
  } catch {
    // Counting is best effort: a failed write never breaks a YouTube request.
  }
}
