import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RATE_LIMIT_POLICY,
  checkAbuseLimit,
  normalizeClientIp,
  purgeExpiredRateLimitBuckets,
  rateLimitMode,
  shouldCountEvent,
  trustedClientIp,
  validVisitorId,
} from "../src/lib/server/rate-limit";
import { HONEYPOT_FIELD, honeypotTriggered } from "../src/lib/honeypot";
import {
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";

// Security batch 2. Abuse limits and analytics counting rules for the public endpoints, run on
// the real routes against a fake database whose rate-limit functions behave like the migration's
// (fixed windows, one counter per key and window, service role only).
//
// The database's own atomicity and privileges are verified separately, by applying the
// migration to a disposable Postgres; here the point is what each endpoint does with the answer.

const routes = {
  optin: await import("../src/routes/api.freebies.optin"),
  support: await import("../src/routes/api.support.contact"),
  referral: await import("../src/routes/api.referrals.click"),
  redirect: await import("../src/routes/r.$slug"),
  view: await import("../src/routes/api.freebies.public"),
};

const SECRET = "test-rate-limit-secret-0123456789abcdef";
type Mode = "off" | "observe" | "enforce" | undefined;
/** Runs `run` with the limiter in `mode`, then restores the environment. (The test harness
 * serves the server's environment from globalThis.__env__ — see helpers/team-fake-api.ts.)
 * `vercel` is the platform's own VERCEL variable: "1" on Vercel, absent anywhere else. */
async function inMode<T>(
  mode: Mode | string,
  run: () => Promise<T>,
  secret: string | null = SECRET,
  vercel: string | null = "1",
) {
  const env = (globalThis as unknown as { __env__: Record<string, string | undefined> }).__env__;
  const before = { mode: env.RATE_LIMIT_MODE, secret: env.RATE_LIMIT_SECRET, vercel: env.VERCEL };
  env.RATE_LIMIT_MODE = mode;
  env.RATE_LIMIT_SECRET = secret ?? undefined;
  env.VERCEL = vercel ?? undefined;
  try {
    return await run();
  } finally {
    env.RATE_LIMIT_MODE = before.mode;
    env.RATE_LIMIT_SECRET = before.secret;
    env.VERCEL = before.vercel;
  }
}

// A fixed database clock at the start of a UTC day, so window arithmetic is exact.
const T0 = Date.UTC(2026, 9, 13, 0, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;

interface Fixture {
  world: World;
  workspace: string;
  magnet: string;
  referrer: string;
  otherReferrer: string;
  link: string;
  otherLink: string;
  video: string;
  channel: string;
}

function fixture(): Fixture {
  const world = emptyWorld();
  const owner = addUser(world, "creator@example.com");
  const second = addUser(world, "second@example.com");
  Object.assign(
    world.profiles.find((p) => p.id === owner)!,
    { referral_code: "creator1" },
  );
  Object.assign(
    world.profiles.find((p) => p.id === second)!,
    { referral_code: "second22" },
  );
  const workspace = addWorkspace(world, owner);
  const magnet = uuid();
  world.lead_magnets = [
    {
      id: magnet,
      workspace_id: workspace,
      slug: "guide",
      status: "published",
      title: "The Guide",
      teaser: "A guide",
      format: "checklist",
      source: "generated",
      content: "# The guide",
      file_path: null,
      file_name: null,
      views: 0,
    },
  ];
  const destination = uuid();
  const channel = uuid();
  const video = uuid();
  const link = uuid();
  const otherLink = uuid();
  world.destinations = [{ id: destination, workspace_id: workspace, url: "https://shop.test/p" }];
  world.videos = [{ id: video, channel_id: channel }];
  world.tracking_links = [
    {
      id: link,
      workspace_id: workspace,
      slug: "shop",
      status: "active",
      destination_id: destination,
      video_id: video,
      campaign_id: null,
      clicks: 0,
    },
    {
      id: otherLink,
      workspace_id: workspace,
      slug: "other",
      status: "active",
      destination_id: destination,
      video_id: null,
      campaign_id: null,
      clicks: 0,
    },
  ];
  world.leads = [];
  world.lead_messages = [];
  world.lead_magnet_optins = [];
  world.support_tickets = [];
  world.referral_clicks = [];
  world.link_click_events = [];
  world.workspace_branding = [];
  world.rate_limit_buckets = [];
  world.nowMs = T0;
  return {
    world,
    workspace,
    magnet,
    referrer: owner,
    otherReferrer: second,
    link,
    otherLink,
    video,
    channel,
  };
}

/** Headers as the platform would set them for a client at `ip`. */
const from = (ip: string | null, extra: Record<string, string> = {}) => ({
  ...(ip ? { "x-vercel-forwarded-for": ip, "x-real-ip": ip } : {}),
  ...extra,
});

let person = 0;
const optIn = (f: Fixture, ip: string | null, extra: Record<string, unknown> = {}, headers = {}) =>
  callTeamApi(routes.optin, f.world, {
    as: null,
    method: "POST",
    path: "/api/freebies/optin",
    body: { slug: "guide", email: `person${++person}@example.com`, ...extra },
    headers: from(ip, headers),
  });
const contact = (f: Fixture, ip: string | null, extra: Record<string, unknown> = {}) =>
  callTeamApi(routes.support, f.world, {
    as: null,
    method: "POST",
    path: "/api/support/contact",
    body: { name: "A Person", email: "p@example.com", message: `Hello ${++person}`, ...extra },
    headers: from(ip),
  });
const referralClick = (f: Fixture, ip: string | null, code = "creator1", cookie?: string) =>
  callTeamApi(routes.referral, f.world, {
    as: null,
    method: "POST",
    path: "/api/referrals/click",
    body: { code },
    headers: from(ip, cookie === undefined ? {} : { cookie: `tubify_pid=${cookie}` }),
  });
const follow = (
  f: Fixture,
  ip: string | null,
  slug = "shop",
  headers: Record<string, string> = {},
) =>
  callTeamApi(routes.redirect, f.world, {
    as: null,
    method: "GET",
    path: `/r/${slug}`,
    params: { slug },
    headers: from(ip, headers),
  });
const viewMagnet = (f: Fixture, ip: string | null) =>
  callTeamApi(routes.view, f.world, {
    as: null,
    method: "GET",
    path: "/api/freebies/public",
    query: "?slug=guide",
    headers: from(ip),
  });

const limiterCalls = (result: CallResult) =>
  result.rpcCalls.filter((name) => name === "consume_rate_limit").length;
const bucketHits = (f: Fixture) => f.world.rate_limit_buckets!.map((b) => b.hits as number);
const logged = (result: CallResult) => JSON.stringify(result.logs);
const outcomes = (result: CallResult) =>
  result.logs
    .filter((entry) => entry[0] === "Rate limit")
    .map((entry) => (entry[1] as { outcome: string }).outcome);

const codeOf = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ============================================================
// The pieces
// ============================================================

test("mode: only 'observe' and 'enforce' switch the limiter on; missing or anything else is off", async () => {
  for (const [value, expected] of [
    [undefined, "off"],
    ["", "off"],
    ["off", "off"],
    ["on", "off"],
    ["ENFORCE", "off"],
    ["enforce ", "off"],
    ["true", "off"],
    ["observe", "observe"],
    ["enforce", "enforce"],
  ] as const)
    await inMode(value, async () => assert.equal(rateLimitMode(), expected, String(value)));
});

test("client address: IPv4, IPv4-mapped IPv6 and IPv6 as its /64", () => {
  assert.equal(normalizeClientIp("203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeClientIp(" 203.0.113.7 "), "203.0.113.7");
  assert.equal(normalizeClientIp("010.001.000.007"), "10.1.0.7", "one spelling per address");
  // IPv4-mapped IPv6 is the IPv4 address it carries, in either notation.
  assert.equal(normalizeClientIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeClientIp("::FFFF:cb00:7107"), "203.0.113.7");
  assert.equal(normalizeClientIp("0:0:0:0:0:ffff:cb00:7107"), "203.0.113.7");
  // Every address in one /64 is the same client.
  const same = [
    "2001:db8:1:2::1",
    "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
    "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff",
    "[2001:db8:1:2::9]",
    "2001:db8:1:2::9%eth0",
  ].map(normalizeClientIp);
  assert.deepEqual([...new Set(same)], ["2001:db8:1:2::/64"]);
  assert.equal(normalizeClientIp("2001:db8:1:3::1"), "2001:db8:1:3::/64", "a different /64");
  assert.equal(normalizeClientIp("::1"), "0:0:0:0::/64");
  for (const bad of [
    "",
    "   ",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "example.com",
    "1.2.3.4, 5.6.7.8",
    ":::",
    "2001:db8::1::2",
    "2001:db8:1:2:3:4:5:6:7",
    "gggg::1",
    "::ffff:999.1.1.1",
    "x".repeat(65),
    "'; drop table x; --",
  ])
    assert.equal(normalizeClientIp(bad), null, JSON.stringify(bad));
});

test("client address: only the platform's own headers are read — never one a client can send", async () => {
  const ip = (headers: Record<string, string>) =>
    trustedClientIp(new Request("https://app.test/x", { headers }));
  await inMode("enforce", async () => {
    assert.equal(ip({ "x-vercel-forwarded-for": "203.0.113.7" }), "203.0.113.7");
    assert.equal(ip({ "x-real-ip": "203.0.113.8" }), "203.0.113.8");
    // Forged forwarding headers change nothing…
    const forged = {
      "x-forwarded-for": "1.1.1.1",
      forwarded: "for=1.1.1.1",
      "cf-connecting-ip": "1.1.1.1",
      "true-client-ip": "1.1.1.1",
      "x-client-ip": "1.1.1.1",
      "x-original-forwarded-for": "1.1.1.1",
    };
    assert.equal(ip({ ...forged, "x-vercel-forwarded-for": "203.0.113.7" }), "203.0.113.7");
    // …and on their own they are not an address at all.
    assert.equal(ip(forged), null);
    assert.equal(ip({}), null);
  });
  const source = codeOf("src/lib/server/rate-limit.ts");
  assert.doesNotMatch(source, /["'`]x-forwarded-for["'`]|cf-connecting-ip|true-client-ip/i);
});

test("client address: conflicting, malformed and missing trusted headers", async () => {
  const ip = (headers: Record<string, string>) =>
    trustedClientIp(new Request("https://app.test/x", { headers }));
  await inMode("enforce", async () => {
    // Conflicting: the first header wins whenever it is a valid address.
    assert.equal(
      ip({ "x-vercel-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }),
      "203.0.113.7",
    );
    assert.equal(
      ip({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1", "x-real-ip": "198.51.100.1" }),
      "203.0.113.7",
    );
    // Malformed or empty first header: the second trusted header is used.
    for (const bad of ["not-an-ip", "<script>", "999.1.1.1", "", " ", ",203.0.113.9"])
      assert.equal(
        ip({ "x-vercel-forwarded-for": bad, "x-real-ip": "198.51.100.1" }),
        "198.51.100.1",
        JSON.stringify(bad),
      );
    // …and never a client-controlled one.
    assert.equal(ip({ "x-vercel-forwarded-for": "not-an-ip", "x-forwarded-for": "1.1.1.1" }), null);
    // Both malformed, or both missing: no address at all, not a key.
    assert.equal(ip({ "x-vercel-forwarded-for": "not-an-ip", "x-real-ip": "nope" }), null);
    assert.equal(ip({ "x-vercel-forwarded-for": "not-an-ip" }), null);
    assert.equal(ip({ "x-real-ip": "1.2.3" }), null);
    assert.equal(ip({}), null);
  });
});

test("client address: the two headers are trusted only on Vercel — anywhere else there is no address", async () => {
  const headers = { "x-vercel-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7" };
  const ip = () => trustedClientIp(new Request("https://app.test/x", { headers }));
  for (const vercel of [null, "", "0", "true", "yes"])
    await inMode("enforce", async () => assert.equal(ip(), null, String(vercel)), SECRET, vercel);
  await inMode("enforce", async () => assert.equal(ip(), "203.0.113.7"));
  // Off Vercel a sender could put anything in those headers: nothing is limited, nothing counted.
  const f = fixture();
  await inMode(
    "enforce",
    async () => {
      for (let n = 0; n < 8; n++) {
        const result = await optIn(f, `203.0.113.${n}`);
        assert.equal(result.status, 200);
        assert.equal(limiterCalls(result), 0);
        assert.deepEqual(outcomes(result), ["no_client_ip"]);
      }
    },
    SECRET,
    null,
  );
  assert.equal(f.world.rate_limit_buckets!.length, 0);
});

test("visitor cookie: only a UUID is kept", () => {
  const id = "3f2b6c1e-8a4d-4c7b-9e21-5d6f7a8b9c0d";
  assert.equal(validVisitorId(id), id);
  assert.equal(validVisitorId(id.toUpperCase()), id);
  for (const bad of [undefined, "", "abc", `${id}x`, "<script>alert(1)</script>", "x".repeat(4000)])
    assert.equal(validVisitorId(bad), undefined, String(bad).slice(0, 20));
});

test("honeypot: an empty or absent field is a person; anything in it is not", () => {
  for (const human of [undefined, null, "", "   ", 0, false])
    assert.equal(honeypotTriggered(human), false);
  for (const bot of ["x", "http://spam.test", " a "]) assert.equal(honeypotTriggered(bot), true);
  assert.equal(HONEYPOT_FIELD, "hp_reference");
});

test("the approved policy, as configured", () => {
  assert.deepEqual(RATE_LIMIT_POLICY.optin, [
    { name: "10m", windowSeconds: 600, limit: 5 },
    { name: "day", windowSeconds: 86400, limit: 20 },
  ]);
  assert.deepEqual(RATE_LIMIT_POLICY.supportContact, [
    { name: "hour", windowSeconds: 3600, limit: 3 },
    { name: "day", windowSeconds: 86400, limit: 10 },
  ]);
  assert.deepEqual(RATE_LIMIT_POLICY.linkClick, { name: "hour", windowSeconds: 3600, limit: 60 });
  assert.deepEqual(RATE_LIMIT_POLICY.leadMagnetView, {
    name: "hour",
    windowSeconds: 3600,
    limit: 1,
  });
  // Nothing else: no referral-click rule, and no shared allowance for unidentified senders.
  assert.deepEqual(Object.keys(RATE_LIMIT_POLICY).sort(), [
    "leadMagnetView",
    "linkClick",
    "optin",
    "supportContact",
  ]);
  assert.doesNotMatch(codeOf("src/lib/server/rate-limit.ts"), /unknown|MULTIPLIER|referral/i);
});

// ============================================================
// Lead-magnet opt-in
// ============================================================

test("opt-in, off (the default): no limiter call, no counter, and nothing is ever refused", async () => {
  for (const mode of [undefined, "off", "nonsense"]) {
    const f = fixture();
    await inMode(mode, async () => {
      for (let n = 0; n < 30; n++) {
        const result = await optIn(f, "203.0.113.7");
        assert.equal(result.status, 200);
        assert.deepEqual(result.rpcCalls, [], "no rate-limit database call at all");
      }
    });
    assert.equal(f.world.leads!.length, 30);
    assert.deepEqual(f.world.rate_limit_buckets, []);
  }
});

test("opt-in, observe: decisions are recorded and a would-block is logged, but nothing is refused", async () => {
  const f = fixture();
  await inMode("observe", async () => {
    const seen: string[][] = [];
    for (let n = 0; n < 8; n++) {
      const result = await optIn(f, "203.0.113.7");
      assert.equal(result.status, 200, `request ${n + 1}`);
      assert.equal(limiterCalls(result), 2);
      seen.push(outcomes(result));
    }
    assert.deepEqual(seen.slice(0, 5), [[], [], [], [], []]);
    assert.deepEqual(seen.slice(5), [["would_block"], ["would_block"], ["would_block"]]);
  });
  assert.equal(f.world.leads!.length, 8, "every lead was still created");
  assert.deepEqual(bucketHits(f).sort(), [8, 8]);
});

test("opt-in, enforce: five per ten minutes; the sixth is 429 with Retry-After and touches nothing", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    for (let n = 0; n < 5; n++) assert.equal((await optIn(f, "203.0.113.7")).status, 200);
    const refused = await optIn(f, "203.0.113.7");
    assert.deepEqual([refused.status, refused.body], [429, { error: "RATE_LIMITED" }]);
    const retryAfter = Number(refused.headers.get("Retry-After"));
    assert.ok(
      Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 600,
      `${retryAfter}`,
    );
    assert.equal(refused.headers.get("Cache-Control"), "private, no-store");
    // Nothing was looked up and nothing was written for the refused request.
    assert.deepEqual(refused.reads, []);
    assert.deepEqual(refused.writes, []);
    assert.deepEqual(outcomes(refused), ["blocked"]);
    // Someone else is unaffected.
    assert.equal((await optIn(f, "198.51.100.9")).status, 200);
  });
  assert.equal(f.world.leads!.length, 6);
  assert.equal(f.world.lead_magnet_optins!.length, 6);
});

test("opt-in, enforce: the window boundary resets the ten-minute count; the daily limit then holds", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    // Five in each of four ten-minute windows: twenty in the day, all allowed.
    for (let window = 0; window < 4; window++) {
      f.world.nowMs = T0 + window * 10 * MIN;
      for (let n = 0; n < 5; n++)
        assert.equal(
          (await optIn(f, "203.0.113.7")).status,
          200,
          `window ${window}, request ${n + 1}`,
        );
    }
    // A fresh ten-minute window later the same day: the daily limit refuses it.
    f.world.nowMs = T0 + 5 * HOUR;
    const daily = await optIn(f, "203.0.113.7");
    assert.equal(daily.status, 429);
    assert.deepEqual(outcomes(daily), ["blocked"]);
    const retryAfter = Number(daily.headers.get("Retry-After"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 86400);
    assert.deepEqual(daily.writes, []);
    // The last millisecond of the day is still refused; the first of the next is allowed.
    f.world.nowMs = T0 + 24 * HOUR - 1;
    assert.equal((await optIn(f, "203.0.113.7")).status, 429);
    f.world.nowMs = T0 + 24 * HOUR;
    assert.equal((await optIn(f, "203.0.113.7")).status, 200);
  });
  assert.equal(f.world.leads!.length, 21);
});

test("opt-in, enforce: the last millisecond of a ten-minute window is refused, the next one is allowed", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    for (let n = 0; n < 5; n++) assert.equal((await optIn(f, "203.0.113.7")).status, 200);
    f.world.nowMs = T0 + 10 * MIN - 1;
    assert.equal((await optIn(f, "203.0.113.7")).status, 429);
    f.world.nowMs = T0 + 10 * MIN;
    assert.equal((await optIn(f, "203.0.113.7")).status, 200);
  });
});

test("opt-in, enforce: people behind one address share a limit; different addresses do not", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    const shared = [];
    for (let n = 0; n < 7; n++) shared.push((await optIn(f, "203.0.113.7")).status);
    assert.deepEqual(shared, [200, 200, 200, 200, 200, 429, 429]);
    for (let n = 0; n < 12; n++)
      assert.equal((await optIn(f, `198.51.100.${n + 1}`)).status, 200, `address ${n}`);
  });
});

