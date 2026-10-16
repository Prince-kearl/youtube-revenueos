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
  linkTrackingSearch,
  splitActionHref,
  trackingLinksListUrl,
  videoChoices,
} from "../src/lib/link-tracking-context";
import { evaluateOpportunities, trackedLinksHref } from "../src/lib/revenue-opportunities";
import {
  LinkVideoContextBanner,
  type VideoContextState,
} from "../src/components/LinkVideoContextBanner";

// Phase 2D-1: a video's tracked-link opportunities lead straight into creating (or reviewing)
// that video's tracked links, through the existing Link Tracking page, dialog and API — and the
// opportunity goes away only once a link really exists for the video.

const routes = {
  links: await import("../src/routes/api.tracking-links"),
  opportunities: await import("../src/routes/api.videos.opportunities"),
  activity: await import("../src/routes/api.videos.link-activity"),
  redirect: await import("../src/routes/r.$slug"),
};

// ============================================================
// The context in the URL (untrusted)
// ============================================================

test("URL context: only a well-formed YouTube id is kept; 'create' only with it", () => {
  assert.deepEqual(linkTrackingSearch({ video: "vidMINE0001" }), { video: "vidMINE0001" });
  // The router writes "1" JSON-quoted and reads it back as "1"; a hand-typed ?create=1 is 1.
  assert.deepEqual(linkTrackingSearch({ video: "vidMINE0001", create: "1" }), {
    video: "vidMINE0001",
    create: "1",
  });
  assert.deepEqual(linkTrackingSearch({ video: "vidMINE0001", create: 1 }), {
    video: "vidMINE0001",
    create: "1",
  });
  assert.deepEqual(linkTrackingSearch({ video: "vidMINE0001", create: "yes" }), {
    video: "vidMINE0001",
  });
  for (const bad of [
    "",
    "short",
    "vidMINE0001x",
    "../../admin",
    "<script>",
    12345678901,
    null,
    ["vidMINE0001"],
  ])
    assert.deepEqual(linkTrackingSearch({ video: bad, create: "1" }), {}, String(bad));
  assert.deepEqual(linkTrackingSearch({}), {});
  assert.equal(trackingLinksListUrl(undefined), "/api/tracking-links");
  assert.equal(trackingLinksListUrl("vidMINE0001"), "/api/tracking-links?video=vidMINE0001");
  assert.deepEqual(splitActionHref("/link-tracking?video=vidMINE0001&create=1"), {
    to: "/link-tracking",
    search: { video: "vidMINE0001", create: "1" },
  });
  assert.deepEqual(splitActionHref("/brand-deals"), { to: "/brand-deals", search: undefined });
});

test("the creation dialog always offers the chosen video, first, once", () => {
  const listed = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];
  assert.deepEqual(
    videoChoices(listed, { id: "c", title: "C" }).map((v) => v.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    videoChoices(listed, { id: "b", title: "B" }).map((v) => v.id),
    ["a", "b"],
  );
  assert.deepEqual(
    videoChoices(listed, null).map((v) => v.id),
    ["a", "b"],
  );
  assert.deepEqual(
    videoChoices([], { id: "c", title: "C" }).map((v) => v.id),
    ["c"],
  );
});

// ============================================================
// The opportunities' actions
// ============================================================

const base = {
  youtubeVideoId: "vidMINE0001",
  periodDays: 90,
  video: { views: 100_000, rpm: 5, availability: "complete" as const },
  workspace: [100_000, 50_000, 20_000, 10_000, 5_000, 2_000].map((views, i) => ({
    isThisVideo: i === 0,
    views,
    rpm: 5,
    availability: "complete" as const,
  })),
  revenueVisible: true,
  deals: {
    status: "checked" as const,
    linkedContracted: 0,
    linkedAny: 1,
    unlinkedContracted: 0,
    canLink: true,
  },
  setup: {
    linkTracking: true,
    leadCapture: { enabled: false, workspaceHasLeadMagnet: null },
    brandDeals: true,
  },
};
const action = (links: Parameters<typeof evaluateOpportunities>[0]["links"], views = 100_000) => {
  const result = evaluateOpportunities({ ...base, links, video: { ...base.video, views } });
  return [...result.opportunities, ...result.gettingStarted].map((o) => [o.type, o.action?.href]);
};

