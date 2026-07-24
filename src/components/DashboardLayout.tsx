import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Video, Sparkles, MapPin, Link2, BarChart3,
  TrendingUp, FileText, Settings, ChevronLeft, Search, Plus,
  Bell, HelpCircle, Youtube, FolderKanban,
  MessageSquare, Users, Gift, Handshake, Mail, Rocket, UserPlus, ScrollText, LifeBuoy, Inbox,
  LogOut, User as UserIcon,
  Send, Menu, Shield, Crown, Target, Pencil, Lock, ShieldAlert, ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  useDeals, useNotifications, useProfile, useViewerRole, useFeatureFlags, useSidebarCollapsed,
  canAccessRoute, FEATURE_META, PLATFORM_ROLES, type PlatformRole, type FeatureKey,
} from "@/lib/stores";
import { clearAllStores, uid } from "@/lib/local-store";
import { DealDialog } from "@/components/modals";
import { NotificationRow } from "@/components/NotificationRow";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/videos", label: "Videos", icon: Video },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/ai-lab", label: "AI Lab", icon: Sparkles },
  { to: "/destinations", label: "Destinations", icon: MapPin },
  { to: "/link-tracking", label: "Link Tracking", icon: Link2 },
  { to: "/comments", label: "Comment Automation", icon: MessageSquare },
  { to: "/leads", label: "Lead Inbox", icon: Inbox },
  { to: "/audience", label: "Audience", icon: Users },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/affiliate", label: "Affiliate", icon: Handshake },
  { to: "/freebie", label: "AI Freebie", icon: Gift },
  { to: "/email", label: "Email", icon: Mail },
  { to: "/brand-deals", label: "Brand Deals", icon: TrendingUp },
  { to: "/team", label: "Team", icon: UserPlus },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/roadmap", label: "Roadmap", icon: Rocket },
  { to: "/changelog", label: "Changelog", icon: ScrollText },
  { to: "/support", label: "Support", icon: LifeBuoy },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/admin", label: "Admin Console", icon: Shield },
] as const;

const primaryMobileNav = nav.filter((item) =>
  (["/dashboard", "/videos", "/comments", "/analytics"] as string[]).includes(item.to),
);

const navGroups: { label: string; items: (typeof nav)[number]["to"][] }[] = [
  { label: "Overview", items: ["/dashboard"] },
  { label: "Content", items: ["/videos", "/projects", "/ai-lab"] },
  { label: "Growth", items: ["/destinations", "/link-tracking", "/comments", "/leads", "/audience", "/analytics"] },
  { label: "Revenue", items: ["/affiliate", "/freebie", "/email", "/brand-deals", "/team"] },
  { label: "General", items: ["/reports", "/roadmap", "/changelog", "/support", "/settings"] },
  { label: "Platform", items: ["/admin"] },
];

const ROLE_META: Record<PlatformRole, { icon: typeof Shield; color: string }> = {
  Superadmin: { icon: Shield, color: "text-brand-purple bg-brand-purple/10" },
  Owner: { icon: Crown, color: "text-primary bg-primary/10" },
  Manager: { icon: Users, color: "text-brand-green bg-brand-green/10" },
  Setter: { icon: Target, color: "text-brand-amber bg-brand-amber/10" },
  Editor: { icon: Pencil, color: "text-muted-foreground bg-accent" },
};

const ROUTE_FEATURE: Partial<Record<string, FeatureKey>> = Object.fromEntries(
  (Object.entries(FEATURE_META) as [FeatureKey, (typeof FEATURE_META)[FeatureKey]][]).map(([key, meta]) => [meta.route, key]),
);

