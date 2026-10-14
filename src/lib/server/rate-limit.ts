// Abuse limits and analytics counting rules for the PUBLIC endpoints — the ones anyone can call
// without a session (lead-magnet opt-in and view, support contact, tracked-link redirect).
//
// Counting is done in Postgres, by public.consume_rate_limit (see the public_rate_limits
// migration): one atomic statement per decision, so it is correct across concurrent requests and
// across any number of server instances. Nothing here keeps a counter in memory.
//
// Two different kinds of rule, never confused:
//
//   * an ABUSE LIMIT can refuse a request (the two forms);
//   * an ANALYTICS RULE never refuses anything — it only decides whether an event is counted
//     (link click, lead-magnet view).
//
// Modes (RATE_LIMIT_MODE):
//
//   off      the default, and what a missing or unrecognised value means. No limiter call is
//            made and nothing is written: every endpoint behaves exactly as it did before.
//   observe  decisions are computed and recorded, and a would-block is logged, but nothing is
//            refused and no event is left uncounted.
//   enforce  the limits apply.
//
// "observe" and "enforce" keep separate counters (the mode is part of every key), so nothing
// counted while observing is ever held against anyone once enforcement is switched on.
//
// Whose request it is. The only client address used is the one the platform itself supplies
// (Vercel sets x-vercel-forwarded-for and x-real-ip and overwrites anything a client sends) —
// and only when the code is actually running on Vercel, because anywhere else those two headers
// are just headers a client can send. x-forwarded-for and every other client-controllable header
// is ignored. The address is normalised (IPv4; IPv4-mapped IPv6 as IPv4; IPv6 as its /64) and
// then only ever used as a keyed hash (HMAC-SHA-256 with RATE_LIMIT_SECRET): the raw address is
// never stored, logged or returned. When no trusted address can be established nothing is
// counted and nothing is limited: forms are allowed through and analytics events are counted.
// There is no shared fallback bucket, so strangers can never use up each other's allowance.
//
// Failure. A limiter that cannot answer never takes a public endpoint down: forms are allowed
// through and analytics events are counted.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";

export type RateLimitMode = "off" | "observe" | "enforce";

/** The configured mode. Anything but "observe" or "enforce" — including unset — is "off". */
export function rateLimitMode(): RateLimitMode {
  const value = getServerEnv("RATE_LIMIT_MODE");
  return value === "observe" || value === "enforce" ? value : "off";
}

// ---------- the policy (provisional; change here, no schema change needed) ----------

export interface RateRule {
  /** Short label used in the bucket key and in logs. */
  name: string;
  windowSeconds: number;
  limit: number;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export const RATE_LIMIT_POLICY = {
  /** Abuse limits per client address. */
  optin: [
    { name: "10m", windowSeconds: 10 * MINUTE, limit: 5 },
    { name: "day", windowSeconds: DAY, limit: 20 },
  ],
  supportContact: [
    { name: "hour", windowSeconds: HOUR, limit: 3 },
    { name: "day", windowSeconds: DAY, limit: 10 },
  ],
  /** Analytics rules per (resource, client address). */
  linkClick: { name: "hour", windowSeconds: HOUR, limit: 60 },
  leadMagnetView: { name: "hour", windowSeconds: HOUR, limit: 1 },
} as const satisfies Record<string, RateRule | readonly RateRule[]>;

// ---------- the client address ----------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function normalizeIpv4(value: string): string | null {
  const match = IPV4.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts.join(".") : null;
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(value: string): number[] | null {
  let text = value;
  // An embedded IPv4 tail ("::ffff:1.2.3.4") is two groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const ipv4 = normalizeIpv4(tail);
    if (!ipv4) return null;
    const [a, b, c, d] = ipv4.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
    return groups.map((group) => parseInt(group, 16));
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...rest];
}

