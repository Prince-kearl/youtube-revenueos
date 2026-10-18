import {
  addMember,
  addUser,
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
  MAX_OPPORTUNITIES,
  pickWorkspaceOpportunities,
  sponsorshipsByCurrency,
  type CommandCenterResponse,
} from "../src/lib/server/command-center";
import {
  evaluateOpportunities,
  workspaceComparisons,
  type OpportunityResult,
} from "../src/lib/revenue-opportunities";
import { MAX_CLICK_EVENTS } from "../src/lib/server/video-link-activity";
import { sponsorshipText, youtubeRevenueText } from "../src/lib/command-center-view";
import {
  RevenueCommandCenterContent,
  type CommandCenterState,
} from "../src/components/RevenueCommandCenterView";

// Phase 3A: the Revenue command center on the dashboard. The aggregation rules are pure and
// tested directly; the endpoint runs against the in-memory database with two workspaces; the
// section is rendered to HTML for each state.

const route = await import("../src/routes/api.revenue.command-center");

// ============================================================
// Sponsorships: by currency, each deal once
// ============================================================

test("sponsorships: contracted and completed only, each deal counted once however many videos it covers, currencies apart", () => {
  const deals = [
    { id: "d1", stage: "contracted", currency: "USD" }, // linked to two videos
    { id: "d2", stage: "completed", currency: "usd " }, // not linked
    { id: "d3", stage: "contracted", currency: "EUR" }, // linked
    { id: "d4", stage: "negotiating", currency: "USD" }, // pipeline: never counted
    { id: "d5", stage: "contracted", currency: null },
  ];
  const values = new Map<string, number | null>([
    ["d1", 1000],
    ["d2", 500.5],
    ["d3", 300],
    ["d4", 999],
    ["d5", 7],
  ]);
  const rows = sponsorshipsByCurrency(deals, new Set(["d1", "d3"]), values);
  assert.deepEqual(rows, [
    { currency: "EUR", attributed: 300, unattributed: 0, attributedDeals: 1, unattributedDeals: 0 },
    {
      currency: "UNKNOWN",
      attributed: 0,
      unattributed: 7,
      attributedDeals: 0,
      unattributedDeals: 1,
    },
    {
      currency: "USD",
      attributed: 1000,
      unattributed: 500.5,
      attributedDeals: 1,
      unattributedDeals: 1,
    },
  ]);
  // Hidden: the same counts, no amounts at all.
  const hidden = sponsorshipsByCurrency(deals, new Set(["d1", "d3"]), null);
  assert.ok(hidden.every((r) => r.attributed === null && r.unattributed === null));
  assert.deepEqual(
    hidden.map((r) => [r.attributedDeals, r.unattributedDeals]),
    [
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  );
  // An amount that cannot be read makes that currency's totals unknown — never smaller.
  const broken = sponsorshipsByCurrency(deals, new Set(["d1"]), new Map([...values, ["d1", null]]));
  assert.equal(broken.find((r) => r.currency === "USD")!.attributed, null);
  assert.equal(broken.find((r) => r.currency === "EUR")!.unattributed, 300);
  // Exact cents.
  const cents = sponsorshipsByCurrency(
    [1, 2, 3].map((n) => ({ id: `c${n}`, stage: "contracted", currency: "USD" })),
    new Set(["c1", "c2", "c3"]),
    new Map([
      ["c1", 0.1],
      ["c2", 0.2],
      ["c3", 0.3],
    ]),
  );
  assert.equal(cents[0].attributed, 0.6);
});

// ============================================================
// Choosing what to show across the workspace
// ============================================================

const opp = (type: string, priority: "high" | "medium" | "low") =>
  ({
    type,
    title: type,
    explanation: "",
    evidence: [],
    nextStep: "",
    action: null,
    priority,
    dataStatus: "complete",
  }) as unknown as OpportunityResult["opportunities"][number];
const step = (type: string) =>
  ({
    type,
    title: type,
    explanation: "",
    nextStep: "",
    action: { label: type, href: `/x/${type}` },
  }) as OpportunityResult["gettingStarted"][number];
const result = (
  opportunities: ReturnType<typeof opp>[],
  gettingStarted: ReturnType<typeof step>[] = [],
): OpportunityResult => ({
  opportunities,
  gettingStarted,
  performance: opportunities.length ? "found" : "insufficient_data",
  checks: { audience: "checked", links: "checked", sponsorships: "checked", revenue: "checked" },
});
const v = (id: string, views: number) => ({ youtubeVideoId: id, title: `Video ${id}`, views });

test("opportunities: high first, then the video with more views; at most two of a kind and five in all", () => {
  const picked = pickWorkspaceOpportunities([
    {
      video: v("small", 2_000),
      result: result([opp("investigate_low_rpm", "high"), opp("link_sponsorship", "low")]),
    },
    {
      video: v("big", 90_000),
      result: result([opp("add_tracked_link", "high"), opp("repeat_high_rpm", "medium")]),
    },
    {
      video: v("mid", 40_000),
      result: result([opp("investigate_low_rpm", "high"), opp("review_link_offer", "medium")]),
    },
    { video: v("other", 30_000), result: result([opp("investigate_low_rpm", "high")]) },
  ]);
  assert.deepEqual(
    picked.opportunities.map((o) => `${o.priority}:${o.type}@${o.video.youtubeVideoId}`),
    [
      "high:add_tracked_link@big",
      "high:investigate_low_rpm@mid",
      "high:investigate_low_rpm@other",
      "medium:repeat_high_rpm@big",
      "medium:review_link_offer@mid",
    ],
  );
  assert.equal(picked.opportunities.length, MAX_OPPORTUNITIES);
  // The third low-RPM video was left out (two of a kind), not the medium ones.
  assert.ok(
    !picked.opportunities.some(
      (o) => o.video.youtubeVideoId === "small" && o.type === "investigate_low_rpm",
    ),
  );
});

test("getting started: each step once; the video step goes to the most viewed video that needs it; none when a link opportunity is already shown", () => {
  const steps = [
    step("track_viewer_interest"),
    step("explore_lead_capture"),
    step("prepare_sponsorship_attribution"),
  ];
  const picked = pickWorkspaceOpportunities([
    { video: v("a", 300), result: result([], steps) },
    { video: v("b", 900), result: result([], steps) },
  ]);
  assert.deepEqual(picked.opportunities, []);
  assert.deepEqual(
    picked.gettingStarted.map((s) => [s.type, s.video?.youtubeVideoId ?? null]),
    [
      ["track_viewer_interest", "b"],
      ["explore_lead_capture", null],
      ["prepare_sponsorship_attribution", null],
    ],
  );
  const withLinkOpp = pickWorkspaceOpportunities([
    { video: v("a", 5_000), result: result([opp("add_tracked_link", "medium")]) },
    { video: v("b", 900), result: result([], steps) },
  ]);
  assert.ok(!withLinkOpp.gettingStarted.some((s) => s.type === "track_viewer_interest"));
});

test("formatting: hidden is 'Hidden', unknown is '—', a genuine zero is $0.00; sponsorships are agreed values", () => {
  assert.equal(youtubeRevenueText(12.5, "available"), "$12.50");
  assert.equal(youtubeRevenueText(0, "available"), "$0.00");
  assert.equal(youtubeRevenueText(null, "unavailable"), "—");
  assert.equal(youtubeRevenueText(5, "hidden"), "Hidden");
  assert.deepEqual(
    sponsorshipText({
      currency: "EUR",
      attributed: 300,
      unattributed: 0,
      attributedDeals: 1,
      unattributedDeals: 0,
    }),
    {
      attributed: "€300.00 linked to videos (1 deal)",
      unattributed: "€0.00 not linked to a video yet (0 deals)",
    },
  );
  assert.match(
    sponsorshipText({
      currency: "USD",
      attributed: null,
      unattributed: null,
      attributedDeals: 2,
      unattributedDeals: 1,
    }).attributed,
    /^Hidden linked to videos \(2 deals\)$/,
  );
});

// ============================================================
// The endpoint
// ============================================================

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const at = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString();

/** W1: two channels, six videos (100k … 2k views; the 100k one earns $1 per 1,000 views, the
 * others $5), one link with clicks on the 50k video, a USD deal linked to two videos, a
 * completed USD deal not linked, a EUR deal linked to one video and a pipeline deal.
 * W2: a video, a link, clicks and a deal of its own — none of which may ever appear. */
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
  const ws = addWorkspace(w, users.owner);
  addMember(w, ws, users.editor, "editor");
  const other = addWorkspace(w, users.stranger);
  Object.assign(
    w.workspaces.find((x) => x.id === ws)!,
    { editor_revenue_visible: flags.editor ?? false, setter_revenue_visible: false },
  );
  Object.assign(
    w.workspaces.find((x) => x.id === other)!,
    { editor_revenue_visible: false, setter_revenue_visible: false },
  );
  const chA = uuid(),
    chB = uuid(),
    chX = uuid();
  w.youtube_channels = [
    {
      id: chA,
      workspace_id: ws,
      youtube_channel_id: "UCa",
      channel_name: "A",
      connection_id: uuid(),
      connected_at: "2026-01-01",
    },
    {
      id: chB,
      workspace_id: ws,
      youtube_channel_id: "UCb",
      channel_name: "B",
      connection_id: uuid(),
      connected_at: "2026-01-02",
    },
    {
      id: chX,
      workspace_id: other,
      youtube_channel_id: "UCx",
      channel_name: "X",
      connection_id: uuid(),
      connected_at: "2026-01-01",
    },
  ];
  const views = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000];
  const vids = views.map((v, i) => ({
    id: uuid(),
    channel: i === 5 ? chB : chA,
    yt: `vidMINE000${i}`,
    views: v,
    rpm: i === 0 ? 1 : 5,
  }));
  const theirs = { id: uuid(), channel: chX, yt: "vidTHEIRS01", views: 900_000, rpm: 9 };
  w.videos = [...vids, theirs].map((v) => ({
    id: v.id,
    channel_id: v.channel,
    youtube_video_id: v.yt,
    title: `Title ${v.yt}`,
    thumbnail: null,
    published_at: "2026-01-01T00:00:00Z",
    status: "active",
  }));
  const stats = (
    channelId: string,
    views: number,
    rpm: number,
    extra: Record<string, unknown> = {},
  ) => ({
    channel_id: channelId,
    day: day(10),
    views,
    watch_minutes: 1,
    estimated_revenue_usd: String((views / 1000) * rpm),
    ad_revenue_usd: String((views / 1000) * rpm),
    premium_revenue_usd: "0",
    ...extra,
  });
  const sumFor = (ch: string) => vids.filter((v) => v.channel === ch);
  w.channel_daily_stats = [
    stats(
      chA,
      sumFor(chA).reduce((a, v) => a + v.views, 0),
      0,
      {
        estimated_revenue_usd: String(
          sumFor(chA).reduce((a, v) => a + (v.views / 1000) * v.rpm, 0),
        ),
        ad_revenue_usd: "0",
      },
    ),
    stats(chB, 2_000, 5),
    stats(chX, 900_000, 9),
  ];
  w.video_daily_stats = [...vids, theirs].map((v) => ({
    ...stats(v.channel, v.views, v.rpm),
    video_id: v.id,
  }));
  w.youtube_sync_state = [];
  const dest = uuid(),
    destX = uuid();
  w.destinations = [
    { id: dest, workspace_id: ws, name: "Course", url: "https://e.test", status: "active" },
    { id: destX, workspace_id: other, name: "X", url: "https://x.test", status: "active" },
  ];
  const link = uuid(),
    linkX = uuid(),
    linkLoose = uuid();
  w.tracking_links = [
    {
      id: link,
      workspace_id: ws,
      destination_id: dest,
      video_id: vids[1].id,
      slug: "c",
      status: "active",
      clicks: 31,
    },
    {
      id: linkLoose,
      workspace_id: ws,
      destination_id: dest,
      video_id: null,
      slug: "bio",
      status: "active",
      clicks: 4,
    },
    {
      id: linkX,
      workspace_id: other,
      destination_id: destX,
      video_id: theirs.id,
      slug: "x",
      status: "active",
      clicks: 500,
    },
  ];
  let n = 1;
  const click = (
    linkId: string,
    videoId: string | null,
    channelId: string | null,
    offset: number,
  ) => ({
    id: n++,
    link_id: linkId,
    video_id: videoId,
    channel_id: channelId,
    destination_id: dest,
    clicked_at: at(offset),
  });
  w.link_click_events = [
    ...Array.from({ length: 30 }, () => click(link, vids[1].id, chA, 5)),
    click(link, vids[1].id, chA, 200), // outside every period but the year
    ...Array.from({ length: 4 }, () => click(linkLoose, null, null, 3)),
    ...Array.from({ length: 50 }, () => click(linkX, theirs.id, chX, 5)),
  ];
  w.tracking_link_stats = [];
  const deal = (
    id: string,
    workspaceId: string,
    stage: string,
    value: string,
    currency: string,
  ) => ({ id, workspace_id: workspaceId, user_id: users.owner, name: id, stage, value, currency });
  const D = { usd: uuid(), done: uuid(), eur: uuid(), pipe: uuid(), theirs: uuid() };
  w.deals = [
    deal(D.usd, ws, "contracted", "1000.00", "USD"),
    deal(D.done, ws, "completed", "500.00", "USD"),
    deal(D.eur, ws, "contracted", "300.00", "EUR"),
    deal(D.pipe, ws, "negotiating", "999.00", "USD"),
    deal(D.theirs, other, "contracted", "77777.00", "USD"),
  ];
  w.deal_videos = [
    { deal_id: D.usd, video_id: vids[0].id, workspace_id: ws, created_at: "2026-09-01T00:00:00Z" },
    { deal_id: D.usd, video_id: vids[1].id, workspace_id: ws, created_at: "2026-09-02T00:00:00Z" },
    { deal_id: D.eur, video_id: vids[2].id, workspace_id: ws, created_at: "2026-09-03T00:00:00Z" },
    {
      deal_id: D.theirs,
      video_id: theirs.id,
      workspace_id: other,
      created_at: "2026-09-01T00:00:00Z",
    },
  ];
  w.lead_magnets = [];
  return { w, users, ws, other, vids, theirs };
}
type F = ReturnType<typeof world>;
const ask = (f: F, who: keyof F["users"] | null, query = "?days=90") =>
  callTeamApi(route, f.w, {
    as: who ? f.users[who] : null,
    method: "GET",
    path: "/api/revenue/command-center",
    query,
  });