test("opt-in, enforce: one IPv6 /64 is one client, and an IPv4-mapped address is its IPv4", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    const v6 = [];
    for (let n = 0; n < 6; n++)
      v6.push((await optIn(f, `2001:db8:1:2::${(n + 1).toString(16)}`)).status);
    assert.deepEqual(v6, [200, 200, 200, 200, 200, 429], "rotating within a /64 does not help");
    assert.equal((await optIn(f, "2001:db8:1:3::1")).status, 200, "another /64");
    const mapped = [];
    for (let n = 0; n < 3; n++) mapped.push((await optIn(f, "192.0.2.50")).status);
    for (let n = 0; n < 3; n++) mapped.push((await optIn(f, "::ffff:192.0.2.50")).status);
    assert.deepEqual(mapped, [200, 200, 200, 200, 200, 429]);
  });
});

test("opt-in, enforce: forged forwarding headers do not buy a fresh limit", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    const statuses = [];
    for (let n = 0; n < 7; n++)
      statuses.push(
        (
          await optIn(
            f,
            "203.0.113.7",
            {},
            {
              "x-forwarded-for": `10.0.0.${n}`,
              forwarded: `for=10.0.0.${n}`,
              "cf-connecting-ip": `10.0.0.${n}`,
              "true-client-ip": `10.0.0.${n}`,
            },
          )
        ).status,
      );
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
  });
});

