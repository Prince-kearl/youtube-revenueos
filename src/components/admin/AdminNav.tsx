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
  Palette,
  ToggleLeft,
  GitBranch,
  Rocket,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { MobileDock, type DockItem } from "@/components/MobileDock";
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

// Tile labels on the phone dock, where a column is about 60px wide. The full section name stays
// the tile's accessible name (and is what the desktop rail shows).
const DOCK_LABELS: Partial<Record<AdminSection, string>> = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  roles: "Roles",
  ai: "AI",
  features: "Features",
  security: "Security",
  audit: "Audit Logs",
  content: "Customize",
  communications: "Messages",
  releases: "Releases",
};

function dockItem(
  item: (typeof ALL_ITEMS)[number],
  active: AdminSection,
  onSelect: (s: AdminSection) => void,
): DockItem {
  return {
    key: item.key,
    label: item.label,
    shortLabel: DOCK_LABELS[item.key],
    Icon: item.icon,
    active: active === item.key,
    onSelect: () => onSelect(item.key),
  };
}

export function AdminNav({
  active,
  onSelect,
}: {
  active: AdminSection;
  onSelect: (s: AdminSection) => void;
}) {
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

      {/* Phone nav — the same dock as the workspace app (see MobileDock): the primary sections
          in a pill, every section in a panel of tiles, in the rail's order. */}
      <MobileDock
        label="Admin"
        panelLabel="Admin sections"
        moreLabel="More admin sections"
        hideAt="lg"
        hidden={keyboardOpen}
        resetKey={active}
        primary={primaryItems.map((item) => dockItem(item, active, onSelect))}
        sections={[
          {
            label: "Admin sections",
            items: ALL_ITEMS.map((item) => dockItem(item, active, onSelect)),
          },
        ]}
      />
    </>
  );
}
