import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Building2,
  Sparkles,
  CreditCard,
  BarChart3,
  Megaphone,
  Settings,
  Lock,
  ScrollText,
  LifeBuoy,
  Server,
  Menu,
  Palette,
  ToggleLeft,
  GitBranch,
  Rocket,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ADMIN_MOBILE_PRIMARY, ADMIN_NAV_GROUPS, type AdminSection } from "@/lib/admin-nav";

// What the console contains and how it is grouped lives in lib/admin-nav.ts (pure data,
// unit-tested). This file adds the icons.
const SECTION_ICONS: Record<AdminSection, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  users: Users,
  roles: ShieldCheck,
  organizations: Building2,
  billing: CreditCard,
  ai: Sparkles,
  features: ToggleLeft,
  security: Lock,
  audit: ScrollText,
  content: Palette,
  communications: Megaphone,
  releases: GitBranch,
  roadmap: Rocket,
  changelog: History,
  system: Settings,
  infrastructure: Server,
  support: LifeBuoy,
};

export type { AdminSection };

export const ADMIN_NAV = ADMIN_NAV_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.map((item) => ({ ...item, icon: SECTION_ICONS[item.key] })),
}));

const ALL_ITEMS = ADMIN_NAV.flatMap((g) => g.items);
const primaryItems = ALL_ITEMS.filter((i) => ADMIN_MOBILE_PRIMARY.includes(i.key));

export function AdminNav({
  active,
  onSelect,
}: {
  active: AdminSection;
  onSelect: (s: AdminSection) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboardOpen = useKeyboardInset() > 150;

  return (
    <>
      {/* Desktop rail — stays pinned in place while the page content scrolls beneath it */}
      <nav
        aria-label="Admin sections"
        className="sticky top-[84px] hidden max-h-[calc(100vh_-_100px)] w-56 shrink-0 space-y-4 self-start overflow-y-auto lg:block"
      >
        {ADMIN_NAV.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => onSelect(item.key)}
                  aria-current={active === item.key ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple",
                    active === item.key
                      ? "bg-brand-purple/10 text-brand-purple"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
      <nav
        aria-label="Admin"
        className={cn(
          "fixed bottom-4 left-1/2 z-50 w-fit max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 lg:hidden print:hidden",
          keyboardOpen && "hidden",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/80 px-2 py-1.5 shadow-xl backdrop-blur-xl">
          {primaryItems.map((item) => (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              aria-label={item.label}
              aria-current={active === item.key ? "page" : undefined}
              title={item.label}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                active === item.key
                  ? "bg-brand-purple text-white"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More admin sections"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            title="More"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
              !primaryItems.some((i) => i.key === active)
                ? "bg-brand-purple text-white"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </nav>

      {/* Mobile "more" sheet — every admin section, grouped the same way as the rail */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[75vh] overflow-y-auto rounded-t-2xl lg:hidden"
        >
          <SheetHeader>
            <SheetTitle>Admin sections</SheetTitle>
          </SheetHeader>
          <div className="mt-2 space-y-4">
            {ADMIN_NAV.map((group) => (
              <div key={group.label}>
                <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group.label}
                </p>
                <div className="grid grid-cols-4 gap-4">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => {
                        onSelect(item.key);
                        setMoreOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 text-center"
                    >
                      <span
                        className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
                          active === item.key
                            ? "bg-brand-purple text-white"
                            : "bg-accent text-muted-foreground",
                        )}
                      >
                        <item.icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <span
                        className={cn(
                          "text-xs leading-tight",
                          active === item.key
                            ? "font-semibold text-brand-purple"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.label}
                      </span>
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
