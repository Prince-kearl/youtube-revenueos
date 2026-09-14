import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Video,
  Sparkles,
  MapPin,
  Link2,
  BarChart3,
  TrendingUp,
  FileText,
  Settings,
  ChevronLeft,
  Search,
  Plus,
  Bell,
  HelpCircle,
  FolderKanban,
  MessageSquare,
  Users,
  Gift,
  Handshake,
  Mail,
  UserPlus,
  LifeBuoy,
  Inbox,
  LogOut,
  User as UserIcon,
  Send,
  Menu,
  Shield,
  Crown,
  Target,
  Pencil,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  useDeals,
  useProfile,
  useViewerRole,
  useFeatureFlags,
  useSidebarCollapsed,
  useSiteContent,
  canAccessRoute,
  FEATURE_META,
  PLATFORM_ROLES,
  type PlatformRole,
  type FeatureKey,
} from "@/lib/stores";
import { clearAllStores, uid, useLocalStore } from "@/lib/local-store";
import { clearChannelSettings } from "@/lib/channel-settings";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { llm } from "@/lib/llm";
import { DealDialog } from "@/components/modals";
import { NotificationRow, type AppNotification } from "@/components/NotificationRow";
import { OnboardingTour } from "@/components/OnboardingTour";
import { openOnboardingGuide } from "@/lib/onboarding";
import { useAuthSession } from "@/lib/supabase/use-auth-session";
import { BrandedLoader } from "@/components/skeletons";
import { signOutSupabase } from "@/lib/supabase/auth";
import {
  YoutubeChannelSwitcher,
  ACTIVE_YOUTUBE_CHANNEL_KEY,
} from "@/components/YoutubeChannelSwitcher";
import { IS_LOCAL_DEMO, DEMO_YOUTUBE_DASHBOARD } from "@/lib/demo-youtube";

// `keywords` back the smart search below with synonyms a literal label match would miss
// (e.g. searching "money" or "sponsorship" should still surface Brand Deals).
const nav = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    keywords: "home overview stats summary revenue",
  },
  { to: "/videos", label: "Videos", icon: Video, keywords: "clips uploads content youtube" },
  { to: "/projects", label: "Projects", icon: FolderKanban, keywords: "campaigns work" },
  { to: "/ai-lab", label: "AI Lab", icon: Sparkles, keywords: "ai tools generate assistant" },
  { to: "/destinations", label: "Destinations", icon: MapPin, keywords: "bio link redirects" },
  { to: "/link-tracking", label: "Link Tracking", icon: Link2, keywords: "links urls clicks utm" },
  {
    to: "/comments",
    label: "Comment Automation",
    icon: MessageSquare,
    keywords: "auto reply bot comments",
  },
  { to: "/leads", label: "Lead Inbox", icon: Inbox, keywords: "leads contacts inbox dm messages" },
  {
    to: "/audience",
    label: "Audience",
    icon: Users,
    keywords: "demographics viewers subscribers age gender location",
  },
  {
    to: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    keywords: "stats metrics performance revenue insights",
  },
  {
    to: "/affiliate",
    label: "Affiliate",
    icon: Handshake,
    keywords: "commission referral partner",
  },
  { to: "/freebie", label: "AI Freebie", icon: Gift, keywords: "lead magnet giveaway freebie" },
  { to: "/email", label: "Email", icon: Mail, keywords: "campaigns newsletter" },
  {
    to: "/brand-deals",
    label: "Brand Deals",
    icon: TrendingUp,
    keywords: "sponsorship partnership money income deals",
  },
  { to: "/team", label: "Team", icon: UserPlus, keywords: "members roles staff invite" },
  { to: "/reports", label: "Reports", icon: FileText, keywords: "exports csv summary" },
  { to: "/support", label: "Support", icon: LifeBuoy, keywords: "help contact faq" },
  { to: "/settings", label: "Settings", icon: Settings, keywords: "preferences config account" },
  { to: "/admin", label: "Admin Console", icon: Shield, keywords: "superadmin platform" },
] as const;

const primaryMobileNav = nav.filter((item) =>
  (["/dashboard", "/videos", "/comments", "/analytics"] as string[]).includes(item.to),
);

// The active pill widens to show its label (see the mobile nav render below) — "Comment
// Automation" at full length dwarfs the other icon-only tabs, so it gets a shorter stand-in here.
// aria-label/title still use the full nav label; this only affects the visible pill text.
const MOBILE_NAV_SHORT_LABEL: Partial<Record<string, string>> = {
  "/comments": "Comments",
};