test("create actions open creation for THIS video; review actions show THIS video's links", () => {
  const create = "/link-tracking?video=vidMINE0001&create=1";
  const review = "/link-tracking?video=vidMINE0001";
  assert.equal(trackedLinksHref("vidMINE0001", { create: true }), create);
  assert.equal(trackedLinksHref("vidMINE0001"), review);
  assert.deepEqual(action({ status: "checked", currentLinks: 0, clicks: 0 }), [
    ["add_tracked_link", create],
  ]);
  assert.deepEqual(action({ status: "checked", currentLinks: 0, clicks: 0 }, 300), [
    ["track_viewer_interest", create],
  ]);
  assert.deepEqual(action({ status: "checked", currentLinks: 2, clicks: 0 }), [
    ["links_without_clicks", review],
  ]);
  assert.deepEqual(action({ status: "checked", currentLinks: 1, clicks: 40 }), [
    ["review_link_offer", review],
  ]);
  // An id that would need escaping is escaped (the page re-validates it anyway).
  assert.equal(trackedLinksHref("a&b=c"), "/link-tracking?video=a%26b%3Dc");
});

test("no create action for a role without link tracking", () => {
  const result = evaluateOpportunities({
    ...base,
    links: { status: "restricted" },
    setup: { ...base.setup, linkTracking: false },
  });
  assert.ok(
    ![...result.opportunities, ...result.gettingStarted].some((o) =>
      o.action?.href.includes("link-tracking"),
    ),
  );
});

// ============================================================
// The API and the loop
// ============================================================

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** W1 (owner and an editor) with two videos and a destination; W2 with its own video and
 * destination. `both` is a member of both workspaces. */
