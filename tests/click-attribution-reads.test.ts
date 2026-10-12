import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PagedReadError, readAllRows } from "../src/lib/server/paged-read";
import {
  addMember,
  addUser,
  addWorkspace,
  callTeamApi,
  emptyWorld,
  uuid,
  type World,
} from "./helpers/team-fake-api";

// Click attribution must count every click. The database API returns at most a fixed number of
// rows per request (1,000 by default) with no sign that more exist, so these tests run the real
// routes against a database that caps responses, and against more than 1,000 click events.

const routes = {
  topVideos: await import("../src/routes/api.destinations.top-videos"),
  links: await import("../src/routes/api.tracking-links"),
};

interface Fixture {
  world: World;
  owner: string;
  editor: string;
  stranger: string;
  workspace: string;
  otherWorkspace: string;
  destination: string;
  foreignDestination: string;
  link: string;
  videos: Record<"a" | "b" | "c" | "d", string>;
}

function fixture(): Fixture {
  const world = emptyWorld();
  world.features.push({ id: uuid(), key: "link_tracking", is_active: true });
  const owner = addUser(world, "owner@example.com");
  const editor = addUser(world, "editor@example.com");
  const stranger = addUser(world, "stranger@example.com");
  const workspace = addWorkspace(world, owner);
  addMember(world, workspace, editor, "editor");
  const otherWorkspace = addWorkspace(world, stranger);
  const destination = uuid();
  const foreignDestination = uuid();
  const videos = { a: uuid(), b: uuid(), c: uuid(), d: uuid() };
  world.destinations = [
    { id: destination, workspace_id: workspace, name: "Course", url: "https://example.com/c" },
    { id: foreignDestination, workspace_id: otherWorkspace, name: "Theirs", url: "https://x.test" },
  ];
  world.videos = Object.entries(videos).map(([key, id]) => ({
    id,
    title: `Video ${key.toUpperCase()}`,
    thumbnail: null,
  }));
  const link = uuid();
  world.tracking_links = [];
  world.link_click_events = [];
  world.tracking_link_stats = [];
  return {
    world,
    owner,
    editor,
    stranger,
    workspace,
    otherWorkspace,
    destination,
    foreignDestination,
    link,
    videos,
  };
}

let nextEventId = 1;
/** `count` click events for a destination, recorded against `videoId` (null = no video). */
function clicks(
  f: Fixture,
  videoId: string | null,
  count: number,
  options: { destination?: string; visitor?: string } = {},
) {
  for (let n = 0; n < count; n++)
    f.world.link_click_events!.push({
      // Zero-padded so the fake database's text ordering is the numeric order.
      id: String(nextEventId++).padStart(9, "0"),
      link_id: f.link,
      destination_id: options.destination ?? f.destination,
      video_id: videoId,
      privacy_id: options.visitor ?? uuid(),
      clicked_at: "2026-10-01T00:00:00Z",
    });
}

const top = (f: Fixture, as: string | null, id: string = f.destination) =>
  callTeamApi(routes.topVideos, f.world, {
    as,
    method: "GET",
    path: "/api/destinations/top-videos",
    query: `?id=${id}`,
  });
const ranking = (result: { body: Record<string, unknown> }) =>
  (result.body.data as Array<{ id: string; clicks: number }>).map((v) => [v.id, v.clicks]);
const clickReads = (result: { reads: Array<{ table: string }> }) =>
  result.reads.filter((read) => read.table === "link_click_events").length;

// ---------- the paged reader ----------

test("readAllRows: every row once, continuing from the rows received, ending on an empty page", async () => {
  const all = Array.from({ length: 2501 }, (_, n) => n);
  for (const cap of [1000, 999, 250, 1]) {
    const windows: Array<[number, number]> = [];
    const rows = await readAllRows<number>(async (from, to) => {
      windows.push([from, to]);
      // The API returns at most `cap` rows of the window asked for, without saying so.
      return { data: all.slice(from, Math.min(to + 1, from + cap)), error: null };
    });
    assert.deepEqual(rows, all, `cap ${cap}`);
    assert.equal(windows.length, Math.ceil(all.length / Math.min(cap, 1000)) + 1, `cap ${cap}`);
    assert.deepEqual(windows[0], [0, 999]);
    assert.equal(windows.at(-1)![0], all.length, "the last request starts after the last row");
  }
  // Exact page boundaries: one full page, then the empty page that proves the end.
  for (const [count, requests] of [
    [0, 1],
    [999, 2],
    [1000, 2],
    [1001, 3],
    [2000, 3],
  ]) {
    let made = 0;
    const rows = await readAllRows<number>(async (from, to) => {
      made += 1;
      return { data: all.slice(0, count).slice(from, to + 1), error: null };
    });
    assert.deepEqual([rows.length, made], [count, requests], `${count} rows`);
  }
});

