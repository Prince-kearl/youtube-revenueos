import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LINK_ACTIVITY_DAYS,
  LinkActivityValidationError,
  MAX_CLICK_EVENTS,
  linkActivityPeriod,
  parseLinkActivityQuery,
  type VideoLinkActivityResponse,
} from "../src/lib/server/video-link-activity";
import {
  SOURCES_CLICKS_NOTE,
  SOURCES_EMPTY_NOTE,
  SOURCES_FORMER_LINKS_LABEL,
  SOURCES_NOT_CONNECTED_NOTE,
  mapVideoRevenueSources,
  videoLinkActivityUrl,
} from "../src/lib/video-revenue-sources";
import { demoRevenuePeriod } from "../src/lib/demo-revenue";
import {
  addMember,
  addUser,
  addPaidWorkspace,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type World,
} from "./helpers/team-fake-api";

// Phase 2B-1. Tracked-link ACTIVITY per video — never money. These run the real route against a
// database that scopes nothing for it, caps responses and can fail mid-read, so what is pinned
// is the route's own workspace filtering, attribution and completeness.

const route = await import("../src/routes/api.videos.link-activity");

const YT = { a: "AAAAAAAAAA1", b: "BBBBBBBBBB1", foreign: "XXXXXXXXXX1", unknown: "NOSUCHVID01" };

interface Fixture {
  world: World;
  owner: string;
  editor: string;
  setter: string;
  stranger: string;
  workspace: string;
  otherWorkspace: string;
  videos: { a: string; b: string; foreign: string };
  /** The channel of each video, as the redirect records it on a click. */
  channelOf: Record<string, string>;
  destinations: { course: string; shop: string; foreign: string };
}

function fixture(): Fixture {
  const world = emptyWorld();
  world.features.push({ id: uuid(), key: "link_tracking", is_active: true });
  const owner = addUser(world, "owner@example.com");
  const editor = addUser(world, "editor@example.com");
  const setter = addUser(world, "setter@example.com");
  const stranger = addUser(world, "stranger@example.com");
  const workspace = addPaidWorkspace(world, owner);
  addMember(world, workspace, editor, "editor");
  addMember(world, workspace, setter, "setter");
  const otherWorkspace = addPaidWorkspace(world, stranger);
  const channel = uuid();
  const otherChannel = uuid();
  world.youtube_channels = [
    { id: channel, workspace_id: workspace },
    { id: otherChannel, workspace_id: otherWorkspace },
  ];
  const videos = { a: uuid(), b: uuid(), foreign: uuid() };
  world.videos = [
    { id: videos.a, channel_id: channel, youtube_video_id: YT.a },
    { id: videos.b, channel_id: channel, youtube_video_id: YT.b },
    { id: videos.foreign, channel_id: otherChannel, youtube_video_id: YT.foreign },
  ];
  const destinations = { course: uuid(), shop: uuid(), foreign: uuid() };
  world.destinations = [
    { id: destinations.course, workspace_id: workspace, name: "Course", url: "https://c.test" },
    { id: destinations.shop, workspace_id: workspace, name: "Shop", url: "https://s.test" },
    { id: destinations.foreign, workspace_id: otherWorkspace, name: "Theirs", url: "https://x" },
  ];
  world.tracking_links = [];
  world.link_click_events = [];
  const channelOf = { [videos.a]: channel, [videos.b]: channel, [videos.foreign]: otherChannel };
  return {
    channelOf,
    world,
    owner,
    editor,
    setter,
    stranger,
    workspace,
    otherWorkspace,
    videos,
    destinations,
  };
}

let linkNumber = 0;
function link(
  f: Fixture,
  videoId: string | null,
  destinationId: string,
  values: Record<string, unknown> = {},
): string {
  const id = uuid();
  linkNumber += 1;
  f.world.tracking_links!.push({
    id,
    workspace_id: f.workspace,
    video_id: videoId,
    destination_id: destinationId,
    slug: `link-${linkNumber}`,
    status: "active",
    clicks: 0,
    created_at: new Date(Date.UTC(2026, 0, 1) + linkNumber * 60_000).toISOString(),
    ...values,
  });
  return id;
}

let eventNumber = 0;
const DAY = 86_400_000;
/** `count` clicks through `linkId`, recorded against `videoId`, `daysAgo` days ago. */
function clicks(
  f: Fixture,
  linkId: string,
  videoId: string | null,
  count: number,
  options: { daysAgo?: number; visitor?: string | null; at?: string } = {},
) {
  for (let n = 0; n < count; n++)
    f.world.link_click_events!.push({
      // Zero-padded so the fake database's text ordering is the numeric order.
      id: String(++eventNumber).padStart(9, "0"),
      link_id: linkId,
      video_id: videoId,
      channel_id: videoId ? (f.channelOf[videoId] ?? null) : null,
      privacy_id: options.visitor === undefined ? uuid() : options.visitor,
      clicked_at: options.at ?? new Date(Date.now() - (options.daysAgo ?? 1) * DAY).toISOString(),
    });
}