test("forms, enforce: with no trusted address nothing is limited, nothing is counted, and no one is locked out", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    // Far more than any limit, from senders that cannot be told apart.
    for (let n = 0; n < 60; n++) {
      // A different forged address each time, a malformed trusted header every third request.
      const result =
        n % 3 === 0
          ? await optIn(f, "not-an-address")
          : await optIn(f, null, {}, { "x-forwarded-for": `10.1.${n}.1` });
      assert.equal(result.status, 200, `request ${n + 1}`);
      assert.equal(limiterCalls(result), 0, "no counter is consumed");
      assert.deepEqual(outcomes(result), ["no_client_ip"]);
      // The diagnostic names only the outcome, the endpoint, the rule and the mode.
      assert.deepEqual(result.logs.filter((entry) => entry[0] === "Rate limit")[0][1], {
        outcome: "no_client_ip",
        endpoint: "optin",
        rule: "*",
        mode: "enforce",
      });
      assert.doesNotMatch(logged(result), /10\.1\.|not-an-address|example\.com/);
    }
    for (let n = 0; n < 40; n++) {
      const result = await contact(f, null);
      assert.equal(result.status, 201, `message ${n + 1}`);
      assert.equal(limiterCalls(result), 0);
      assert.deepEqual(outcomes(result), ["no_client_ip"]);
    }
    assert.equal(f.world.rate_limit_buckets!.length, 0, "there is no shared bucket");
    // A client with a real address keeps its own, untouched allowance.
    for (let n = 0; n < 5; n++) assert.equal((await optIn(f, "203.0.113.7")).status, 200);
    assert.equal((await optIn(f, "203.0.113.7")).status, 429);
    // …and exhausting it locks out nobody without one.
    assert.equal((await optIn(f, null)).status, 200);
  });
  assert.equal(f.world.leads!.length, 66);
  assert.equal(f.world.support_tickets!.length, 40);
  assert.ok(f.world.rate_limit_buckets!.every((b) => !/unknown/.test(String(b.bucket_key))));
});