test("readAllRows: a failed page throws and returns nothing — never a partial list, never an empty one", async () => {
  for (const failOn of [1, 2, 3]) {
    let made = 0;
    await assert.rejects(
      readAllRows<number>(async (from) => {
        made += 1;
        return made === failOn
          ? { data: null, error: { code: "XX000" } }
          : { data: Array.from({ length: 1000 }, (_, n) => from + n), error: null };
      }),
      (error: unknown) => error instanceof PagedReadError && error.code === "XX000",
      `page ${failOn}`,
    );
    assert.equal(made, failOn, "nothing is requested after the failure");
  }
});

// ---------- top videos for a destination ----------

test("top videos: more than 1,000 clicks are all counted and correctly ranked at the default row cap", async () => {
  const f = fixture();
  // Stored in an order where the first 1,000 rows would tell a different story: C looks like
  // the leader and B barely registers.
  clicks(f, f.videos.c, 400);
  clicks(f, null, 300);
  clicks(f, f.videos.d, 50);
  clicks(f, f.videos.a, 900);
  clicks(f, f.videos.b, 1200);
  f.world.maxRows = 1000;
  const result = await top(f, f.owner);
  assert.equal(result.status, 200);
  assert.deepEqual(ranking(result), [
    [f.videos.b, 1200],
    [f.videos.a, 900],
    [f.videos.c, 400],
  ]);
  // 2,550 clicks with a video: three pages and the empty one that ends the read.
  assert.equal(clickReads(result), 4);
  assert.equal((result.body.data as Array<{ title: string }>)[0].title, "Video B");
});

test("top videos: the same answer whatever the row cap, including caps that split every page", async () => {
  const build = () => {
    const f = fixture();
    clicks(f, f.videos.c, 130);
    clicks(f, null, 40);
    clicks(f, f.videos.a, 260);
    clicks(f, f.videos.b, 410);
    clicks(f, f.videos.d, 7);
    return f;
  };
  const expected = (f: Fixture) => [
    [f.videos.b, 410],
    [f.videos.a, 260],
    [f.videos.c, 130],
  ];
  const uncapped = build();
  assert.deepEqual(ranking(await top(uncapped, uncapped.owner)), expected(uncapped));
  // (Not below 3: the final lookup of the three winning videos is a single read of three rows.)
  for (const cap of [1000, 807, 250, 33, 3]) {
    const f = build();
    f.world.maxRows = cap;
    assert.deepEqual(ranking(await top(f, f.owner)), expected(f), `capped at ${cap}`);
  }
});

test("top videos: a failed page fails the request with no partial counts", async () => {
  for (const succeedFirst of [0, 1, 2]) {
    const f = fixture();
    clicks(f, f.videos.a, 900);
    clicks(f, f.videos.b, 1200);
    f.world.maxRows = 1000;
    f.world.failReadsAfter = { link_click_events: succeedFirst };
    const result = await top(f, f.owner);
    assert.deepEqual(
      [succeedFirst, result.status, result.body],
      [succeedFirst, 500, { error: "DATABASE_ERROR" }],
    );
    assert.ok(!result.text.includes(f.videos.a) && !result.text.includes("clicks"));
  }
  // The destination lookup failing is a failure too, not "no clicks".
  const f = fixture();
  clicks(f, f.videos.a, 3);
  f.world.failingReads = ["destinations"];
  assert.equal((await top(f, f.owner)).status, 500);
});