function world() {
  const w: World = { ...emptyWorld() };
  w.features.push(
    { id: "feature-links", key: "link_tracking", is_active: true },
    { id: "feature-deals", key: "brand_deals", is_active: true },
  );
  const users = {
    owner: addUser(w, "owner@x.test"),
    editor: addUser(w, "editor@x.test"),
    stranger: addUser(w, "stranger@x.test"),
    both: addUser(w, "both@x.test"),
  };
  const ws = addWorkspace(w, users.owner);
  addMember(w, ws, users.editor, "editor");
  const other = addWorkspace(w, users.stranger);
  addMember(w, ws, users.both, "manager");
  addMember(w, other, users.both, "manager");
  for (const id of [ws, other])
    Object.assign(
      w.workspaces.find((x) => x.id === id)!,
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
  const video = { mine: uuid(), second: uuid(), theirs: uuid() };
  const row = (id: string, channelId: string, yt: string, title: string) => ({
    id,
    channel_id: channelId,
    youtube_video_id: yt,
    title,
    thumbnail: null,
    published_at: "2026-01-01T00:00:00Z",
    status: "active",
  });
  w.videos = [
    row(video.mine, channel, "vidMINE0001", "My first video"),
    row(video.second, channel, "vidMINE0002", "My second video"),
    row(video.theirs, otherChannel, "vidTHEIRS01", "Their secret video"),
  ];
  const stats = (channelId: string, videoId: string | null, views: number) => ({
    channel_id: channelId,
    ...(videoId ? { video_id: videoId } : {}),
    day: day(10),
    views,
    watch_minutes: 10,
    estimated_revenue_usd: "1",
    ad_revenue_usd: "1",
    premium_revenue_usd: "0",
  });
  w.channel_daily_stats = [stats(channel, null, 600), stats(otherChannel, null, 600)];
  w.video_daily_stats = [
    stats(channel, video.mine, 300),
    stats(channel, video.second, 300),
    stats(otherChannel, video.theirs, 600),
  ];
  w.youtube_sync_state = [];
  const destination = { mine: uuid(), theirs: uuid() };
  w.destinations = [
    {
      id: destination.mine,
      workspace_id: ws,
      name: "Course",
      url: "https://example.com/course",
      status: "active",
    },
    {
      id: destination.theirs,
      workspace_id: other,
      name: "Theirs",
      url: "https://x.test",
      status: "active",
    },
  ];
  w.tracking_links = [];
  w.link_click_events = [];
  w.tracking_link_stats = [];
  w.deals = [];
  w.deal_videos = [];
  return { w, users, ws, other, video, destination };
}
type F = ReturnType<typeof world>;
const listLinks = (f: F, as: string, query = "") =>
  callTeamApi(routes.links, f.w, { as, method: "GET", path: "/api/tracking-links", query });
const createLink = (f: F, as: string, body: Record<string, unknown>) =>
  callTeamApi(routes.links, f.w, { as, method: "POST", path: "/api/tracking-links", body });
const opportunities = (f: F, as: string, yt: string) =>
  callTeamApi(routes.opportunities, f.w, {
    as,
    method: "GET",
    path: "/api/videos/opportunities",
    query: `?videoId=${yt}&days=90`,
  });
const activity = (f: F, as: string, yt: string) =>
  callTeamApi(routes.activity, f.w, {
    as,
    method: "GET",
    path: "/api/videos/link-activity",
    query: `?videoId=${yt}&days=90`,
  });
const gsTypes = (r: CallResult) =>
  ((r.body.data as { gettingStarted: Array<{ type: string }> }).gettingStarted ?? []).map(
    (s) => s.type,
  );
const sourcesLinks = (r: CallResult) => (r.body.data as { links: Array<{ slug: string }> }).links;

test("context: this workspace's video is resolved on the server, with its links only", async () => {
  const f = world();
  f.w.tracking_links!.push(
    {
      id: uuid(),
      user_id: f.users.owner,
      workspace_id: f.ws,
      destination_id: f.destination.mine,
      video_id: f.video.mine,
      slug: "for-mine",
      tracking_code: uuid(),
      status: "active",
      clicks: 0,
      created_at: "2026-09-01T00:00:00Z",
    },
    {
      id: uuid(),
      user_id: f.users.owner,
      workspace_id: f.ws,
      destination_id: f.destination.mine,
      video_id: f.video.second,
      slug: "for-second",
      tracking_code: uuid(),
      status: "active",
      clicks: 0,
      created_at: "2026-09-02T00:00:00Z",
    },
  );
  const result = await listLinks(f, f.users.owner, "?video=vidMINE0001");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.video, {
    id: f.video.mine,
    youtubeVideoId: "vidMINE0001",
    title: "My first video",
  });
  assert.deepEqual(
    (result.body.data as Array<{ slug: string }>).map((l) => l.slug),
    ["for-mine"],
  );
  // Without a context: every link, and no "video" key — exactly as before.
  const all = await listLinks(f, f.users.owner);
  assert.equal((all.body.data as unknown[]).length, 2);
  assert.ok(!("video" in all.body));
});

test("context: another workspace's video and an unknown id are the same 'nothing' — no title, no links", async () => {
  const f = world();
  f.w.tracking_links!.push({
    id: uuid(),
    user_id: f.users.stranger,
    workspace_id: f.other,
    destination_id: f.destination.theirs,
    video_id: f.video.theirs,
    slug: "theirs",
    tracking_code: uuid(),
    status: "active",
    clicks: 0,
    created_at: "2026-09-01T00:00:00Z",
  });
  const theirs = await listLinks(f, f.users.owner, "?video=vidTHEIRS01");
  const unknown = await listLinks(f, f.users.owner, "?video=vidUNKNOWN1");
  assert.deepEqual(theirs.body, { data: [], video: null });
  assert.equal(theirs.text, unknown.text);
  assert.doesNotMatch(theirs.text, /secret|theirs/i);
  assert.equal((await listLinks(f, f.users.owner, "?video=not-valid")).status, 422);
});

