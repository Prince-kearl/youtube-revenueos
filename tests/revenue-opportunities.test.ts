import {
  addMember,
  addUser,
  addPaidWorkspace,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type CallResult,
  type World,
} from "./helpers/team-fake-api";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  OPPORTUNITY_RULES,
  evaluateOpportunities,
  median,
  percentile,
  type OpportunityInputs,
  type OpportunityResult,
} from "../src/lib/revenue-opportunities";
import { uncheckedAreas, videoOpportunitiesUrl } from "../src/lib/video-opportunities-view";
import {
  VideoOpportunitiesContent,
  type OpportunitiesState,
} from "../src/components/VideoOpportunitiesView";
import type { VideoOpportunitiesResponse } from "../src/lib/server/video-opportunities";

// Phase 2C: revenue opportunities for one video. The rules are pure and tested directly; the
// endpoint runs against the in-memory database (helpers/team-fake-api.ts); the section is
// rendered to HTML for each state.

// ============================================================
// The rules
// ============================================================

/** A workspace of six videos over 90 days: this one has 100,000 views; the others 50k, 20k, 10k,
 * 5k and 2k — so this video is in the top quarter. Every video has complete revenue; the others'
 * RPMs are 4, 4, 5, 5 and 6 (median 5). */
function inputs(
  overrides: Partial<OpportunityInputs> = {},
  thisVideo: Partial<NonNullable<OpportunityInputs["video"]>> = {},
): OpportunityInputs {
  const video = { views: 100_000, rpm: 5, availability: "complete" as const, ...thisVideo };
  const others = [
    { views: 50_000, rpm: 4 },
    { views: 20_000, rpm: 4 },
    { views: 10_000, rpm: 5 },
    { views: 5_000, rpm: 5 },
    { views: 2_000, rpm: 6 },
  ];
  return {
    youtubeVideoId: "vidTHIS0001",
    periodDays: 90,
    video,
    workspace: [
      { isThisVideo: true, ...video },
      ...others.map((o) => ({ isThisVideo: false, availability: "complete" as const, ...o })),
    ],
    revenueVisible: true,
    links: { status: "checked", currentLinks: 1, clicks: 5 },
    deals: {
      status: "checked",
      linkedContracted: 0,
      linkedAny: 0,
      unlinkedContracted: 0,
      canLink: true,
    },
    // Every feature on, and the workspace already has a lead magnet: no setup step unless a test
    // says otherwise.
    setup: {
      linkTracking: true,
      leadCapture: { enabled: true, workspaceHasLeadMagnet: true },
      brandDeals: true,
    },
    ...overrides,
  };
}
const types = (result: OpportunityResult) => result.opportunities.map((o) => o.type);
const byType = (result: OpportunityResult, type: string) =>
  result.opportunities.find((o) => o.type === type);

test("thresholds are the documented ones", () => {
  assert.deepEqual(OPPORTUNITY_RULES, {
    MIN_VIEWS: 1_000,
    MIN_COMPARABLE: 5,
    MIN_CLICKS: 25,
    LOW_RPM_RATIO: 0.5,
    HIGH_RPM_RATIO: 1.5,
  });
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 75), 3);
  assert.equal(percentile([5], 75), 5);
  assert.equal(percentile([10, 20, 30, 40, 50, 60, 70, 80], 75), 60);
});