const get = (f: Fixture, as: string | null, videoId: string = YT.a, days: number | string = 90) =>
  callTeamApi(route, f.world, {
    as,
    method: "GET",
    path: "/api/videos/link-activity",
    query: `?videoId=${videoId}&days=${days}`,
  });
const dataOf = (result: { body: Record<string, unknown> }) =>
  result.body.data as VideoLinkActivityResponse;
const readsOf = (result: { reads: Array<{ table: string; method: string }> }, table: string) =>
  result.reads.filter((read) => read.table === table);

// ---------- validation and the period ----------

test("the request: a YouTube video id and one of the three ranges, nothing else", () => {
  const parse = (query: string) => parseLinkActivityQuery(new URL(`https://x.test/a?${query}`));
  assert.deepEqual(LINK_ACTIVITY_DAYS, [90, 180, 365]);
  assert.deepEqual(parse(`videoId=${YT.a}&days=180`), { youtubeVideoId: YT.a, days: 180 });
  for (const bad of [
    `videoId=${YT.a}`,
    `videoId=${YT.a}&days=30`,
    `videoId=${YT.a}&days=91`,
    `videoId=${YT.a}&days=abc`,
    "days=90",
    "videoId=short&days=90",
    `videoId=${YT.a},${YT.b}&days=90`,
    "videoId=aaaaaaaa-0000-4000-8000-000000000001&days=90",
  ])
    assert.throws(() => parse(bad), LinkActivityValidationError, bad);
  // The page asks with the same three ranges as the Revenue overview.
  assert.equal(
    videoLinkActivityUrl(YT.a, "3M"),
    `/api/videos/link-activity?videoId=${YT.a}&days=90`,
  );
  assert.equal(videoLinkActivityUrl(YT.a, "6M")!.split("days=")[1], "180");
  assert.equal(videoLinkActivityUrl(YT.a, "12M")!.split("days=")[1], "365");
  assert.equal(videoLinkActivityUrl("not an id", "3M"), null);
  assert.ok(videoLinkActivityUrl("demo-video-1", "3M", { demo: true }));
});

test("the period: the last N UTC calendar days, today included, with its exact bounds stated", () => {
  const now = new Date("2026-10-12T15:30:00.000Z");
  assert.deepEqual(linkActivityPeriod(90, now), {
    days: 90,
    startDate: "2026-07-15",
    endDate: "2026-10-12",
    from: "2026-07-15T00:00:00.000Z",
    to: "2026-10-12T15:30:00.000Z",
    timezone: "UTC",
  });
  assert.equal(linkActivityPeriod(180, now).startDate, "2026-04-16");
  assert.equal(linkActivityPeriod(365, now).startDate, "2025-10-13");
  // Just after midnight UTC the new day is already the last day.
  assert.equal(linkActivityPeriod(90, new Date("2026-10-13T00:00:01.000Z")).endDate, "2026-10-13");
});

test("malformed requests are 422 and read no link or click", async () => {
  const f = fixture();
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 3);
  for (const [videoId, days] of [
    [YT.a, 30],
    ["short", 90],
    [YT.a, "all"],
  ] as const) {
    const result = await get(f, f.owner, videoId, days);
    assert.deepEqual([result.status, result.body], [422, { error: "VALIDATION_ERROR" }]);
    assert.equal(readsOf(result, "link_click_events").length, 0);
    assert.equal(readsOf(result, "tracking_links").length, 0);
  }
});

// ---------- the answer ----------

test("a video with no links and no clicks: an empty, complete answer", async () => {
  const f = fixture();
  const result = await get(f, f.owner);
  assert.equal(result.status, 200);
  const data = dataOf(result);
  assert.deepEqual(
    [data.breakdown, data.totals, data.links, data.formerLinks],
    ["complete", { clicks: 0, uniqueVisitors: 0, clicksWithoutVisitorId: 0 }, [], null],
  );
  assert.equal(data.period.days, 90);
  assert.equal(data.period.timezone, "UTC");
  // The count said zero, so no click row was read at all.
  assert.deepEqual(
    readsOf(result, "link_click_events").map((read) => read.method),
    ["HEAD"],
  );
});