test("top videos: a click counts for the video recorded on the click, not the link's current video", async () => {
  const f = fixture();
  // The link was made for video A and later pointed at video B.
  f.world.tracking_links!.push({
    id: f.link,
    workspace_id: f.workspace,
    destination_id: f.destination,
    video_id: f.videos.b,
    slug: "course",
    clicks: 12,
  });
  clicks(f, f.videos.a, 9); // made while it pointed at A
  clicks(f, f.videos.b, 3); // made after
  const result = await top(f, f.owner);
  assert.deepEqual(ranking(result), [
    [f.videos.a, 9],
    [f.videos.b, 3],
  ]);
  // The link is not consulted at all: history cannot be rewritten by editing it.
  assert.equal(result.reads.filter((read) => read.table === "tracking_links").length, 0);
});

test("top videos: total clicks, not unique visitors — and no money anywhere", async () => {
  const f = fixture();
  clicks(f, f.videos.a, 6, { visitor: "one-visitor" });
  clicks(f, f.videos.b, 2);
  const result = await top(f, f.owner);
  assert.deepEqual(ranking(result), [
    [f.videos.a, 6],
    [f.videos.b, 2],
  ]);
  assert.deepEqual(Object.keys((result.body.data as object[])[0]).sort(), [
    "clicks",
    "id",
    "thumbnail",
    "title",
  ]);
  assert.doesNotMatch(result.text, /revenue|usd|value|\$|earn|commission/i);
  // The read asks for the video of each click and nothing else.
  const read = result.reads.find((entry) => entry.table === "link_click_events")!;
  assert.match(decodeURIComponent(String(read.body)), /select=video_id&/);
});

test("top videos: no clicks, clicks without a video, and clicks to other destinations", async () => {
  const f = fixture();
  assert.deepEqual((await top(f, f.owner)).body, { data: [] });
  clicks(f, null, 25);
  clicks(f, f.videos.a, 40, { destination: uuid() });
  assert.deepEqual((await top(f, f.owner)).body, { data: [] });
  // A video that no longer exists is left out rather than shown without a title.
  clicks(f, uuid(), 5);
  clicks(f, f.videos.c, 2);
  assert.deepEqual(ranking(await top(f, f.owner)), [[f.videos.c, 2]]);
});

test("top videos: another workspace's destination, and one that does not exist, answer like one with no clicks", async () => {
  const f = fixture();
  clicks(f, f.videos.a, 30);
  clicks(f, f.videos.b, 80, { destination: f.foreignDestination });
  const foreign = await top(f, f.owner, f.foreignDestination);
  const missing = await top(f, f.owner, uuid());
  assert.deepEqual([foreign.status, foreign.body], [200, { data: [] }]);
  assert.deepEqual([missing.status, missing.body], [200, { data: [] }]);
  // No click of that destination was read for them.
  assert.equal(clickReads(foreign), 0);
  assert.equal(clickReads(missing), 0);
  // The destination is looked up within the caller's own workspace.
  const lookup = foreign.reads.find((read) => read.table === "destinations")!;
  assert.match(
    decodeURIComponent(String(lookup.body)),
    new RegExp(`workspace_id=eq\\.${f.workspace}`),
  );
  // Its own workspace sees it; a member of the first workspace sees theirs.
  assert.deepEqual(ranking(await top(f, f.stranger, f.foreignDestination)), [[f.videos.b, 80]]);
  assert.deepEqual(ranking(await top(f, f.editor)), [[f.videos.a, 30]]);
  assert.deepEqual((await top(f, f.stranger)).body, { data: [] });
});

test("top videos: signed-out and malformed requests read nothing", async () => {
  const f = fixture();
  clicks(f, f.videos.a, 3);
  const out = await top(f, null);
  assert.equal(out.status, 401);
  assert.equal(clickReads(out), 0);
  const bad = await top(f, f.owner, "not-a-uuid");
  assert.equal(bad.status, 422);
  assert.equal(clickReads(bad), 0);
});

// ---------- the tracked-links list ----------

function addLinks(f: Fixture, count: number) {
  for (let n = 0; n < count; n++) {
    const id = uuid();
    f.world.tracking_links!.push({
      id,
      workspace_id: f.workspace,
      destination_id: f.destination,
      video_id: null,
      slug: `link-${n}`,
      status: "active",
      clicks: 10,
      // Several links share each timestamp, so the tie-breaker matters.
      created_at: new Date(Date.UTC(2026, 8, 1) + Math.floor(n / 7) * 60_000).toISOString(),
      updated_at: "2026-09-01T00:00:00Z",
    });
    f.world.tracking_link_stats!.push({ link_id: id, total_clicks: 10, unique_clicks: 4 });
  }
}
const listLinks = (f: Fixture, as: string | null) =>
  callTeamApi(routes.links, f.world, { as, method: "GET", path: "/api/tracking-links" });