test("add a tracked link: strong audience and nothing measured — high in the top quarter, medium above the median", () => {
  const none = { status: "checked" as const, currentLinks: 0, clicks: 0 };
  const top = evaluateOpportunities(inputs({ links: none }));
  const opp = byType(top, "add_tracked_link")!;
  assert.equal(opp.priority, "high");
  // Phase 2D-1: straight into creating a link for THIS video.
  assert.deepEqual(opp.action, {
    label: "Add a tracked link",
    href: "/link-tracking?video=vidTHIS0001&create=1",
  });
  assert.match(opp.explanation, /100,000 views in the last 90 days/);
  assert.match(opp.explanation, /isn't evidence it earns nothing beyond YouTube/);
  assert.deepEqual(
    opp.evidence.map((e) => e.value),
    ["100,000", "Top quarter of the workspace's 6 videos", "None"],
  );
  // 15,000 among 2k, 5k, 10k, 20k, 50k: above the median (12.5k), below the top quarter (20k).
  assert.equal(
    byType(evaluateOpportunities(inputs({ links: none }, { views: 15_000 })), "add_tracked_link")!
      .priority,
    "medium",
  );
  // Below the median, or under 1,000 views: nothing.
  assert.equal(
    byType(evaluateOpportunities(inputs({ links: none }, { views: 3_000 })), "add_tracked_link"),
    undefined,
  );
  // Fewer than five videos to compare: 1,000 views is enough, and no ranking is claimed.
  const small = evaluateOpportunities({
    ...inputs({ links: none }, { views: 1_500 }),
    workspace: [{ isThisVideo: true, views: 1_500, rpm: 5, availability: "complete" }],
  });
  const lone = byType(small, "add_tracked_link")!;
  assert.equal(lone.priority, "medium");
  assert.match(
    lone.evidence[1].value,
    /Not ranked — fewer than 5 of the workspace's videos have views/,
  );
  // …but under 1,000 views, never.
  assert.equal(
    byType(
      evaluateOpportunities({
        ...inputs({ links: none }, { views: 999 }),
        workspace: [{ isThisVideo: true, views: 999, rpm: 5, availability: "complete" }],
      }),
      "add_tracked_link",
    ),
    undefined,
  );
  // Clicks from links since moved away count as measurement: no "add a link".
  assert.equal(
    byType(
      evaluateOpportunities(inputs({ links: { status: "checked", currentLinks: 0, clicks: 3 } })),
      "add_tracked_link",
    ),
    undefined,
  );
});

test("links without clicks, and clicks worth reviewing — clicks are interest, never income", () => {
  const silent = evaluateOpportunities(
    inputs({ links: { status: "checked", currentLinks: 2, clicks: 0 } }),
  );
  const quiet = byType(silent, "links_without_clicks")!;
  assert.equal(quiet.priority, "medium");
  assert.match(quiet.explanation, /2 tracked links are on this video, but none was clicked/);
  assert.equal(
    byType(
      evaluateOpportunities(
        inputs({ links: { status: "checked", currentLinks: 2, clicks: 0 } }, { views: 900 }),
      ),
      "links_without_clicks",
    ),
    undefined,
  );
  const busy = evaluateOpportunities(
    inputs({ links: { status: "checked", currentLinks: 1, clicks: 25 } }),
  );
  const review = byType(busy, "review_link_offer")!;
  assert.match(review.explanation, /clicked 25 times/);
  assert.match(review.explanation, /Clicks show interest, not sales/);
  assert.equal(
    byType(
      evaluateOpportunities(inputs({ links: { status: "checked", currentLinks: 1, clicks: 24 } })),
      "review_link_offer",
    ),
    undefined,
  );
  for (const result of [silent, busy])
    assert.doesNotMatch(
      JSON.stringify(result),
      /conversion|commission|sale(s)? (were|made)|earned \$/i,
    );
});

test("sponsorships: link an existing deal (never create one), and pitch with a strong sponsored video — agreed, not paid", () => {
  const unlinked = {
    status: "checked" as const,
    linkedContracted: 0,
    linkedAny: 0,
    unlinkedContracted: 2,
    canLink: true,
  };
  const link = byType(evaluateOpportunities(inputs({ deals: unlinked })), "link_sponsorship")!;
  assert.equal(link.priority, "low");
  assert.deepEqual(link.action, { label: "Link a deal", href: "#brand-deals" });
  assert.match(link.nextStep, /don't create a new one/);
  // Not for a member who may not link, nor when this video already has a deal, nor when every
  // contracted deal is linked somewhere.
  for (const deals of [
    { ...unlinked, canLink: false },
    { ...unlinked, linkedAny: 1 },
    { ...unlinked, unlinkedContracted: 0 },
  ])
    assert.equal(byType(evaluateOpportunities(inputs({ deals })), "link_sponsorship"), undefined);

  const sponsored = {
    status: "checked" as const,
    linkedContracted: 1,
    linkedAny: 1,
    unlinkedContracted: 0,
    canLink: false,
  };
  const pitch = byType(
    evaluateOpportunities(inputs({ deals: sponsored })),
    "sponsored_video_for_pitch",
  )!;
  assert.match(pitch.explanation, /agreed, not confirmed as paid/);
  assert.equal(pitch.priority, "low");
  // Only in the top quarter, and only with a contracted (not pipeline) deal.
  assert.equal(
    byType(
      evaluateOpportunities(inputs({ deals: sponsored }, { views: 15_000 })),
      "sponsored_video_for_pitch",
    ),
    undefined,
  );
  assert.equal(
    byType(
      evaluateOpportunities(inputs({ deals: { ...sponsored, linkedContracted: 0 } })),
      "sponsored_video_for_pitch",
    ),
    undefined,
  );
});

test("revenue per view: low and high RPM against the same workspace over the same days, only with complete data", () => {
  const low = evaluateOpportunities(inputs({}, { rpm: 2 }));
  const investigate = byType(low, "investigate_low_rpm")!;
  assert.equal(investigate.priority, "high");
  assert.deepEqual(
    investigate.evidence.map((e) => [e.label, e.value]),
    [
      ["RPM, last 90 days", "$2.00"],
      ["Median RPM of 5 other workspace videos, same days", "$5.00"],
      ["Views, last 90 days (stored YouTube data)", "100,000"],
    ],
  );
  assert.match(investigate.explanation, /shows the gap, not its cause/);
  assert.equal(low.checks.revenue, "checked");
  // Exactly half the median still counts; just above does not.
  assert.ok(byType(evaluateOpportunities(inputs({}, { rpm: 2.5 })), "investigate_low_rpm"));
  assert.equal(
    byType(evaluateOpportunities(inputs({}, { rpm: 2.51 })), "investigate_low_rpm"),
    undefined,
  );
  // A genuine zero RPM is a real figure and counts; an unknown one (null) is not a zero.
  assert.ok(byType(evaluateOpportunities(inputs({}, { rpm: 0 })), "investigate_low_rpm"));
  assert.deepEqual(types(evaluateOpportunities(inputs({}, { rpm: null }))), []);

  const high = byType(evaluateOpportunities(inputs({}, { rpm: 7.5 })), "repeat_high_rpm")!;
  assert.equal(high.priority, "medium");
  assert.match(high.explanation, /doesn't prove which/);
  assert.deepEqual(types(evaluateOpportunities(inputs({}, { rpm: 6 }))), [], "in between: nothing");

  // Revenue not known for every stored day (partial, unavailable): no comparison at all.
  for (const availability of ["partial", "unavailable"] as const) {
    const result = evaluateOpportunities(inputs({}, { rpm: 1, availability }));
    assert.deepEqual(types(result), [], availability);
    assert.equal(result.checks.revenue, "insufficient_data");
  }
  // Known but still provisional (the newest days may be revised — the default period always
  // ends there): compared, and marked as such.
  const provisional = evaluateOpportunities(inputs({}, { rpm: 1, availability: "provisional" }));
  assert.equal(byType(provisional, "investigate_low_rpm")!.dataStatus, "provisional");
  const otherProvisional = inputs({}, { rpm: 1 });
  otherProvisional.workspace = otherProvisional.workspace.map((v) => ({
    ...v,
    availability: "provisional",
  }));
  assert.ok(byType(evaluateOpportunities(otherProvisional), "investigate_low_rpm"));
  // Fewer than five comparable videos (others partial, or under 1,000 views): no comparison.
  const thin = inputs({}, { rpm: 1 });
  thin.workspace = thin.workspace.map((v, i) => (i >= 2 ? { ...v, availability: "partial" } : v));
  assert.deepEqual(types(evaluateOpportunities(thin)), []);
  // A low RPM on a small video (below the median views) is not worth chasing.
  assert.equal(
    byType(evaluateOpportunities(inputs({}, { rpm: 1, views: 3_000 })), "investigate_low_rpm"),
    undefined,
  );
});

test("a member who may not see revenue gets no revenue rule and nothing derived from revenue", () => {
  const hidden = evaluateOpportunities({
    ...inputs(
      { revenueVisible: false, links: { status: "checked", currentLinks: 0, clicks: 0 } },
      { rpm: null },
    ),
  });
  assert.equal(hidden.checks.revenue, "hidden");
  assert.deepEqual(types(hidden), ["add_tracked_link"]);
  assert.doesNotMatch(JSON.stringify(hidden), /\$|RPM|revenue per/i);
  // Even if RPMs were (wrongly) supplied, a hidden caller gets no revenue rule.
  const leaked = evaluateOpportunities(inputs({ revenueVisible: false }, { rpm: 1 }));
  assert.ok(!types(leaked).some((t) => t.includes("rpm")));
});

test("missing data is never read as zero: no stored video, restricted and unavailable parts", () => {
  const nothing = evaluateOpportunities({ ...inputs(), video: null, workspace: [] });
  assert.deepEqual(nothing.opportunities, []);
  assert.deepEqual(nothing.checks, {
    audience: "insufficient_data",
    links: "insufficient_data",
    sponsorships: "insufficient_data",
    revenue: "insufficient_data",
  });
  const restricted = evaluateOpportunities(
    inputs({ links: { status: "restricted" }, deals: { status: "unavailable" } }),
  );
  assert.equal(restricted.checks.links, "restricted");
  assert.equal(restricted.checks.sponsorships, "unavailable");
  assert.ok(!types(restricted).some((t) => /link|sponsor/.test(t)));
  assert.deepEqual(uncheckedAreas(restricted.checks), [
    "Tracked links: not included for your role or plan",
    "Brand deals: couldn't be loaded — try refreshing",
  ]);
});

test("ordering: high, then medium, then low; each type at most once; contradictory pairs never together", () => {
  const all = evaluateOpportunities(
    inputs(
      {
        links: { status: "checked", currentLinks: 0, clicks: 0 },
        deals: {
          status: "checked",
          linkedContracted: 0,
          linkedAny: 0,
          unlinkedContracted: 1,
          canLink: true,
        },
      },
      { rpm: 1 },
    ),
  );
  assert.deepEqual(types(all), ["investigate_low_rpm", "add_tracked_link", "link_sponsorship"]);
  assert.deepEqual(
    all.opportunities.map((o) => o.priority),
    ["high", "high", "low"],
  );
  // Exhaustively over many input combinations.
  const exclusive = [
    ["add_tracked_link", "links_without_clicks", "review_link_offer"],
    ["investigate_low_rpm", "repeat_high_rpm"],
    ["link_sponsorship", "sponsored_video_for_pitch"],
  ];
  const rank = { high: 0, medium: 1, low: 2 };
  for (const views of [500, 3_000, 20_000, 100_000])
    for (const rpm of [null, 0, 1, 5, 9])
      for (const [currentLinks, clicks] of [
        [0, 0],
        [0, 4],
        [1, 0],
        [2, 30],
      ])
        for (const [linkedContracted, linkedAny, unlinkedContracted] of [
          [0, 0, 0],
          [0, 0, 2],
          [1, 1, 3],
          [0, 1, 1],
        ]) {
          const result = evaluateOpportunities(
            inputs(
              {
                links: { status: "checked", currentLinks, clicks },
                deals: {
                  status: "checked",
                  linkedContracted,
                  linkedAny,
                  unlinkedContracted,
                  canLink: true,
                },
              },
              { views, rpm },
            ),
          );
          const list = types(result);
          assert.equal(new Set(list).size, list.length);
          for (const group of exclusive)
            assert.ok(list.filter((t) => group.includes(t)).length <= 1, JSON.stringify(list));
          const ranks = result.opportunities.map((o) => rank[o.priority]);
          assert.deepEqual(
            ranks,
            [...ranks].sort((a, b) => a - b),
          );
          assert.ok(result.opportunities.length <= 4);
        }
});

test("periods are stated, never mixed: views are stored days, clicks UTC days, comparisons the same days", () => {
  const result = evaluateOpportunities(
    inputs(
      { periodDays: 180, links: { status: "checked", currentLinks: 1, clicks: 40 } },
      { rpm: 9 },
    ),
  );
  for (const opportunity of result.opportunities)
    for (const item of opportunity.evidence)
      if (/Views|Clicks|RPM/i.test(item.label)) assert.match(item.label, /last 180 days|same days/);
  assert.match(byType(result, "review_link_offer")!.evidence[0].label, /\(UTC\)/);
});

// ============================================================
// The endpoint
// ============================================================

const route = await import("../src/routes/api.videos.opportunities");
const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** Workspace W1 with six videos (views 100k, 50k, 20k, 10k, 5k, 2k) and W2 with one video. */
function world(flags: { editor?: boolean } = {}) {
  const w: World = { ...emptyWorld(), protectMoney: true };
  w.features.push(
    { id: "feature-links", key: "link_tracking", is_active: true },
    { id: "feature-deals", key: "brand_deals", is_active: true },
  );
  const users = {
    owner: addUser(w, "owner@x.test"),
    editor: addUser(w, "editor@x.test"),
    stranger: addUser(w, "stranger@x.test"),
  };
  const ws = addPaidWorkspace(w, users.owner);
  addMember(w, ws, users.editor, "editor");
  Object.assign(
    w.workspaces.find((x) => x.id === ws)!,
    {
      editor_revenue_visible: flags.editor ?? false,
      setter_revenue_visible: false,
    },
  );
  const other = addPaidWorkspace(w, users.stranger);
  Object.assign(
    w.workspaces.find((x) => x.id === other)!,
    { editor_revenue_visible: false, setter_revenue_visible: false },
  );
  const channel = uuid();
  const otherChannel = uuid();
  w.youtube_channels = [
    {
      id: channel,
      workspace_id: ws,
      youtube_channel_id: "UCmine",
      channel_name: "Mine",
      connection_id: uuid(),
      connected_at: "2026-01-01",
    },
    {
      id: otherChannel,
      workspace_id: other,
      youtube_channel_id: "UCother",
      channel_name: "Other",
      connection_id: uuid(),
      connected_at: "2026-01-01",
    },
  ];
  const views = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000];
  const videos = views.map((v, i) => ({
    id: uuid(),
    channel_id: channel,
    youtube_video_id: `vidMINE000${i}`,
    title: `Mine ${i}`,
    thumbnail: null,
    published_at: "2026-01-01T00:00:00Z",
    status: "active",
    views: v,
  }));
  const theirs = {
    id: uuid(),
    channel_id: otherChannel,
    youtube_video_id: "vidTHEIRS01",
    title: "Theirs",
    thumbnail: null,
    published_at: "2026-01-01T00:00:00Z",
    status: "active",
    views: 900_000,
  };
  w.videos = [...videos, theirs].map(({ views: _views, ...row }) => row);
  const statsRow = (channelId: string, v: number, extra: Record<string, unknown> = {}) => ({
    channel_id: channelId,
    day: day(10),
    views: v,
    watch_minutes: Math.round(v / 2),
    estimated_revenue_usd: String((v / 1000) * 5),
    ad_revenue_usd: String((v / 1000) * 5),
    premium_revenue_usd: "0",
    ...extra,
  });
  w.channel_daily_stats = [
    statsRow(
      channel,
      views.reduce((a, b) => a + b, 0),
    ),
    statsRow(otherChannel, 900_000),
  ];
  w.video_daily_stats = [
    ...videos.map((v) => ({ ...statsRow(channel, v.views), video_id: v.id })),
    { ...statsRow(otherChannel, 900_000), video_id: theirs.id },
  ];
  w.youtube_sync_state = [];
  w.tracking_links = [];
  w.link_click_events = [];
  w.destinations = [];
  w.deals = [];
  w.deal_videos = [];
  return { w, users, ws, other, channel, videos, theirs };
}
type F = ReturnType<typeof world>;
const ask = (f: F, who: keyof F["users"] | null, query: string) =>
  callTeamApi(route, f.w, {
    as: who ? f.users[who] : null,
    method: "GET",
    path: "/api/videos/opportunities",
    query,
  });
const dataOf = (r: CallResult) => r.body.data as VideoOpportunitiesResponse["data"];

test("endpoint: a strong video with nothing measured gets 'add a tracked link'; a weak one gets nothing", async () => {
  const f = world();
  const strong = await ask(f, "owner", "?videoId=vidMINE0000&days=90");
  assert.equal(strong.status, 200, strong.text);
  assert.equal(strong.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(
    dataOf(strong).opportunities.map((o) => [o.type, o.priority]),
    [["add_tracked_link", "high"]],
  );
  assert.equal(dataOf(strong).checks.audience, "checked");
  assert.equal(dataOf(strong).period.days, 90);
  const weak = await ask(f, "owner", "?videoId=vidMINE0005&days=90");
  assert.deepEqual(dataOf(weak).opportunities, []);
  assert.deepEqual(strong.refusedMoneyReads, []);
});

test("endpoint: another workspace's video, an unknown id and a video with nothing stored look exactly alike", async () => {
  const f = world();
  const theirs = await ask(f, "owner", "?videoId=vidTHEIRS01&days=90");
  const unknown = await ask(f, "owner", "?videoId=vidUNKNOWN1&days=90");
  assert.equal(theirs.status, 200);
  assert.equal(
    theirs.text.replaceAll("vidTHEIRS01", "<asked>"),
    unknown.text.replaceAll("vidUNKNOWN1", "<asked>"),
  );
  assert.deepEqual(dataOf(theirs).opportunities, []);
  assert.equal(dataOf(theirs).checks.audience, "insufficient_data");
  assert.doesNotMatch(theirs.text, /900,000|Theirs/);
  // And nothing about links or deals was read for it.
  assert.ok(
    !theirs.reads.some((r) => ["tracking_links", "deal_videos", "deals"].includes(String(r.table))),
  );
});

test("endpoint: a member who may not see revenue gets activity-based suggestions only, and nothing about money", async () => {
  const f = world();
  const result = await ask(f, "editor", "?videoId=vidMINE0000&days=90");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.visibility, { revenue: "hidden" });
  assert.equal(dataOf(result).checks.revenue, "hidden");
  assert.doesNotMatch(result.text, /\$|RPM|"rpm"|revenue per view/i);
  assert.deepEqual(
    result.refusedMoneyReads,
    [],
    "no money column asked for on the member's session",
  );
  assert.deepEqual(
    dataOf(result).opportunities.map((o) => o.type),
    ["add_tracked_link"],
  );
});

test("endpoint: each group needs its own feature; a part that fails to read is 'unavailable', not zero", async () => {
  const f = world();
  f.w.role_feature_access.push(
    { role: "editor", feature_id: "feature-links", enabled: false },
    { role: "editor", feature_id: "feature-deals", enabled: false },
  );
  const restricted = await ask(f, "editor", "?videoId=vidMINE0000&days=90");
  assert.equal(dataOf(restricted).checks.links, "restricted");
  assert.equal(dataOf(restricted).checks.sponsorships, "restricted");
  assert.deepEqual(dataOf(restricted).opportunities, []);
  assert.ok(
    !restricted.reads.some((r) =>
      ["tracking_links", "link_click_events", "deal_videos"].includes(String(r.table)),
    ),
  );

  const g = world();
  g.w.failingReads = ["tracking_links"];
  const broken = await ask(g, "owner", "?videoId=vidMINE0000&days=90");
  assert.equal(broken.status, 200);
  assert.equal(dataOf(broken).checks.links, "unavailable");
  assert.ok(
    !dataOf(broken).opportunities.some((o) => o.type === "add_tracked_link"),
    "a failed read is not 'no links'",
  );
});

test("endpoint: sponsorship suggestions from the workspace's deals — stages only, never values", async () => {
  const f = world();
  f.w.deals!.push({
    id: uuid(),
    workspace_id: f.ws,
    user_id: f.users.owner,
    name: "Unlinked",
    stage: "contracted",
    value: "5000",
    currency: "USD",
  });
  const result = await ask(f, "owner", "?videoId=vidMINE0000&days=90");
  assert.ok(dataOf(result).opportunities.some((o) => o.type === "link_sponsorship"));
  assert.doesNotMatch(result.text, /5000|5,000\.00/);
  assert.ok(!result.reads.some((r) => r.table === "deals" && String(r.body).includes("value")));
  // A restricted member can't link: no such suggestion, and the workspace's deals aren't counted.
  const editor = await ask(f, "editor", "?videoId=vidMINE0000&days=90");
  assert.ok(!dataOf(editor).opportunities.some((o) => o.type === "link_sponsorship"));
});

test("endpoint: validation, sign-in and a failed core read", async () => {
  const f = world();
  for (const query of [
    "",
    "?videoId=vidMINE0000",
    "?videoId=vidMINE0000&days=30",
    "?videoId=bad&days=90",
    "?videoId=vidMINE0000&days=abc",
  ]) {
    const result = await ask(f, "owner", query);
    assert.equal(result.status, 422, query);
  }
  assert.equal((await ask(f, null, "?videoId=vidMINE0000&days=90")).status, 401);
  f.w.failingReads = ["video_daily_stats"];
  const failed = await ask(f, "owner", "?videoId=vidMINE0000&days=90");
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: "DATABASE_ERROR" });
});