test("one link: its clicks and its visitors, with the destination and the short link", async () => {
  const f = fixture();
  const id = link(f, f.videos.a, f.destinations.course, { slug: "course" });
  clicks(f, id, f.videos.a, 5);
  clicks(f, id, f.videos.a, 3, { visitor: "returning" });
  const data = dataOf(await get(f, f.owner));
  assert.deepEqual(data.totals, { clicks: 8, uniqueVisitors: 6, clicksWithoutVisitorId: 0 });
  assert.deepEqual(data.links, [
    {
      id,
      slug: "course",
      status: "active",
      destination: { name: "Course", url: "https://c.test" },
      clicks: 8,
      uniqueVisitors: 6,
      shortUrl: "https://app.test/r/course",
    },
  ]);
  assert.equal(data.formerLinks, null);
});

test("several links: the total is the sum of the rows, and a visitor on two links is one visitor", async () => {
  const f = fixture();
  const course = link(f, f.videos.a, f.destinations.course);
  const shop = link(f, f.videos.a, f.destinations.shop);
  const idle = link(f, f.videos.a, f.destinations.foreign); // on the video, never clicked
  clicks(f, course, f.videos.a, 4);
  clicks(f, shop, f.videos.a, 2);
  // The same person used both links, twice each.
  clicks(f, course, f.videos.a, 2, { visitor: "both" });
  clicks(f, shop, f.videos.a, 2, { visitor: "both" });
  const data = dataOf(await get(f, f.owner));
  const byId = new Map(data.links.map((row) => [row.id, row]));
  assert.deepEqual([byId.get(course)!.clicks, byId.get(course)!.uniqueVisitors], [6, 5], "course");
  assert.deepEqual([byId.get(shop)!.clicks, byId.get(shop)!.uniqueVisitors], [4, 3], "shop");
  assert.deepEqual([byId.get(idle)!.clicks, byId.get(idle)!.uniqueVisitors], [0, 0], "idle");
  // 10 clicks; 4 + 2 one-off visitors and one person on both links = 7, not 5 + 3 = 8.
  assert.deepEqual(data.totals, { clicks: 10, uniqueVisitors: 7, clicksWithoutVisitorId: 0 });
  assert.equal(
    data.links.reduce((sum, row) => sum + (row.clicks ?? 0), 0) + (data.formerLinks?.clicks ?? 0),
    data.totals.clicks,
  );
  // A destination that is not this workspace's is not described.
  assert.equal(byId.get(idle)!.destination, null);
  // Newest link first.
  assert.deepEqual(
    data.links.map((row) => row.id),
    [idle, shop, course],
  );
});

test("a reassigned link: its earlier clicks stay with this video, in their own row; later ones go with the new video", async () => {
  const f = fixture();
  const stays = link(f, f.videos.a, f.destinations.course);
  // Made for video A, since pointed at video B.
  const moved = link(f, f.videos.b, f.destinations.shop);
  // Made for video A, since detached from any video.
  const detached = link(f, null, f.destinations.course, { slug: "detached" });
  clicks(f, stays, f.videos.a, 3);
  clicks(f, moved, f.videos.a, 5); // while it pointed at A
  clicks(f, moved, f.videos.b, 7); // after it moved
  clicks(f, detached, f.videos.a, 2, { visitor: "same" });

  const a = dataOf(await get(f, f.owner, YT.a));
  assert.deepEqual(
    a.links.map((row) => [row.id, row.clicks]),
    [[stays, 3]],
    "only the link on the video now is listed as a link",
  );
  assert.deepEqual(a.formerLinks, { links: 2, clicks: 7, uniqueVisitors: 6 });
  assert.deepEqual(a.totals, { clicks: 10, uniqueVisitors: 9, clicksWithoutVisitorId: 0 });
  assert.equal(a.links[0].clicks! + a.formerLinks!.clicks, a.totals.clicks);

  // Video B has the link now and only the clicks made after the move.
  const b = dataOf(await get(f, f.owner, YT.b));
  assert.deepEqual(
    b.links.map((row) => [row.id, row.clicks]),
    [[moved, 7]],
  );
  assert.equal(b.formerLinks, null);
  assert.equal(b.totals.clicks, 7);
});

test("clicks with no video belong to no video", async () => {
  const f = fixture();
  const general = link(f, null, f.destinations.course);
  const onVideo = link(f, f.videos.a, f.destinations.shop);
  clicks(f, general, null, 40);
  clicks(f, onVideo, null, 6); // recorded before the link had a video
  clicks(f, onVideo, f.videos.a, 2);
  const data = dataOf(await get(f, f.owner));
  assert.equal(data.totals.clicks, 2);
  assert.deepEqual(
    data.links.map((row) => row.clicks),
    [2],
  );
  assert.equal(data.formerLinks, null);
});

