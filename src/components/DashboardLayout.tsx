import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Video, Sparkles, MapPin, Link2, BarChart3,
  TrendingUp, FileText, Settings, ChevronLeft, Search, Plus,
  Bell, Maximize2, HelpCircle, Youtube, FolderKanban,
  MessageSquare, Users, Gift, Handshake, Mail, Rocket,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/add-video", label: "Add Video", icon: Plus },
  { to: "/videos", label: "Videos", icon: Video },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/ai-lab", label: "AI Lab", icon: Sparkles },
  { to: "/destinations", label: "Destinations", icon: MapPin },
  { to: "/link-tracking", label: "Link Tracking", icon: Link2 },
  { to: "/comments", label: "Comment Automation", icon: MessageSquare },
  { to: "/audience", label: "Audience", icon: Users },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/affiliate", label: "Affiliate", icon: Handshake },
  { to: "/freebie", label: "AI Freebie", icon: Gift },
  { to: "/email", label: "Email", icon: Mail },
  { to: "/brand-deals", label: "Brand Deals", icon: TrendingUp },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/roadmap", label: "Roadmap", icon: Rocket },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;


export function DashboardLayout({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar — desktop only */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-sidebar transition-all duration-200 md:flex ${
          collapsed ? "w-20" : "w-[210px]"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-5">
          <Logo collapsed={collapsed} />
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                }`}
              >
                <span
                  className={`absolute left-0 top-0 h-full w-1 rounded-r-full transition-colors ${
                    active ? "bg-primary" : "bg-transparent group-hover:bg-primary/60"
                  }`}
                />
                <Icon className="relative h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="relative">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-3">
          <div className="flex items-center gap-3 rounded-xl bg-accent/50 px-3 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-red">
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

      {/* Main */}
      <div className={`transition-all duration-200 ${collapsed ? "md:pl-20" : "md:pl-[210px]"}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
          {/* Mobile logo */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="md:hidden">
              <Logo collapsed />
            </div>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-primary">{title}</h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative hidden items-center lg:flex">
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
              <input
                placeholder="Search..."
                className="h-9 w-64 rounded-lg border border-border bg-card pl-9 pr-12 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              <kbd className="absolute right-2 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
            </div>
            <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:px-3.5">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Quick Add Deal</span>
            </button>
            <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-brand-red" />
            </button>
            <div className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent">
              <img
                src="https://i.pravatar.cc/64?img=13"
                alt="Alex Chen"
                className="h-8 w-8 rounded-lg object-cover"
              />
              <span className="hidden text-sm font-medium sm:block">Alex Chen</span>
            </div>
            <button className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:flex">
              <Maximize2 className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <main className="p-4 pb-28 sm:p-6 md:pb-6">{children}</main>
      </div>

      {/* Help FAB — desktop only (mobile bottom nav takes over) */}
      <button className="fixed bottom-6 right-6 z-30 hidden h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 md:flex">
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* Mobile floating pill nav (inspired by Kearl Devs Studio) */}
      <nav
        aria-label="Primary"
        className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-1 overflow-x-auto rounded-full border border-border/60 bg-card/80 px-2 py-1.5 shadow-xl backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                title={item.label}
                className={cn(
                  "group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