// ============================================================
// The section
// ============================================================

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/videos/x"] }),
});
const render = (state: OpportunitiesState) =>
  renderToStaticMarkup(
    createElement(
      RouterContextProvider,
      { router },
      createElement(VideoOpportunitiesContent, { state, headingId: "h", onRetry: () => {} }),
    ),
  );
const response = (result: OpportunityResult): VideoOpportunitiesResponse => ({
  data: { ...result, period: { days: 90, startDate: "2026-07-01", endDate: "2026-09-28" } },
  visibility: { revenue: "visible" },
});
const ready = (result: OpportunityResult): OpportunitiesState => ({
  status: "ready",
  response: response(result),
  refreshing: false,
});

test("section: opportunity → why → what to do next, with evidence and a working action", () => {
  const html = render(
    ready(
      evaluateOpportunities(
        inputs(
          {
            links: { status: "checked", currentLinks: 0, clicks: 0 },
            deals: {
              status: "checked",
              linkedContracted: 0,
              linkedAny: 0,
              unlinkedContracted: 1,
              canLink: true,
            },
          },
          { rpm: 1 },
        ),
      ),
    ),
  );
  assert.equal(html.split('data-testid="opportunity"').length - 1, 3);
  assert.match(html, /This video earns less per view than most of this workspace&#x27;s videos/);
  assert.match(
    html,
    /Comparisons use only this workspace&#x27;s videos \(all its connected channels\)/,
  );
  assert.match(html, /High priority/);
  assert.match(html, /Next step: <\/span>/);
  // (The router writes the string "1" JSON-quoted, and reads it back as "1".)
  // (Phase 3B-1: with the period the suggestion was made over, for "Back to video".)
  assert.match(html, /href="\/link-tracking\?video=vidTHIS0001&amp;create=%221%22&amp;range=3M"/);
  assert.match(html, /href="\/analytics"/);
  assert.match(html, /href="#brand-deals"/);
  assert.match(html, /Median RPM of 5 other workspace videos, same days/);
});

test("section: loading, error, restricted, empty and insufficient states say what they mean", () => {
  assert.match(render({ status: "loading" }), /aria-label="Loading opportunities"/);
  assert.match(
    render({ status: "error" }),
    /We couldn&#x27;t work out this video&#x27;s opportunities/,
  );
  assert.match(render({ status: "restricted" }), /aren&#x27;t available for your account/);
  const empty = render(ready(evaluateOpportunities(inputs({}, { rpm: 5, views: 3_000 }))));
  assert.match(empty, /data-testid="opportunities-empty"/);
  const insufficient = render(
    ready(evaluateOpportunities({ ...inputs(), video: null, workspace: [] })),
  );
  assert.match(insufficient, /data-testid="opportunities-insufficient"/);
  assert.match(insufficient, /Not checked for this video:/);
  const hidden = render(
    ready(evaluateOpportunities(inputs({ revenueVisible: false }, { rpm: null }))),
  );
  assert.match(hidden, /Revenue per view: hidden by your workspace&#x27;s revenue settings/);
  for (const html of [empty, insufficient, hidden]) assert.doesNotMatch(html, /\$\d/);
});

test("wiring: the section follows Revenue sources on the video page, on its own request; the other sections are untouched", () => {
  const page = readFileSync("src/routes/videos.$videoId.tsx", "utf8").replace(/\s+/g, " ");
  const sources = page.indexOf("<VideoRevenueSources");
  const opportunities = page.indexOf("<VideoRevenueOpportunities");
  const overview = page.indexOf("<VideoRevenueOverview");
  assert.ok(overview > 0 && overview < sources && sources < opportunities);
  assert.match(
    page,
    // (Phase 3B-1: also asked again after a deal is linked to or unlinked from the video.)
    /<VideoRevenueOpportunities className="mt-5" youtubeVideoId=\{videoId\} range=\{range\} refreshNonce=\{retryNonce \+ dealsNonce\} \/>/,
  );
  assert.equal(
    videoOpportunitiesUrl("vidMINE0000", "3M"),
    "/api/videos/opportunities?videoId=vidMINE0000&days=90",
  );
  assert.equal(videoOpportunitiesUrl("bad", "12M"), null);
  // The Brand deals block is the in-page target of "Link a deal".
  // (Phase 3B-1: one constant, shared with the command center's link to it.)
  assert.match(
    readFileSync("src/components/VideoBrandDealsView.tsx", "utf8"),
    /id=\{BRAND_DEALS_ANCHOR\}/,
  );
  assert.match(
    readFileSync("src/lib/revenue-actions.ts", "utf8"),
    /export const BRAND_DEALS_ANCHOR = "brand-deals";/,
  );
  // The overview, sources and deals components do not depend on the new section.
  for (const file of [
    "src/components/VideoRevenueOverview.tsx",
    "src/components/VideoRevenueSources.tsx",
    "src/components/VideoBrandDeals.tsx",
  ])
    assert.doesNotMatch(readFileSync(file, "utf8"), /opportunit/i, file);
});

test("endpoint: a low-RPM video is flagged for the owner from stored data, and never for a restricted member", async () => {
  const f = world();
  // The 100k-view video earned $1 per 1,000 views; the others $5.
  const row = f.w.video_daily_stats!.find((r) => r.video_id === f.videos[0].id)!;
  Object.assign(row, { estimated_revenue_usd: "100", ad_revenue_usd: "100" });
  const owner = await ask(f, "owner", "?videoId=vidMINE0000&days=90");
  assert.equal(dataOf(owner).checks.revenue, "checked");
  const low = dataOf(owner).opportunities.find((o) => o.type === "investigate_low_rpm")!;
  assert.equal(low.priority, "high");
  assert.deepEqual(
    low.evidence.slice(0, 2).map((e) => e.value),
    ["$1.00", "$5.00"],
  );
  const editor = await ask(f, "editor", "?videoId=vidMINE0000&days=90");
  assert.ok(!dataOf(editor).opportunities.some((o) => o.type.includes("rpm")));
  assert.doesNotMatch(editor.text, /\$/);
  // With revenue visible to editors, the same suggestion appears for them.
  const g = world({ editor: true });
  Object.assign(
    g.w.video_daily_stats!.find((r) => r.video_id === g.videos[0].id)!,
    {
      estimated_revenue_usd: "100",
      ad_revenue_usd: "100",
    },
  );
  const allowed = await ask(g, "editor", "?videoId=vidMINE0000&days=90");
  assert.ok(dataOf(allowed).opportunities.some((o) => o.type === "investigate_low_rpm"));
});

// ============================================================
// Phase 2C-1: Getting Started
// ============================================================

const steps = (result: OpportunityResult) => result.gettingStarted.map((s) => s.type);
/** A small creator: every video under 1,000 views, nothing measured, no deals, every feature on,
 * no lead magnet yet. */
const smallCreator = (overrides: Partial<OpportunityInputs> = {}) =>
  inputs(
    {
      workspace: [120, 300, 80, 640, 15, 900].map((views, i) => ({
        isThisVideo: i === 0,
        views,
        rpm: 2,
        availability: "provisional" as const,
      })),
      links: { status: "checked", currentLinks: 0, clicks: 0 },
      deals: {
        status: "checked",
        linkedContracted: 0,
        linkedAny: 0,
        unlinkedContracted: 0,
        canLink: true,
      },
      setup: {
        linkTracking: true,
        leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
        brandDeals: true,
      },
      ...overrides,
    },
    { views: 120, rpm: 2, availability: "provisional" },
  );

test("small creator: no performance findings, but three setup steps — and performance says 'insufficient data'", () => {
  const result = evaluateOpportunities(smallCreator());
  assert.deepEqual(result.opportunities, []);
  assert.equal(result.performance, "insufficient_data");
  assert.deepEqual(steps(result), [
    "track_viewer_interest",
    "explore_lead_capture",
    "prepare_sponsorship_attribution",
  ]);
  assert.deepEqual(
    result.gettingStarted.map((s) => s.action),
    [
      { label: "Create a tracked link", href: "/link-tracking?video=vidTHIS0001&create=1" },
      { label: "Create a lead magnet", href: "/freebie" },
      { label: "Open Brand Deals", href: "/brand-deals" },
    ],
  );
  // Setup steps carry no priority and no evidence, and claim nothing about results.
  for (const step of result.gettingStarted) {
    assert.deepEqual(Object.keys(step).sort(), [
      "action",
      "explanation",
      "nextStep",
      "title",
      "type",
    ]);
    assert.doesNotMatch(
      step.explanation + step.title,
      /\$|viewers (are|have) click|clicked|leads? (came|from this)|converted|earned|paid|is sponsored/i,
    );
  }
  assert.match(result.gettingStarted[0].explanation, /This video has no tracked link yet/);
  assert.match(result.gettingStarted[2].explanation, /doesn't mean a sponsorship exists/);
});

test("setup steps already done are left out; one that cannot be known to be done is left out too", () => {
  // The video has a tracked link, or clicks from a link since moved: no "start measuring".
  for (const links of [
    { status: "checked" as const, currentLinks: 1, clicks: 0 },
    { status: "checked" as const, currentLinks: 0, clicks: 3 },
    { status: "unavailable" as const },
  ])
    assert.ok(
      !steps(evaluateOpportunities(smallCreator({ links }))).includes("track_viewer_interest"),
      JSON.stringify(links),
    );
  // The workspace already has a lead magnet, or it could not be read.
  for (const workspaceHasLeadMagnet of [true, null])
    assert.ok(
      !steps(
        evaluateOpportunities(
          smallCreator({
            setup: {
              linkTracking: true,
              leadCapture: { enabled: true, workspaceHasLeadMagnet },
              brandDeals: true,
            },
          }),
        ),
      ).includes("explore_lead_capture"),
    );
  // A deal is already linked to the video (any stage), or the deals could not be read.
  for (const deals of [
    {
      status: "checked" as const,
      linkedContracted: 0,
      linkedAny: 1,
      unlinkedContracted: 0,
      canLink: true,
    },
    { status: "unavailable" as const },
  ])
    assert.ok(
      !steps(evaluateOpportunities(smallCreator({ deals }))).includes(
        "prepare_sponsorship_attribution",
      ),
    );
});

test("a role without the feature gets no step that leads to it", () => {
  const none = evaluateOpportunities(
    smallCreator({
      links: { status: "restricted" },
      deals: { status: "restricted" },
      setup: {
        linkTracking: false,
        leadCapture: { enabled: false, workspaceHasLeadMagnet: null },
        brandDeals: false,
      },
    }),
  );
  assert.deepEqual(none.gettingStarted, []);
  const cases = [
    [
      {
        linkTracking: false,
        leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
        brandDeals: true,
      },
      "track_viewer_interest",
    ],
    [
      {
        linkTracking: true,
        leadCapture: { enabled: false, workspaceHasLeadMagnet: false },
        brandDeals: true,
      },
      "explore_lead_capture",
    ],
    [
      {
        linkTracking: true,
        leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
        brandDeals: false,
      },
      "prepare_sponsorship_attribution",
    ],
  ] as const;
  for (const [setup, missing] of cases) {
    const list = steps(evaluateOpportunities(smallCreator({ setup })));
    assert.ok(!list.includes(missing), missing);
    assert.equal(list.length, 2);
  }
});

test("a setup step never repeats a performance opportunity for the same action", () => {
  // A strong video with no link gets the performance "add a tracked link" — not the setup step.
  const strong = evaluateOpportunities(
    inputs({
      links: { status: "checked", currentLinks: 0, clicks: 0 },
      setup: {
        linkTracking: true,
        leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
        brandDeals: true,
      },
    }),
  );
  assert.ok(strong.opportunities.some((o) => o.type === "add_tracked_link"));
  assert.ok(!steps(strong).includes("track_viewer_interest"));
  // An unlinked contracted deal gives "link a sponsorship" — not "get ready to attribute".
  const bigLinkable = evaluateOpportunities(
    inputs({
      deals: {
        status: "checked",
        linkedContracted: 0,
        linkedAny: 0,
        unlinkedContracted: 1,
        canLink: true,
      },
    }),
  );
  assert.ok(bigLinkable.opportunities.some((o) => o.type === "link_sponsorship"));
  assert.ok(!steps(bigLinkable).includes("prepare_sponsorship_attribution"));
  // Over many combinations: at most three steps, each at most once, never overlapping.
  const overlap: Record<string, string[]> = {
    track_viewer_interest: ["add_tracked_link", "links_without_clicks", "review_link_offer"],
    prepare_sponsorship_attribution: ["link_sponsorship"],
  };
  for (const views of [100, 1_500, 100_000])
    for (const [currentLinks, clicks] of [
      [0, 0],
      [1, 0],
      [0, 30],
    ])
      for (const unlinkedContracted of [0, 1])
        for (const linkedAny of [0, 1]) {
          const result = evaluateOpportunities(
            inputs(
              {
                links: { status: "checked", currentLinks, clicks },
                deals: {
                  status: "checked",
                  linkedContracted: 0,
                  linkedAny,
                  unlinkedContracted,
                  canLink: true,
                },
                setup: {
                  linkTracking: true,
                  leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
                  brandDeals: true,
                },
              },
              { views },
            ),
          );
          const list = steps(result);
          assert.ok(list.length <= 3 && new Set(list).size === list.length);
          for (const step of list)
            for (const covered of overlap[step] ?? [])
              assert.ok(
                !result.opportunities.some((o) => o.type === covered),
                `${step} with ${covered}`,
              );
        }
});

test("performance opportunities are unchanged by the setup steps", () => {
  for (const rpm of [1, 5, 9]) {
    const base = inputs({}, { rpm });
    const withSetup = evaluateOpportunities({
      ...base,
      setup: {
        linkTracking: true,
        leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
        brandDeals: true,
      },
    });
    const without = evaluateOpportunities({
      ...base,
      setup: {
        linkTracking: false,
        leadCapture: { enabled: false, workspaceHasLeadMagnet: null },
        brandDeals: false,
      },
    });
    assert.deepEqual(withSetup.opportunities, without.opportunities);
    assert.deepEqual(withSetup.checks, without.checks);
  }
  // performance: "none" only with enough data and nothing found.
  assert.equal(evaluateOpportunities(inputs({}, { rpm: 5 })).performance, "none");
  assert.equal(evaluateOpportunities(inputs({}, { rpm: 1 })).performance, "found");
});

test("nothing stored for the video: setup steps from the role and workspace only, worded without claims about the video", () => {
  const result = evaluateOpportunities(
    smallCreator({
      video: null,
      workspace: [],
      links: { status: "insufficient_data" },
      deals: { status: "insufficient_data" },
    }),
  );
  assert.equal(result.performance, "insufficient_data");
  assert.deepEqual(result.checks, {
    audience: "insufficient_data",
    links: "insufficient_data",
    sponsorships: "insufficient_data",
    revenue: "insufficient_data",
  });
  assert.deepEqual(steps(result), [
    "track_viewer_interest",
    "explore_lead_capture",
    "prepare_sponsorship_attribution",
  ]);
  assert.doesNotMatch(result.gettingStarted[0].explanation, /This video has no tracked link/);
});

test("endpoint: a small creator's video gets setup steps; unknown and other-workspace ids get the identical answer", async () => {
  const f = world();
  f.w.features.push({ id: "feature-freebie", key: "freebie", is_active: true });
  f.w.lead_magnets = [];
  // A small video: a seventh video with 300 views.
  const small = {
    id: uuid(),
    channel_id: f.channel,
    youtube_video_id: "vidSMALL001",
    title: "Small",
    thumbnail: null,
    published_at: "2026-01-01T00:00:00Z",
    status: "active",
  };
  f.w.videos!.push(small);
  f.w.video_daily_stats!.push({
    channel_id: f.channel,
    video_id: small.id,
    day: day(10),
    views: 300,
    watch_minutes: 100,
    estimated_revenue_usd: "1",
    ad_revenue_usd: "1",
    premium_revenue_usd: "0",
  });
  const result = await ask(f, "owner", "?videoId=vidSMALL001&days=90");
  assert.equal(result.status, 200);
  const data = dataOf(result);
  assert.deepEqual(data.opportunities, []);
  assert.equal(data.performance, "insufficient_data");
  assert.deepEqual(
    data.gettingStarted.map((s) => s.type),
    ["track_viewer_interest", "explore_lead_capture", "prepare_sponsorship_attribution"],
  );
  // A lead magnet in the workspace completes that step.
  f.w.lead_magnets.push({ id: uuid(), workspace_id: f.ws, user_id: f.users.owner, title: "Guide" });
  assert.ok(
    !dataOf(await ask(f, "owner", "?videoId=vidSMALL001&days=90")).gettingStarted.some(
      (s) => s.type === "explore_lead_capture",
    ),
  );
  // Another workspace's lead magnet does not.
  const g = world();
  g.w.features.push({ id: "feature-freebie", key: "freebie", is_active: true });
  g.w.lead_magnets = [
    { id: uuid(), workspace_id: g.other, user_id: g.users.stranger, title: "Theirs" },
  ];
  assert.ok(
    dataOf(await ask(g, "owner", "?videoId=vidMINE0005&days=90")).gettingStarted.some(
      (s) => s.type === "explore_lead_capture",
    ),
  );
  // Isolation: unknown and other-workspace ids are indistinguishable, steps included.
  const theirs = await ask(g, "owner", "?videoId=vidTHEIRS01&days=90");
  const unknown = await ask(g, "owner", "?videoId=vidUNKNOWN1&days=90");
  assert.equal(
    theirs.text.replaceAll("vidTHEIRS01", "<asked>"),
    unknown.text.replaceAll("vidUNKNOWN1", "<asked>"),
  );
  assert.ok(dataOf(unknown).gettingStarted.length > 0);
  assert.equal(dataOf(unknown).checks.links, "insufficient_data", "not 'couldn't be loaded'");
  assert.ok(!theirs.reads.some((r) => ["tracking_links", "deal_videos"].includes(String(r.table))));
});

test("endpoint: setup steps follow the role's features, and say nothing about money", async () => {
  const f = world();
  f.w.features.push({ id: "feature-freebie", key: "freebie", is_active: true });
  f.w.lead_magnets = [];
  f.w.role_feature_access.push(
    { role: "editor", feature_id: "feature-links", enabled: false },
    { role: "editor", feature_id: "feature-freebie", enabled: false },
    { role: "editor", feature_id: "feature-deals", enabled: false },
  );
  const editor = await ask(f, "editor", "?videoId=vidMINE0005&days=90");
  assert.deepEqual(dataOf(editor).gettingStarted, []);
  assert.doesNotMatch(editor.text, /\/link-tracking|\/freebie|\/brand-deals/);
  assert.equal(dataOf(editor).checks.links, "restricted");
  // Revenue hidden from the editor: the deal step is offered, with no amount anywhere.
  const g = world();
  const hidden = await ask(g, "editor", "?videoId=vidMINE0005&days=90");
  assert.ok(
    dataOf(hidden).gettingStarted.some((s) => s.type === "prepare_sponsorship_attribution"),
  );
  assert.doesNotMatch(hidden.text, /\$/);
});

test("section: Performance and Getting Started are shown apart; setup steps have no priority", () => {
  const html = render(ready(evaluateOpportunities(smallCreator())));
  assert.match(html, /Performance opportunities/);
  assert.match(html, /data-testid="opportunities-insufficient"/);
  assert.match(html, /Performance insights need more data than this video has/);
  assert.doesNotMatch(html, /at 1,000 views|once it reaches/, "no promise of when");
  assert.match(html, /Getting started/);
  assert.equal(html.split('data-testid="getting-started-step"').length - 1, 3);
  assert.doesNotMatch(html.slice(html.indexOf('data-testid="getting-started"')), /priority/i);
  assert.match(html, /href="\/freebie"/);
  // Nothing at all to suggest: one clear message.
  const nothing = render(
    ready(
      evaluateOpportunities(
        smallCreator({
          setup: {
            linkTracking: false,
            leadCapture: { enabled: false, workspaceHasLeadMagnet: null },
            brandDeals: false,
          },
        }),
      ),
    ),
  );
  assert.match(nothing, /data-testid="opportunities-nothing"/);
  assert.match(nothing, /There&#x27;s nothing to suggest for this video right now\./);
  // An older response without the new fields still renders.
  const legacy = response(evaluateOpportunities(inputs({}, { rpm: 1 })));
  delete (legacy.data as Partial<typeof legacy.data>).gettingStarted;
  delete (legacy.data as Partial<typeof legacy.data>).performance;
  assert.match(
    render({ status: "ready", response: legacy, refreshing: false }),
    /This video earns less per view/,
  );
});