test("forms, observe: a missing address is noted and nothing is counted", async () => {
  const f = fixture();
  await inMode("observe", async () => {
    const result = await optIn(f, null);
    assert.equal(result.status, 200);
    assert.deepEqual(outcomes(result), ["no_client_ip"]);
    assert.equal(limiterCalls(result), 0);
  });
  assert.equal(f.world.rate_limit_buckets!.length, 0);
});

test("a malformed first header falls back to the second trusted one: the client is still limited as itself", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    const statuses = [];
    for (let n = 0; n < 7; n++)
      statuses.push(
        (
          await optIn(
            f,
            null,
            {},
            { "x-vercel-forwarded-for": "garbage", "x-real-ip": "203.0.113.7" },
          )
        ).status,
      );
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
    // The same client seen through the first header shares that allowance.
    assert.equal((await optIn(f, "203.0.113.7")).status, 429);
  });
});

test("observe and enforce keep separate counters: observation traffic never uses up an enforcement allowance", async () => {
  const f = fixture();
  // A busy day of observation from one address: far past every limit.
  await inMode("observe", async () => {
    for (let n = 0; n < 30; n++) assert.equal((await optIn(f, "203.0.113.7")).status, 200);
    for (let n = 0; n < 15; n++) assert.equal((await contact(f, "203.0.113.7")).status, 201);
    for (let n = 0; n < 70; n++) await follow(f, "203.0.113.7");
    for (let n = 0; n < 3; n++) await viewMagnet(f, "203.0.113.7");
  });
  const observed = f.world.rate_limit_buckets!.map((b) => String(b.bucket_key));
  assert.equal(observed.length, 6);
  assert.ok(observed.every((key) => key.startsWith("observe:")));
  const clicksBefore = f.world.link_click_events!.length;
  const viewsBefore = views(f);
  // Enforcement is switched on in the same windows: everyone starts from zero.
  await inMode("enforce", async () => {
    const optins = [];
    for (let n = 0; n < 6; n++) optins.push((await optIn(f, "203.0.113.7")).status);
    assert.deepEqual(optins, [200, 200, 200, 200, 200, 429]);
    const messages = [];
    for (let n = 0; n < 4; n++) messages.push((await contact(f, "203.0.113.7")).status);
    assert.deepEqual(messages, [201, 201, 201, 429]);
    for (let n = 0; n < 61; n++) await follow(f, "203.0.113.7");
    assert.equal(f.world.link_click_events!.length, clicksBefore + 60);
    for (let n = 0; n < 2; n++) await viewMagnet(f, "203.0.113.7");
    assert.equal(views(f), viewsBefore + 1);
  });
  const keys = f.world.rate_limit_buckets!.map((b) => String(b.bucket_key));
  assert.equal(keys.filter((key) => key.startsWith("enforce:")).length, 6);
  assert.equal(keys.length, 12, "one set of counters per mode");
  // The same client, the same keyed hash — only the namespace differs.
  assert.deepEqual(
    keys
      .filter((key) => key.startsWith("enforce:"))
      .map((key) => key.slice("enforce:".length))
      .sort(),
    observed.map((key) => key.slice("observe:".length)).sort(),
  );
  // And going back to observing does not disturb the enforcement counters.
  const enforced = JSON.stringify(
    f.world.rate_limit_buckets!.filter((b) => String(b.bucket_key).startsWith("enforce:")),
  );
  await inMode("observe", async () => void (await optIn(f, "203.0.113.7")));
  assert.equal(
    JSON.stringify(
      f.world.rate_limit_buckets!.filter((b) => String(b.bucket_key).startsWith("enforce:")),
    ),
    enforced,
  );
});

test("opt-in: the honeypot gets a normal-looking answer and records nothing, in every mode", async () => {
  for (const mode of ["off", "observe", "enforce"]) {
    const f = fixture();
    await inMode(mode, async () => {
      const real = await optIn(f, "203.0.113.7");
      const bot = await optIn(f, "203.0.113.7", { [HONEYPOT_FIELD]: "https://spam.test" });
      assert.equal(bot.status, 200, mode);
      // Indistinguishable from the real answer.
      assert.deepEqual(bot.body, real.body, mode);
      assert.deepEqual(bot.writes, [], `${mode}: no lead, message or opt-in`);
      // An empty hidden field — what a real browser sends — is an ordinary opt-in.
      const empty = await optIn(f, "203.0.113.7", { [HONEYPOT_FIELD]: "" });
      assert.equal(empty.status, 200);
      assert.ok(empty.writes.length > 0, mode);
    });
    assert.equal(f.world.leads!.length, 2, mode);
    assert.equal(f.world.lead_magnet_optins!.length, 2, mode);
  }
});

test("opt-in, enforce: honeypot submissions still count against the limit", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    for (let n = 0; n < 5; n++)
      assert.equal((await optIn(f, "203.0.113.7", { [HONEYPOT_FIELD]: "x" })).status, 200);
    assert.equal((await optIn(f, "203.0.113.7")).status, 429);
  });
  assert.equal(f.world.leads!.length, 0);
});

test("opt-in, enforce: if the limiter cannot answer, the opt-in goes through (fail open)", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    f.world.failRateLimit = true;
    for (let n = 0; n < 8; n++) {
      const result = await optIn(f, "203.0.113.7");
      assert.equal(result.status, 200);
      assert.deepEqual(outcomes(result), ["unavailable"]);
    }
  });
  assert.equal(f.world.leads!.length, 8);
  // A missing or weak secret is the same: unavailable, and open.
  for (const secret of [null, "too-short"]) {
    const g = fixture();
    await inMode(
      "enforce",
      async () => {
        for (let n = 0; n < 7; n++) {
          const result = await optIn(g, "203.0.113.7");
          assert.equal(result.status, 200);
          assert.equal(limiterCalls(result), 0, "nothing is counted without a usable secret");
        }
      },
      secret,
    );
  }
});