const dataOf = (r: CallResult) => r.body.data as CommandCenterResponse["data"];

test("endpoint: YouTube revenue, sponsorships and clicks side by side, for the workspace's own data only", async () => {
  const f = world();
  const r = await ask(f, "owner");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  const d = dataOf(r);
  assert.equal(d.status, "connected");
  assert.equal(d.period.days, 90);
  // YouTube: channel-level, both of the workspace's channels: 100 + 50×5×… = $535 + $10.
  assert.equal(d.youtube.revenue, 100 + 250 + 100 + 50 + 25 + 10);
  assert.equal(d.youtube.views, 187_000);
  // Sponsorships: the two-video USD deal once; the completed one unlinked; EUR on its own; the
  // pipeline deal nowhere; never added to YouTube revenue.
  assert.deepEqual(d.sponsorships, {
    status: "checked",
    byCurrency: [
      {
        currency: "EUR",
        attributed: 300,
        unattributed: 0,
        attributedDeals: 1,
        unattributedDeals: 0,
      },
      {
        currency: "USD",
        attributed: 1000,
        unattributed: 500,
        attributedDeals: 1,
        unattributedDeals: 1,
      },
    ],
    payments: { tracked: false },
  });
  // Clicks: this workspace's links, this period only (the 200-days-old click is outside 90 days).
  assert.equal(d.links.status, "checked");
  if (d.links.status === "checked") {
    assert.deepEqual(
      [d.links.links, d.links.linksOnVideos, d.links.videosWithLinks, d.links.clicks],
      [2, 1, 1, 34],
    );
  }
  // Nothing of the other workspace, anywhere.
  assert.doesNotMatch(r.text, /vidTHEIRS01|77777|900,000|UCx/);
});