test("clicks without a visitor id are clicks, and count towards no visitor", async () => {
  const f = fixture();
  const id = link(f, f.videos.a, f.destinations.course);
  clicks(f, id, f.videos.a, 4, { visitor: null });
  clicks(f, id, f.videos.a, 3);
  const data = dataOf(await get(f, f.owner));
  assert.deepEqual(data.totals, { clicks: 7, uniqueVisitors: 3, clicksWithoutVisitorId: 4 });
  assert.deepEqual([data.links[0].clicks, data.links[0].uniqueVisitors], [7, 3]);
  // The same convention as the tracking_link_stats view.
  const view = readFileSync("supabase/migrations/202609040001_link_tracking.sql", "utf8");
  assert.match(view, /count\(distinct privacy_id\) as unique_clicks/);
});

test("a deleted link's clicks are gone with it; a click whose link is not this workspace's is counted nowhere", async () => {
  const f = fixture();
  const kept = link(f, f.videos.a, f.destinations.course);
  clicks(f, kept, f.videos.a, 3);
  // The schema deletes a link's click events with the link, so nothing of it remains to show.
  const schema = readFileSync("supabase/migrations/202608160001_initial_schema.sql", "utf8");
  assert.match(
    schema,
    /link_id uuid not null references public\.tracking_links\(id\) on delete cascade/,
  );
  // A click row that somehow names this video through a link outside the workspace.
  const foreignLink = uuid();
  f.world.tracking_links!.push({
    id: foreignLink,
    workspace_id: f.otherWorkspace,
    video_id: null,
    destination_id: f.destinations.foreign,
    slug: "theirs",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  clicks(f, foreignLink, f.videos.a, 50);
  clicks(f, uuid(), f.videos.a, 20); // its link no longer exists at all
  const data = dataOf(await get(f, f.owner));
  assert.deepEqual(data.totals, { clicks: 3, uniqueVisitors: 3, clicksWithoutVisitorId: 0 });
  assert.equal(data.formerLinks, null);
});

// ---------- the period ----------

test("period boundaries: from 00:00 UTC on the first day up to now", async () => {
  const f = fixture();
  const id = link(f, f.videos.a, f.destinations.course);
  const period = linkActivityPeriod(90, new Date());
  const from = new Date(period.from).getTime();
  const at = (ms: number) => new Date(ms).toISOString();
  clicks(f, id, f.videos.a, 1, { at: at(from) }); // the first instant: in
  clicks(f, id, f.videos.a, 1, { at: at(from - 1) }); // one millisecond earlier: out
  clicks(f, id, f.videos.a, 1, { at: at(Date.now() - 1000) }); // a second ago: in
  clicks(f, id, f.videos.a, 1, { at: at(Date.now() + 3_600_000) }); // in the future: out
  clicks(f, id, f.videos.a, 1, { daysAgo: 120 }); // only in the longer ranges
  clicks(f, id, f.videos.a, 1, { daysAgo: 300 });
  clicks(f, id, f.videos.a, 1, { daysAgo: 400 }); // in none
  const ninety = dataOf(await get(f, f.owner, YT.a, 90));
  assert.equal(ninety.totals.clicks, 2);
  assert.equal(ninety.period.from, period.from);
  assert.equal(ninety.period.startDate, period.startDate);
  // The longer ranges also take in the click one millisecond before the 90-day start.
  assert.equal(dataOf(await get(f, f.owner, YT.a, 180)).totals.clicks, 4);
  assert.equal(dataOf(await get(f, f.owner, YT.a, 365)).totals.clicks, 5);
  // The read itself is bounded on both sides.
  const read = (await get(f, f.owner)).reads.find((entry) => entry.table === "link_click_events")!;
  assert.match(decodeURIComponent(String(read.body)), /clicked_at=gte\.[^&]+&clicked_at=lte\./);
  // …and names the channel as well as the video, which is what the existing index is on.
  assert.match(decodeURIComponent(String(read.body)), /channel_id=in\.[^&]+&video_id=in\./);
  assert.match(
    readFileSync("supabase/migrations/202608160001_initial_schema.sql", "utf8"),
    /on public\.link_click_events\(channel_id, video_id, clicked_at desc\)/,
  );
});

// ---------- completeness ----------

test("more than 1,000 clicks: all counted at the default row cap, and at caps that split every page", async () => {
  const build = () => {
    const f = fixture();
    const course = link(f, f.videos.a, f.destinations.course);
    const moved = link(f, f.videos.b, f.destinations.shop);
    clicks(f, course, f.videos.a, 1700);
    clicks(f, moved, f.videos.a, 650);
    clicks(f, course, f.videos.a, 200, { visitor: "regular" });
    clicks(f, moved, f.videos.a, 50, { visitor: "regular" });
    return f;
  };
  const expected = {
    totals: { clicks: 2600, uniqueVisitors: 2351, clicksWithoutVisitorId: 0 },
    link: [1900, 1701],
    former: { links: 1, clicks: 700, uniqueVisitors: 651 },
  };
  for (const cap of [undefined, 1000, 777, 250]) {
    const f = build();
    f.world.maxRows = cap;
    const result = await get(f, f.owner);
    const data = dataOf(result);
    assert.equal(result.status, 200, `cap ${cap}`);
    assert.deepEqual(data.totals, expected.totals, `cap ${cap}`);
    assert.deepEqual([data.links[0].clicks, data.links[0].uniqueVisitors], expected.link);
    assert.deepEqual(data.formerLinks, expected.former, `cap ${cap}`);
    if (cap === 1000)
      // One exact count, then three pages of rows and the empty page that ends the read.
      assert.deepEqual(
        readsOf(result, "link_click_events").map((read) => read.method),
        ["HEAD", "GET", "GET", "GET", "GET"],
      );
  }
});

test("only the two columns needed are read from the click events, ordered by their key", async () => {
  const f = fixture();
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 2);
  const result = await get(f, f.owner);
  const rows = readsOf(result, "link_click_events").filter((read) => read.method === "GET");
  const query = decodeURIComponent(String((rows[0] as unknown as { body: string }).body));
  assert.match(query, /select=link_id,privacy_id&/);
  assert.match(query, /order=id\.asc/);
});

test("above the click limit: the exact total is returned and the breakdown is declared unavailable, not guessed", async () => {
  const f = fixture();
  const id = link(f, f.videos.a, f.destinations.course);
  clicks(f, id, f.videos.a, MAX_CLICK_EVENTS + 1, { visitor: "x" });
  const result = await get(f, f.owner);
  const data = dataOf(result);
  assert.equal(result.status, 200);
  assert.equal(data.breakdown, "unavailable");
  assert.deepEqual(data.totals, {
    clicks: MAX_CLICK_EVENTS + 1,
    uniqueVisitors: null,
    clicksWithoutVisitorId: null,
  });
  // The link is still listed; its figures are unknown, never zero.
  assert.deepEqual(
    [data.links[0].id, data.links[0].clicks, data.links[0].uniqueVisitors],
    [id, null, null],
  );
  assert.equal(data.formerLinks, null);
  assert.equal(data.limits.maxClickEvents, MAX_CLICK_EVENTS);
  // No click row was read: only the count.
  assert.deepEqual(
    readsOf(result, "link_click_events").map((read) => read.method),
    ["HEAD"],
  );
  // Exactly at the limit the full breakdown is still produced.
  f.world.link_click_events!.pop();
  assert.equal(dataOf(await get(f, f.owner)).breakdown, "complete");
});

test("a failed read — the count, any page of clicks, links, the video — fails the request with no figures", async () => {
  const build = () => {
    const f = fixture();
    const course = link(f, f.videos.a, f.destinations.course);
    const moved = link(f, f.videos.b, f.destinations.shop);
    clicks(f, course, f.videos.a, 1500);
    clicks(f, moved, f.videos.a, 900);
    f.world.maxRows = 1000;
    return f;
  };
  const failures: Array<[string, Partial<World>]> = [
    ["the count", { failReadsAfter: { link_click_events: 0 } }],
    ["the first page of clicks", { failReadsAfter: { link_click_events: 1 } }],
    ["an intermediate page of clicks", { failReadsAfter: { link_click_events: 2 } }],
    ["the closing page of clicks", { failReadsAfter: { link_click_events: 4 } }],
    ["the links on the video", { failReadsAfter: { tracking_links: 0 } }],
    ["the links since moved", { failReadsAfter: { tracking_links: 2 } }],
    ["the video", { failingReads: ["videos"] }],
    ["the channels", { failingReads: ["youtube_channels"] }],
    ["the destinations", { failingReads: ["destinations"] }],
  ];
  for (const [what, settings] of failures) {
    const f = build();
    Object.assign(f.world, settings);
    const result = await get(f, f.owner);
    assert.deepEqual([what, result.status, result.body], [what, 500, { error: "DATABASE_ERROR" }]);
    assert.doesNotMatch(result.text, /clicks|uniqueVisitors/, what);
  }
  // With nothing failing, the same data is complete.
  const healthy = build();
  assert.equal(dataOf(await get(healthy, healthy.owner)).totals.clicks, 2400);
});

// ---------- who may ask, and for what ----------

test("signed out is 401, before anything is read", async () => {
  const f = fixture();
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 3);
  const result = await get(f, null);
  assert.equal(result.status, 401);
  assert.equal(readsOf(result, "tracking_links").length, 0);
  assert.equal(readsOf(result, "link_click_events").length, 0);
});