test("workspace switching: the same id resolves only in the workspace the member is in now", async () => {
  const f = world();
  // `both` is currently in W1 (their first membership).
  assert.equal((await listLinks(f, f.users.both, "?video=vidMINE0001")).body.video !== null, true);
  assert.equal((await listLinks(f, f.users.both, "?video=vidTHEIRS01")).body.video, null);
  // Switch: W2 becomes their workspace.
  const memberships = f.w.workspace_members.filter((m) => m.user_id === f.users.both);
  f.w.workspace_members = [
    ...f.w.workspace_members.filter((m) => m.user_id !== f.users.both),
    ...memberships.reverse(),
  ];
  assert.equal(
    (await listLinks(f, f.users.both, "?video=vidMINE0001")).body.video,
    null,
    "the old video no longer applies",
  );
  assert.ok((await listLinks(f, f.users.both, "?video=vidTHEIRS01")).body.video);
});

test("creating: a link for the video is saved against it; another workspace's video is refused", async () => {
  const f = world();
  const created = await createLink(f, f.users.owner, {
    destinationId: f.destination.mine,
    videoId: f.video.mine,
  });
  assert.equal(created.status, 201);
  assert.equal(f.w.tracking_links!.length, 1);
  assert.equal(f.w.tracking_links![0].video_id, f.video.mine);
  assert.equal(f.w.tracking_links![0].workspace_id, f.ws);
  // A member of both workspaces cannot attach a W2 video to a W1 link — the same 404 as an unknown video.
  for (const videoId of [f.video.theirs, uuid()]) {
    const refused = await createLink(f, f.users.both, {
      destinationId: f.destination.mine,
      videoId,
    });
    assert.equal(refused.status, 404);
    assert.deepEqual(refused.body, { error: "VIDEO_NOT_FOUND" });
  }
  // …nor move an existing link onto one.
  const patch = await callTeamApi(routes.links, f.w, {
    as: f.users.both,
    method: "PATCH",
    path: "/api/tracking-links",
    query: `?id=${f.w.tracking_links![0].id}`,
    body: { videoId: f.video.theirs },
  });
  assert.equal(patch.status, 404);
  assert.equal(f.w.tracking_links![0].video_id, f.video.mine);
  assert.equal(f.w.tracking_links!.length, 1);
  // Creating without a video still works exactly as before.
  const plain = await createLink(f, f.users.owner, { destinationId: f.destination.mine });
  assert.equal(plain.status, 201);
  assert.equal(f.w.tracking_links![1].video_id, null);
});

test("without the link_tracking feature: no context, no creation", async () => {
  const f = world();
  f.w.role_feature_access.push({ role: "editor", feature_id: "feature-links", enabled: false });
  const list = await listLinks(f, f.users.editor, "?video=vidMINE0001");
  assert.equal(list.status, 403);
  assert.doesNotMatch(list.text, /My first video/);
  const create = await createLink(f, f.users.editor, {
    destinationId: f.destination.mine,
    videoId: f.video.mine,
  });
  assert.equal(create.status, 403);
  assert.equal(f.w.tracking_links!.length, 0);
  // And the editor is not offered the creation action for the video.
  const opp = await opportunities(f, f.users.editor, "vidMINE0001");
  assert.doesNotMatch(opp.text, /link-tracking/);
});