test("endpoint: the existing per-video rules decide the suggestions — with actions into the existing workflows", async () => {
  const f = world();
  const d = dataOf(await ask(f, "owner"));
  assert.deepEqual(
    d.opportunities.map((o) => `${o.priority}:${o.type}@${o.video.youtubeVideoId}`),
    [
      // The 100k video: earns least per view, has no tracked link, carries a contracted deal.
      "high:investigate_low_rpm@vidMINE0000",
      "high:add_tracked_link@vidMINE0000",
      // The 50k video's link is being clicked; the 20k one has no link yet.
      "medium:review_link_offer@vidMINE0001",
      "medium:add_tracked_link@vidMINE0002",
      "low:sponsored_video_for_pitch@vidMINE0000",
    ],
  );
  // Exactly what that video's own page would say.
  const lowRpm = d.opportunities[0];
  assert.match(lowRpm.explanation, /\$1\.00, against a median of \$5\.00/);
  assert.equal(
    d.opportunities.find((o) => o.type === "review_link_offer")?.action?.href,
    "/link-tracking?video=vidMINE0001",
  );
  assert.equal(
    d.opportunities.find((o) => o.type === "add_tracked_link")?.action?.href,
    "/link-tracking?video=vidMINE0000&create=1",
  );
  // Videos: most viewed first, with their own figures.
  assert.deepEqual(
    d.videos.map((v) => v.youtubeVideoId),
    ["vidMINE0000", "vidMINE0001", "vidMINE0002", "vidMINE0003", "vidMINE0004", "vidMINE0005"],
  );
  assert.deepEqual(
    d.videos
      .slice(0, 3)
      .map((v) => [v.revenue, v.trackedLinks, v.clicks, v.linkedDeals, v.opportunities]),
    [
      // revenue, links, clicks, deals, suggestions (low RPM + add a link + pitch)
      [100, 0, 0, 1, 3],
      // review the clicked link + pitch (top quarter, contracted deal)
      [250, 1, 30, 1, 2],
      // add a link
      [100, 0, 0, 1, 1],
    ],
  );
  assert.equal(d.videoCount, 6);
});