test("a role without link_tracking is refused, and no link, click, video or destination is read", async () => {
  const f = fixture();
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 3);
  const feature = f.world.features.find((row) => row.key === "link_tracking")!;
  f.world.role_feature_access.push({ role: "editor", feature_id: feature.id, enabled: false });
  const refused = await get(f, f.editor);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "FEATURE_DISABLED");
  for (const table of ["tracking_links", "link_click_events", "videos", "destinations"])
    assert.equal(readsOf(refused, table).length, 0, table);
  assert.doesNotMatch(refused.text, /clicks|slug|shortUrl|Course/);
  // Other roles are unaffected, and switching the feature off entirely refuses everyone.
  assert.equal((await get(f, f.setter)).status, 200);
  assert.equal((await get(f, f.owner)).status, 200);
  feature.is_active = false;
  assert.equal((await get(f, f.owner)).status, 403);
});

test("an unknown video and another workspace's video get exactly the answer of a video with no links", async () => {
  const f = fixture();
  // The other workspace has a busy link on its own video.
  const theirs = uuid();
  f.world.tracking_links!.push({
    id: theirs,
    workspace_id: f.otherWorkspace,
    video_id: f.videos.foreign,
    destination_id: f.destinations.foreign,
    slug: "theirs",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  clicks(f, theirs, f.videos.foreign, 80);
  const idle = await get(f, f.owner, YT.b); // own video, nothing on it
  const foreign = await get(f, f.owner, YT.foreign);
  const unknown = await get(f, f.owner, YT.unknown);
  const strip = (result: { body: Record<string, unknown> }) => {
    const { period, ...rest } = dataOf(result);
    return { ...rest, period: { ...period, to: "" } };
  };
  assert.deepEqual(strip(foreign), strip(unknown));
  assert.deepEqual(strip(foreign), strip(idle));
  assert.equal(foreign.status, 200);
  assert.doesNotMatch(foreign.text, /theirs|Theirs/);
  assert.equal(dataOf(foreign).totals.clicks, 0);
  // No click or link was read for a video that is not the caller's.
  for (const result of [foreign, unknown]) {
    assert.equal(readsOf(result, "link_click_events").length, 0);
    assert.equal(readsOf(result, "tracking_links").length, 0);
  }
  // Its own workspace does see it — and cannot see the first workspace's video the same way.
  assert.equal(dataOf(await get(f, f.stranger, YT.foreign)).totals.clicks, 80);
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 9);
  assert.equal(dataOf(await get(f, f.stranger, YT.a)).totals.clicks, 0);
  assert.equal(dataOf(await get(f, f.owner, YT.a)).totals.clicks, 9);
});

test("every read is filtered by the caller's own workspace", async () => {
  const f = fixture();
  const moved = link(f, f.videos.b, f.destinations.shop);
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 2);
  clicks(f, moved, f.videos.a, 2);
  const result = await get(f, f.owner);
  const workspaceFilter = new RegExp(`workspace_id=eq\\.${f.workspace}`);
  for (const table of ["youtube_channels", "tracking_links", "destinations"]) {
    const reads = readsOf(result, table) as unknown as Array<{ body: string }>;
    assert.ok(reads.length > 0, table);
    for (const read of reads) assert.match(decodeURIComponent(read.body), workspaceFilter, table);
  }
  // Videos are reached only through those channels; clicks only through those videos.
  const video = readsOf(result, "videos")[0] as unknown as { body: string };
  assert.match(decodeURIComponent(video.body), /channel_id=in\./);
  for (const read of readsOf(result, "link_click_events") as unknown as Array<{ body: string }>)
    assert.match(decodeURIComponent(read.body), new RegExp(`video_id=in\\.\\("?${f.videos.a}`));
});