export function DashboardLayout({ title, children, hideAppNav }: { title: string; children: ReactNode; hideAppNav?: boolean }) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [moreOpen, setMoreOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [profile] = useProfile();
  const [notifs, setNotifs] = useNotifications();
  const [, setDeals] = useDeals();
  const [viewerRole, setViewerRole] = useViewerRole();
  const [flags] = useFeatureFlags();
  const visibleNotifs = notifs.filter((n) => !n.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const unread = notifs.filter((n) => !n.read && !n.archived).length;

  const isLocked = (to: string) => {
    const feature = ROUTE_FEATURE[to];
    return !!feature && !flags[feature] && viewerRole !== "Superadmin";
  };
  const visibleNav = nav.filter((item) => canAccessRoute(viewerRole, item.to));
  const visibleNavGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((to) => canAccessRoute(viewerRole, to)) }))
    .filter((g) => g.items.length > 0);
  const visiblePrimaryMobileNav = primaryMobileNav.filter((item) => canAccessRoute(viewerRole, item.to));
  const routeAllowed = canAccessRoute(viewerRole, pathname);
  const lockedFeatureOnPage = routeAllowed ? ROUTE_FEATURE[pathname] : undefined;
  const pageBlocked = !routeAllowed || (!!lockedFeatureOnPage && !flags[lockedFeatureOnPage] && viewerRole !== "Superadmin");

  const switchRole = (role: PlatformRole) => {
    setViewerRole(role);
    if (!canAccessRoute(role, pathname)) {
      navigate({ to: "/dashboard" });
    }
    toast.success(`Viewing as ${role}`, { description: "This switches the RBAC demo — nothing else changes." });
  };

  // Cmd/Ctrl+K search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const markAllRead = () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  };
  const clearNotifs = () => { setNotifs([]); toast.success("Notifications cleared"); };
  const signOut = () => {
    clearAllStores();
    toast.success("Signed out — local data cleared");
    setTimeout(() => window.location.reload(), 400);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!hideAppNav && (
        <aside
          className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-sidebar transition-all duration-200 md:flex ${
            collapsed ? "w-20" : "w-[210px]"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-5">
            <Logo collapsed={collapsed} />
            <button onClick={() => setCollapsed((c) => !c)} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
            </button>
          </div>

          <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
            {visibleNavGroups.map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider ${group.label === "Platform" ? "text-brand-purple/70" : "text-muted-foreground/60"}`}>{group.label}</p>
                )}
                <div className="space-y-1">
                  {group.items.map((to) => {
                    const item = nav.find((n) => n.to === to)!;
                    const active = pathname === item.to;
                    const locked = isLocked(item.to);
                    const Icon = item.icon;
                    return (
                      <Link key={item.to} to={item.to} title={collapsed ? item.label : locked ? "Disabled by admin" : undefined} className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${active ? "bg-primary/10 text-primary" : locked ? "text-muted-foreground/40 hover:bg-accent" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>
                        <span className={`absolute left-0 top-0 h-full w-1 rounded-r-full transition-colors ${active ? "bg-primary" : "bg-transparent group-hover:bg-primary/60"}`} />
                        <Icon className="relative h-[18px] w-[18px] shrink-0" />
                        {!collapsed && <span className="relative flex-1">{item.label}</span>}
                        {!collapsed && locked && <Lock className="relative h-3.5 w-3.5 shrink-0" />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="p-3">
            <div className="flex items-center gap-3 rounded-xl bg-accent/50 px-3 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
                <Youtube className="h-4 w-4 text-white" fill="white" strokeWidth={1.5} />
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">Connected</p>
                  <p className="truncate text-sm font-semibold">@YourChannel</p>
                </div>
              )}
              {!collapsed && <span className="h-2 w-2 shrink-0 rounded-full bg-success" />}
            </div>
          </div>
        </aside>
      )}

      <div className={`transition-all duration-200 ${hideAppNav ? "" : collapsed ? "md:pl-20" : "md:pl-[210px]"}`}>
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <div className={hideAppNav ? "" : "md:hidden"}><Logo collapsed /></div>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-primary">{title}</h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setCmdOpen(true)} className="relative hidden items-center lg:flex">
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
              <span className="flex h-9 w-64 items-center rounded-lg border border-border bg-card pl-9 pr-12 text-sm text-muted-foreground">Search...</span>
              <kbd className="absolute right-2 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
            </button>
            <button onClick={() => setCmdOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:hidden" aria-label="Search">
              <Search className="h-[18px] w-[18px]" />
            </button>

            {/* RBAC demo role switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  title="Demo control — switch roles to preview RBAC"
                  className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold sm:px-3 ${ROLE_META[viewerRole].color}`}
                >
                  {(() => { const RoleIcon = ROLE_META[viewerRole].icon; return <RoleIcon className="h-3.5 w-3.5" />; })()}
                  <span className="hidden sm:inline">Viewing as {viewerRole}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Preview as role</DropdownMenuLabel>
                <p className="px-2 pb-2 text-xs text-muted-foreground">Demo control — switches nav access &amp; permissions live.</p>
                <DropdownMenuSeparator />
                {PLATFORM_ROLES.map((role) => {
                  const RoleIcon = ROLE_META[role].icon;
                  return (
                    <DropdownMenuItem key={role} onSelect={() => switchRole(role)} className={role === viewerRole ? "bg-accent" : undefined}>
                      <RoleIcon className="mr-2 h-4 w-4" />
                      <span className="flex-1">{role}</span>
                      {role === viewerRole && <ShieldCheck className="h-4 w-4 text-primary" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Notifications */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Notifications">
                  <Bell className="h-[18px] w-[18px]" />
                  {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-red" />}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="flex items-center justify-between border-b border-border p-3">
                  <p className="text-sm font-semibold">Notifications</p>
                  <div className="flex gap-1">
                    <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
                    <span className="text-muted-foreground">·</span>
                    <button onClick={clearNotifs} className="text-xs text-muted-foreground hover:text-destructive">Clear</button>
                  </div>
                </div>
                <div className="max-h-80 space-y-1.5 overflow-y-auto p-1.5">
                  {visibleNotifs.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">No notifications</p>
                  ) : visibleNotifs.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      onMarkRead={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))}
                      onTogglePin={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x)))}
                      onToggleArchive={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, archived: !x.archived } : x)))}
                      onDelete={() => setNotifs((prev) => prev.filter((x) => x.id !== n.id))}
                    />
                  ))}
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
                <button className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent">
                  <img src={profile.avatar} alt={profile.name} className="h-8 w-8 rounded-full object-cover" />
                  <span className="hidden text-sm font-medium sm:block">{profile.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="font-semibold">{profile.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">{profile.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                  <UserIcon className="mr-2 h-4 w-4" /> Profile & Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
                  <HelpCircle className="mr-2 h-4 w-4" /> Help & Tubi
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="p-4 pb-28 sm:p-6 md:pb-6">
          {pageBlocked ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-dashed border-border p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
                {routeAllowed ? <Lock className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
              </span>
              {routeAllowed ? (
                <>
                  <h2 className="mt-4 text-lg font-semibold">This feature has been disabled</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    A Superadmin has temporarily turned off {lockedFeatureOnPage ? FEATURE_META[lockedFeatureOnPage].label : "this feature"} for all users.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg font-semibold">Access restricted</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Your role ({viewerRole}) doesn't have permission to view this page. Ask an Owner or Superadmin for access.
                  </p>
                </>
              )}
              <button onClick={() => navigate({ to: "/dashboard" })} className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Back to Dashboard
              </button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Help FAB */}
      <button onClick={() => setHelpOpen(true)} className="fixed bottom-6 right-6 z-30 hidden h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 md:flex print:hidden" aria-label="Help">
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* Mobile pill nav */}
      {!hideAppNav && (
        <>
          <nav aria-label="Primary" className="fixed bottom-4 left-1/2 z-50 w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 md:hidden print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/80 px-2 py-1.5 shadow-xl backdrop-blur-xl">
              {visiblePrimaryMobileNav.map((item) => {
                const active = pathname === item.to;
                const Icon = item.icon;
                return (
                  <Link key={item.to} to={item.to} aria-label={item.label} title={item.label} className={cn("group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  </Link>
                );
              })}
              <button
                onClick={() => setMoreOpen(true)}
                aria-label="More"
                title="More"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                  !visiblePrimaryMobileNav.some((item) => item.to === pathname) && visibleNav.some((item) => item.to === pathname)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            </div>
          </nav>

          {/* Mobile "more" nav sheet */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto rounded-t-2xl md:hidden">
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
                      <span className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-colors", active ? "bg-primary text-primary-foreground" : locked ? "bg-accent text-muted-foreground/40" : "bg-accent text-muted-foreground")}>
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                      {locked && <Lock className="absolute right-1 top-1 h-3 w-3 text-muted-foreground" />}
                      <span className={cn("text-xs leading-tight", active ? "font-semibold text-primary" : "text-muted-foreground")}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

      {/* Global command search */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search pages, deals, links…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Pages">
            {visibleNav.map((item) => (
              <CommandItem key={item.to} value={item.label} onSelect={() => { setCmdOpen(false); navigate({ to: item.to }); }}>
                <item.icon className="mr-2 h-4 w-4" /> {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem value="new deal" onSelect={() => { setCmdOpen(false); setDealOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> New brand deal
            </CommandItem>
            <CommandItem value="help tubi assistant" onSelect={() => { setCmdOpen(false); setHelpOpen(true); }}>
              <HelpCircle className="mr-2 h-4 w-4" /> Open Tubi
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Help / Tubi assistant panel */}
      <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} />

      {/* Quick add deal */}
      <DealDialog
        open={dealOpen}
        onOpenChange={setDealOpen}
        onSave={(deal) => setDeals((prev) => [deal, ...prev])}
      />
    </div>
  );
}

function HelpSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [msgs, setMsgs] = useState<{ id: string; role: "user" | "bot"; text: string }[]>([
    { id: uid(), role: "bot", text: "Hi! I'm Tubi, your assistant. Ask about revenue trends, deals, links, or how to use any feature." },
  ]);
  const [input, setInput] = useState("");
  const suggestions = useMemo(() => [
    "How do I create a tracking link?",
    "Explain the deal pipeline stages",
    "Why is data 24–72h delayed?",
    "How do comment rules work?",
  ], []);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg = { id: uid(), role: "user" as const, text };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setTimeout(() => {
      const reply = canned(text);
      setMsgs((m) => [...m, { id: uid(), role: "bot", text: reply }]);
    }, 500);
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
            <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-8 bg-primary text-primary-foreground" : "mr-8 bg-accent/50"}`}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3 flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" />
          <Button type="submit" size="icon"><Send className="h-4 w-4" /></Button>
        </form>
        <Link to="/support" onClick={() => onOpenChange(false)} className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
          <LifeBuoy className="h-3.5 w-3.5" /> Need a human? Report a problem →
        </Link>
      </SheetContent>
    </Sheet>
  );
}

function canned(q: string) {
  const s = q.toLowerCase();
  if (s.includes("link")) return "Go to Link Tracking → Create Link. Enter a destination URL and an optional slug; you get a rvos.io short link that tracks clicks, conversions, and Stripe revenue attribution.";
  if (s.includes("deal") || s.includes("brand")) return "Deals move through Prospect → Pitched → Negotiating → Contracted → Completed. Use Quick Add Deal in the topbar or click any stage's Add deal button.";
  if (s.includes("delay") || s.includes("24") || s.includes("fresh")) return "YouTube Analytics reports lag 24–72h and revenue metrics ~48h. Click and Stripe attribution are real-time — that's why the two feeds are shown separately.";
  if (s.includes("comment") || s.includes("rule")) return "Comment rules watch new comments for keywords, @handles, or AI-detected questions. Each match triggers your saved reply and creates a lead. Each auto-reply costs ~50 YouTube API units.";
  return "I can help with deals, links, comments, analytics, and settings. Try one of the suggestions above.";
}
