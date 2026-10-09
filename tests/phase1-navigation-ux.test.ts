import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CREATOR_MOBILE_PRIMARY,
  CREATOR_NAV,
  CREATOR_NAV_GROUPS,
  activeCreatorNavRoute,
  permissionRouteFor,
  visibleCreatorNavGroups,
} from "../src/lib/creator-nav";
import {
  ADMIN_MOBILE_PRIMARY,
  ADMIN_NAV_GROUPS,
  ADMIN_SECTIONS,
  adminSectionFrom,
} from "../src/lib/admin-nav";
import {
  EMPTY_ONBOARDING_STATE,
  IDLE_ONBOARDING_SESSION,
  LEGACY_ONBOARDING_KEY,
  ONBOARDING_STEPS,
  endOnboardingSession,
  getOnboardingSession,
  goToNextOnboardingStep,
  leftOnboardingFlow,
  migrateLegacyOnboarding,
  nextOnboardingStep,
  normalizeOnboardingState,
  onboardingStorageKey,
  openOnboardingGuide,
  resolveOnboardingView,
  setOnboardingSession,
  setOnboardingUser,
  type OnboardingSession,
  type OnboardingState,
  type OnboardingStatus,
} from "../src/lib/onboarding";
import { LEAD_SOURCES, leadSourceLinks } from "../src/lib/lead-sources";
import { canAccessRoute, type PlatformRole } from "../src/lib/stores";
import { CHANNEL_COUNT_HINT, videosCountLine, videosEmptyState } from "../src/lib/videos-page";
import { MIN_VIDEOS_TO_RANK, mapVideosRevenuePage } from "../src/lib/videos-revenue";
import type { RevenueVideosResponse } from "../src/lib/server/revenue-videos";

// Phase 1 — navigation and UX reliability. The navigation structure, the rules for where the
// getting-started guide may appear, and the Videos page's wording are pure modules, so they are
// tested here directly; the layouts only render what these decide.

const read = (file: string) => readFileSync(file, "utf8");

// ---------- 1. creator navigation ----------

// Every page the sidebar offered before the regrouping. None may be lost.
const CREATOR_ROUTES_BEFORE = [
  "/dashboard",
  "/videos",
  "/projects",
  "/ai-lab",
  "/destinations",
  "/link-tracking",
  "/comments",
  "/leads",
  "/audience",
  "/analytics",
  "/affiliate",
  "/freebie",
  "/email",
  "/brand-deals",
  "/team",
  "/reports",
  "/support",
  "/settings",
  "/admin",
];

test("creator navigation: the groups and their links", () => {
  assert.deepEqual(
    CREATOR_NAV_GROUPS.map((group) => [group.label, group.items]),
    [
      ["Overview", ["/dashboard"]],
      ["Content & Insights", ["/videos", "/analytics", "/audience", "/ai-lab"]],
      ["Attribution & Capture", ["/destinations", "/link-tracking", "/freebie"]],
      ["Monetization", ["/brand-deals"]],
      ["Engagement & Leads", ["/comments", "/leads", "/email"]],
      ["Workspace & Tools", ["/projects", "/reports", "/team", "/settings", "/support"]],
      ["Account", ["/affiliate"]],
      ["Platform", ["/admin"]],
    ],
  );
});

test("creator navigation: every page that was reachable still is, exactly once, and no page was added", () => {
  const grouped = CREATOR_NAV_GROUPS.flatMap((group) => group.items);
  assert.deepEqual([...grouped].sort(), [...CREATOR_ROUTES_BEFORE].sort());
  assert.equal(new Set(grouped).size, grouped.length, "no page appears in two groups");
  assert.deepEqual(CREATOR_NAV.map((item) => item.to).sort(), [...CREATOR_ROUTES_BEFORE].sort());
  for (const item of CREATOR_NAV) {
    assert.ok(item.label.trim(), item.to);
    assert.ok(item.label.length <= 20, `${item.label} fits the sidebar`);
  }
  // The phone's bottom bar still offers real pages.
  for (const to of CREATOR_MOBILE_PRIMARY) assert.ok(grouped.includes(to), to);
});

test("creator navigation: direct links still resolve — every entry has its route file", () => {
  const routeTree = read("src/routeTree.gen.ts");
  for (const item of CREATOR_NAV) {
    assert.ok(existsSync(`src/routes${item.to}.tsx`), `${item.to} route file`);
    assert.ok(routeTree.includes(`'${item.to}'`), `${item.to} is registered`);
  }
  // Pages that are deliberately not in the sidebar keep their routes too.
  for (const route of ["add-video", "pre-publish", "notifications", "billing", "videos.$videoId"])
    assert.ok(existsSync(`src/routes/${route}.tsx`), route);
});

test("the referral programme is labelled as what it is", () => {
  const item = CREATOR_NAV.find((entry) => entry.to === "/affiliate")!;
  assert.equal(item.label, "Referrals");
  // The page is Tubify's own refer-a-customer programme, not a tracker of creator affiliate income.
  assert.match(read("src/routes/affiliate.tsx"), /referralLink/);
  assert.match(read("src/routes/affiliate.tsx"), /referredClients/);
});