test("endpoint: a member who may not see revenue gets counts and activity — no amounts, no revenue rule, order by views", async () => {
  const f = world();
  const r = await ask(f, "editor");
  const d = dataOf(r);
  assert.deepEqual(r.body.visibility, { revenue: "hidden" });
  assert.deepEqual(d.youtube, { revenue: null, availability: "hidden", views: 187_000 });
  assert.ok(
    d.sponsorships.status === "checked" &&
      d.sponsorships.byCurrency.every((x) => x.attributed === null && x.unattributed === null),
  );
  assert.ok(d.videos.every((v) => v.revenue === null));
  assert.ok(!d.opportunities.some((o) => o.type.includes("rpm")));
  // No amount anywhere ("value" keys are evidence such as views and clicks, never money).
  assert.doesNotMatch(r.text, /\$|RPM|"(attributed|unattributed|revenue)":\d|77777|"value":"[€$£]/);
  assert.deepEqual(r.refusedMoneyReads, [], "no money column on the member's session");
  // With revenue opened to editors, the same editor sees the amounts.
  const g = world({ editor: true });
  assert.equal(dataOf(await ask(g, "editor")).youtube.revenue, 535);
});

test("endpoint: each part needs its feature; a part that cannot be read is 'unavailable', not zero", async () => {
  const f = world();
  f.w.role_feature_access.push(
    { role: "editor", feature_id: "feature-links", enabled: false },
    { role: "editor", feature_id: "feature-deals", enabled: false },
  );
  const r = await ask(f, "editor");
  const d = dataOf(r);
  assert.deepEqual(d.links, { status: "restricted" });
  assert.deepEqual(d.sponsorships, { status: "restricted" });
  assert.ok(
    !r.reads.some((x) =>
      ["tracking_links", "link_click_events", "deals", "deal_videos"].includes(String(x.table)),
    ),
  );
  assert.doesNotMatch(r.text, /link-tracking|brand-deals/);
  assert.ok(
    d.videos.every((v) => v.trackedLinks === null && v.clicks === null && v.linkedDeals === null),
  );

  const g = world();
  g.w.failingReads = ["link_click_events"];
  const broken = dataOf(await ask(g, "owner"));
  assert.deepEqual(broken.links, { status: "unavailable" });
  assert.ok(broken.videos.every((v) => v.clicks === null));
  assert.ok(
    !broken.opportunities.some((o) => o.type === "add_tracked_link"),
    "a failed read is not 'no links'",
  );
});

test("endpoint: validation, sign-in, periods, a failed core read, and a workspace with no channel", async () => {
  const f = world();
  for (const q of ["?days=30", "?days=abc"])
    assert.equal((await ask(f, "owner", q)).status, 422, q);
  assert.equal(dataOf(await ask(f, "owner", "")).period.days, 90, "90 days by default");
  const half = dataOf(await ask(f, "owner", "?days=180"));
  assert.equal(half.period.days, 180);
  assert.equal(half.links.status === "checked" && half.links.clicks, 34, "the old click is not");
  const year = dataOf(await ask(f, "owner", "?days=365"));
  assert.equal(year.period.days, 365);
  assert.equal(year.links.status === "checked" && year.links.clicks, 35, "it is within a year");
  assert.equal((await ask(f, null)).status, 401);
  f.w.failingReads = ["video_daily_stats"];
  const failed = await ask(f, "owner");
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: "DATABASE_ERROR" });
  const g = world();
  g.w.youtube_channels = g.w.youtube_channels!.filter((c) => c.workspace_id !== g.ws);
  const none = dataOf(await ask(g, "owner"));
  assert.equal(none.status, "not_connected");
  assert.deepEqual(none.videos, []);
  assert.doesNotMatch(JSON.stringify(none), /vidTHEIRS01/);
});

test("endpoint: above the click cap the exact total stays, the per-video breakdown is not read", async () => {
  const f = world();
  const sample = f.w.link_click_events![0]; // an in-period click on the video's link
  const extra = MAX_CLICK_EVENTS - 30 + 1; // 34 in the period already
  f.w.link_click_events!.push(
    ...Array.from({ length: extra }, (_, i) => ({ ...sample, id: 1_000_000 + i })),
  );
  const d = dataOf(await ask(f, "owner"));
  assert.equal(d.links.status === "checked" && d.links.clicks, 34 + extra);
  assert.ok(
    d.videos.every((v) => v.clicks === null),
    "no partial per-video counts",
  );
  assert.ok(
    !d.opportunities.some((o) =>
      ["add_tracked_link", "links_without_clicks", "review_link_offer"].includes(o.type),
    ),
    "no link findings without the breakdown",
  );
});

test("endpoint: a small channel gets setup steps instead of an empty screen", async () => {
  const f = world();
  // Every video under 1,000 views, nothing clicked yet.
  for (const row of f.w.video_daily_stats!) row.views = 120;
  f.w.link_click_events = [];
  // (An unlinked contracted deal would rightly suggest linking it, whatever the views.)
  f.w.deals = f.w.deals!.filter((d) => d.stage !== "completed");
  f.w.features.push({ id: "feature-freebie", key: "freebie", is_active: true });
  const d = dataOf(await ask(f, "owner"));
  assert.deepEqual(d.opportunities, []);
  assert.deepEqual(
    d.gettingStarted.map((s) => s.type),
    // (Some videos have no deal linked, so the sponsorship step applies too.)
    ["track_viewer_interest", "explore_lead_capture", "prepare_sponsorship_attribution"],
  );
  assert.match(d.gettingStarted[0].action.href, /^\/link-tracking\?video=vidMINE000\d&create=1$/);
  assert.equal(d.gettingStarted[1].video, null);
});

// ============================================================
// The section
// ============================================================

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
});
const render = (state: CommandCenterState) =>
  renderToStaticMarkup(
    createElement(
      RouterContextProvider,
      { router },
      createElement(RevenueCommandCenterContent, { state, range: "3M", onRetry: () => {} }),
    ),
  );
const ready = (response: CommandCenterResponse): CommandCenterState => ({
  status: "ready",
  response,
  refreshing: false,
});

test("section: a 'For you' feed — one card per finding, with its video, its facts and one action", async () => {
  const f = world();
  const response = (await ask(f, "owner")).body as unknown as CommandCenterResponse;
  assert.ok(response.data.opportunities.length > 0, "this world has findings");
  const html = render(ready(response));
  assert.match(html, /For you/);
  // One card per finding, each with a dismiss control and a single action.
  const cards = html.split('data-testid="command-center-opportunity"').length - 1;
  assert.equal(cards, response.data.opportunities.length);
  assert.equal(html.split('data-testid="command-center-dismiss"').length - 1, cards);
  assert.match(html, /i\.ytimg\.com\/vi\/vidMINE\d+\/mqdefault\.jpg/, "the video's thumbnail");
  assert.match(html, /href="\/link-tracking\?video=vidMINE0001&amp;range=3M"/);
  // Setup prompts are the onboarding guide's job, not findings.
  assert.doesNotMatch(html, /data-testid="command-center-step"/);
  assert.doesNotMatch(html, />Setup</);
  // Figures appear only where they exist, each on its own — never added together.
  assert.match(html, /€300\.00 linked to videos \(1 deal\)/);
  assert.match(html, />34<!-- --> link clicks|34 link clicks/);
  assert.doesNotMatch(html, /\$1,(535|835)|\$1,535/, "no combined total");
  assert.doesNotMatch(html, /No contracted deals yet|No tracked links yet/);
  // YouTube revenue, trends and the videos table are the KPI cards and the sections below.
  assert.doesNotMatch(html, /YouTube estimated revenue/);
  assert.doesNotMatch(html, /data-testid="command-center-video"/);
  assert.doesNotMatch(html, /aria-label="Period"/, "no second period control");
});

