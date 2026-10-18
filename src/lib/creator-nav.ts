// The creator application's navigation: which pages exist, what they are called, and how they
// are grouped. Pure data (no React, no icons) so the structure itself is unit-tested; the layout
// adds the icons and decides what the signed-in user may see.
//
// The menu is kept short: seven main entries, each a "hub" whose related pages open as tabs at
// the top of the page (Analytics → Channel · Audience · Reports), and the occasional pages (Team,
// Settings, Referrals, Support, Admin Console) under the account card. Every page keeps its own
// address, so old links and bookmarks still open it, with its hub highlighted.
//
// This file only arranges links. It grants nothing: every page — hub entry or tab — is still
// filtered by its own role and feature checks in DashboardLayout, a hub with no page left to show
// disappears, and every page's data is authorised again on the server.

export interface CreatorNavItem {
  to: string;
  label: string;
  /** Synonyms for the global search ("money" should still find Brand Deals). */
  keywords: string;
}

// `keywords` back the smart search with synonyms a literal label match would miss.
export const CREATOR_NAV: readonly CreatorNavItem[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    keywords: "home overview stats summary revenue",
  },
  { to: "/videos", label: "Videos", keywords: "clips uploads content youtube" },
  {
    to: "/analytics",
    label: "Analytics",
    keywords: "stats metrics performance revenue insights",
  },
  {
    to: "/audience",
    label: "Audience",
    keywords: "demographics viewers subscribers age gender location",
  },
  {
    to: "/ai-lab",
    label: "AI Description Lab",
    keywords: "ai lab tools generate assistant description optimise",
  },
  { to: "/destinations", label: "Destinations", keywords: "bio link redirects" },
  { to: "/link-tracking", label: "Link Tracking", keywords: "links urls clicks utm" },
  {
    to: "/freebie",
    label: "Freebie Generator",
    keywords: "ai lead magnet giveaway freebie opt-in",
  },
  {
    to: "/brand-deals",
    label: "Brand Deals",
    keywords: "sponsorship partnership money income deals",
  },
  {
    to: "/comments",
    label: "Comment Automation",
    keywords: "auto reply bot comments",
  },
  { to: "/leads", label: "Lead Inbox", keywords: "leads contacts inbox dm messages" },
  { to: "/email", label: "Email", keywords: "campaigns newsletter" },
  { to: "/projects", label: "Projects", keywords: "campaigns work" },
  { to: "/reports", label: "Reports", keywords: "exports csv summary" },
  { to: "/team", label: "Team", keywords: "members roles staff invite" },
  { to: "/settings", label: "Settings", keywords: "preferences config account" },
  { to: "/support", label: "Support", keywords: "help contact faq" },
  // Tubify's own referral programme (refer a customer, earn commission) — not a tracker for the
  // creator's affiliate income, so it sits with the account rather than under Monetization.
  {
    to: "/affiliate",
    label: "Referrals",
    keywords: "affiliate commission referral partner refer",
  },
  { to: "/admin", label: "Admin Console", keywords: "superadmin platform" },
];

export interface CreatorNavTab {
  to: string;
  /** The tab's name on its hub's page ("Channel" for /analytics under Analytics). */
  label: string;
}

export interface CreatorNavHub {
  id: string;
  label: string;
  /** The hub's pages, in tab order. The first one the user may open is where the entry leads. */
  tabs: readonly CreatorNavTab[];
}