/**
 * A client address in the one form used for keys, or null when it is not an address:
 *   IPv4                      "203.0.113.7"
 *   IPv4-mapped IPv6          the IPv4 address it carries
 *   any other IPv6            its /64 network, e.g. "2001:db8:1:2::/64"
 * (An IPv6 customer is normally given a whole /64, so the individual address is not an identity.)
 */
export function normalizeClientIp(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 64) return null;
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  if (!value.includes(":")) return normalizeIpv4(value);
  const groups = ipv6Groups(value);
  if (!groups) return null;
  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
      ? `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
      : null;
  if (mapped) return mapped;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** The headers the platform sets itself, in order of preference. Nothing else is consulted. */
const TRUSTED_IP_HEADERS = ["x-vercel-forwarded-for", "x-real-ip"] as const;

/** Whether this code is running on Vercel (which sets VERCEL=1 for every deployment). Only
 * there does the platform overwrite the two headers above; elsewhere a client could send them. */
function onVercel(): boolean {
  return getServerEnv("VERCEL") === "1";
}

/**
 * The client address as the platform reports it, normalised — or null when it cannot be
 * established: not running on Vercel, or neither header carries a valid address. The first
 * header is preferred; the second is used only when the first is missing or malformed.
 * `x-forwarded-for` is deliberately not read: a client can send it.
 */
export function trustedClientIp(request: Request): string | null {
  if (!onVercel()) return null;
  for (const header of TRUSTED_IP_HEADERS) {
    const value = request.headers.get(header);
    if (!value) continue;
    // The platform puts the client first if it ever lists more than one hop.
    const ip = normalizeClientIp(value.split(",")[0]);
    if (ip) return ip;
  }
  return null;
}

// ---------- keys ----------

class RateLimitUnavailable extends Error {}

const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(): Promise<CryptoKey> {
  const secret = getServerEnv("RATE_LIMIT_SECRET");
  // A short or missing secret would make the hashes guessable: the limiter is then unavailable.
  if (!secret || secret.length < 32) throw new RateLimitUnavailable("secret");
  if (cachedKey?.secret !== secret)
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    };
  return cachedKey.key;
}

/** A keyed, irreversible stand-in for a client address: 128 bits of HMAC-SHA-256, as hex. */
async function hashClient(ip: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(`ip:${ip}`));
  return Array.from(new Uint8Array(signature).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const KEY_PART = /^[A-Za-z0-9_.-]{1,80}$/;

function bucketKey(parts: string[]): string {
  if (parts.some((part) => !KEY_PART.test(part))) throw new RateLimitUnavailable("key");
  const key = parts.join(":");
  if (key.length > 200) throw new RateLimitUnavailable("key");
  return key;
}

// ---------- the counter ----------

/** One atomic increment in the database. True while the bucket is within its limit. */
async function consume(service: SupabaseClient, key: string, rule: RateRule): Promise<boolean> {
  if (
    !Number.isInteger(rule.windowSeconds) ||
    rule.windowSeconds < 1 ||
    rule.windowSeconds > DAY ||
    !Number.isInteger(rule.limit) ||
    rule.limit < 1 ||
    rule.limit > 1_000_000
  )
    throw new RateLimitUnavailable("rule");
  const { data, error } = await service.rpc("consume_rate_limit", {
    p_key: key,
    p_window_seconds: rule.windowSeconds,
    p_limit: rule.limit,
  });
  if (error || typeof data !== "boolean") throw new RateLimitUnavailable("store");
  return data;
}

/** Logged without any identifier of the client or the resource. */
function report(
  outcome:
    "would_block" | "blocked" | "not_counted" | "would_not_count" | "unavailable" | "no_client_ip",
  endpoint: string,
  rule: string,
) {
  console.warn("Rate limit", { outcome, endpoint, rule, mode: rateLimitMode() });
}

function secondsLeftInWindow(windowSeconds: number, nowMs: number): number {
  return Math.max(1, windowSeconds - (Math.floor(nowMs / 1000) % windowSeconds));
}

// ---------- abuse limits (the two forms) ----------

export type AbuseDecision = { refuse: false } | { refuse: true; retryAfterSeconds: number };

/**
 * Whether a form submission must be refused. Every rule is counted (a request that exceeds one
 * still counts towards the others). Refuses only in "enforce"; fails OPEN if the limiter cannot
 * answer, and also when no trusted client address can be established — that request is not
 * counted against anyone.
 */
export async function checkAbuseLimit(
  service: SupabaseClient,
  request: Request,
  endpoint: "optin" | "support_contact",
  rules: readonly RateRule[],
): Promise<AbuseDecision> {
  const mode = rateLimitMode();
  if (mode === "off") return { refuse: false };
  try {
    const ip = trustedClientIp(request);
    if (!ip) {
      report("no_client_ip", endpoint, "*");
      return { refuse: false };
    }
    const client = await hashClient(ip);
    const results = await Promise.all(
      rules.map(async (rule) => ({
        rule,
        within: await consume(service, bucketKey([mode, endpoint, rule.name, client]), rule),
      })),
    );
    const exceeded = results.filter((result) => !result.within);
    if (exceeded.length === 0) return { refuse: false };
    for (const { rule } of exceeded)
      report(mode === "enforce" ? "blocked" : "would_block", endpoint, rule.name);
    if (mode !== "enforce") return { refuse: false };
    const now = Date.now();
    return {
      refuse: true,
      retryAfterSeconds: Math.max(
        ...exceeded.map(({ rule }) => secondsLeftInWindow(rule.windowSeconds, now)),
      ),
    };
  } catch {
    report("unavailable", endpoint, "*");
    return { refuse: false };
  }
}

/** The response for a refused form submission. Says nothing about how the limit works. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

// ---------- analytics rules (never refuse) ----------

/**
 * Whether an analytics event should be counted.
 *
 *   off       always true, and no limiter call is made.
 *   observe   always true; the decision is still computed and a would-not-count is logged.
 *   enforce   true while the (resource, client) bucket is within the rule.
 *
 * With no trusted client address, or if the limiter cannot answer, the event is counted.
 */
export async function shouldCountEvent(
  service: SupabaseClient,
  request: Request,
  event: {
    endpoint: "link_click" | "lead_magnet_view";
    rule: RateRule;
    /** The link or lead magnet the event belongs to (its id). */
    resourceId: string;
  },
): Promise<boolean> {
  const mode = rateLimitMode();
  if (mode === "off") return true;
  try {
    const ip = trustedClientIp(request);
    if (!ip) return true;
    const key = bucketKey([
      mode,
      event.endpoint,
      event.rule.name,
      event.resourceId,
      await hashClient(ip),
    ]);
    if (await consume(service, key, event.rule)) return true;
    report(mode === "enforce" ? "not_counted" : "would_not_count", event.endpoint, event.rule.name);
    return mode !== "enforce";
  } catch {
    report("unavailable", event.endpoint, event.rule.name);
    return true;
  }
}

// ---------- visitor cookie ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The visitor id from the privacy cookie if it is one this app could have issued (a UUID);
 * anything else — the cookie is fully client-controlled — is discarded. */
export function validVisitorId(value: string | undefined): string | undefined {
  return value !== undefined && UUID.test(value) ? value.toLowerCase() : undefined;
}

// ---------- cleanup ----------

const PURGE_TIMEOUT_MS = 3000;

/**
 * Deletes a bounded number of expired buckets. Best effort: it never throws, gives up after a
 * few seconds, and does nothing at all in "off". Returns the number deleted, or null.
 */
export async function purgeExpiredRateLimitBuckets(
  service: SupabaseClient,
): Promise<number | null> {
  if (rateLimitMode() === "off") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const purge = Promise.resolve(
      service.rpc("purge_rate_limit_buckets", { p_max_rows: 5000 }),
    ).then(({ data, error }) => (error || typeof data !== "number" ? null : data));
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PURGE_TIMEOUT_MS);
    });
    return await Promise.race([purge, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