test("opt-in: malformed requests are refused before the limiter is ever consulted", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    for (const body of [
      { email: "not-an-email" },
      { slug: "../x" },
      { [HONEYPOT_FIELD]: "x".repeat(501) },
    ]) {
      const result = await optIn(f, "203.0.113.7", body);
      assert.equal(result.status, 422, JSON.stringify(body).slice(0, 40));
      assert.deepEqual(result.rpcCalls, []);
    }
  });
  assert.deepEqual(f.world.rate_limit_buckets, []);
});

// ============================================================
// Support contact
// ============================================================

test("support contact, off and observe: every message becomes a ticket", async () => {
  for (const mode of [undefined, "off", "observe"]) {
    const f = fixture();
    await inMode(mode, async () => {
      for (let n = 0; n < 12; n++) {
        const result = await contact(f, "203.0.113.7");
        assert.equal(result.status, 201, `${mode} ${n}`);
        assert.equal(limiterCalls(result), mode === "observe" ? 2 : 0);
      }
    });
    assert.equal(f.world.support_tickets!.length, 12, String(mode));
    assert.equal(f.world.rate_limit_buckets!.length, mode === "observe" ? 2 : 0);
  }
});

test("support contact, enforce: three an hour and ten a day per address; a refusal writes no ticket", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    const first = [];
    for (let n = 0; n < 4; n++) first.push(await contact(f, "203.0.113.7"));
    assert.deepEqual(
      first.map((r) => r.status),
      [201, 201, 201, 429],
    );
    assert.deepEqual(first[3].body, { error: "RATE_LIMITED" });
    assert.ok(Number(first[3].headers.get("Retry-After")) >= 1);
    assert.deepEqual(first[3].writes, []);
    assert.equal(f.world.support_tickets!.length, 3);
    // Three more in each of the next two hours (every attempt, refused or not, counts towards
    // the day: that is ten attempts so far).
    for (let hour = 1; hour <= 2; hour++) {
      f.world.nowMs = T0 + hour * HOUR;
      for (let n = 0; n < 3; n++) assert.equal((await contact(f, "203.0.113.7")).status, 201);
    }
    assert.equal(f.world.support_tickets!.length, 9);
    // A fresh hour, but the day's allowance is spent.
    f.world.nowMs = T0 + 3 * HOUR;
    const daily = await contact(f, "203.0.113.7");
    assert.equal(daily.status, 429);
    assert.deepEqual(daily.writes, []);
    // The next day starts again.
    f.world.nowMs = T0 + 24 * HOUR;
    assert.equal((await contact(f, "203.0.113.7")).status, 201);
  });
  assert.equal(f.world.support_tickets!.length, 10);
});

test("support contact, enforce: there is no global cap — one sender cannot lock everyone else out", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    for (let n = 0; n < 6; n++) await contact(f, "203.0.113.7"); // one noisy address
    for (let n = 0; n < 60; n++)
      assert.equal(
        (await contact(f, `198.51.${Math.floor(n / 200)}.${(n % 200) + 1}`)).status,
        201,
      );
  });
  assert.equal(f.world.support_tickets!.length, 63);
});

test("support contact: the honeypot is answered like a real message and creates no ticket", async () => {
  for (const mode of ["off", "enforce"]) {
    const f = fixture();
    await inMode(mode, async () => {
      const real = await contact(f, "203.0.113.7");
      const bot = await contact(f, "203.0.113.7", { [HONEYPOT_FIELD]: "buy now" });
      assert.deepEqual([bot.status, bot.body], [real.status, real.body]);
      assert.deepEqual(bot.writes, []);
    });
    assert.equal(f.world.support_tickets!.length, 1, mode);
  }
});

test("support contact, enforce: a limiter failure lets the message through", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    f.world.failRateLimit = true;
    for (let n = 0; n < 6; n++) assert.equal((await contact(f, "203.0.113.7")).status, 201);
  });
  assert.equal(f.world.support_tickets!.length, 6);
});

// ============================================================
// Referral click (an analytics rule: never a refusal)
// ============================================================

const cookieOf = () => crypto.randomUUID();

test("referral click: one row per (referrer, visitor cookie) in every mode, and the limiter is never involved", async () => {
  for (const mode of [undefined, "off", "observe", "enforce"]) {
    const f = fixture();
    await inMode(mode, async () => {
      const visitor = cookieOf();
      // The same visitor three times is one click…
      for (let n = 0; n < 3; n++) {
        const result = await referralClick(f, "203.0.113.7", "creator1", visitor);
        assert.deepEqual([result.status, result.body], [200, { ok: true }]);
        assert.deepEqual(result.rpcCalls, [], String(mode));
        assert.deepEqual(outcomes(result), []);
      }
      assert.equal(f.world.referral_clicks!.length, 1, String(mode));
      // …and four different visitors behind the SAME address (an office, a campus, a mobile
      // carrier) are four clicks.
      for (let n = 0; n < 4; n++)
        assert.equal((await referralClick(f, "203.0.113.7", "creator1", cookieOf())).status, 200);
      assert.equal(f.world.referral_clicks!.length, 5, String(mode));
      // A first-time visitor (no cookie yet) is counted and given one.
      const fresh = await referralClick(f, "203.0.113.7");
      assert.match(fresh.headers.get("Set-Cookie") ?? "", /tubify_pid=[0-9a-f-]{36}/);
      // The same visitor for another referrer is that referrer's click.
      await referralClick(f, "203.0.113.7", "second22", visitor);
      // With no address at all, nothing changes either.
      await referralClick(f, null, "creator1", cookieOf());
    });
    assert.equal(f.world.referral_clicks!.length, 8, String(mode));
    assert.equal(new Set(f.world.referral_clicks!.map((row) => row.privacy_id)).size, 7);
    assert.equal(f.world.rate_limit_buckets!.length, 0, String(mode));
  }
});

test("referral click: a rate-limit store outage, or no secret, suppresses nothing", async () => {
  for (const mode of ["observe", "enforce"]) {
    const f = fixture();
    await inMode(mode, async () => {
      f.world.failRateLimit = true;
      for (let n = 0; n < 4; n++) {
        const result = await referralClick(f, "203.0.113.7", "creator1", cookieOf());
        assert.deepEqual([result.status, result.body], [200, { ok: true }]);
        assert.deepEqual(outcomes(result), []);
      }
    });
    await inMode(
      mode,
      async () => void (await referralClick(f, "203.0.113.7", "creator1", cookieOf())),
      null,
    );
    assert.equal(f.world.referral_clicks!.length, 5, mode);
  }
});

test("referral click: a cookie that is not a UUID is replaced, never stored; an unknown code is still 404", async () => {
  const f = fixture();
  await inMode("off", async () => {
    const result = await referralClick(f, "203.0.113.7", "creator1", "<script>x</script>");
    assert.equal(result.status, 200);
    const stored = f.world.referral_clicks![0].privacy_id as string;
    assert.match(stored, /^[0-9a-f-]{36}$/);
    assert.match(result.headers.get("Set-Cookie") ?? "", new RegExp(`tubify_pid=${stored}`));
    const kept = cookieOf();
    const second = await referralClick(f, "203.0.113.7", "creator1", kept);
    assert.equal(second.headers.get("Set-Cookie"), null);
    assert.equal(f.world.referral_clicks![1].privacy_id, kept);
    assert.equal((await referralClick(f, "203.0.113.7", "nobody")).status, 404);
  });
});