test("the loop: the setup step stays until a link exists for the video, then it is gone and the link shows in Revenue sources", async () => {
  const f = world();
  // Before: the step is there, pointing at creation for this video.
  const before = await opportunities(f, f.users.owner, "vidMINE0001");
  assert.ok(gsTypes(before).includes("track_viewer_interest"));
  assert.match(before.text, /\/link-tracking\?video=vidMINE0001&create=1/);
  assert.deepEqual(sourcesLinks(await activity(f, f.users.owner, "vidMINE0001")), []);

  // Opening the page / cancelling the dialog changes nothing (only GETs).
  await listLinks(f, f.users.owner, "?video=vidMINE0001");
  assert.ok(
    gsTypes(await opportunities(f, f.users.owner, "vidMINE0001")).includes("track_viewer_interest"),
  );

  // A failed save (a slug already taken) creates nothing: still there.
  f.w.tracking_links!.push({
    id: uuid(),
    user_id: f.users.owner,
    workspace_id: f.ws,
    destination_id: f.destination.mine,
    video_id: f.video.second,
    slug: "taken",
    tracking_code: uuid(),
    status: "active",
    clicks: 0,
    created_at: "2026-09-01T00:00:00Z",
  });
  f.w.refuseWrites = { tracking_links: "23505" };
  const failed = await createLink(f, f.users.owner, {
    destinationId: f.destination.mine,
    videoId: f.video.mine,
    slug: "taken",
  });
  assert.notEqual(failed.status, 201);
  delete f.w.refuseWrites;
  assert.ok(
    gsTypes(await opportunities(f, f.users.owner, "vidMINE0001")).includes("track_viewer_interest"),
  );

  // A link for ANOTHER video doesn't complete this one.
  assert.ok(
    gsTypes(await opportunities(f, f.users.owner, "vidMINE0001")).includes("track_viewer_interest"),
  );

  // Created for this video: the step is gone, and the link is in Revenue sources — with no clicks.
  assert.equal(
    (
      await createLink(f, f.users.owner, {
        destinationId: f.destination.mine,
        videoId: f.video.mine,
        slug: "my-course",
      })
    ).status,
    201,
  );
  const after = await opportunities(f, f.users.owner, "vidMINE0001");
  assert.ok(!gsTypes(after).includes("track_viewer_interest"));
  const sources = await activity(f, f.users.owner, "vidMINE0001");
  assert.deepEqual(
    sourcesLinks(sources).map((l) => l.slug),
    ["my-course"],
  );
  assert.equal(
    (sources.body.data as { totals: { clicks: number } }).totals.clicks,
    0,
    "no clicks invented",
  );
  // The other video still has its own step.
  assert.ok(
    !gsTypes(await opportunities(f, f.users.owner, "vidMINE0002")).includes(
      "track_viewer_interest",
    ),
    "it has a link already",
  );
});

test("outcome: a real click on the new link is attributed to the video, exactly as before", async () => {
  const f = world();
  await createLink(f, f.users.owner, {
    destinationId: f.destination.mine,
    videoId: f.video.mine,
    slug: "my-course",
  });
  // (The database gives a new link status 'active' by default; the test database does not.)
  f.w.tracking_links!.forEach((link) => (link.status ??= "active"));
  const redirect = await callTeamApi(routes.redirect, f.w, {
    as: null,
    method: "GET",
    path: "/r/my-course",
    params: { slug: "my-course" },
  });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("Location"), "https://example.com/course");
  assert.equal(f.w.link_click_events!.length, 1);
  assert.equal(f.w.link_click_events![0].video_id, f.video.mine);
  // (clicked_at is the database's default, now(); the test database leaves defaults to the test.)
  f.w.link_click_events!.forEach((event) => (event.clicked_at ??= new Date().toISOString()));
  const sources = await activity(f, f.users.owner, "vidMINE0001");
  assert.equal((sources.body.data as { totals: { clicks: number } }).totals.clicks, 1);
});

// ============================================================
// The page
// ============================================================

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/link-tracking"] }),
});
const banner = (context: VideoContextState, justCreated = false) =>
  renderToStaticMarkup(
    createElement(
      RouterContextProvider,
      { router },
      createElement(LinkVideoContextBanner, { context, justCreated, onCreate: () => {} }),
    ),
  );