test("no money: nothing financial is read or returned, for any role, with revenue hidden or not", async () => {
  const f = fixture();
  clicks(f, link(f, f.videos.a, f.destinations.course), f.videos.a, 4);
  // The database as it is in production: any member-session read naming a money column fails.
  f.world.protectMoney = true;
  for (const who of [f.owner, f.editor, f.setter]) {
    const result = await get(f, who);
    assert.equal(result.status, 200);
    assert.deepEqual(result.refusedMoneyReads, []);
    assert.ok(
      // (Besides the plan check, which reads the workspace's owner and subscription with the
      // service role — plan-access.ts — and nothing financial.)
      result.reads.every(
        (read) =>
          read.as === "user" ||
          (read.as === "service" && ["workspaces", "subscriptions"].includes(String(read.table))),
      ),
      "the caller's own session only",
    );
    for (const table of ["deals", "channel_daily_stats", "video_daily_stats"])
      assert.equal(readsOf(result, table).length, 0, table);
    assert.doesNotMatch(result.text, /usd|revenue|value|commission|earn|\$/i);
    assert.deepEqual(Object.keys(dataOf(result)).sort(), [
      "breakdown",
      "formerLinks",
      "limits",
      "links",
      "period",
      "totals",
    ]);
  }
  // Editors and setters with revenue hidden get the same activity as the owner.
  assert.deepEqual(dataOf(await get(f, f.editor)).totals, dataOf(await get(f, f.owner)).totals);
  const source = readFileSync("src/lib/server/video-link-activity.ts", "utf8").replace(
    /^\s*\/\/.*$/gm,
    "",
  );
  assert.doesNotMatch(source, /revenue|MoneyReader|usd|deals|createServiceSupabaseClient/i);
});