// ============================================================
// Tracked-link redirect (an analytics rule: the redirect itself is never in question)
// ============================================================

const isRedirect = (result: CallResult) =>
  result.status === 302 && result.headers.get("Location") === "https://shop.test/p";

test("redirect, off and observe: every click is recorded, with its video, exactly as before", async () => {
  for (const mode of [undefined, "off", "observe"]) {
    const f = fixture();
    await inMode(mode, async () => {
      for (let n = 0; n < 65; n++)
        assert.ok(isRedirect(await follow(f, "203.0.113.7")), `${mode} ${n}`);
    });
    assert.equal(f.world.link_click_events!.length, 65, String(mode));
    assert.equal(f.world.tracking_links![0].clicks, 65, String(mode));
    // Click attribution is untouched: the click carries the link's video and channel.
    const event = f.world.link_click_events![0];
    assert.deepEqual(
      [event.link_id, event.video_id, event.channel_id],
      [f.link, f.video, f.channel],
    );
    assert.equal(f.world.rate_limit_buckets!.length, mode === "observe" ? 1 : 0, String(mode));
  }
});

test("redirect, observe: would-not-count is logged past the cap, and the click is still recorded", async () => {
  const f = fixture();
  await inMode("observe", async () => {
    let last!: CallResult;
    for (let n = 0; n < 61; n++) last = await follow(f, "203.0.113.7");
    assert.deepEqual(outcomes(last), ["would_not_count"]);
  });
  assert.equal(f.world.link_click_events!.length, 61);
});

test("redirect, enforce: at most sixty recorded clicks per link and address per hour — and every request still redirects", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    for (let n = 0; n < 75; n++)
      assert.ok(isRedirect(await follow(f, "203.0.113.7")), `request ${n + 1}`);
    assert.equal(f.world.link_click_events!.length, 60);
    assert.equal(f.world.tracking_links![0].clicks, 60, "the counter and the events agree");
    // Another address, and another link, are counted independently.
    assert.ok(isRedirect(await follow(f, "198.51.100.9")));
    assert.equal(f.world.link_click_events!.length, 61);
    const other = await follow(f, "203.0.113.7", "other");
    assert.equal(other.status, 302);
    assert.equal(f.world.link_click_events!.length, 62);
    // The next hour counts again.
    f.world.nowMs = T0 + HOUR;
    await follow(f, "203.0.113.7");
    assert.equal(f.world.link_click_events!.length, 63);
  });
});

test("redirect, enforce: a failing limiter never blocks the redirect, and the click is recorded", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    f.world.failRateLimit = true;
    for (let n = 0; n < 3; n++) {
      const result = await follow(f, "203.0.113.7");
      assert.ok(isRedirect(result));
      assert.deepEqual(outcomes(result), ["unavailable"]);
    }
  });
  assert.equal(f.world.link_click_events!.length, 3);
  // No secret, no trusted address: still a redirect, still recorded.
  const g = fixture();
  await inMode("enforce", async () => assert.ok(isRedirect(await follow(g, "203.0.113.7"))), null);
  await inMode("enforce", async () => assert.ok(isRedirect(await follow(g, null))));
  assert.equal(g.world.link_click_events!.length, 2);
});

test("redirect: unknown and inactive links are 404 in every mode, and nothing is counted for them", async () => {
  for (const mode of ["off", "enforce"]) {
    const f = fixture();
    f.world.tracking_links![1].status = "archived";
    await inMode(mode, async () => {
      for (const slug of ["nope", "other"]) {
        const result = await follow(f, "203.0.113.7", slug);
        assert.equal(result.status, 404, `${mode} ${slug}`);
        assert.deepEqual(result.rpcCalls, []);
        assert.deepEqual(result.writes, []);
      }
    });
  }
});

test("redirect: the visitor cookie is stored only if it is a UUID", async () => {
  const f = fixture();
  await inMode("off", async () => {
    const kept = cookieOf();
    const known = await follow(f, "203.0.113.7", "shop", { cookie: `tubify_pid=${kept}` });
    assert.equal(known.headers.get("Set-Cookie"), null);
    assert.equal(f.world.link_click_events![0].privacy_id, kept);
    for (const forged of ["%3Cscript%3E", "1", "x".repeat(2000), "'; drop table x; --"]) {
      const result = await follow(f, "203.0.113.7", "shop", { cookie: `tubify_pid=${forged}` });
      assert.ok(isRedirect(result));
      const stored = f.world.link_click_events!.at(-1)!.privacy_id as string;
      assert.match(stored, /^[0-9a-f]{8}-[0-9a-f]{4}-/, forged.slice(0, 12));
      assert.match(result.headers.get("Set-Cookie") ?? "", new RegExp(`tubify_pid=${stored}`));
    }
    // No cookie at all: a new one is issued, as before.
    const fresh = await follow(f, "203.0.113.7");
    assert.match(
      fresh.headers.get("Set-Cookie") ?? "",
      /tubify_pid=[0-9a-f-]{36}; Path=\/; HttpOnly; SameSite=Lax/,
    );
  });
});

// ============================================================
// Public lead-magnet view (an analytics rule)
// ============================================================

const views = (f: Fixture) => f.world.lead_magnets![0].views as number;

test("lead-magnet view, off and observe: every load counts, as before", async () => {
  for (const mode of [undefined, "off", "observe"]) {
    const f = fixture();
    await inMode(mode, async () => {
      for (let n = 0; n < 5; n++) assert.equal((await viewMagnet(f, "203.0.113.7")).status, 200);
    });
    assert.equal(views(f), 5, String(mode));
  }
});

test("lead-magnet view, enforce: one counted view per lead magnet and address per hour; the page is always served", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    const first = await viewMagnet(f, "203.0.113.7");
    for (let n = 0; n < 4; n++) {
      const again = await viewMagnet(f, "203.0.113.7");
      assert.equal(again.status, 200);
      assert.deepEqual(again.body, first.body, "the same page whether or not it was counted");
    }
    assert.equal(views(f), 1);
    await viewMagnet(f, "198.51.100.9");
    assert.equal(views(f), 2);
    f.world.nowMs = T0 + HOUR;
    await viewMagnet(f, "203.0.113.7");
    assert.equal(views(f), 3);
  });
});

test("lead-magnet view, enforce: a failing limiter still serves the page and counts the view", async () => {
  const f = fixture();
  await inMode("enforce", async () => {
    f.world.failRateLimit = true;
    for (let n = 0; n < 3; n++) assert.equal((await viewMagnet(f, "203.0.113.7")).status, 200);
  });
  assert.equal(views(f), 3);
});

// ============================================================
// What is stored and logged
// ============================================================

