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

test("section: three sources each with its own unit and caveat, then what to do next, then the videos", async () => {
  const f = world();
  const response = (await ask(f, "owner")).body as unknown as CommandCenterResponse;
  const html = render(ready(response));
  assert.match(html, /YouTube estimated revenue/);
  assert.match(html, /\$535\.00/);
  assert.match(html, /Contracted sponsorships/);
  assert.match(html, /€300\.00 linked to videos \(1 deal\)/);
  assert.match(html, /not payments received, and not limited to this period/);
  assert.match(html, /Tracked-link clicks/);
  assert.match(html, />34</);
  assert.match(html, /Clicks show interest, not income\./);
  assert.match(html, /they are never added together/);
  assert.doesNotMatch(html, /\$1,(535|835)|\$1,535/, "no combined total");
  assert.match(html, /What to do next/);
  assert.match(html, /href="\/link-tracking\?video=vidMINE0001"/);
  assert.match(html, /href="\/videos\/vidMINE0000"/);
  assert.equal(html.split('data-testid="command-center-video"').length - 1, 6);
});

test("section: hidden amounts read 'Hidden'; loading, error, restricted and not-connected states", async () => {
  const f = world();
  const hidden = render(ready((await ask(f, "editor")).body as unknown as CommandCenterResponse));
  assert.match(hidden, /Revenue is hidden by your workspace/);
  assert.doesNotMatch(hidden, /\$\d/);
  assert.match(hidden, /Hidden linked to videos/);
  assert.match(render({ status: "loading" }), /aria-label="Loading the revenue command center"/);
  assert.match(render({ status: "error" }), /We couldn&#x27;t load the revenue command center/);
  assert.match(render({ status: "restricted" }), /isn&#x27;t available for your account/);
  const g = world();
  g.w.youtube_channels = g.w.youtube_channels!.filter((c) => c.workspace_id !== g.ws);
  assert.match(
    render(ready((await ask(g, "owner")).body as unknown as CommandCenterResponse)),
    /Connect a YouTube channel/,
  );
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
