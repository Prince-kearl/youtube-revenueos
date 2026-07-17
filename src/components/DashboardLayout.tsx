import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Video, Sparkles, MapPin, Link2, BarChart3,
  TrendingUp, FileText, Settings, ChevronLeft, Search, Plus,
  Bell, Maximize2, HelpCircle, Youtube, FolderKanban,
  MessageSquare, Users, Gift, Handshake, Mail, Rocket,
  CheckCircle2, DollarSign, AlertTriangle, Zap, Clock, LogOut, User as UserIcon,
  Send,
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
import { useDeals, useNotifications, useProfile } from "@/lib/stores";
import { clearAllStores, uid } from "@/lib/local-store";
import { DealDialog } from "@/components/modals";

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

const notifIcons = { message: MessageSquare, check: CheckCircle2, dollar: DollarSign, alert: AlertTriangle, zap: Zap, clock: Clock };
const notifColor: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  green: "bg-brand-green/15 text-brand-green",
  amber: "bg-brand-amber/15 text-brand-amber",
  red: "bg-brand-red/15 text-brand-red",
  blue: "bg-brand-blue/15 text-brand-blue",
};

export function DashboardLayout({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [profile] = useProfile();
  const [notifs, setNotifs] = useNotifications();
  const [, setDeals] = useDeals();
  const unread = notifs.filter((n) => !n.read).length;

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

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>
                <span className={`absolute left-0 top-0 h-full w-1 rounded-r-full transition-colors ${active ? "bg-primary" : "bg-transparent group-hover:bg-primary/60"}`} />
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

      <div className={`transition-all duration-200 ${collapsed ? "md:pl-20" : "md:pl-[210px]"}`}>
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <div className="md:hidden"><Logo collapsed /></div>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-primary">{title}</h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setCmdOpen(true)} className="relative hidden items-center lg:flex">
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
              <span className="flex h-9 w-64 items-center rounded-lg border border-border bg-card pl-9 pr-12 text-sm text-muted-foreground">Search...</span>
              <kbd className="absolute right-2 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
            </button>
            <button onClick={() => setDealOpen(true)} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:px-3.5">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Quick Add Deal</span>
            </button>

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
                <div className="max-h-80 overflow-y-auto">
                  {notifs.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">No notifications</p>
                  ) : notifs.map((n) => {
                    const Icon = notifIcons[n.icon];
                    return (
                      <button
                        key={n.id}
                        onClick={() => setNotifs((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))}
                        className={`flex w-full items-start gap-3 border-b border-border p-3 text-left last:border-0 hover:bg-accent/50 ${!n.read ? "bg-primary/5" : ""}`}
                      >
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${notifColor[n.color]}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{n.title}</p>
                          <p className="text-xs text-muted-foreground">{n.time}</p>
                        </div>
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            {/* Profile menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent">
                  <img src={profile.avatar} alt={profile.name} className="h-8 w-8 rounded-lg object-cover" />
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
                  <HelpCircle className="mr-2 h-4 w-4" /> Help & AI Assistant
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => toast.error("Fullscreen not supported"))}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
              aria-label="Fullscreen"
            >
              <Maximize2 className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <main className="p-4 pb-28 sm:p-6 md:pb-6">{children}</main>
      </div>

      {/* Help FAB */}
      <button onClick={() => setHelpOpen(true)} className="fixed bottom-6 right-6 z-30 hidden h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 md:flex print:hidden" aria-label="Help">
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* Mobile pill nav */}
      <nav aria-label="Primary" className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 md:hidden print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center gap-1 overflow-x-auto rounded-full border border-border/60 bg-card/80 px-2 py-1.5 shadow-xl backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} aria-label={item.label} title={item.label} className={cn("group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Global command search */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search pages, deals, links…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Pages">
            {nav.map((item) => (
              <CommandItem key={item.to} value={item.label} onSelect={() => { setCmdOpen(false); navigate({ to: item.to }); }}>
                <item.icon className="mr-2 h-4 w-4" /> {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem value="new deal" onSelect={() => { setCmdOpen(false); setDealOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> New brand deal
            </CommandItem>
            <CommandItem value="help ai assistant" onSelect={() => { setCmdOpen(false); setHelpOpen(true); }}>
              <HelpCircle className="mr-2 h-4 w-4" /> Open AI Assistant
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Help / AI Assistant panel */}
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
    { id: uid(), role: "bot", text: "Hi! I'm your Tubify assistant. Ask about revenue trends, deals, links, or how to use any feature." },
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
          <SheetTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI Assistant</SheetTitle>
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
