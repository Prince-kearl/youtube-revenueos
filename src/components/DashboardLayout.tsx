import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Video, Sparkles, MapPin, Link2, BarChart3,
  TrendingUp, FileText, Settings, ChevronLeft, Search, Plus,
  Bell, Maximize2, HelpCircle, Youtube, FolderKanban,
} from "lucide-react";
import { Logo } from "@/components/Logo";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/videos", label: "Videos", icon: Video },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/ai-lab", label: "AI Lab", icon: Sparkles },
  { to: "/destinations", label: "Destinations", icon: MapPin },
  { to: "/link-tracking", label: "Link Tracking", icon: Link2 },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/brand-deals", label: "Brand Deals", icon: TrendingUp },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function DashboardLayout({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-sidebar transition-all duration-200 ${
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

        <nav className="flex-1 space-y-1 px-3 py-2">
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
      <div className={`transition-all duration-200 ${collapsed ? "pl-20" : "pl-[210px]"}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
          <h2 className="text-[15px] font-semibold tracking-tight text-primary">{title}</h2>
          <div className="flex items-center gap-3">
            <div className="relative hidden items-center md:flex">
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
              <input
                placeholder="Search..."
                className="h-9 w-64 rounded-lg border border-border bg-card pl-9 pr-12 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              <kbd className="absolute right-2 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
            </div>
            <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Quick Add Deal
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
            <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
              <Maximize2 className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <main className="p-6">{children}</main>
      </div>

      {/* Help FAB */}
      <button className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105">
        <HelpCircle className="h-5 w-5" />
      </button>
    </div>
  );
}