const navGroups: { label: string; items: (typeof nav)[number]["to"][] }[] = [
  { label: "Overview", items: ["/dashboard"] },
  { label: "Content", items: ["/videos", "/projects", "/ai-lab"] },
  {
    label: "Growth",
    items: ["/destinations", "/link-tracking", "/comments", "/leads", "/audience", "/analytics"],
  },
  { label: "Revenue", items: ["/affiliate", "/freebie", "/email", "/brand-deals", "/team"] },
  { label: "General", items: ["/reports", "/support", "/settings"] },
  { label: "Platform", items: ["/admin"] },
];

const ROLE_META: Record<PlatformRole, { icon: typeof Shield; color: string }> = {
  Superadmin: { icon: Shield, color: "text-brand-purple bg-brand-purple/10" },
  Owner: { icon: Crown, color: "text-primary bg-primary/10" },
  Manager: { icon: Users, color: "text-brand-green bg-brand-green/10" },
  Setter: { icon: Target, color: "text-brand-amber bg-brand-amber/10" },
  Editor: { icon: Pencil, color: "text-muted-foreground bg-accent" },
};

// "Preview as role" now simulates real WORKSPACE roles (see api.features.access.ts) — Superadmin
// isn't a workspace role at all, so it's excluded here even though PLATFORM_ROLES (the older demo
// nav-gating list) still includes it for its own unrelated purpose.
const WORKSPACE_PREVIEW_ROLES = PLATFORM_ROLES.filter((role) => role !== "Superadmin");

const ROUTE_FEATURE: Partial<Record<string, FeatureKey>> = Object.fromEntries(
  (Object.entries(FEATURE_META) as [FeatureKey, (typeof FEATURE_META)[FeatureKey]][]).map(
    ([key, meta]) => [meta.route, key],
  ),
);

// Maps each route to the `features.key` row it corresponds to in the database (see the
// 202609120001_feature_management.sql migration) — the real, Superadmin-managed, per-role system.
// Distinct from ROUTE_FEATURE above, which drives the older, flat, non-role-specific demo toggle.
const NAV_ROUTE_TO_FEATURE_KEY: Record<string, string> = {
  "/dashboard": "dashboard",
  "/videos": "videos",
  "/projects": "projects",
  "/ai-lab": "ai_lab",
  "/destinations": "destinations",
  "/link-tracking": "link_tracking",
  "/comments": "comment_automation",
  "/leads": "leads",
  "/audience": "audience",
  "/analytics": "analytics",
  "/affiliate": "affiliate",
  "/freebie": "freebie",
  "/email": "email",
  "/brand-deals": "brand_deals",
  "/team": "team",
  "/reports": "reports",
};

// ============ SMART SEARCH ============
// Powers the global search below — tolerates typos and near-miss spelling (edit distance,
// scaled to word length) and doesn't require word order to match ("revenue video" still finds
// "Creator Revenue Systems"). Every query word must match *something* in the target text (AND
// semantics) so unrelated multi-word queries don't return everything.
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      currentRow.push(
        a[i] === b[j]
          ? previousRow[j]
          : 1 + Math.min(previousRow[j], previousRow[j + 1], currentRow[j]),
      );
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}

function searchMatchScore(query: string, text: string): number | null {
  const trimmedQuery = query.trim().toLowerCase();
  const targetText = text.toLowerCase();
  if (!trimmedQuery) return null;
  if (targetText.includes(trimmedQuery)) return 100;

  const queryWords = trimmedQuery.split(/\s+/).filter(Boolean);
  const targetWords = targetText.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const queryWord of queryWords) {
    let bestWordScore = 0;
    for (const targetWord of targetWords) {
      // Guard against trivial matches like "a"/"of"/"the" being a substring of nearly every
      // longer query word — only take the substring shortcut once both sides have real content.
      if (
        Math.min(queryWord.length, targetWord.length) >= 3 &&
        (targetWord.includes(queryWord) || queryWord.includes(targetWord))
      ) {
        bestWordScore = Math.max(bestWordScore, 10);
        continue;
      }
      const distance = levenshteinDistance(queryWord, targetWord);
      const tolerance = queryWord.length <= 4 ? 1 : queryWord.length <= 7 ? 2 : 3;
      if (distance <= tolerance) bestWordScore = Math.max(bestWordScore, 8 - distance);
    }
    if (bestWordScore === 0) return null; // this query word matched nothing at all — reject
    score += bestWordScore;
  }
  return score;
}