test("no raw address, email or cookie is ever stored in a counter or written to a log", async () => {
  const f = fixture();
  const ips = ["203.0.113.77", "2001:db8:aaaa:bbbb::5"];
  const visitor = cookieOf();
  const all: CallResult[] = [];
  await inMode("enforce", async () => {
    for (const ip of ips) {
      for (let n = 0; n < 7; n++)
        all.push(await optIn(f, ip, { email: "secret.person@example.com" }));
      for (let n = 0; n < 5; n++) all.push(await contact(f, ip));
      for (let n = 0; n < 2; n++) all.push(await referralClick(f, ip, "creator1", visitor));
      for (let n = 0; n < 62; n++)
        all.push(await follow(f, ip, "shop", { cookie: `tubify_pid=${visitor}` }));
      for (let n = 0; n < 2; n++) all.push(await viewMagnet(f, ip));
    }
  });
  const keys = f.world.rate_limit_buckets!.map((b) => String(b.bucket_key));
  assert.equal(
    keys.length,
    12,
    "two forms with two rules each, a link and a lead magnet, per address",
  );
  const stored = JSON.stringify(f.world.rate_limit_buckets);
  const logs = all.map(logged).join("\n");
  for (const secret of [...ips, "203.0.113", "2001:db8", "secret.person", visitor, SECRET]) {
    assert.ok(!stored.includes(secret), `counter contains ${secret}`);
    assert.ok(!logs.includes(secret), `log contains ${secret}`);
  }
  // A key is the mode, a label, an optional resource id, and a 128-bit keyed hash.
  for (const key of keys)
    assert.match(
      key,
      /^enforce:(optin|support_contact|link_click|lead_magnet_view):[a-z0-9]+:([0-9a-f-]{36}:)?[0-9a-f]{32}$/,
    );
  // The log lines that exist name only the outcome, the endpoint, the rule and the mode.
  const lines = all.flatMap((r) => r.logs).filter((entry) => entry[0] === "Rate limit");
  assert.ok(lines.length > 0);
  for (const [, detail] of lines)
    assert.deepEqual(Object.keys(detail as object).sort(), ["endpoint", "mode", "outcome", "rule"]);
  // And the same address hashes differently under a different secret.
  const g = fixture();
  await inMode(
    "enforce",
    async () => void (await optIn(g, ips[0])),
    "another-secret-of-sufficient-length-123456",
  );
  assert.notEqual(String(g.world.rate_limit_buckets![0].bucket_key), keys[0]);
});

// ============================================================
// Concurrency and several server instances
// ============================================================

/** A stand-in for the database: one shared, atomic counter per key and window. */
function sharedStore() {
  const counts = new Map<string, number>();
  let calls = 0;
  const client = () =>
    ({
      rpc: async (
        _name: string,
        args: { p_key: string; p_window_seconds: number; p_limit: number },
      ) => {
        calls += 1;
        // Let other requests interleave before the (atomic) increment, as on a real network.
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
        const key = `${args.p_key}|${args.p_window_seconds}`;
        const hits = (counts.get(key) ?? 0) + 1;
        counts.set(key, hits);
        return { data: hits <= args.p_limit, error: null };
      },
    }) as unknown as SupabaseClient;
  return { client, counts, calls: () => calls };
}
const requestFrom = (ip: string) =>
  new Request("https://app.test/api/freebies/optin", {
    method: "POST",
    headers: { "x-vercel-forwarded-for": ip },
  });

test("concurrency: simultaneous requests across three server instances — exactly five get through, and never more", async () => {
  const consoleWarn = console.warn;
  console.warn = () => {};
  try {
    await inMode("enforce", async () => {
      const store = sharedStore();
      // Three independent clients over one database: nothing is shared between them in memory.
      const instances = [store.client(), store.client(), store.client()];
      const decisions = await Promise.all(
        Array.from({ length: 18 }, (_, n) =>
          checkAbuseLimit(
            instances[n % 3],
            requestFrom("203.0.113.7"),
            "optin",
            RATE_LIMIT_POLICY.optin,
          ),
        ),
      );
      assert.equal(decisions.filter((d) => !d.refuse).length, 5);
      assert.equal(decisions.filter((d) => d.refuse).length, 13);
      assert.equal(store.calls(), 36, "every request counted against both rules");
      // A burst far beyond the daily limit as well: the two rules are counted independently, so
      // fewer than five may pass — but never more.
      const flood = sharedStore();
      const floodDecisions = await Promise.all(
        Array.from({ length: 200 }, (_, n) =>
          checkAbuseLimit(
            [flood.client(), flood.client()][n % 2],
            requestFrom("203.0.113.7"),
            "optin",
            RATE_LIMIT_POLICY.optin,
          ),
        ),
      );
      assert.ok(floodDecisions.filter((d) => !d.refuse).length <= 5);
      // A second address, concurrently, has its own five.
      const mixed = await Promise.all(
        Array.from({ length: 30 }, (_, n) =>
          checkAbuseLimit(
            instances[n % 3],
            requestFrom(n % 2 ? "198.51.100.1" : "198.51.100.2"),
            "optin",
            RATE_LIMIT_POLICY.optin,
          ),
        ),
      );
      assert.equal(mixed.filter((d) => !d.refuse).length, 10);
    });
  } finally {
    console.warn = consoleWarn;
  }
});

test("concurrency: simultaneous clicks on one link are recorded exactly up to the cap", async () => {
  const consoleWarn = console.warn;
  console.warn = () => {};
  try {
    await inMode("enforce", async () => {
      const store = sharedStore();
      const instances = [store.client(), store.client()];
      const link = uuid();
      const counted = await Promise.all(
        Array.from({ length: 200 }, (_, n) =>
          shouldCountEvent(instances[n % 2], requestFrom("203.0.113.7"), {
            endpoint: "link_click",
            rule: RATE_LIMIT_POLICY.linkClick,
            resourceId: link,
          }),
        ),
      );
      assert.equal(counted.filter(Boolean).length, 60);
    });
  } finally {
    console.warn = consoleWarn;
  }
});