type LinkOut = { id: string; clicks: number; uniqueClicks: number; created_at: string };

test("tracked links: more than 1,000 links are all listed, each once, with total and unique kept apart", async () => {
  const f = fixture();
  addLinks(f, 1250);
  for (const cap of [undefined, 1000, 333, 64]) {
    f.world.maxRows = cap;
    const result = await listLinks(f, f.owner);
    assert.equal(result.status, 200, `cap ${cap}`);
    const links = result.body.data as LinkOut[];
    assert.equal(links.length, 1250, `cap ${cap}`);
    assert.equal(new Set(links.map((link) => link.id)).size, 1250, "no link twice");
    // Total clicks and unique visitors are different numbers and both complete.
    assert.equal(
      links.reduce((sum, link) => sum + link.clicks, 0),
      12500,
    );
    assert.equal(
      links.reduce((sum, link) => sum + link.uniqueClicks, 0),
      5000,
    );
    // Newest first, as before.
    assert.ok(links.every((link, n) => n === 0 || links[n - 1].created_at >= link.created_at));
  }
});

test("tracked links: a failed read fails the list — unique visitors are never shown as 0 because of an error", async () => {
  const f = fixture();
  addLinks(f, 30);
  f.world.failingReads = ["tracking_link_stats"];
  const stats = await listLinks(f, f.owner);
  assert.deepEqual([stats.status, stats.body], [500, { error: "DATABASE_ERROR" }]);
  // An intermediate page of the links themselves.
  const g = fixture();
  addLinks(g, 30);
  g.world.maxRows = 10;
  g.world.failReadsAfter = { tracking_links: 2 };
  const page = await listLinks(g, g.owner);
  assert.deepEqual([page.status, page.body], [500, { error: "DATABASE_ERROR" }]);
  // A link with no stats row yet simply has no unique visitors.
  const h = fixture();
  addLinks(h, 2);
  h.world.tracking_link_stats = [];
  const fresh = await listLinks(h, h.owner);
  assert.deepEqual(
    (fresh.body.data as LinkOut[]).map((link) => link.uniqueClicks),
    [0, 0],
  );
});

test("tracked links: still workspace-scoped and still behind the link_tracking feature", async () => {
  const f = fixture();
  addLinks(f, 3);
  assert.equal(((await listLinks(f, f.stranger)).body.data as unknown[]).length, 0);
  assert.equal((await listLinks(f, null)).status, 401);
  const feature = f.world.features.find((row) => row.key === "link_tracking")!;
  f.world.role_feature_access.push({ role: "editor", feature_id: feature.id, enabled: false });
  assert.equal((await listLinks(f, f.editor)).status, 403);
  assert.equal((await listLinks(f, f.owner)).status, 200);
});

// ---------- nothing else changed ----------

test("no unpaged click read is left in these routes, and their gates are as they were", () => {
  const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
  const topVideos = flat("src/routes/api.destinations.top-videos.ts");
  assert.match(
    topVideos,
    /\.from\("link_click_events"\) \.select\("video_id"\) \.eq\("destination_id", id\) \.not\("video_id", "is", null\) \.order\("id", \{ ascending: true \}\) \.range\(from, to\)/,
  );
  // Membership only, exactly as before (whether it should also require link_tracking is an
  // open decision, not something this change settles).
  assert.match(topVideos, /await getWorkspaceContext\(request\)/);
  assert.doesNotMatch(topVideos, /requireWorkspaceFeature/);
  const links = flat("src/routes/api.tracking-links.ts");
  assert.equal(links.match(/requireWorkspaceFeature\( request, "link_tracking", \)/g)?.length, 4);
  assert.match(
    links,
    /\.order\("created_at", \{ ascending: false \}\) (\/\/[^.]*\. )?\.order\("id", \{ ascending: true \}\) \.range\(from, to\)/,
  );
});