export const CREATOR_NAV_HUBS: readonly CreatorNavHub[] = [
  { id: "dashboard", label: "Dashboard", tabs: [{ to: "/dashboard", label: "Dashboard" }] },
  {
    id: "videos",
    label: "Videos",
    tabs: [
      { to: "/videos", label: "All videos" },
      { to: "/ai-lab", label: "AI Description Lab" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    tabs: [
      { to: "/analytics", label: "Channel" },
      { to: "/audience", label: "Audience" },
      { to: "/reports", label: "Reports" },
    ],
  },
  {
    id: "links",
    label: "Links",
    tabs: [
      { to: "/destinations", label: "Destinations" },
      { to: "/link-tracking", label: "Link Tracking" },
      { to: "/freebie", label: "Freebies" },
    ],
  },
  { id: "brand-deals", label: "Brand Deals", tabs: [{ to: "/brand-deals", label: "Brand Deals" }] },
  {
    id: "inbox",
    label: "Inbox",
    tabs: [
      { to: "/comments", label: "Comments" },
      { to: "/leads", label: "Leads" },
      { to: "/email", label: "Email" },
    ],
  },
  { id: "projects", label: "Projects", tabs: [{ to: "/projects", label: "Projects" }] },
];

/** Pages used now and then, listed under the account card rather than in the main menu. */
export const CREATOR_ACCOUNT_NAV: readonly string[] = [
  "/team",
  "/settings",
  "/affiliate",
  "/support",
  "/admin",
];

/** The four hubs on the phone's bottom bar; everything else is under "More". */
export const CREATOR_MOBILE_PRIMARY: readonly string[] = [
  "dashboard",
  "videos",
  "analytics",
  "inbox",
];

// Pages that have no entry of their own but belong to one: opening a video, analysing one, or
// checking a draft before publishing are all part of Videos.
const NESTED_UNDER: ReadonlyArray<readonly [prefix: string, owner: string]> = [
  ["/videos/", "/videos"],
  ["/add-video", "/videos"],
  ["/pre-publish", "/videos"],
];

/** The navigation entry to highlight for a pathname, or null when the page belongs to none
 * (for example Notifications). */
export function activeCreatorNavRoute(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (CREATOR_NAV.some((item) => item.to === path)) return path;
  for (const [prefix, owner] of NESTED_UNDER)
    if (path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))
      return owner;
  return null;
}

/**
 * The route whose permission governs a page. A page with its own navigation entry answers for
 * itself; a nested or contextual page (a single video, Analyze Video, Pre-Publish) is governed by
 * the entry it belongs to — whoever may open Videos may open a video, and whoever may not, may
 * not. Any other path (Notifications, for example) is returned unchanged and keeps its own rule.
 *
 * This is deliberately a separate function from activeCreatorNavRoute even though the two agree
 * today: which entry lights up and which permission applies are different questions, and a page
 * could one day be highlighted under one entry while requiring another's access.
 */
export function permissionRouteFor(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (CREATOR_NAV.some((item) => item.to === path)) return path;
  for (const [prefix, owner] of NESTED_UNDER)
    if (path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))
      return owner;
  return path;
}

export interface VisibleCreatorNavHub extends CreatorNavHub {
  /** Where the hub's entry leads: its first tab the user may open. */
  to: string;
}

/** The hubs with only the tabs `canSee` allows, dropping hubs left with none. */
export function visibleCreatorNavHubs(canSee: (to: string) => boolean): VisibleCreatorNavHub[] {
  return CREATOR_NAV_HUBS.flatMap((hub) => {
    const tabs = hub.tabs.filter((tab) => canSee(tab.to));
    return tabs.length ? [{ ...hub, tabs, to: tabs[0].to }] : [];
  });
}

/** The account-card pages `canSee` allows. */
export function visibleCreatorAccountNav(canSee: (to: string) => boolean): string[] {
  return CREATOR_ACCOUNT_NAV.filter(canSee);
}

/** The hub to highlight for a pathname (a tab's page, or a page nested under one), or null. */
export function activeCreatorNavHub(pathname: string): string | null {
  const route = activeCreatorNavRoute(pathname);
  return CREATOR_NAV_HUBS.find((hub) => hub.tabs.some((tab) => tab.to === route))?.id ?? null;
}

/**
 * The tabs to show at the top of a page: only on a hub's own tab pages (not on a single video,
 * say), only the tabs `canSee` allows, and only when there is more than one to choose from.
 */
export function creatorHubTabsFor(
  pathname: string,
  canSee: (to: string) => boolean,
): VisibleCreatorNavHub | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const hub = visibleCreatorNavHubs(canSee).find((entry) =>
    entry.tabs.some((tab) => tab.to === path),
  );
  return hub && hub.tabs.length > 1 ? hub : null;
}
