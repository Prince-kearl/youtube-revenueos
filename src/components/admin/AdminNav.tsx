import { useState } from "react";
import {
  LayoutDashboard, Users, ShieldCheck, Building2, Sparkles, CreditCard,
  BarChart3, Megaphone, Settings, Lock, ScrollText, LifeBuoy, Server, Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type AdminSection =
  | "dashboard" | "users" | "roles" | "organizations" | "ai" | "billing"
  | "analytics" | "communications" | "system" | "security" | "audit" | "support" | "infrastructure";

export const ADMIN_NAV: { label: string; items: { key: AdminSection; label: string; icon: typeof LayoutDashboard }[] }[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "User Management",
    items: [
      { key: "users", label: "Users", icon: Users },
      { key: "roles", label: "Roles & Permissions", icon: ShieldCheck },
      { key: "organizations", label: "Organizations", icon: Building2 },
    ],
  },
  { label: "Platform", items: [
    { key: "ai", label: "AI Management", icon: Sparkles },
    { key: "billing", label: "Billing", icon: CreditCard },
    { key: "analytics", label: "Analytics", icon: BarChart3 },
    { key: "communications", label: "Communications", icon: Megaphone },
  ] },
  { label: "Operations", items: [
    { key: "system", label: "System", icon: Settings },
    { key: "security", label: "Security", icon: Lock },
    { key: "audit", label: "Audit Logs", icon: ScrollText },
    { key: "support", label: "Support", icon: LifeBuoy },
    { key: "infrastructure", label: "Infrastructure", icon: Server },
  ] },
];

const ALL_ITEMS = ADMIN_NAV.flatMap((g) => g.items);
const PRIMARY_KEYS: AdminSection[] = ["dashboard", "users", "billing", "support"];
const primaryItems = ALL_ITEMS.filter((i) => PRIMARY_KEYS.includes(i.key));

export function AdminNav({ active, onSelect }: { active: AdminSection; onSelect: (s: AdminSection) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* Desktop rail — stays pinned in place while the page content scrolls beneath it */}
      <nav className="sticky top-[84px] hidden max-h-[calc(100vh_-_100px)] w-56 shrink-0 space-y-4 self-start overflow-y-auto lg:block">
        {ADMIN_NAV.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => onSelect(item.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                    active === item.key ? "bg-brand-purple/10 text-brand-purple" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Mobile pill nav — same floating design as the workspace nav, fixed above the content */}
      <nav aria-label="Admin" className="fixed bottom-4 left-1/2 z-50 w-fit max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 lg:hidden print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/80 px-2 py-1.5 shadow-xl backdrop-blur-xl">
          {primaryItems.map((item) => (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              aria-label={item.label}
              title={item.label}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                active === item.key ? "bg-brand-purple text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            title="More"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
              !primaryItems.some((i) => i.key === active) ? "bg-brand-purple text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </nav>

      {/* Mobile "more" sheet — every admin section, grouped the same way as the rail */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto rounded-t-2xl lg:hidden">
          <SheetHeader>
            <SheetTitle>All Admin Sections</SheetTitle>
          </SheetHeader>
          <div className="mt-2 space-y-4">
            {ADMIN_NAV.map((group) => (
              <div key={group.label}>
                <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{group.label}</p>
                <div className="grid grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => { onSelect(item.key); setMoreOpen(false); }}
                      className="flex flex-col items-center gap-1.5 text-center"
                    >
                      <span className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-colors", active === item.key ? "bg-brand-purple text-white" : "bg-accent text-muted-foreground")}>
                        <item.icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <span className={cn("text-xs leading-tight", active === item.key ? "font-semibold text-brand-purple" : "text-muted-foreground")}>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