// ---------- what the section prints ----------

const response = (
  overrides: Partial<VideoLinkActivityResponse> = {},
): VideoLinkActivityResponse => ({
  period: linkActivityPeriod(90, new Date("2026-10-12T15:30:00.000Z")),
  breakdown: "complete",
  totals: { clicks: 0, uniqueVisitors: 0, clicksWithoutVisitorId: 0 },
  links: [],
  formerLinks: null,
  limits: { maxClickEvents: MAX_CLICK_EVENTS },
  ...overrides,
});
const viewLink = (clicksCount: number | null, visitors: number | null, extra = {}) => ({
  id: uuid(),
  slug: "course",
  status: "active",
  destination: { name: "Course", url: "https://c.test" },
  clicks: clicksCount,
  uniqueVisitors: visitors,
  shortUrl: "https://app.test/r/course",
  ...extra,
});

test("view: no links and no clicks is the empty state, with the period still stated", () => {
  const view = mapVideoRevenueSources(response());
  assert.equal(view.state, "empty");
  assert.equal(view.periodLabel.endsWith("(UTC)"), true);
  assert.match(view.periodLabel, /15 Jul 2026 – 12 Oct 2026/);
  assert.equal(
    SOURCES_EMPTY_NOTE,
    "No tracked links for this video yet. Add one to see how many viewers click through from its description.",
  );
});

test("view: links and their counts, formatted; a link with no clicks yet is still activity to show", () => {
  const view = mapVideoRevenueSources(
    response({
      totals: { clicks: 1204, uniqueVisitors: 987, clicksWithoutVisitorId: 0 },
      links: [
        viewLink(1204, 987),
        viewLink(0, 0, { status: "archived", destination: null, slug: "old" }),
      ],
    }),
  );
  assert.equal(view.state, "activity");
  assert.deepEqual([view.clicks, view.uniqueVisitors], ["1,204", "987"]);
  assert.deepEqual(
    view.links.map((row) => [row.title, row.statusLabel, row.clicks, row.uniqueVisitors]),
    [
      ["Course", null, "1,204", "987"],
      ["old", "Archived", "0", "0"],
    ],
  );
  assert.equal(mapVideoRevenueSources(response({ links: [viewLink(0, 0)] })).state, "activity");
});

test("view: historical clicks are their own labelled row, and say so when no link is on the video now", () => {
  const view = mapVideoRevenueSources(
    response({
      totals: { clicks: 7, uniqueVisitors: 6, clicksWithoutVisitorId: 0 },
      formerLinks: { links: 2, clicks: 7, uniqueVisitors: 6 },
    }),
  );
  assert.equal(view.state, "activity");
  assert.equal(SOURCES_FORMER_LINKS_LABEL, "From links no longer on this video");
  assert.deepEqual(view.formerLinks, {
    label: "From links no longer on this video",
    detail: "2 links that pointed at this video when the clicks were made",
    clicks: "7",
    uniqueVisitors: "6",
  });
  assert.equal(view.noCurrentLinksNote, "No tracked link is on this video now.");
});

test("view: an unavailable breakdown is a dash and an explanation, never a zero", () => {
  const view = mapVideoRevenueSources(
    response({
      breakdown: "unavailable",
      totals: { clicks: 61234, uniqueVisitors: null, clicksWithoutVisitorId: null },
      links: [viewLink(null, null)],
    }),
  );
  assert.deepEqual([view.clicks, view.uniqueVisitors], ["61,234", "—"]);
  assert.deepEqual([view.links[0].clicks, view.links[0].uniqueVisitors], ["—", "—"]);
  assert.match(view.notes[0], /more than 50,000 clicks in this period/);
  assert.match(view.notes[0], /The click total is exact\./);
});

test("view: the notes explain missing visitor ids and why link visitors can add up to more", () => {
  const view = mapVideoRevenueSources(
    response({
      totals: { clicks: 10, uniqueVisitors: 7, clicksWithoutVisitorId: 1 },
      links: [viewLink(6, 5), viewLink(4, 3)],
    }),
  );
  assert.match(view.notes[0], /^1 click carried no visitor id and is not counted/);
  assert.match(view.notes[1], /counted once across the whole video/);
  assert.deepEqual(mapVideoRevenueSources(response({ links: [viewLink(3, 3)] })).notes, []);
});