test("banner: names the confirmed video, links back to it, and confirms a created link", () => {
  assert.equal(banner({ status: "none" }), "");
  assert.match(banner({ status: "loading" }), /Checking the video…/);
  const valid: VideoContextState = {
    status: "valid",
    video: { id: "v1", youtubeVideoId: "vidMINE0001", title: "My first video" },
  };
  const html = banner(valid);
  assert.match(html, /Tracked links for this video/);
  assert.match(html, /My first video/);
  assert.match(html, /href="\/videos\/vidMINE0001"/);
  assert.match(html, /Show all links/);
  assert.doesNotMatch(html, /link-context-created/);
  assert.match(
    banner(valid, true),
    /Link created for this video\. It now shows under Revenue sources/,
  );
  const unavailable = banner({ status: "unavailable" });
  assert.match(unavailable, /isn&#x27;t available in this workspace/);
  assert.doesNotMatch(
    unavailable,
    /href="\/videos\//,
    "no way 'back' to a video the server did not confirm",
  );
});

test("page wiring: context from the URL is validated, confirmed by the server, opened once, then dropped from the URL", () => {
  const page = readFileSync("src/routes/link-tracking.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(page, /validateSearch: linkTrackingSearch/);
  // …and re-applied to what the page reads (the router keeps keys its validator dropped).
  assert.ok(
    page.includes(
      "const search = linkTrackingSearch(Route.useSearch() as Record<string, unknown>);",
    ),
  );
  assert.match(page, /fetch\(trackingLinksListUrl\(videoParam\)/);
  assert.match(
    page,
    /setContext\( ?body\.video \? \{ status: "valid", video: body\.video \} : \{ status: "unavailable" \},? ?\)/,
  );
  assert.match(page, /if \(search\.create !== "1" \|\| context\.status !== "valid"\) return;/);
  assert.match(
    page,
    /navigate\(\{ to: "\/link-tracking", search: \{ video: videoParam \}, replace: true \}\)/,
  );
  assert.match(
    page,
    /defaultVideo=\{ context\.status === "valid" \? \{ id: context\.video\.id, title: context\.video\.title \} : null \}/,
  );
  // Success is shown only when the saved link is really for the video.
  assert.match(
    page,
    /if \(!id && context\.status === "valid" && saved\.video\?\.id === context\.video\.id\) setJustCreated\(true\);/,
  );
  const dialog = readFileSync("src/components/modals/index.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(dialog, /setVideoId\(defaultVideo\?\.id \?\? ""\)/);
  assert.match(
    dialog,
    /if \(!initial && !defaultVideo\) void goToNextOnboardingStep\(navigate, "link"\);/,
  );
  // The video page's action keeps its search parameters through the router.
  const view = readFileSync("src/components/VideoOpportunitiesView.tsx", "utf8").replace(
    /\s+/g,
    " ",
  );
  assert.match(view, /const \{ to, search \} = splitActionHref\(action\.href\);/);
});

test("destinations: a link can only point at a destination of the CURRENT workspace", async () => {
  const f = world();
  // `both` is a member of W1 (current) and W2. W2's destination is refused like an unknown one.
  for (const destinationId of [f.destination.theirs, uuid()]) {
    const refused = await createLink(f, f.users.both, { destinationId, videoId: f.video.mine });
    assert.equal(refused.status, 404);
    assert.deepEqual(refused.body, { error: "DESTINATION_NOT_FOUND" });
    assert.doesNotMatch(refused.text, /Theirs|x\.test/);
    assert.deepEqual(refused.writes, []);
  }
  assert.equal(f.w.tracking_links!.length, 0);
  // Its own destination works, with or without a video.
  assert.equal(
    (
      await createLink(f, f.users.both, {
        destinationId: f.destination.mine,
        videoId: f.video.mine,
      })
    ).status,
    201,
  );
  assert.equal(
    (await createLink(f, f.users.both, { destinationId: f.destination.mine })).status,
    201,
  );
  // An existing link cannot be moved onto the other workspace's destination either…
  const link = f.w.tracking_links![0];
  const patch = (destinationId: string) =>
    callTeamApi(routes.links, f.w, {
      as: f.users.both,
      method: "PATCH",
      path: "/api/tracking-links",
      query: `?id=${link.id}`,
      body: { destinationId },
    });
  for (const destinationId of [f.destination.theirs, uuid()]) {
    const refused = await patch(destinationId);
    assert.equal(refused.status, 404);
    assert.deepEqual(refused.body, { error: "DESTINATION_NOT_FOUND" });
  }
  assert.equal(link.destination_id, f.destination.mine);
  // …while an update that keeps or names its own destination still works.
  assert.equal((await patch(f.destination.mine)).status, 200);
  // After switching to W2, the same member can use W2's destination there — and not W1's.
  const memberships = f.w.workspace_members.filter((m) => m.user_id === f.users.both);
  f.w.workspace_members = [
    ...f.w.workspace_members.filter((m) => m.user_id !== f.users.both),
    ...memberships.reverse(),
  ];
  assert.equal(
    (await createLink(f, f.users.both, { destinationId: f.destination.theirs })).status,
    201,
  );
  assert.equal(
    (await createLink(f, f.users.both, { destinationId: f.destination.mine })).status,
    404,
  );
});