// ---------- 3. active-route highlighting ----------

test("active highlighting: the page itself, or the entry a nested page belongs to", () => {
  for (const item of CREATOR_NAV) assert.equal(activeCreatorNavRoute(item.to), item.to);
  assert.equal(activeCreatorNavRoute("/videos/abc123XYZ_-"), "/videos", "a single video");
  assert.equal(activeCreatorNavRoute("/add-video"), "/videos", "Analyze Video");
  assert.equal(activeCreatorNavRoute("/pre-publish"), "/videos");
  assert.equal(activeCreatorNavRoute("/pre-publish/42"), "/videos");
  assert.equal(activeCreatorNavRoute("/settings/"), "/settings", "trailing slash");
  assert.equal(activeCreatorNavRoute("/notifications"), null, "belongs to no entry");
  assert.equal(activeCreatorNavRoute("/videosomething"), null, "not a prefix match on text");
  // Exactly one entry is ever highlighted.
  for (const path of ["/videos/abc", "/dashboard", "/leads"])
    assert.equal(CREATOR_NAV.filter((n) => n.to === activeCreatorNavRoute(path)).length, 1);
});

test("the layout renders from the shared structure and marks the current page", () => {
  const layout = read("src/components/DashboardLayout.tsx");
  assert.match(layout, /visibleCreatorNavGroups\(/);
  assert.match(layout, /activeCreatorNavRoute\(pathname\)/);
  assert.match(layout, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(layout, /aria-label=\{collapsed \? "Expand sidebar" : "Collapse sidebar"\}/);
  // One structure for desktop and mobile: the "More" sheet uses the same groups.
  assert.equal(layout.match(/visibleNavGroups\.map\(/g)?.length, 2);
});

// ---------- 5 & 6. restrictions are preserved ----------

const ROLES: PlatformRole[] = ["Owner", "Manager", "Setter", "Editor"];
const visibleFor = (role: PlatformRole, features: Record<string, boolean> = {}) =>
  visibleCreatorNavGroups((to) => canAccessRoute(role, to) && (features[to] ?? true)).flatMap(
    (group) => group.items,
  );

test("regrouping grants nothing: each role sees exactly the pages its role allowed before", () => {
  for (const role of ROLES) {
    const expected = CREATOR_ROUTES_BEFORE.filter((to) => canAccessRoute(role, to)).sort();
    assert.deepEqual(visibleFor(role).sort(), expected, role);
  }
  // No workspace role reaches the admin console through the sidebar.
  for (const role of ROLES) assert.ok(!visibleFor(role).includes("/admin"), role);
});

test("team management stays hidden from roles and workspaces that are not entitled to it", () => {
  assert.ok(!visibleFor("Setter").includes("/team"));
  assert.ok(!visibleFor("Editor").includes("/team"));
  // When the server's feature map switches Team off for the caller's role, the entry is hidden
  // too — even for an owner. (That map is per role; it does not know about subscription plans.)
  assert.ok(!visibleFor("Owner", { "/team": false }).includes("/team"));
  assert.ok(visibleFor("Owner", { "/team": true }).includes("/team"));
  // A group left with nothing to show disappears instead of rendering an empty heading.
  const withoutBrandDeals = visibleCreatorNavGroups((to) => to !== "/brand-deals");
  assert.ok(!withoutBrandDeals.some((group) => group.label === "Monetization"));
});

test("the server still authorises team management itself; the nav is not the gate", () => {
  const members = read("src/routes/api.workspace.members.ts");
  assert.ok((members.match(/requireWorkspaceFeature\(request, "team"\)/g) ?? []).length >= 4);
  // The layout still applies both checks to every entry it renders.
  const layout = read("src/components/DashboardLayout.tsx");
  assert.match(layout, /\(to\) => canReachRoute\(to\) && realFeatureEnabledFor\(to\)/);
});

// ---------- 2. admin navigation ----------

test("admin navigation: the groups and their sections", () => {
  assert.deepEqual(
    ADMIN_NAV_GROUPS.map((group) => [group.label, group.items.map((item) => item.label)]),
    [
      ["Overview & Insights", ["Executive Dashboard", "Analytics & Reporting"]],
      ["Accounts & Access", ["Users", "Roles & Permissions", "Workspaces"]],
      ["Billing & Subscriptions", ["Billing"]],
      ["Product Controls", ["AI Management", "Feature Management"]],
      ["Security & Audit", ["Security Center", "Audit Logs"]],
      ["Brand & Communications", ["Customization", "Communications"]],
      ["Releases & Roadmap", ["Release Registry", "Roadmap", "Changelog"]],
      ["System & Support", ["System", "Infrastructure", "Support"]],
    ],
  );
});

test("admin navigation: all eighteen sections are kept, once each, and each has a screen", () => {
  const before = [
    "dashboard",
    "users",
    "roles",
    "organizations",
    "ai",
    "billing",
    "features",
    "releases",
    "roadmap",
    "changelog",
    "analytics",
    "communications",
    "content",
    "system",
    "security",
    "audit",
    "support",
    "infrastructure",
  ];
  assert.deepEqual([...ADMIN_SECTIONS].sort(), [...before].sort());
  assert.equal(new Set(ADMIN_SECTIONS).size, 18);
  const admin = read("src/routes/admin.tsx");
  for (const key of before)
    assert.match(admin, new RegExp(`\\b${key}: \\w+Section|${key}: ExecutiveDashboard`));
  for (const key of ADMIN_MOBILE_PRIMARY) assert.ok(ADMIN_SECTIONS.includes(key));
  // Feature Management and Roles & Permissions remain separate screens in separate groups.
  const groupOf = (key: string) =>
    ADMIN_NAV_GROUPS.find((group) => group.items.some((item) => item.key === key))!.label;
  assert.notEqual(groupOf("features"), groupOf("roles"));
});

test("admin navigation: the open section is part of the address and unknown values are safe", () => {
  assert.equal(adminSectionFrom("billing"), "billing");
  assert.equal(adminSectionFrom("releases"), "releases");
  for (const value of [undefined, null, "", "nope", 7, "Billing", "__proto__"])
    assert.equal(adminSectionFrom(value), "dashboard");
  const admin = read("src/routes/admin.tsx");
  assert.match(admin, /validateSearch/);
  // The console still verifies platform-admin rights before showing anything.
  assert.match(admin, /\/api\/admin\/whoami/);
});

test("'Version Control' is named for what it is: a registry of release records", () => {
  const section = read("src/components/admin/sections/VersionControlSection.tsx");
  assert.match(section, /Release Registry<\/h1>/);
  assert.match(section, /separate from git\/source control/);
  assert.doesNotMatch(read("src/lib/admin-nav.ts"), /label: "Version Control"/);
});

// ---------- 7 & 8. onboarding ----------

const NOTHING_DONE: OnboardingStatus = {
  channel: false,
  video: false,
  comments: false,
  link: false,
};
const saved = (patch: Partial<OnboardingState> = {}): OnboardingState => ({
  ...EMPTY_ONBOARDING_STATE,
  ...patch,
});
const FOLLOWING: OnboardingSession = { guided: true, reviewIndex: null };
const everyone = () => true;
const view = (
  pathname: string,
  status: OnboardingStatus | null = NOTHING_DONE,
  state: OnboardingState = saved(),
  session: OnboardingSession = IDLE_ONBOARDING_SESSION,
  canUseStep: (step: (typeof ONBOARDING_STEPS)[number]) => boolean = everyone,
) => resolveOnboardingView({ status, state, session, pathname, canUseStep });

const commentsNext: OnboardingStatus = { channel: true, video: true, comments: false, link: false };

/** A minimal stand-in for window.localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

test("the guide never appears on a page it has nothing to do with", () => {
  const unrelated = [
    "/videos",
    "/analytics",
    "/audience",
    "/leads",
    "/brand-deals",
    "/reports",
    "/team",
    "/email",
    "/projects",
    "/destinations",
    "/freebie",
    "/affiliate",
    "/support",
    "/notifications",
    "/admin",
    "/videos/abc",
  ];
  for (const pathname of unrelated) {
    assert.equal(view(pathname, commentsNext).kind, "hidden", pathname);
    // …even while following the guide: no overlay travels with the user.
    assert.equal(view(pathname, commentsNext, saved(), FOLLOWING).kind, "hidden", pathname);
  }
});

test("the comment-automation prompt appears only on the Dashboard pill and on its own page", () => {
  const dashboard = view("/dashboard", commentsNext);
  assert.equal(dashboard.kind, "nudge");
  assert.equal(dashboard.kind === "nudge" && dashboard.step.id, "comments");
  assert.deepEqual(dashboard.kind === "nudge" && [dashboard.done, dashboard.total], [2, 4]);
  // On its own page it is a compact hint: nothing is dimmed unless the user asked for the guide.
  assert.equal(view("/comments", commentsNext).kind, "hint");
  assert.equal(view("/comments", commentsNext, saved(), FOLLOWING).kind, "spotlight");
  // Another step's page shows nothing about comments.
  assert.equal(view("/link-tracking", commentsNext).kind, "hidden");
});

test("the spotlight needs an explicit request in the current visit — it is never restored", () => {
  // The reported sequence: "Show me" (following), go to the Dashboard, reload, open Comment
  // Automation directly. A reload starts a new visit: nothing about "following" is saved.
  assert.deepEqual(Object.keys(EMPTY_ONBOARDING_STATE).sort(), ["dismissed", "skipped"]);
  assert.deepEqual(IDLE_ONBOARDING_SESSION, { guided: false, reviewIndex: null });

  // 1. During the visit, "Show me" turns the spotlight on.
  assert.equal(view("/comments", commentsNext, saved(), FOLLOWING).kind, "spotlight");
  // 2. After a reload the saved state is all that is left — even a state written by the
  //    previous version, which did save these flags, is read without them.
  const afterReload = normalizeOnboardingState({
    dismissed: false,
    skipped: [],
    guided: true,
    reviewIndex: 2,
  } as Partial<OnboardingState>);
  assert.deepEqual(afterReload, { dismissed: false, skipped: [] });
  // 3. Opening Comment Automation directly shows the hint, not the spotlight.
  assert.equal(view("/comments", commentsNext, afterReload, IDLE_ONBOARDING_SESSION).kind, "hint");
  // 4. Nor does passing through the Dashboard first turn it on.
  assert.equal(view("/dashboard", commentsNext, afterReload).kind, "nudge");
  assert.equal(view("/comments", commentsNext, afterReload).kind, "hint");

  // The component keeps "following" in memory only and never writes it to storage.
  const tour = read("src/components/OnboardingTour.tsx");
  assert.match(tour, /useSyncExternalStore\(\s*subscribeOnboardingSession/);
  assert.doesNotMatch(tour, /guided: (true|false)[^}]*\}\)\)/, "no guided flag in a saved update");
  assert.doesNotMatch(read("src/lib/onboarding.ts"), /writeStore\([^)]*guided/);
});

test("the in-memory session: following, Back/Next position, ending, and a change of user", () => {
  endOnboardingSession();
  assert.deepEqual(getOnboardingSession(), IDLE_ONBOARDING_SESSION);
  setOnboardingSession({ guided: true, reviewIndex: 1 });
  assert.deepEqual(getOnboardingSession(), { guided: true, reviewIndex: 1 });
  // Escape and Close end it without touching anything saved.
  endOnboardingSession();
  assert.deepEqual(getOnboardingSession(), IDLE_ONBOARDING_SESSION);
  // A different signed-in user never continues the previous user's guide.
  setOnboardingUser("user-a");
  setOnboardingSession({ guided: true, reviewIndex: 2 });
  setOnboardingUser("user-a");
  assert.equal(getOnboardingSession().guided, true, "same user: nothing changes");
  setOnboardingUser("user-b");
  assert.deepEqual(getOnboardingSession(), IDLE_ONBOARDING_SESSION);
  setOnboardingUser(null);
});

test("Back/Next still walks an intentional tour, done steps included", () => {
  const reviewingFirst: OnboardingSession = { guided: true, reviewIndex: 0 };
  assert.equal(view("/settings", commentsNext, saved(), reviewingFirst).kind, "spotlight");
  assert.equal(view("/videos", commentsNext, saved(), reviewingFirst).kind, "hidden");
  const reviewingLast: OnboardingSession = { guided: true, reviewIndex: 3 };
  assert.equal(view("/link-tracking", commentsNext, saved(), reviewingLast).kind, "spotlight");
  // Reopening the guide starts an intentional tour at the first step and un-dismisses it.
  const visited: string[] = [];
  openOnboardingGuide((opts) => void visited.push(opts.to));
  assert.deepEqual(visited, ["/settings"]);
  assert.deepEqual(getOnboardingSession(), { guided: true, reviewIndex: 0 });
  endOnboardingSession();
});

test("closing the guide hides it everywhere until it is reopened", () => {
  const closed = saved({ dismissed: true });
  for (const pathname of ["/dashboard", "/comments", "/settings", "/link-tracking", "/add-video"]) {
    assert.equal(view(pathname, NOTHING_DONE, closed).kind, "hidden", pathname);
    assert.equal(view(pathname, NOTHING_DONE, closed, FOLLOWING).kind, "hidden", pathname);
  }
});

test("a completed step is not asked for again, and a finished guide disappears", () => {
  assert.equal(nextOnboardingStep(commentsNext, saved(), everyone)?.id, "comments");
  const done: OnboardingStatus = { channel: true, video: true, comments: true, link: true };
  assert.equal(nextOnboardingStep(done, saved(), everyone), undefined);
  for (const pathname of ["/dashboard", "/comments", "/settings"])
    assert.equal(view(pathname, done).kind, "hidden", pathname);
  // The page of a step that is already done gets no hint.
  assert.equal(view("/settings", commentsNext).kind, "hidden");
});

test("a skipped step is set aside and the guide moves on", () => {
  const skipped = saved({ skipped: ["comments"] });
  assert.equal(nextOnboardingStep(commentsNext, skipped, everyone)?.id, "link");
  assert.equal(view("/comments", commentsNext, skipped).kind, "hidden");
  const dashboard = view("/dashboard", commentsNext, skipped);
  assert.equal(dashboard.kind === "nudge" && dashboard.step.id, "link");
});

test("a step the user cannot open — role, plan or feature switch — is never offered", () => {
  const noComments = (step: (typeof ONBOARDING_STEPS)[number]) => step.to !== "/comments";
  assert.equal(nextOnboardingStep(commentsNext, saved(), noComments)?.id, "link");
  const idle = IDLE_ONBOARDING_SESSION;
  assert.equal(view("/comments", commentsNext, saved(), idle, noComments).kind, "hidden");
  const dashboard = view("/dashboard", commentsNext, saved(), idle, noComments);
  assert.equal(dashboard.kind === "nudge" && dashboard.step.id, "link");
  assert.deepEqual(dashboard.kind === "nudge" && [dashboard.done, dashboard.total], [2, 3]);
  // Someone who can open none of the steps sees no guide at all.
  assert.equal(view("/dashboard", NOTHING_DONE, saved(), idle, () => false).kind, "hidden");
});

test("unknown completion state shows nothing rather than a guess", () => {
  for (const pathname of ["/dashboard", "/comments"])
    assert.equal(view(pathname, null).kind, "hidden", pathname);
});

test("walking away from the guide ends it, so no spotlight is left waiting", () => {
  for (const pathname of ["/videos", "/leads", "/analytics", "/notifications", "/admin"])
    assert.equal(leftOnboardingFlow(pathname), true, pathname);
  for (const pathname of ["/dashboard", "/settings", "/add-video", "/comments", "/link-tracking"])
    assert.equal(leftOnboardingFlow(pathname), false, pathname);
  const tour = read("src/components/OnboardingTour.tsx");
  assert.match(tour, /leftOnboardingFlow\(pathname\)\) endOnboardingSession\(\)/);
  // The spotlight never captures clicks on the page or its navigation.
  assert.match(tour, /pointer-events-none fixed inset-0/);
});

test("the guide's saved state is kept per user, outside what signing out clears", () => {
  const a = onboardingStorageKey("user-a");
  const b = onboardingStorageKey("user-b");
  assert.notEqual(a, b);
  for (const key of [a, b, onboardingStorageKey(null)])
    assert.ok(!key.startsWith("yroos."), "clearAllStores() removes only the yroos. prefix");
  assert.match(read("src/lib/local-store.ts"), /clearAllStores\(prefix = "yroos\."\)/);
});

test("a legacy dismissal is migrated once, to one user, and can never be claimed again", () => {
  const storage = fakeStorage({ [LEGACY_ONBOARDING_KEY]: JSON.stringify({ dismissed: true }) });
  // The first signed-in user inherits their own earlier dismissal…
  assert.deepEqual(migrateLegacyOnboarding(storage, "user-a"), { dismissed: true, skipped: [] });
  // …and the legacy key is gone at once.
  assert.equal(storage.getItem(LEGACY_ONBOARDING_KEY), null);
  // A second account in the same browser finds nothing to inherit, however often it is asked.
  assert.equal(migrateLegacyOnboarding(storage, "user-b"), null);
  assert.equal(migrateLegacyOnboarding(storage, "user-b"), null);
  // Repeating it for the first user changes nothing either (idempotent).
  assert.equal(migrateLegacyOnboarding(storage, "user-a"), null);
});

test("legacy migration is safe in every other case", () => {
  // Nothing saved by the old version: nothing happens.
  assert.equal(migrateLegacyOnboarding(fakeStorage(), "user-a"), null);
  // A legacy state that was not dismissed migrates nothing, and is still removed.
  const open = fakeStorage({ [LEGACY_ONBOARDING_KEY]: JSON.stringify({ dismissed: false }) });
  assert.equal(migrateLegacyOnboarding(open, "user-a"), null);
  assert.equal(open.getItem(LEGACY_ONBOARDING_KEY), null);
  // The user's own newer state always wins over the legacy one.
  const own = fakeStorage({
    [LEGACY_ONBOARDING_KEY]: JSON.stringify({ dismissed: true }),
    [onboardingStorageKey("user-a")]: JSON.stringify({ dismissed: false, skipped: ["link"] }),
  });
  assert.equal(migrateLegacyOnboarding(own, "user-a"), null);
  assert.equal(own.getItem(LEGACY_ONBOARDING_KEY), null);
  // Unreadable legacy state is dropped, not thrown.
  const broken = fakeStorage({ [LEGACY_ONBOARDING_KEY]: "{not json" });
  assert.equal(migrateLegacyOnboarding(broken, "user-a"), null);
  assert.equal(broken.getItem(LEGACY_ONBOARDING_KEY), null);
  // Nobody signed in: the legacy state is left for the user who does sign in.
  const waiting = fakeStorage({ [LEGACY_ONBOARDING_KEY]: JSON.stringify({ dismissed: true }) });
  assert.equal(migrateLegacyOnboarding(waiting, null), null);
  assert.notEqual(waiting.getItem(LEGACY_ONBOARDING_KEY), null);
});

test("nothing is written to storage while rendering; migration runs in an effect", () => {
  const tour = read("src/components/OnboardingTour.tsx");
  // The storage key is derived without side effects…
  assert.match(tour, /useOnboarding\(onboardingStorageKey\(userId\)\)/);
  assert.doesNotMatch(tour, /selectOnboardingUser/);
  // …and the user switch plus the migration live inside one effect keyed on the user.
  assert.match(
    tour,
    /useEffect\(\(\) => \{\s*setOnboardingUser\(userId\);[\s\S]*?migrateLegacyOnboarding\(window\.localStorage, userId\)[\s\S]*?\}, \[userId\]\);/,
  );
  // A previous user's completion state is never applied to the next user.
  assert.match(tour, /statusFor === userId \? status : null/);
  // The pure helpers themselves never touch storage on import or on key derivation.
  const lib = read("src/lib/onboarding.ts");
  assert.doesNotMatch(lib, /export function onboardingStorageKey[^}]*(writeStore|localStorage)/);
});

test("state saved by previous versions is read safely", () => {
  assert.deepEqual(normalizeOnboardingState({ dismissed: true }), {
    dismissed: true,
    skipped: [],
  });
  assert.deepEqual(normalizeOnboardingState(null), EMPTY_ONBOARDING_STATE);
  assert.deepEqual(normalizeOnboardingState({}), EMPTY_ONBOARDING_STATE);
});

test("finishing a step outside the guide does not send the user anywhere", async () => {
  endOnboardingSession();
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response("{}");
  }) as typeof fetch;
  try {
    const visited: string[] = [];
    await goToNextOnboardingStep((opts) => void visited.push(opts.to), "link");
    assert.deepEqual(visited, [], "no redirect to the next step");
    assert.equal(fetched, 0, "not even a status request");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("finishing a step while following the guide still hands over to the next open step", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ data: { channel: true, video: true, comments: true, link: false } }),
    )) as typeof fetch;
  try {
    setOnboardingSession({ guided: true, reviewIndex: 2 });
    const visited: string[] = [];
    await goToNextOnboardingStep((opts) => void visited.push(opts.to), "comments");
    assert.deepEqual(visited, ["/link-tracking"]);
    assert.deepEqual(getOnboardingSession(), { guided: true, reviewIndex: null });
  } finally {
    globalThis.fetch = realFetch;
    endOnboardingSession();
  }
});

test("the guide can still be reopened from Settings and from the assistant", () => {
  assert.match(read("src/routes/settings.tsx"), /openOnboardingGuide\(navigate\)/);
  assert.match(read("src/components/DashboardLayout.tsx"), /openOnboardingGuide\(navigate\)/);
});

// ---------- C1. the page gate for nested and contextual pages ----------

const NESTED_PAGES = ["/videos/abc123XYZ_-", "/add-video", "/pre-publish", "/pre-publish/42"];

test("the reported defect: the role rules never matched a nested page's literal path", () => {
  // Checked literally — as the gate used to — a Manager is refused pages under Videos…
  for (const path of NESTED_PAGES) assert.equal(canAccessRoute("Manager", path), false, path);
  // …although Videos itself is theirs.
  assert.equal(canAccessRoute("Manager", "/videos"), true);
});

test("a nested page is governed by the entry it belongs to", () => {
  for (const path of NESTED_PAGES) assert.equal(permissionRouteFor(path), "/videos", path);
  for (const item of CREATOR_NAV) assert.equal(permissionRouteFor(item.to), item.to);
  // Pages with no parent keep their own rule; lookalike paths are not swept in.
  for (const path of ["/notifications", "/billing", "/videosomething", "/pre-publishing"])
    assert.equal(permissionRouteFor(path), path, path);
  assert.equal(permissionRouteFor("/settings/"), "/settings");
});

const gate = (role: PlatformRole, pathname: string) =>
  canAccessRoute(role, permissionRouteFor(pathname));

test("Manager and Editor reach the pages under Videos; Setter still does not", () => {
  for (const path of NESTED_PAGES) {
    assert.equal(gate("Owner", path), true, `Owner ${path}`);
    assert.equal(gate("Manager", path), true, `Manager ${path}`);
    assert.equal(gate("Editor", path), true, `Editor ${path}`); // Editors have Videos
    assert.equal(gate("Setter", path), false, `Setter ${path}`); // Setters do not
  }
});

test("the gate widens nothing: for every page with its own entry the answer is unchanged", () => {
  for (const role of ROLES)
    for (const item of CREATOR_NAV)
      assert.equal(gate(role, item.to), canAccessRoute(role, item.to), `${role} ${item.to}`);
  // A nested page is allowed exactly when its parent entry is — never more.
  for (const role of ROLES)
    for (const path of NESTED_PAGES)
      assert.equal(gate(role, path), canAccessRoute(role, "/videos"), `${role} ${path}`);
  // Things no workspace role had before, none has now.
  assert.equal(gate("Manager", "/admin"), false);
  assert.equal(gate("Manager", "/billing"), false);
  assert.equal(gate("Editor", "/team"), false);
  assert.equal(gate("Editor", "/leads"), false);
  assert.equal(gate("Setter", "/videos"), false);
  assert.equal(gate("Setter", "/reports"), false);
});

test("the layout applies the same parent rule to the role check and the feature check", () => {
  const layout = read("src/components/DashboardLayout.tsx");
  assert.match(layout, /const gateRoute = permissionRouteFor\(pathname\);/);
  assert.match(layout, /canAccessRoute\(viewerRole, gateRoute\)/);
  assert.match(layout, /!realFeatureEnabledFor\(gateRoute\)/);
  assert.doesNotMatch(layout, /canAccessRoute\(viewerRole, pathname\)/);
});

// ---------- G3. Lead Inbox: only authorised lead sources are linked ----------

test("lead-source links follow the server's feature access", () => {
  const to = (features: Record<string, boolean> | null) =>
    leadSourceLinks(features).map((link) => link.to);
  // Access not known yet (loading or failed): no link is offered on a guess.
  assert.deepEqual(to(null), []);
  // Both allowed.
  assert.deepEqual(to({ comment_automation: true, freebie: true }), ["/comments", "/freebie"]);
  // A feature the map does not mention is enabled — the server's own default.
  assert.deepEqual(to({}), ["/comments", "/freebie"]);
  // A restricted role sees only what it may open…
  assert.deepEqual(to({ comment_automation: true, freebie: false }), ["/comments"]);
  assert.deepEqual(to({ comment_automation: false, freebie: true }), ["/freebie"]);
  // …and nothing at all when neither is allowed.
  assert.deepEqual(to({ comment_automation: false, freebie: false }), []);
  // The keys are the server's feature keys for those two pages.
  const layout = read("src/components/DashboardLayout.tsx");
  for (const source of LEAD_SOURCES)
    assert.match(layout, new RegExp(`"${source.to}": "${source.feature}"`));
});

test("the Lead Inbox empty state stays informative when no source may be linked", () => {
  const leads = read("src/routes/leads.tsx");
  assert.match(leads, /fetch\("\/api\/features\/access"/);
  assert.match(leads, /leadSourceLinks\(featureAccess\)/);
  assert.match(leads, /sourceLinks\.length > 0 && \(/);
  assert.doesNotMatch(leads, /<Link to="\/(comments|freebie)"/, "no unconditional link");
  // The explanation itself does not depend on the links.
  assert.match(leads, /No leads captured yet/);
  assert.match(leads, /you can add one by hand with New Lead/);
});

// ---------- 9. Videos: count line, empty states, badges ----------

test("the Videos count line says which number is which", () => {
  const line = (input: Partial<Parameters<typeof videosCountLine>[0]>) =>
    videosCountLine({
      shown: 0,
      loaded: 0,
      hasMore: false,
      channelVideoCount: 0,
      searching: false,
      ...input,
    });
  assert.deepEqual(line({ shown: 12, loaded: 12, channelVideoCount: 12 }), {
    text: "12 videos",
    hint: null,
  });
  assert.equal(line({ shown: 1, loaded: 1, channelVideoCount: 1 }).text, "1 video");
  assert.equal(
    line({ shown: 50, loaded: 50, hasMore: true, channelVideoCount: 312 }).text,
    "Showing 50 of 312 videos",
  );
  // The production case: nothing listed, but YouTube's channel statistic still says 2.
  assert.deepEqual(line({ channelVideoCount: 2 }), {
    text: "0 public videos listed · YouTube counts 2 on this channel",
    hint: CHANNEL_COUNT_HINT,
  });
  assert.doesNotMatch(line({ channelVideoCount: 2 }).text, /0 of 2 published/);
  assert.equal(
    line({ shown: 3, loaded: 40, channelVideoCount: 40, searching: true }).text,
    "3 of 40 loaded videos match",
  );
});

test("an empty Videos table says why it is empty and what to do", () => {
  const noMatch = videosEmptyState({ search: " budget ", channelVideoCount: 40 })!;
  assert.equal(noMatch.kind, "no_match");
  assert.equal(noMatch.action, "clear_search");
  assert.match(noMatch.title, /budget/);

  const none = videosEmptyState({ search: "", channelVideoCount: 0 })!;
  assert.equal(none.kind, "no_videos");
  assert.match(none.description, /appear here automatically/);

  const unlisted = videosEmptyState({ search: "", channelVideoCount: 2 })!;
  assert.equal(unlisted.kind, "none_listed");
  assert.match(unlisted.description, /counts 2/);
  assert.match(unlisted.description, /private, unlisted, scheduled or removed/);
  assert.equal(unlisted.action, "refresh");
});

test("with video sync switched off, nothing claims that YouTube lists no videos", () => {
  // What the route returns then: an empty list beside the stored channel count.
  const line = videosCountLine({
    shown: 0,
    loaded: 0,
    hasMore: false,
    channelVideoCount: 12,
    searching: false,
    syncDisabled: true,
  });
  assert.deepEqual(line, { text: "Video sync is turned off", hint: null });
  assert.doesNotMatch(line.text, /listed|YouTube counts|public/);
  // No empty-state explanation applies — the page's own "sync is disabled" notice is the story.
  assert.equal(videosEmptyState({ search: "", channelVideoCount: 12, syncDisabled: true }), null);
  assert.equal(videosEmptyState({ search: "", channelVideoCount: 0, syncDisabled: true }), null);
  assert.equal(videosEmptyState({ search: "x", channelVideoCount: 12, syncDisabled: true }), null);
  // The other states are exactly as before.
  assert.equal(videosEmptyState({ search: "", channelVideoCount: 12 })!.kind, "none_listed");
  assert.equal(
    videosEmptyState({ search: "", channelVideoCount: 12, syncDisabled: false })!.kind,
    "none_listed",
  );
  assert.equal(videosEmptyState({ search: "", channelVideoCount: 0 })!.kind, "no_videos");
  assert.equal(videosEmptyState({ search: "x", channelVideoCount: 12 })!.kind, "no_match");

  const page = read("src/routes/videos.tsx");
  // The banner is still rendered for the disabled state, and the empty state needs a reason.
  assert.match(page, /state\.status === "disabled" && \(\s*<div[^>]*>\s*Video sync is disabled/);
  assert.match(page, /!filteredVideos\.length && emptyState && \(/);
  assert.equal(page.match(/syncDisabled: state\.status === "disabled"/g)?.length, 2);
});

test("the Videos page keeps not-connected, loading, reauthorization and failure apart", () => {
  const page = read("src/routes/videos.tsx");
  assert.match(page, /state\.status === "loading" && <LoadingState \/>/);
  assert.match(page, /state\.status === "not_connected"/);
  assert.match(page, /state\.status === "reauth"/);
  assert.match(page, /state\.status === "error" && \(\s*<ErrorState/);
  assert.match(page, /does not mean your channel needs reconnecting/);
  assert.match(page, /<EmptyState/);
  assert.doesNotMatch(page, /published videos`/);
});

const videoRow = (id: string, usd: number, views: number) => ({
  youtubeVideoId: id,
  revenue: { usd, availability: "available", knownDays: 5, unknownDays: 0 },
  views,
  currentlyListed: true,
  change: { views: { current: views, previous: views, absolute: 0, percent: 0 } },
});
const videosResponse = (rows: ReturnType<typeof videoRow>[]) =>
  ({
    videos: rows,
    dataQuality: { freshness: { latestStoredDay: "2026-10-06", missingDays: [] }, sync: [] },
  }) as unknown as RevenueVideosResponse;

test("a single video is not called Top Performer: there is nothing to rank it against", () => {
  assert.equal(MIN_VIDEOS_TO_RANK, 2);
  const alone = mapVideosRevenuePage(videosResponse([videoRow("ONLYVIDEO01", 0, 31)]), null);
  assert.equal(alone.cells.get("ONLYVIDEO01")!.status, "Steady");
  const aloneEarning = mapVideosRevenuePage(
    videosResponse([videoRow("ONLYVIDEO01", 12, 31)]),
    null,
  );
  assert.notEqual(aloneEarning.cells.get("ONLYVIDEO01")!.status, "Top Performer");
  assert.notEqual(aloneEarning.cells.get("ONLYVIDEO01")!.status, "High Revenue");
  // The figures themselves are untouched.
  assert.equal(aloneEarning.cells.get("ONLYVIDEO01")!.revenue.text, "$12.00");

  const two = mapVideosRevenuePage(
    videosResponse([videoRow("AAAAAAAAAAA", 5, 10), videoRow("BBBBBBBBBBB", 9, 10)]),
    null,
  );
  assert.equal(two.cells.get("BBBBBBBBBBB")!.status, "Top Performer");
  assert.equal(two.cells.get("AAAAAAAAAAA")!.status, "Steady");
});

// ---------- other pages' states ----------

test("Brand Deals, Reports and Lead Inbox use the shared states and name the next step", () => {
  const deals = read("src/routes/brand-deals.tsx");
  assert.match(deals, /status === "ready" && deals\.length === 0 && \(\s*<EmptyState/);
  assert.match(deals, /No brand deals tracked yet/);
  assert.match(deals, /Add your first deal/);
  assert.match(deals, /<ErrorState/);
  assert.match(deals, /<ListLoadingState/);

  const reports = read("src/routes/reports.tsx");
  assert.match(reports, /<ErrorState/);
  assert.match(reports, /<ListLoadingState/);
  assert.match(reports, /title="Brand Deal Revenue Closed"/);

  const leads = read("src/routes/leads.tsx");
  assert.match(leads, /No leads captured yet/);
  assert.match(leads, /No leads match this filter\./);
  assert.match(leads, /leads\.length === 0/);
});

// ---------- 10. canonical revenue wiring is untouched ----------

test("Dashboard, Analytics and Videos still load revenue through the canonical modules", () => {
  assert.match(read("src/routes/dashboard.tsx"), /@\/lib\/dashboard-revenue/);
  assert.match(read("src/routes/analytics.tsx"), /@\/lib\/analytics-revenue/);
  assert.match(read("src/routes/videos.tsx"), /@\/lib\/videos-revenue/);
  for (const page of ["dashboard", "analytics", "videos"])
    assert.doesNotMatch(read(`src/routes/${page}.tsx`), /\bCPM\b/, page);
});