function rankSearchMatches<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
  limit: number,
): T[] {
  return items
    .map((item) => ({ item, score: searchMatchScore(query, getText(item)) }))
    .filter((row): row is { item: T; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);
}

export function DashboardLayout({
  title,
  children,
  hideAppNav,
}: {
  title: string;
  children: ReactNode;
  hideAppNav?: boolean;
}) {
  const { user, loading: authLoading } = useAuthSession();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [siteContent] = useSiteContent();
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [profile, setProfile] = useProfile();
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [deals, setDeals] = useDeals();
  const [viewerRole, setViewerRole] = useViewerRole();
  const [flags] = useFeatureFlags();
  const keyboardOpen = useKeyboardInset() > 150;
  const visibleNotifs = notifs
    .filter((n) => !n.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const unread = notifs.filter((n) => !n.read && !n.archived).length;
  const previousUserId = useRef<string | null>(null);
  // Drives the connection dot on the sidebar's YouTube badge — null while still checking, so the
  // dot doesn't flash "disconnected" before the real answer arrives.
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/youtube/channels", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("channels_failed");
        const body = (await response.json()) as { data?: unknown[] };
        setYoutubeConnected(Boolean(body.data?.length));
      })
      .catch(() => setYoutubeConnected(false));
    return () => controller.abort();
  }, []);

  // Real platform-staff admin status (profiles.role, distinct from the workspace-role
  // viewerRole/authenticatedRole below) — the only thing that should decide whether the Admin
  // Console nav link and route are reachable. admin.tsx independently re-verifies this server-side
  // on every request, so this is purely for nav visibility / avoiding the "Access restricted"
  // dead end for a real superadmin whose workspace role isn't Owner/Manager.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/whoami", { signal: controller.signal, cache: "no-store" })
      .then((response) => setIsPlatformAdmin(response.ok))
      .catch(() => setIsPlatformAdmin(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/notifications", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { data?: AppNotification[] };
        setNotifs(body.data ?? []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const isLocked = (to: string) => {
    const feature = ROUTE_FEATURE[to];
    return !!feature && !flags[feature] && viewerRole !== "Superadmin";
  };

  // Real, server-backed feature access for the signed-in user's actual role (see
  // src/lib/server/feature-access.ts) — additive on top of the demo PlatformRole/flags system
  // above, never looser than it. null while loading means "don't hide anything yet" so nav
  // doesn't flash empty before the real answer arrives; every route this gates is also enforced
  // server-side independently, so this is UX only, not the real security boundary.
  //
  // authenticatedRole is the caller's REAL workspace membership role (lowercase —
  // owner/manager/setter/editor — see src/lib/server/workspace.ts; NOT profiles.role, the
  // separate platform-staff role behind the Superadmin console), never influenced by the
  // viewerRole demo switcher below. Only a workspace owner or manager may turn viewerRole into a
  // genuine "Preview as role" simulation — for everyone else it's ignored (see the reset effect
  // further down), so a stale/restrictive localStorage value from playing with the old demo can
  // never leave a non-privileged real user under-navigated.
  const [realFeatureAccess, setRealFeatureAccess] = useState<Record<string, boolean> | null>(null);
  const [authenticatedRole, setAuthenticatedRole] = useState<string | null>(null);
  const canPreviewRoles = authenticatedRole === "owner" || authenticatedRole === "manager";
  useEffect(() => {
    const controller = new AbortController();
    const previewParam = canPreviewRoles ? `?previewRole=${viewerRole.toLowerCase()}` : "";
    fetch(`/api/features/access${previewParam}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("features_failed");
        const body = (await response.json()) as {
          data?: { role: string; features: Record<string, boolean> };
        };
        if (body.data?.role) setAuthenticatedRole(body.data.role);
        setRealFeatureAccess(body.data?.features ?? {});
      })
      .catch(() => setRealFeatureAccess({}));
    return () => controller.abort();
    // canPreviewRoles derives from authenticatedRole itself (state this same effect sets), so
    // including it would refetch on every response with no new intent — viewerRole is the only
    // real trigger for a new preview simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRole]);

  // A real, non-privileged user whose browser still has a restrictive value saved from the old
  // demo switcher (e.g. "Setter") gets snapped back to the fully-open baseline the first time we
  // learn their real role — the real feature-access fetch above is what actually governs their
  // nav from here on, not this legacy value.
  useEffect(() => {
    if (authenticatedRole && !canPreviewRoles && viewerRole !== "Owner") {
      setViewerRole("Owner");
    }
  }, [authenticatedRole, canPreviewRoles, viewerRole, setViewerRole]);

  // For a Superadmin/Owner who's never touched the preview switcher, viewerRole still sits at the
  // old demo's generic default ("Owner") — without this, that default reads as "previewing Owner"
  // the instant we learn a real role like Superadmin, showing the preview banner to someone who
  // never asked for a preview. Sync it to their own real role once per page load; any deliberate
  // choice they make afterward (including choosing "Owner" on purpose) is left alone.
  const previewRoleInitialized = useRef(false);
  useEffect(() => {
    if (!authenticatedRole || !canPreviewRoles || previewRoleInitialized.current) return;
    previewRoleInitialized.current = true;
    const ownRole = (authenticatedRole.charAt(0).toUpperCase() +
      authenticatedRole.slice(1)) as PlatformRole;
    if (viewerRole !== ownRole) setViewerRole(ownRole);
  }, [authenticatedRole, canPreviewRoles, viewerRole, setViewerRole]);

  const realFeatureEnabledFor = (to: string) => {
    if (!realFeatureAccess) return true;
    const key = NAV_ROUTE_TO_FEATURE_KEY[to];
    if (!key) return true;
    return realFeatureAccess[key] ?? true;
  };
  // /admin defers to the real platform-staff check (isPlatformAdmin) instead of the workspace-role
  // preview — see the routeAllowed comment below for why canAccessRoute alone can never admit a
  // real Superadmin/Owner here.
  const canReachRoute = (to: string) =>
    to === "/admin" ? isPlatformAdmin : canAccessRoute(viewerRole, to);
  const visibleNav = nav.filter((item) => canReachRoute(item.to) && realFeatureEnabledFor(item.to));
  const visibleNavGroups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((to) => canReachRoute(to) && realFeatureEnabledFor(to)),
    }))
    .filter((g) => g.items.length > 0);
  const visiblePrimaryMobileNav = primaryMobileNav.filter(
    (item) => canReachRoute(item.to) && realFeatureEnabledFor(item.to),
  );

  // Global search — searches pages plus real content (videos, leads, brand deals), not just nav
  // labels. Videos are fetched lazily on first focus rather than eagerly on every page load, since
  // this component mounts on every authenticated route.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVideos, setSearchVideos] = useState<
    Array<{ id: string; title: string; thumbnail: string | null }>
  >([]);
  const searchVideosLoadedRef = useRef(false);
  const [searchLeads, setSearchLeads] = useState<
    Array<{ id: string; name: string; username: string | null }>
  >([]);
  const searchLeadsLoadedRef = useRef(false);
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const mobileSearchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const loadSearchVideos = () => {
    if (searchVideosLoadedRef.current) return;
    searchVideosLoadedRef.current = true;
    if (IS_LOCAL_DEMO) {
      setSearchVideos(
        DEMO_YOUTUBE_DASHBOARD.videos.map((v) => ({
          id: v.id,
          title: v.title,
          thumbnail: v.thumbnail,
        })),
      );
      return;
    }
    const params = new URLSearchParams({ limit: "50" });
    if (activeChannelId) params.set("channelId", activeChannelId);
    fetch(`/api/youtube/videos?${params.toString()}`, { cache: "default" })
      .then(async (response) => {
        const body = (await response.json()) as {
          status?: string;
          data?: { videos?: Array<{ id: string; title: string; thumbnail: string | null }> };
        };
        if (body.status === "connected" && body.data?.videos) {
          setSearchVideos(
            body.data.videos.map((v) => ({ id: v.id, title: v.title, thumbnail: v.thumbnail })),
          );
        }
      })
      .catch(() => {});
  };

  const loadSearchLeads = () => {
    if (searchLeadsLoadedRef.current) return;
    searchLeadsLoadedRef.current = true;
    fetch("/api/leads", { cache: "default" })
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: Array<{ id: string; name: string; username: string | null }>;
        };
        if (response.ok && body.data) {
          setSearchLeads(body.data.map((l) => ({ id: l.id, name: l.name, username: l.username })));
        }
      })
      .catch(() => {});
  };

  const openSearch = (input: "desktop" | "mobile") => {
    setSearchOpen(true);
    loadSearchVideos();
    loadSearchLeads();
    requestAnimationFrame(() =>
      (input === "desktop" ? searchInputRef : mobileSearchInputRef).current?.focus(),
    );
  };

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q)
      return {
        pages: [] as typeof visibleNav,
        videos: [] as typeof searchVideos,
        leads: [] as typeof searchLeads,
        deals: [] as typeof deals,
      };
    return {
      pages: rankSearchMatches(visibleNav, q, (item) => `${item.label} ${item.keywords}`, 5),
      videos: rankSearchMatches(searchVideos, q, (v) => v.title, 5),
      leads: rankSearchMatches(searchLeads, q, (l) => `${l.name} ${l.username ?? ""}`, 5),
      deals: rankSearchMatches(deals, q, (d) => `${d.company} ${d.contact}`, 5),
    };
  }, [searchQuery, visibleNav, searchVideos, searchLeads, deals]);
  const hasSearchResults =
    searchResults.pages.length +
      searchResults.videos.length +
      searchResults.leads.length +
      searchResults.deals.length >
    0;

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };
  const goToSearchResult = (to: string) => {
    closeSearch();
    navigate({ to });
  };

  const renderSearchGroups = () => (
    <>
      {searchResults.pages.length > 0 && (
        <div className="p-2">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Pages</p>
          {searchResults.pages.map((item) => (
            <button
              key={item.to}
              type="button"
              onClick={() => goToSearchResult(item.to)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
            >
              <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
      {searchResults.videos.length > 0 && (
        <div className="border-t border-border p-2">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Videos</p>
          {searchResults.videos.map((video) => (
            <button
              key={video.id}
              type="button"
              onClick={() => goToSearchResult(`/videos/${video.id}`)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
            >
              {video.thumbnail ? (
                <img
                  src={video.thumbnail}
                  alt=""
                  className="h-6 w-10 shrink-0 rounded object-cover"
                />
              ) : (
                <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{video.title}</span>
            </button>
          ))}
        </div>
      )}
      {searchResults.leads.length > 0 && (
        <div className="border-t border-border p-2">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Leads</p>
          {searchResults.leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => goToSearchResult("/leads")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
            >
              <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {lead.name} <span className="text-muted-foreground">{lead.username}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {searchResults.deals.length > 0 && (
        <div className="border-t border-border p-2">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Brand Deals</p>
          {searchResults.deals.map((deal) => (
            <button
              key={deal.id}
              type="button"
              onClick={() => goToSearchResult("/brand-deals")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
            >
              <Handshake className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {deal.company} <span className="text-muted-foreground">— {deal.contact}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {!hasSearchResults && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {searchQuery.trim()
            ? "No results."
            : "Start typing to search pages, videos, leads, and deals…"}
        </p>
      )}
      <div className="border-t border-border p-2">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Actions</p>
        <button
          type="button"
          onClick={() => {
            closeSearch();
            setDealOpen(true);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
        >
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" /> New brand deal
        </button>
        <button
          type="button"
          onClick={() => {
            closeSearch();
            setHelpOpen(true);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
        >
          <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" /> Open Tubi
        </button>
      </div>
    </>
  );

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchContainerRef.current?.contains(target)) return;
      if (mobileSearchContainerRef.current?.contains(target)) return;
      closeSearch();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);
  // /admin is exempt from the workspace-role preview gate below: canAccessRoute's Superadmin
  // check exists to hide the nav link during role preview, but there's no way to ever *preview*
  // Superadmin (WORKSPACE_PREVIEW_ROLES deliberately excludes it — it isn't a workspace role), so
  // a real platform-staff Superadmin/Owner would otherwise get "Access restricted" here before
  // admin.tsx's own real, server-verified profiles.role check ever runs.
  const routeAllowed = pathname === "/admin" || canAccessRoute(viewerRole, pathname);
  const lockedFeatureOnPage = routeAllowed ? ROUTE_FEATURE[pathname] : undefined;
  // realFeatureEnabledFor is the real, server-backed, per-role check — this is the client-side UX
  // half of it (immediately hides page content on direct navigation); every API the page calls
  // enforces the same rule independently via requireFeatureEnabled, since a client check alone
  // can always be bypassed.
  const pageBlocked =
    !routeAllowed ||
    (!!lockedFeatureOnPage && !flags[lockedFeatureOnPage] && viewerRole !== "Superadmin") ||
    !realFeatureEnabledFor(pathname);

  const switchRole = (role: PlatformRole) => {
    setViewerRole(role);
    if (!canAccessRoute(role, pathname)) {
      navigate({ to: "/dashboard" });
    }
    toast.success(`Viewing as ${role}`, {
      description: "Real nav & feature access for that role — your own account never changes.",
    });
  };

  // Cmd/Ctrl+K search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch(window.innerWidth >= 1024 ? "desktop" : "mobile");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const markAllRead = () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    toast.success("All notifications marked as read");
  };
  const clearNotifs = () => {
    setNotifs([]);
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_all" }),
    });
    toast.success("Notifications cleared");
  };
  const patchNotification = (id: string, patch: Partial<AppNotification>) => {
    setNotifs((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    void fetch(`/api/notifications?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };
  const deleteNotification = (id: string) => {
    setNotifs((prev) => prev.filter((x) => x.id !== id));
    void fetch(`/api/notifications?id=${id}`, { method: "DELETE" });
  };
  const signOut = async () => {
    await signOutSupabase();
    clearAllStores();
    clearChannelSettings();
    navigate({ to: "/" });
  };

  useEffect(() => {
    if (!user) return;
    if (previousUserId.current && previousUserId.current !== user.id) {
      clearAllStores();
      clearChannelSettings();
    }
    previousUserId.current = user.id;
    setProfile((current) => ({
      ...current,
      name:
        user.user_metadata?.name ??
        user.user_metadata?.full_name ??
        user.email?.split("@")[0] ??
        current.name,
      email: user.email ?? current.email,
      avatar: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? current.avatar,
    }));
  }, [user]);

  // Server/API routes independently verify the session too (see requireSessionUser) — this only
  // keeps signed-out visitors from seeing protected page content client-side.
  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/" });
  }, [authLoading, user, navigate]);

  // Split intentionally: authLoading is the genuine "checking your session" moment, which gets a
  // minimal branded loader rather than a blank white screen. Once that resolves, !user means
  // we're actively redirecting away (the effect above just fired) — nothing meaningful to show
  // there since the page is about to change out from under it regardless.
  if (authLoading) {
    return <BrandedLoader />;
  }
  if (!user) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="dashboard-shell h-dvh min-h-screen overflow-hidden bg-background text-foreground">
      {!hideAppNav && (
        <aside
          className={`card-gradient-outline fixed top-[var(--sidebar-gap)] bottom-[var(--sidebar-gap)] left-[var(--sidebar-gap)] z-30 hidden flex-col overflow-hidden backdrop-blur-2xl transition-all duration-200 md:flex ${
            collapsed ? "w-20" : "w-[210px]"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-5">
            <Logo collapsed={collapsed} />
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-6 w-6 items-center justify-center rounded-[var(--button-radius)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft
                className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
            {visibleNavGroups.map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p
                    className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider ${group.label === "Platform" ? "text-brand-purple/70" : "text-muted-foreground/60"}`}
                  >
                    {group.label}
                  </p>
                )}
                <div className="space-y-1">
                  {group.items.map((to) => {
                    const item = nav.find((n) => n.to === to)!;
                    const active = pathname === item.to;
                    const locked = isLocked(item.to);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        title={collapsed ? item.label : locked ? "Disabled by admin" : undefined}
                        className={`group relative flex items-center text-sm font-medium transition-all duration-200 ${collapsed ? "mx-auto h-10 w-10 justify-center" : "gap-3 px-3 py-2.5"} ${active ? "glass-active-nav" : locked ? "rounded-full text-muted-foreground/40 hover:bg-accent" : "rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}
                      >
                        <Icon className="relative h-[18px] w-[18px] shrink-0" />
                        {!collapsed && (
                          <span className="relative flex-1 truncate whitespace-nowrap">
                            {item.label}
                          </span>
                        )}
                        {!collapsed && locked && <Lock className="relative h-3.5 w-3.5 shrink-0" />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="p-3">
            <div className="card-frost flex items-center gap-3 px-3 py-3 backdrop-blur-lg">
              <div className="relative shrink-0">
                <div className="flex h-8 w-8 items-center justify-center">
                  <svg viewBox="0 0 24 18" className="h-6 w-8" fill="none" aria-hidden="true">
                    <path
                      d="M23.5 3.1a3 3 0 0 0-2.1-2.1C19.6.5 12 .5 12 .5s-7.6 0-9.4.5A3 3 0 0 0 .5 3.1 31.7 31.7 0 0 0 0 9s0 2.9.5 5.9a3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-3 .5-5.9.5-5.9s0-2.9-.5-5.9Z"
                      fill="#ff0000"
                    />
                    <path d="m9.6 12.8 5.2-3.8-5.2-3.8v7.6Z" fill="white" />
                  </svg>
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${youtubeConnected === null ? "bg-muted-foreground/40" : youtubeConnected ? "bg-success" : "bg-destructive"}`}
                  title={
                    youtubeConnected === null
                      ? "Checking YouTube connection…"
                      : youtubeConnected
                        ? "YouTube connected"
                        : "YouTube not connected"
                  }
                  role="status"
                  aria-label={
                    youtubeConnected === null
                      ? "Checking YouTube connection"
                      : youtubeConnected
                        ? "YouTube connected"
                        : "YouTube not connected"
                  }
                />
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">Account</p>
                  <p className="truncate text-sm font-semibold">
                    {youtubeConnected === null
                      ? "Checking…"
                      : youtubeConnected
                        ? "YouTube connected"
                        : "Not connected"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      <div
        className={`flex h-full min-h-0 flex-col transition-all duration-200 ${hideAppNav ? "" : collapsed ? "md:pl-[var(--sidebar-offset-collapsed)]" : "md:pl-[var(--sidebar-offset-expanded)]"}`}
      >
        <header className="glass-bar z-20 flex h-[68px] shrink-0 items-center justify-between gap-3 px-4 backdrop-blur-2xl sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <div className={hideAppNav ? "" : "md:hidden"}>
              <Logo collapsed />
            </div>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-primary">
              {title}
            </h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div ref={searchContainerRef} className="relative hidden lg:block">
              <div className="glass-pill relative flex h-9 w-64 items-center backdrop-blur-lg">
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => {
                    setSearchOpen(true);
                    loadSearchVideos();
                    loadSearchLeads();
                  }}
                  placeholder="Search pages, videos, leads…"
                  aria-label="Search pages, videos, leads, and deals"
                  className="h-9 w-full truncate bg-transparent pl-9 pr-12 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {!searchQuery && (
                  <kbd className="pointer-events-none absolute right-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    ⌘K
                  </kbd>
                )}
              </div>
              {searchOpen && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl">
                  {renderSearchGroups()}
                </div>
              )}
            </div>
            <div ref={mobileSearchContainerRef} className="relative lg:hidden">
              <button
                onClick={() => openSearch("mobile")}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--button-radius)] text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Search"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
              {searchOpen && (
                <div className="fixed inset-x-0 top-[68px] z-50 border-b border-border bg-popover p-3 shadow-xl">
                  <div className="glass-pill relative flex h-10 items-center backdrop-blur-lg">
                    <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
                    <input
                      ref={mobileSearchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search pages, videos, leads…"
                      aria-label="Search pages, videos, leads, and deals"
                      className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-popover">
                    {renderSearchGroups()}
                  </div>
                </div>
              )}
            </div>

            {/* Workspace owner/manager-only role preview — a real simulation backed by
                role_feature_access (see the previewRole param above), never an actual role
                change. Hidden entirely for setter/editor. */}
            {canPreviewRoles && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Preview how another role's navigation and feature access looks"
                    className={`flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold sm:px-3 ${ROLE_META[viewerRole].color}`}
                  >
                    {(() => {
                      const RoleIcon = ROLE_META[viewerRole].icon;
                      return <RoleIcon className="h-3.5 w-3.5" />;
                    })()}
                    <span className="hidden sm:inline">Viewing as {viewerRole}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Preview as role</DropdownMenuLabel>
                  <p className="px-2 pb-2 text-xs text-muted-foreground">
                    Shows real nav &amp; feature access for another role. Your own account and
                    permissions never change.
                  </p>
                  <DropdownMenuSeparator />
                  {WORKSPACE_PREVIEW_ROLES.map((role) => {
                    const RoleIcon = ROLE_META[role].icon;
                    return (
                      <DropdownMenuItem
                        key={role}
                        onSelect={() => switchRole(role)}
                        className={role === viewerRole ? "bg-accent" : undefined}
                      >
                        <RoleIcon className="mr-2 h-4 w-4" />
                        <span className="flex-1">{role}</span>
                        {role === viewerRole && <ShieldCheck className="h-4 w-4 text-primary" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Notifications */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
                >
                  <Bell className="h-[18px] w-[18px]" />
                  {unread > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-semibold leading-none text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="flex items-center justify-between border-b border-border p-3">
                  <p className="text-sm font-semibold">Notifications</p>
                  <div className="flex gap-1">
                    <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                      Mark all read
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      onClick={clearNotifs}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="max-h-80 space-y-1.5 overflow-y-auto p-1.5">
                  {visibleNotifs.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      No notifications
                    </p>
                  ) : (
                    visibleNotifs.map((n) => (
                      <NotificationRow
                        key={n.id}
                        notification={n}
                        onMarkRead={() => patchNotification(n.id, { read: true })}
                        onTogglePin={() => patchNotification(n.id, { pinned: !n.pinned })}
                        onToggleArchive={() => patchNotification(n.id, { archived: !n.archived })}
                        onDelete={() => deleteNotification(n.id)}
                      />
                    ))
                  )}
                </div>
                <Link
                  to="/notifications"
                  className="block border-t border-border p-3 text-center text-sm font-medium text-primary hover:underline"
                >
                  View all notifications
                </Link>
              </PopoverContent>
            </Popover>

            {/* Profile menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full px-1 py-1 hover:bg-accent">
                  <img
                    src={profile.avatar}
                    alt={profile.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                  <span className="hidden text-sm font-medium sm:block">{profile.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl">
                <DropdownMenuLabel>
                  <p className="font-semibold">{profile.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">{profile.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                  <UserIcon className="mr-2 h-4 w-4" /> Profile & Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="px-2 py-2">
                  <p className="mb-2 text-xs font-semibold">Active YouTube channel</p>
                  <YoutubeChannelSwitcher />
                </div>
                <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
                  <HelpCircle className="mr-2 h-4 w-4" /> Help & Tubi
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={signOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="dashboard-main min-h-0 flex-1 overflow-y-auto p-4 pb-28 sm:p-6 md:pb-6">
          {canPreviewRoles && viewerRole.toLowerCase() !== authenticatedRole && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-purple/30 bg-brand-purple/10 px-4 py-2.5 text-sm">
              <span className="text-brand-purple">
                <span className="font-semibold">Viewing as {viewerRole}</span> — Preview mode. Your
                actual role is {authenticatedRole}.
              </span>
              <button
                onClick={() =>
                  setViewerRole(
                    ((authenticatedRole ?? "owner").charAt(0).toUpperCase() +
                      (authenticatedRole ?? "owner").slice(1)) as PlatformRole,
                  )
                }
                className="rounded-full border border-brand-purple/40 px-3 py-1 text-xs font-semibold text-brand-purple hover:bg-brand-purple/10"
              >
                Exit preview
              </button>
            </div>
          )}
          {pageBlocked ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-dashed border-border p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
                {routeAllowed ? <Lock className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
              </span>
              {routeAllowed ? (
                <>
                  <h2 className="mt-4 text-lg font-semibold">This feature has been disabled</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    A Superadmin has temporarily turned off{" "}
                    {lockedFeatureOnPage ? FEATURE_META[lockedFeatureOnPage].label : "this feature"}{" "}
                    for all users.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg font-semibold">Access restricted</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Your role ({viewerRole}) doesn't have permission to view this page. Ask an Owner
                    or Superadmin for access.
                  </p>
                </>
              )}
              <button
                onClick={() => navigate({ to: "/dashboard" })}
                className="mt-5 rounded-[var(--button-radius)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Back to Dashboard
              </button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Help FAB */}
      <button
        onClick={() => setHelpOpen(true)}
        className="glass-fab fixed bottom-6 right-6 z-30 hidden h-12 w-12 items-center justify-center backdrop-blur-lg transition-transform hover:scale-105 md:flex print:hidden"
        aria-label="Help"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* Mobile pill nav */}
      {!hideAppNav && (
        <>
          <nav
            aria-label="Primary"
            className={cn(
              "fixed bottom-4 left-1/2 z-50 w-fit max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 md:hidden print:hidden",
              keyboardOpen && "hidden",
            )}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="glass-pill flex items-center gap-1 px-2 py-1.5 backdrop-blur-2xl">
              {visiblePrimaryMobileNav.map((item) => {
                const active = pathname === item.to;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-label={item.label}
                    title={item.label}
                    className={cn(
                      "group relative flex h-10 shrink-0 items-center justify-center rounded-full transition-all",
                      active
                        ? "glass-tab-active gap-1.5 px-3"
                        : "w-10 text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                    {active && (
                      <span className="whitespace-nowrap text-sm font-semibold">
                        {MOBILE_NAV_SHORT_LABEL[item.to] ?? item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
              <button
                onClick={() => setMoreOpen(true)}
                aria-label="More"
                title="More"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                  !visiblePrimaryMobileNav.some((item) => item.to === pathname) &&
                    visibleNav.some((item) => item.to === pathname)
                    ? "glass-tab-active"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            </div>
          </nav>

          {/* Mobile "more" nav sheet */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[75vh] overflow-y-auto rounded-t-2xl md:hidden"
            >
              <SheetHeader>
                <SheetTitle>All Features</SheetTitle>
              </SheetHeader>
              <div className="mt-2 grid grid-cols-4 gap-4">
                {visibleNav.map((item) => {
                  const active = pathname === item.to;
                  const locked = isLocked(item.to);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className="relative flex flex-col items-center gap-1.5 text-center"
                    >
                      <span
                        className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : locked
                              ? "bg-accent text-muted-foreground/40"
                              : "bg-accent text-muted-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                      {locked && (
                        <Lock className="absolute right-1 top-1 h-3 w-3 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "text-xs leading-tight",
                          active ? "font-semibold text-primary" : "text-muted-foreground",
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

      {/* Help / Tubi assistant panel */}
      <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} />

      {/* Quick add deal */}
      <DealDialog
        open={dealOpen}
        onOpenChange={setDealOpen}
        onSave={(deal) => setDeals((prev) => [deal, ...prev])}
      />

      <OnboardingTour />
    </div>
  );
}

function HelpSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [msgs, setMsgs] = useState<{ id: string; role: "user" | "bot"; text: string }[]>([
    {
      id: uid(),
      role: "bot",
      text: "Hi! I'm Tubi, your assistant. Ask about revenue trends, deals, links, or how to use any feature.",
    },
  ]);
  const [input, setInput] = useState("");
  const suggestions = useMemo(
    () => [
      "How do I create a tracking link?",
      "Explain the deal pipeline stages",
      "Why is data 24–72h delayed?",
      "How do comment rules work?",
    ],
    [],
  );

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg = { id: uid(), role: "user" as const, text };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    llm.chatReply(text).then((reply) => {
      setMsgs((m) => [...m, { id: uid(), role: "bot", text: reply }]);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <img src="/tubi.png" alt="" className="h-5 w-5 object-contain" />
            <span className="text-primary">Tubi</span>
          </SheetTitle>
          <SheetDescription>Frontend preview — answers are canned demo copy.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {msgs.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-8 bg-primary text-primary-foreground" : "mr-8 bg-accent/50"}`}
            >
              {m.text}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-3 flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
          />
          <Button type="submit" size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <button
          onClick={() => {
            onOpenChange(false);
            openOnboardingGuide(navigate);
          }}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-border py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Sparkles className="h-3.5 w-3.5" /> Replay the getting started guide
        </button>
        <Link
          to="/support"
          onClick={() => onOpenChange(false)}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-[var(--button-radius)] border border-border py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LifeBuoy className="h-3.5 w-3.5" /> Need a human? Report a problem →
        </Link>
      </SheetContent>
    </Sheet>
  );
}