test("section: nothing is shown without a finding — while loading, restricted, not connected or with only setup steps", async () => {
  assert.equal(render({ status: "loading" }), "");
  assert.equal(render({ status: "restricted" }), "");
  const g = world();
  g.w.youtube_channels = g.w.youtube_channels!.filter((c) => c.workspace_id !== g.ws);
  assert.equal(render(ready((await ask(g, "owner")).body as unknown as CommandCenterResponse)), "");
  // Only setup steps (a small channel with nothing to find yet): no panel at all.
  const f = world();
  const response = (await ask(f, "owner")).body as unknown as CommandCenterResponse;
  const setupOnly = {
    ...response,
    data: { ...response.data, opportunities: [] },
  } as CommandCenterResponse;
  assert.equal(render(ready(setupOnly)), "");
  // A failed request says so (and offers a retry) — never an empty or zero feed.
  assert.match(render({ status: "error" }), /We couldn&#x27;t load your suggestions/);
});

test("section: hidden amounts read 'Hidden' for a member who may not see revenue", async () => {
  const f = world();
  const response = (await ask(f, "editor")).body as unknown as CommandCenterResponse;
  const hidden = render(ready(response));
  assert.doesNotMatch(hidden, /\$\d/);
  if (response.data.opportunities.length > 0) assert.match(hidden, /Hidden linked to videos/);
});

test("feed (pure): labels, dismissal for 30 days per suggestion and video, thumbnails", async () => {
  const view = await import("../src/lib/command-center-view");
  assert.equal(view.insightLabel("add_tracked_link"), "Link opportunity");
  assert.equal(view.insightLabel("something_new"), "Suggestion");
  const a = { type: "add_tracked_link", video: { youtubeVideoId: "vidA" } };
  const b = { type: "add_tracked_link", video: { youtubeVideoId: "vidB" } };
  const now = Date.parse("2026-10-17T12:00:00Z");
  assert.equal(view.insightKey(a), "add_tracked_link@vidA");
  // Dismissed a day ago: hidden; the same suggestion for another video is not.
  assert.deepEqual(view.visibleInsights([a, b], { [view.insightKey(a)]: now - 86_400_000 }, now), [
    b,
  ]);
  // Dismissed more than 30 days ago: back, if it still applies.
  assert.deepEqual(
    view.visibleInsights([a, b], { [view.insightKey(a)]: now - 31 * 86_400_000 }, now),
    [a, b],
  );
  assert.equal(view.videoThumbnailUrl("abc 123"), "https://i.ytimg.com/vi/abc%20123/mqdefault.jpg");
  // Dismissals live on this device under the prefix sign-out clears.
  const component = readFileSync("src/components/RevenueCommandCenterView.tsx", "utf8");
  assert.match(component, /const DISMISSED_KEY = "yroos\.insights\.dismissed";/);
});

test("wiring: on the dashboard on its own request; the video pages are untouched", () => {
  const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");
  assert.match(dashboard, /<RevenueCommandCenter \/>/);
  for (const file of [
    "src/routes/videos.$videoId.tsx",
    "src/components/VideoRevenueOverview.tsx",
    "src/components/VideoRevenueSources.tsx",
    "src/components/VideoRevenueOpportunities.tsx",
  ])
    assert.doesNotMatch(readFileSync(file, "utf8"), /command-center|CommandCenter/, file);
  // The per-video suggestions come from the same rules the video pages use.
  assert.match(
    readFileSync("src/lib/server/command-center.ts", "utf8"),
    /evaluateOpportunities\(inputs, shared\)/,
  );
  void evaluateOpportunities;
});

test("rules: the shared, sorted-once comparisons give exactly the per-call result", () => {
  // A seeded generator, so a failure can be reproduced.
  let seed = 7;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const availabilities = ["complete", "provisional", "partial", "unavailable"] as const;
  for (let round = 0; round < 60; round++) {
    const size = 1 + Math.floor(rand() * 40);
    const workspace = Array.from({ length: size }, () => ({
      isThisVideo: false,
      // Repeated views and RPMs on purpose: removing "this video's" value must take one only.
      views: [0, 500, 1_000, 1_000, 4_000, 20_000, 90_000][Math.floor(rand() * 7)],
      rpm: rand() < 0.15 ? null : [0.5, 1, 1, 2.5, 4, 8][Math.floor(rand() * 6)],
      availability: availabilities[Math.floor(rand() * 4)],
    }));
    const shared = workspaceComparisons(workspace);
    for (let i = 0; i < size; i++) {
      const own = workspace[i];
      const inputs: Parameters<typeof evaluateOpportunities>[0] = {
        youtubeVideoId: "vidEQUIV000",
        periodDays: 90,
        video: { views: own.views, rpm: own.rpm, availability: own.availability },
        workspace: workspace.map((w, j) => ({ ...w, isThisVideo: j === i })),
        revenueVisible: rand() < 0.8,
        links: {
          status: "checked",
          currentLinks: rand() < 0.5 ? 0 : 1,
          clicks: rand() < 0.5 ? 0 : 40,
        },
        deals: {
          status: "checked",
          linkedContracted: rand() < 0.7 ? 0 : 1,
          linkedAny: rand() < 0.6 ? 0 : 1,
          unlinkedContracted: rand() < 0.7 ? 0 : 2,
          canLink: true,
        },
        setup: {
          linkTracking: true,
          leadCapture: { enabled: true, workspaceHasLeadMagnet: false },
          brandDeals: true,
        },
      };
      assert.deepEqual(
        evaluateOpportunities(inputs, shared),
        evaluateOpportunities(inputs),
        `round ${round}, video ${i}`,
      );
    }
  }
});

// ============================================================
// Phase 3B-1: actions, their completion and what came of them
// ============================================================

const actions = await import("../src/lib/revenue-actions");
const linkTrackingContext = await import("../src/lib/link-tracking-context");
const { readYoutubeRevenue } = await import("../src/lib/server/command-center");
const { LinkVideoContextBanner } = await import("../src/components/LinkVideoContextBanner");
const workflow = {
  links: await import("../src/routes/api.tracking-links"),
  deals: await import("../src/routes/api.videos.deals"),
  opportunities: await import("../src/routes/api.videos.opportunities"),
};
const userOf = (f: F, who: keyof F["users"]) => f.users[who];
const createTrackedLink = (f: F, who: keyof F["users"], body: Record<string, unknown>) =>
  callTeamApi(workflow.links, f.w, {
    as: userOf(f, who),
    method: "POST",
    path: "/api/tracking-links",
    body,
  });
const linkDeal = (f: F, who: keyof F["users"], body: Record<string, unknown>) =>
  callTeamApi(workflow.deals, f.w, {
    as: userOf(f, who),
    method: "POST",
    path: "/api/videos/deals",
    body,
  });
const videoOpportunities = (f: F, who: keyof F["users"], yt: string, days = 90) =>
  callTeamApi(workflow.opportunities, f.w, {
    as: userOf(f, who),
    method: "GET",
    path: "/api/videos/opportunities",
    query: `?videoId=${yt}&days=${days}`,
  });
const keysOf = (d: CommandCenterResponse["data"]) =>
  d.opportunities.map((o) => `${o.type}@${o.video.youtubeVideoId}`);
const rowOf = (d: CommandCenterResponse["data"], yt: string) =>
  d.videos.find((v) => v.youtubeVideoId === yt)!;
const myDestination = (f: F) =>
  f.w.destinations!.find((d) => d.workspace_id === f.ws)!.id as string;
const theirDestination = (f: F) =>
  f.w.destinations!.find((d) => d.workspace_id === f.other)!.id as string;
const dealId = (f: F, stage: string, currency = "USD") =>
  f.w.deals!.find((d) => d.workspace_id === f.ws && d.stage === stage && d.currency === currency)!
    .id as string;

/** The command center and each video's own page give the same suggestions for the same days. */
async function assertConsistent(f: F, who: keyof F["users"], days = 90) {
  const d = dataOf(await ask(f, who, `?days=${days}`));
  for (const row of d.videos) {
    const own = await videoOpportunities(f, who, row.youtubeVideoId, days);
    assert.equal(own.status, 200, own.text);
    const types = (own.body.data.opportunities as Array<{ type: string }>).map((o) => o.type);
    assert.equal(types.length, row.opportunities, `${row.youtubeVideoId}: suggestion count`);
    for (const o of d.opportunities.filter((x) => x.video.youtubeVideoId === row.youtubeVideoId))
      assert.ok(types.includes(o.type), `${o.type} is on ${row.youtubeVideoId}'s own page too`);
    const step = d.gettingStarted.find((s) => s.video?.youtubeVideoId === row.youtubeVideoId);
    if (step)
      assert.ok(
        (own.body.data.gettingStarted as Array<{ type: string; action: { href: string } }>).some(
          (s) => s.type === step.type && s.action.href === step.action.href,
        ),
      );
  }
  return d;
}

test("actions (pure): where an action leads, and how setup and activity are worded apart", () => {
  // The video page's period from the URL: only the three known ones.
  assert.deepEqual(actions.videoPageSearch({ range: "6M" }), { range: "6M" });
  for (const range of ["7M", "", 6, null, "constructor", "__proto__"])
    assert.deepEqual(actions.videoPageSearch({ range }), {}, String(range));
  assert.equal(actions.rangeForDays(90), "3M");
  assert.equal(actions.rangeForDays(365), "12M");
  assert.equal(actions.rangeForDays(30), undefined);
  // An in-page action ("#brand-deals") from outside the video's page: that video, that block,
  // the same period. A page action stays the page, with its own search.
  assert.deepEqual(actions.actionTarget("#brand-deals", "vidMINE0003", "6M"), {
    kind: "video",
    videoId: "vidMINE0003",
    search: { range: "6M" },
    hash: "brand-deals",
  });
  // A video's links carry the period, so "Back to video" returns to it; other pages do not.
  assert.deepEqual(actions.actionTarget("/link-tracking?video=vidMINE0003&create=1", "x", "3M"), {
    kind: "page",
    to: "/link-tracking",
    search: { video: "vidMINE0003", create: "1", range: "3M" },
  });
  assert.deepEqual(actions.actionTarget("/link-tracking?video=vidMINE0003", "x", undefined), {
    kind: "page",
    to: "/link-tracking",
    search: { video: "vidMINE0003" },
  });
  assert.deepEqual(actions.actionTarget("/brand-deals", "x", "6M"), {
    kind: "page",
    to: "/brand-deals",
    search: undefined,
  });
  // The Link Tracking page keeps a well-formed period only next to a well-formed video.
  const { linkTrackingSearch } = linkTrackingContext;
  assert.deepEqual(linkTrackingSearch({ video: "vidMINE0003", range: "6M" }), {
    video: "vidMINE0003",
    range: "6M",
  });
  assert.deepEqual(linkTrackingSearch({ video: "vidMINE0003", create: "1", range: "12M" }), {
    video: "vidMINE0003",
    create: "1",
    range: "12M",
  });
  for (const range of ["1Y", "", 90, "__proto__", "toString", ["3M"]])
    assert.deepEqual(linkTrackingSearch({ video: "vidMINE0003", range }), { video: "vidMINE0003" });
  assert.deepEqual(linkTrackingSearch({ video: "bad", range: "3M" }), {}, "no video, no period");
  // Completed (exists), none, and unknown (restricted or unreadable) are three different things.
  const p = actions.videoProgress({ trackedLinks: 2, clicks: 0, linkedDeals: null });
  assert.deepEqual(
    [p.trackedLinks.state, p.clicks.state, p.deals.state],
    ["completed", "none", "unknown"],
  );
  assert.equal(p.deals.text, "—", "a part the caller may not use is never 'none'");
  const q = actions.videoProgress({ trackedLinks: 0, clicks: 31, linkedDeals: 1 });
  assert.deepEqual(
    [q.trackedLinks.state, q.clicks.state, q.deals.state],
    ["none", "observed", "completed"],
  );
  assert.match(actions.PROGRESS_NOTE, /interest, not income/);
  assert.match(actions.PROGRESS_NOTE, /agreed, not confirmed as paid/);
  // The Link Tracking page: completion from the links that exist; clicks as activity only.
  assert.deepEqual(actions.linkContextProgress([]), {
    completed: false,
    text: "This video has no tracked link yet.",
    activity: null,
  });
  assert.deepEqual(actions.linkContextProgress([{ clicks: 0 }]), {
    completed: true,
    text: "This video has 1 tracked link.",
    activity: "No clicks recorded yet.",
  });
  const busy = actions.linkContextProgress([{ clicks: 30 }, { clicks: 1 }]);
  assert.equal(busy.text, "This video has 2 tracked links.");
  assert.equal(busy.activity, "31 clicks recorded on them so far — interest, not income.");
  for (const text of [actions.PROGRESS_NOTE, busy.text, busy.activity ?? ""])
    assert.doesNotMatch(text, /\$|earned|revenue from|ROI|uplift|conversion/i);
});

test("workflow: creating a tracked link completes 'add a tracked link' for that video — in the command center and on its page", async () => {
  const f = world();
  const before = await assertConsistent(f, "owner");
  assert.ok(keysOf(before).includes("add_tracked_link@vidMINE0000"));
  assert.deepEqual(
    [rowOf(before, "vidMINE0000").trackedLinks, rowOf(before, "vidMINE0000").clicks],
    [0, 0],
  );
  const created = await createTrackedLink(f, "owner", {
    destinationId: myDestination(f),
    videoId: f.vids[0].id,
  });
  assert.ok(created.status === 200 || created.status === 201, created.text);
  // The suggestion is gone because the link now exists — asked again, from persisted data.
  const after = await assertConsistent(f, "owner");
  assert.ok(!keysOf(after).includes("add_tracked_link@vidMINE0000"));
  assert.deepEqual(
    [rowOf(after, "vidMINE0000").trackedLinks, rowOf(after, "vidMINE0000").clicks],
    [1, 0],
    "completed (a link exists), but no activity yet: zero clicks is not an outcome",
  );
  const own = await videoOpportunities(f, "owner", "vidMINE0000");
  assert.ok(
    !(own.body.data.opportunities as Array<{ type: string }>).some(
      (o) => o.type === "add_tracked_link",
    ),
  );
  // The same suggestion for another video is untouched: completion is per video.
  assert.ok(keysOf(after).includes("add_tracked_link@vidMINE0002"));
  // The other workspace sees nothing of it.
  const theirs = dataOf(await ask(f, "stranger"));
  assert.doesNotMatch(JSON.stringify(theirs), /vidMINE/);
});

test("workflow: a refused or failed save completes nothing, and a cancelled one sends nothing", async () => {
  const f = world();
  const before = dataOf(await ask(f, "owner"));
  const linksBefore = f.w.tracking_links!.length;
  // Another workspace's destination, another workspace's video, an unknown video: each answers
  // as if it did not exist, and nothing is written.
  for (const body of [
    { destinationId: theirDestination(f), videoId: f.vids[0].id },
    { destinationId: myDestination(f), videoId: f.theirs.id },
    { destinationId: myDestination(f), videoId: uuid() },
  ]) {
    const refused = await createTrackedLink(f, "owner", body);
    assert.ok(refused.status >= 400, refused.text);
    assert.equal(refused.writes.length, 0, JSON.stringify(body));
  }
  // A save the database refuses.
  f.w.refuseWrites = { tracking_links: "23514" };
  const failed = await createTrackedLink(f, "owner", {
    destinationId: myDestination(f),
    videoId: f.vids[0].id,
  });
  assert.ok(failed.status >= 400, failed.text);
  f.w.refuseWrites = {};
  assert.equal(f.w.tracking_links!.length, linksBefore);
  const after = dataOf(await ask(f, "owner"));
  assert.deepEqual(keysOf(after), keysOf(before));
  assert.deepEqual(after.videos, before.videos);
  // Opening and closing the creation dialog is not a state anywhere: the Link Tracking banner's
  // completion comes from the links the server listed, and nothing else.
  const banner = (links: Array<{ clicks: number }> | null, justCreated = false) =>
    renderToStaticMarkup(
      createElement(
        RouterContextProvider,
        { router },
        createElement(LinkVideoContextBanner, {
          context: {
            status: "valid",
            video: { id: f.vids[0].id, youtubeVideoId: "vidMINE0000", title: "T" },
          },
          justCreated,
          onCreate: () => {},
          links,
        }),
      ),
    );
  assert.match(banner([]), /data-state="available"/);
  assert.match(banner([]), /no tracked link yet/);
  assert.doesNotMatch(banner(null), /link-context-progress/, "not known yet: nothing is claimed");
  assert.match(banner([{ clicks: 0 }]), /data-state="completed"/);
  assert.match(banner([{ clicks: 12 }]), /12 clicks recorded on it so far — interest, not income/);
  // "Back to video" returns to the period it came from, or to the page's default without one.
  const back = (range?: "3M" | "6M" | "12M") =>
    renderToStaticMarkup(
      createElement(
        RouterContextProvider,
        { router },
        createElement(LinkVideoContextBanner, {
          context: {
            status: "valid",
            video: { id: f.vids[0].id, youtubeVideoId: "vidMINE0000", title: "T" },
          },
          justCreated: false,
          onCreate: () => {},
          links: [],
          range,
        }),
      ),
    );
  assert.match(
    back("6M"),
    /data-testid="link-context-back" href="\/videos\/vidMINE0000\?range=6M"/,
  );
  assert.match(back(), /data-testid="link-context-back" href="\/videos\/vidMINE0000"/);
});

test("workflow: linking a deal attributes it to the video — each deal once, currencies apart, agreed not paid", async () => {
  const f = world();
  const before = await assertConsistent(f, "owner");
  const usd = (d: CommandCenterResponse["data"]) =>
    d.sponsorships.status === "checked"
      ? d.sponsorships.byCurrency.find((r) => r.currency === "USD")
      : undefined;
  const eur = (d: CommandCenterResponse["data"]) =>
    d.sponsorships.status === "checked"
      ? d.sponsorships.byCurrency.find((r) => r.currency === "EUR")
      : undefined;
  assert.deepEqual(usd(before), {
    currency: "USD",
    attributed: 1000,
    unattributed: 500,
    attributedDeals: 1,
    unattributedDeals: 1,
  });
  const beforeOwn = await videoOpportunities(f, "owner", "vidMINE0003");
  assert.ok(
    (beforeOwn.body.data.opportunities as Array<{ type: string; action: { href: string } }>).some(
      (o) => o.type === "link_sponsorship" && o.action.href === "#brand-deals",
    ),
    "the video's page offers to link the unlinked contracted deal, at its Brand deals block",
  );
  // The existing association workflow, on the video's own page.
  const linked = await linkDeal(f, "owner", {
    videoId: "vidMINE0003",
    dealId: dealId(f, "completed"),
  });
  assert.equal(linked.status, 201, linked.text);
  const after = await assertConsistent(f, "owner");
  assert.deepEqual(usd(after), {
    currency: "USD",
    attributed: 1500,
    unattributed: 0,
    attributedDeals: 2,
    unattributedDeals: 0,
  });
  assert.deepEqual(eur(after), eur(before), "another currency is never touched or merged");
  assert.equal(rowOf(after, "vidMINE0003").linkedDeals, 1);
  assert.deepEqual(after.sponsorships.status === "checked" && after.sponsorships.payments, {
    tracked: false,
  });
  const afterOwn = await videoOpportunities(f, "owner", "vidMINE0003");
  assert.ok(
    !(afterOwn.body.data.opportunities as Array<{ type: string }>).some(
      (o) => o.type === "link_sponsorship",
    ),
    "no deal is left unlinked: the suggestion is gone everywhere",
  );
  assert.ok(!keysOf(after).some((k) => k.startsWith("link_sponsorship@")));
  // Linking the same deal to a second video splits it — the deal is still counted once.
  await linkDeal(f, "owner", { videoId: "vidMINE0004", dealId: dealId(f, "completed") });
  assert.deepEqual(usd(dataOf(await ask(f, "owner"))), usd(after));
  // A member who may not see revenue still sees no amount after the change.
  const hidden = await ask(f, "editor");
  assert.doesNotMatch(hidden.text, /1500|"attributed":\d|"unattributed":\d|\$/);
});

test("workflow: a role without the feature gets no action into it and cannot complete it there", async () => {
  const f = world();
  f.w.role_feature_access.push(
    { role: "editor", feature_id: "feature-links", enabled: false },
    { role: "editor", feature_id: "feature-deals", enabled: false },
  );
  const d = await ask(f, "editor");
  assert.doesNotMatch(d.text, /link-tracking|brand-deals/);
  const link = await createTrackedLink(f, "editor", {
    destinationId: myDestination(f),
    videoId: f.vids[0].id,
  });
  assert.equal(link.status, 403);
  assert.equal(link.writes.length, 0);
  const deal = await linkDeal(f, "editor", {
    videoId: "vidMINE0003",
    dealId: dealId(f, "completed"),
  });
  assert.equal(deal.status, 403);
  assert.equal(deal.writes.length, 0);
  // With the features but without the right to see revenue: no "link a deal" suggestion — it
  // would rest on contracted deals the member may not act on — and linking is refused.
  const g = world();
  assert.ok(!keysOf(dataOf(await ask(g, "editor"))).some((k) => k.startsWith("link_sponsorship")));
  const refused = await linkDeal(g, "editor", {
    videoId: "vidMINE0003",
    dealId: dealId(g, "completed"),
  });
  assert.ok(refused.status >= 400, refused.text);
  assert.equal(refused.writes.length, 0);
  // Another workspace's deal on my video, my deal on their video: refused, nothing written.
  for (const body of [
    { videoId: "vidMINE0003", dealId: g.w.deals!.find((x) => x.workspace_id === g.other)!.id },
    { videoId: "vidTHEIRS01", dealId: dealId(g, "completed") },
  ]) {
    const r = await linkDeal(g, "owner", body);
    assert.ok(r.status >= 400, r.text);
    assert.equal(r.writes.length, 0);
  }
});

test("section: the 'link a deal' action leads to the video's own Brand deals block, over the same days", () => {
  const response: CommandCenterResponse = {
    data: {
      status: "connected",
      period: { days: 180, startDate: "2026-04-01", endDate: "2026-09-27" },
      youtube: { revenue: 10, availability: "available", views: 100 },
      sponsorships: { status: "checked", byCurrency: [], payments: { tracked: false } },
      links: {
        status: "checked",
        links: 1,
        linksOnVideos: 1,
        videosWithLinks: 1,
        clicks: 3,
        period: { startDate: "2026-04-01", endDate: "2026-09-28" },
      },
      opportunities: [
        {
          type: "link_sponsorship",
          title: "Link a sponsorship",
          explanation: "x",
          nextStep: "y",
          priority: "medium",
          dataStatus: "complete",
          evidence: [],
          action: { label: "Link a deal", href: "#brand-deals" },
          video: { youtubeVideoId: "vidMINE0003", title: "T3" },
        } as unknown as CommandCenterResponse["data"]["opportunities"][number],
      ],
      gettingStarted: [],
      videos: [
        {
          youtubeVideoId: "vidMINE0003",
          title: "T3",
          views: 100,
          revenue: 10,
          revenueAvailability: "complete",
          trackedLinks: 1,
          clicks: 3,
          linkedDeals: 0,
          opportunities: 1,
        },
      ],
      videoCount: 1,
    },
    visibility: { revenue: "visible" },
  };
  const html = render(ready(response));
  assert.match(html, /href="\/videos\/vidMINE0003\?range=6M#brand-deals"[^>]*>Link a deal/);
  assert.match(html, /href="\/videos\/vidMINE0003\?range=6M"/, "video links keep the period");
});

test("performance: the two revenue reads run side by side, and either failing fails the answer", async () => {
  const started: string[] = [];
  const release: Array<() => void> = [];
  const gate = <T>(name: string, value: T) =>
    new Promise<T>((resolve) => {
      started.push(name);
      release.push(() => resolve(value));
    });
  const summary = { earned: {} } as never;
  const videos = { videos: [] } as never;
  const pending = readYoutubeRevenue({} as never, 90, "2026-10-16", {
    buildRevenueSummary: () => gate("summary", summary),
    buildRevenueVideos: () => gate("videos", videos),
  });
  await Promise.resolve();
  assert.deepEqual(started.sort(), ["summary", "videos"], "both started before either finished");
  for (const go of release) go();
  assert.deepEqual(await pending, { summary, revenue: videos });
  // The same period and day for both.
  const seen: unknown[] = [];
  await readYoutubeRevenue({} as never, 180, "2026-10-16", {
    buildRevenueSummary: async (_c, q, o) => (seen.push(["s", q.days ?? q, o]), summary),
    buildRevenueVideos: async (_c, q, o) => (seen.push(["v", q.startDate, q.endDate, o]), videos),
  });
  assert.equal(seen.length, 2);
  await assert.rejects(
    readYoutubeRevenue({} as never, 90, "2026-10-16", {
      buildRevenueSummary: async () => summary,
      buildRevenueVideos: async () => {
        throw new Error("read failed");
      },
    }),
    /read failed/,
  );
  // The endpoint still answers 500 on a failed revenue read (see above), and the optimized,
  // sorted-once opportunity evaluation is still the one used.
  assert.match(
    readFileSync("src/lib/server/command-center.ts", "utf8"),
    /evaluateOpportunities\(inputs, shared\)/,
  );
});

test("wiring: the video page opens at the period it is given and asks for its suggestions again after a deal change", () => {
  const page = readFileSync("src/routes/videos.$videoId.tsx", "utf8");
  assert.match(page, /validateSearch: videoPageSearch/);
  assert.match(page, /useState<Range>\(searchRange \?\? "12M"\)/, "12M stays the default");
  assert.match(page, /onDealsChanged=\{\(\) => setDealsNonce/);
  assert.match(page, /refreshNonce=\{retryNonce \+ dealsNonce\}/);
  const deals = readFileSync("src/components/VideoBrandDeals.tsx", "utf8");
  // Only a saved change calls back: after the refreshed block is shown, never on failure.
  const success = deals.indexOf("onChanged?.();");
  assert.ok(success > deals.indexOf("toast.success(") && success < deals.indexOf("return true;"));
  assert.equal(deals.split("onChanged?.()").length - 1, 1);
  const links = readFileSync("src/routes/link-tracking.tsx", "utf8");
  assert.match(
    links,
    /links=\{context\.status === "valid" && pageStatus === "ready" \? links : null\}/,
  );
});