test("wording: clicks are activity, and what is not connected is said plainly", () => {
  assert.equal(
    SOURCES_CLICKS_NOTE,
    "Clicks show interest, not income. Tubify has not verified sales or commissions from these links.",
  );
  assert.match(
    SOURCES_NOT_CONNECTED_NOTE,
    /^Affiliate commissions, sales and leads are not yet linked/,
  );
  // Nothing the mapper produces calls a click money.
  const view = mapVideoRevenueSources(
    response({
      totals: { clicks: 5, uniqueVisitors: 5, clicksWithoutVisitorId: 0 },
      links: [viewLink(5, 5)],
      formerLinks: { links: 1, clicks: 2, uniqueVisitors: 2 },
    }),
  );
  assert.doesNotMatch(JSON.stringify(view), /\$|revenue|earn|conversion|commission|sale/i);
});

// ---------- the page ----------

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

test("the section sits directly below the Revenue overview, above the KPI cards, on its own request", () => {
  const page = flat("src/routes/videos.$videoId.tsx");
  const overview = page.indexOf("<VideoRevenueOverview");
  const sources = page.indexOf("<VideoRevenueSources");
  const cards = page.indexOf('title="Views in period"');
  assert.ok(overview > 0 && overview < sources && sources < cards);
  assert.match(
    page,
    /<VideoRevenueSources className="mt-5" youtubeVideoId=\{videoId\} range=\{range\}/,
  );
  // Rendered unconditionally, like the overview: no live-request state can remove it.
  assert.doesNotMatch(page.slice(overview, sources), /\{data && result\.status/);

  const component = flat("src/components/VideoRevenueSources.tsx");
  assert.match(
    component,
    /videoLinkActivityUrl\(youtubeVideoId, range, \{ demo: IS_LOCAL_DEMO \}\)/,
  );
  assert.doesNotMatch(component, /api\/revenue\/|api\/youtube\//, "its own endpoint only");
  // The Revenue overview is untouched by it.
  assert.doesNotMatch(
    flat("src/components/VideoRevenueOverview.tsx"),
    /VideoRevenueSources|link-activity/,
  );
});

test("the section's states: loading, restricted, error with retry, empty with a real action — and no figure on failure", () => {
  const component = flat("src/components/VideoRevenueSources.tsx");
  assert.match(component, /aria-label="Loading link activity"/);
  // 403: restricted, decided before the body is even read.
  assert.match(
    component,
    /if \(response\.status === 403\) \{ setState\(\{ status: "restricted" \}\); return; \}/,
  );
  assert.match(component, /\{SOURCES_RESTRICTED_NOTE\}/);
  assert.match(component, /title="We couldn't load this video's link activity"/);
  assert.match(component, /onRetry=\{\(\) => setRetryNonce/);
  assert.match(component, /setState\(\{ status: "error" \}\); \}\);/);
  assert.match(component, /<Link to="\/link-tracking"/);
  assert.doesNotMatch(component, /search=|\?video=/, "no video preselection");
  // The YouTube line and the not-connected line are outside every link state, so a restricted
  // or failed section still shows them.
  assert.match(component, /\{SOURCES_YOUTUBE_NOTE\}/);
  assert.match(component, /\{SOURCES_NOT_CONNECTED_NOTE\}/);
  assert.match(component, /\{SOURCES_CLICKS_NOTE\}/);
  // No money, no arithmetic.
  assert.doesNotMatch(component, /\$\{?\d|toFixed|reduce\(|usd|formatVideoRevenue/);
});

// ---------- demo ----------

test("demo: the sample answer has the endpoint's shape, follows the range, and is labelled as sample", () => {
  const demo = flat("src/lib/demo-api.ts");
  assert.match(demo, /"\/api\/videos\/link-activity": demoVideoLinkActivity,/);
  assert.match(demo, /const \{ period \} = demoRevenuePeriod\(url\.searchParams\);/);
  for (const key of ["period", "breakdown", "totals", "links", "formerLinks", "limits"])
    assert.match(
      demo.slice(demo.indexOf("function demoVideoLinkActivity")),
      new RegExp(`${key}[:,]`),
    );
  for (const [range, days] of [
    ["3M", 90],
    ["6M", 180],
    ["12M", 365],
  ] as const) {
    const url = new URL(videoLinkActivityUrl("demo-video-1", range, { demo: true })!, "https://x");
    assert.equal(demoRevenuePeriod(url.searchParams).period.days, days);
  }
  assert.match(
    flat("src/components/VideoRevenueSources.tsx"),
    /\{IS_LOCAL_DEMO && \( <span [^>]*> Sample data <\/span> \)\}/,
  );
  // The interceptor exists only in demo mode and answers from bundled sample data.
  assert.match(
    demo,
    /if \(!IS_LOCAL_DEMO \|\| installed \|\| typeof window === "undefined"\) return;/,
  );
});