test("the limiter keeps no counter in memory: off makes no call, and a new process sees the same counts", async () => {
  const store = sharedStore();
  await inMode("off", async () => {
    const decision = await checkAbuseLimit(
      store.client(),
      requestFrom("203.0.113.7"),
      "optin",
      RATE_LIMIT_POLICY.optin,
    );
    assert.deepEqual(decision, { refuse: false });
    assert.equal(
      await shouldCountEvent(store.client(), requestFrom("203.0.113.7"), {
        endpoint: "link_click",
        rule: RATE_LIMIT_POLICY.linkClick,
        resourceId: uuid(),
      }),
      true,
    );
  });
  assert.equal(store.calls(), 0);
  const source = codeOf("src/lib/server/rate-limit.ts");
  assert.doesNotMatch(source, /new Map\(|new Set\(|globalThis|let \w*(count|hits|bucket)/i);
});

// ============================================================
// Cleanup
// ============================================================

test("cleanup: bounded, best effort, and nothing at all when the limiter is off", async () => {
  const calls: unknown[] = [];
  const service = (answer: () => Promise<unknown>) =>
    ({
      rpc: (name: string, args: unknown) => {
        calls.push([name, args]);
        return answer();
      },
    }) as unknown as SupabaseClient;
  await inMode("off", async () => {
    assert.equal(
      await purgeExpiredRateLimitBuckets(service(async () => ({ data: 5, error: null }))),
      null,
    );
  });
  assert.deepEqual(calls, [], "off: no database call");
  for (const mode of ["observe", "enforce"])
    await inMode(mode, async () => {
      assert.equal(
        await purgeExpiredRateLimitBuckets(service(async () => ({ data: 7, error: null }))),
        7,
      );
    });
  assert.deepEqual(calls[0], ["purge_rate_limit_buckets", { p_max_rows: 5000 }]);
  // A database error, a thrown error and a hang all come back as "nothing done" — never a throw.
  await inMode("enforce", async () => {
    assert.equal(
      await purgeExpiredRateLimitBuckets(
        service(async () => ({ data: null, error: { code: "XX000" } })),
      ),
      null,
    );
    assert.equal(
      await purgeExpiredRateLimitBuckets(
        service(() => {
          throw new Error("down");
        }),
      ),
      null,
    );
    assert.equal(
      await purgeExpiredRateLimitBuckets(service(() => Promise.reject(new Error("down")))),
      null,
    );
  });
});

test("cleanup runs in the existing daily cron, before the sync, and cannot fail it", () => {
  const sync = readFileSync("src/routes/api.youtube.sync.ts", "utf8").replace(/\s+/g, " ");
  const cron = sync.slice(sync.indexOf("GET: async"));
  const purge = cron.indexOf("await purgeExpiredRateLimitBuckets(service);");
  assert.ok(purge > 0 && purge < cron.indexOf('.from("youtube_channels")'));
  assert.ok(
    purge > cron.indexOf('return json({ error: "AUTH_REQUIRED" }'),
    "only after the cron secret check",
  );
  // No new scheduled job was added.
  assert.deepEqual(JSON.parse(readFileSync("vercel.json", "utf8")).crons, [
    { path: "/api/youtube/sync", schedule: "0 0 * * *" },
  ]);
});

// ============================================================
// Wiring
// ============================================================

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

test("each form checks its limit before any application read or write, and the honeypot before any write", () => {
  const optin = flat("src/routes/api.freebies.optin.ts");
  const order = (source: string, ...needles: string[]) => {
    const at = needles.map((needle) => source.indexOf(needle));
    assert.ok(
      at.every((index) => index > 0),
      needles[at.findIndex((index) => index <= 0)],
    );
    assert.deepEqual(
      [...at].sort((a, b) => a - b),
      at,
      needles.join(" → "),
    );
  };
  order(
    optin,
    "optinSchema.parse(",
    'checkAbuseLimit(service, request, "optin", RATE_LIMIT_POLICY.optin)',
    "if (limit.refuse) return rateLimitedResponse(limit.retryAfterSeconds);",
    '.from("lead_magnets")',
    "if (honeypotTriggered(input[HONEYPOT_FIELD])) return unlocked();",
    '.from("leads")',
  );
  const support = flat("src/routes/api.support.contact.ts");
  order(
    support,
    "contactSchema.parse(",
    'checkAbuseLimit( service, request, "support_contact", RATE_LIMIT_POLICY.supportContact, )',
    "if (limit.refuse) return rateLimitedResponse(limit.retryAfterSeconds);",
    "if (honeypotTriggered(input[HONEYPOT_FIELD]))",
    '.from("support_tickets").insert(',
  );
  // The analytics endpoints can never return a refusal.
  for (const file of ["r.$slug.ts", "api.freebies.public.ts"]) {
    const source = flat(`src/routes/${file}`);
    assert.match(source, /shouldCountEvent\(service, request, \{/, file);
    assert.doesNotMatch(source, /rateLimitedResponse|checkAbuseLimit|429/, file);
  }
  // The referral click uses the limiter for nothing: only the visitor-cookie check.
  const referral = flat("src/routes/api.referrals.click.ts");
  assert.match(referral, /validVisitorId\(getCookie\(request, PRIVACY_ID_COOKIE\)\)/);
  assert.doesNotMatch(
    referral,
    /shouldCountEvent|RATE_LIMIT_POLICY|rateLimitedResponse|checkAbuseLimit|429/,
  );
});

test("the two public forms carry the hidden field, out of sight, out of the tab order and unannounced", () => {
  const field = readFileSync("src/components/HoneypotField.tsx", "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ");
  assert.match(field, /aria-hidden="true"/);
  assert.match(field, /tabIndex=\{-1\}/);
  assert.match(field, /autoComplete="off"/);
  assert.match(field, /name=\{HONEYPOT_FIELD\}/);
  // Off-screen rather than removed: a field a script cannot see is a field it will not fill.
  assert.doesNotMatch(field, /display: ?none|type="hidden"/);
  assert.match(field, /-left-\[9999px\]/);
  const freebie = flat("src/routes/f.$slug.tsx");
  assert.match(freebie, /<HoneypotField value=\{trap\} onChange=\{setTrap\} \/>/);
  assert.match(freebie, /\[HONEYPOT_FIELD\]: trap,/);
  assert.match(freebie, /RATE_LIMITED: "Too many requests from this network\./);
  const landing = flat("src/routes/landing.tsx");
  assert.match(landing, /<HoneypotField value=\{trap\} onChange=\{setTrap\} \/>/);
  assert.match(landing, /JSON\.stringify\(\{ name, email, message, \[HONEYPOT_FIELD\]: trap \}\)/);
  assert.match(landing, /if \(res\.status === 429\)/);
});

test("the migration: counters only, service role only, and nothing else in the database is touched", () => {
  const dir = "supabase/migrations";
  const file = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .at(-1)!;
  assert.equal(file, "202610130001_public_rate_limits.sql");
  const sql = readFileSync(`${dir}/${file}`, "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ");
  assert.match(sql, /^ ?begin; /);
  assert.match(sql, / commit; ?$/);
  assert.match(sql, /alter table public\.rate_limit_buckets enable row level security;/);
  assert.doesNotMatch(sql, /create policy/);
  assert.match(
    sql,
    /revoke all on table public\.rate_limit_buckets from public, anon, authenticated, service_role;/,
  );
  for (const fn of [
    "consume_rate_limit(text, integer, integer)",
    "purge_rate_limit_buckets(integer)",
  ]) {
    const name = fn.replace(/[()]/g, "\\$&");
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${name} from public, anon, authenticated;`),
    );
    assert.match(sql, new RegExp(`grant execute on function public\\.${name} to service_role;`));
  }
  assert.equal(sql.match(/security definer set search_path = ''/g)?.length, 2);
  assert.match(
    sql,
    /on conflict \(bucket_key, window_start\) do update set hits = case when b\.hits >= 1000000000 then b\.hits else b\.hits \+ 1 end/,
  );
  assert.match(sql, /p_window_seconds not between 1 and 86400/);
  assert.match(sql, /p_limit not between 1 and 1000000/);
  assert.match(sql, /limit p_max_rows for update skip locked/);
  // Every grant and revoke names one of the three new objects; no default privilege, no other table.
  for (const statement of sql.match(/\b(grant|revoke) [^;]+;/g) ?? [])
    assert.match(
      statement,
      /rate_limit_buckets|consume_rate_limit|purge_rate_limit_buckets/,
      statement,
    );
  assert.doesNotMatch(sql, /alter default privileges|drop |truncate | on all /);
  // Nothing dynamic: the functions' SQL is fixed.
  assert.doesNotMatch(sql, /\bexecute (format|'|\$)/i);
});
