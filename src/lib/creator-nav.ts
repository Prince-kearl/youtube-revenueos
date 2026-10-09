// The creator application's navigation: which pages exist, what they are called, and how they
// are grouped. Pure data (no React, no icons) so the structure itself is unit-tested; the layout
// adds the icons and decides what the signed-in user may see.
//
// Grouping follows how the product is used: see how the channel is doing, understand the
// content, capture the attention it earns, make money from it, talk to the people it brings in.
//
// This file only arranges links. It grants nothing: every entry is still filtered by the role and
// feature checks in DashboardLayout, and every page's data is authorised again on the server.

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

export interface CreatorNavGroup {
  label: string;
  items: string[];
}

export const CREATOR_NAV_GROUPS: readonly CreatorNavGroup[] = [
  { label: "Overview", items: ["/dashboard"] },
  { label: "Content & Insights", items: ["/videos", "/analytics", "/audience", "/ai-lab"] },
  { label: "Attribution & Capture", items: ["/destinations", "/link-tracking", "/freebie"] },
  { label: "Monetization", items: ["/brand-deals"] },
  { label: "Engagement & Leads", items: ["/comments", "/leads", "/email"] },
  {
    label: "Workspace & Tools",
    items: ["/projects", "/reports", "/team", "/settings", "/support"],
  },
  { label: "Account", items: ["/affiliate"] },
  { label: "Platform", items: ["/admin"] },
];

/** The four destinations on the phone's bottom bar; everything else is under "More". */
export const CREATOR_MOBILE_PRIMARY: readonly string[] = [
  "/dashboard",
  "/videos",
  "/comments",
  "/analytics",
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

/** The groups with only the routes `canSee` allows, dropping groups left empty. */
export function visibleCreatorNavGroups(canSee: (to: string) => boolean): CreatorNavGroup[] {
  return CREATOR_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);
}
