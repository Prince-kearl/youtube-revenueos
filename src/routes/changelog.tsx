import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";

export const Route = createFileRoute("/changelog")({
  component: Changelog,
});

type EntryType = "New" | "Improved" | "Fixed";
type Area = "Dashboard" | "Team" | "Comments" | "Analytics" | "Billing" | "Mobile" | "Notifications";

type Entry = {
  date: string;
  type: EntryType;
  area: Area;
  title: string;
  description: string;
};

const entries: Entry[] = [
  { date: "This week", type: "New", area: "Team", title: "Invite teammates and split lead distribution", description: "Assign roles, commission %, and lead share per teammate, with a live distribution chart." },
  { date: "This week", type: "New", area: "Notifications", title: "Pin, archive, and edit auto-replies", description: "Manage Live Alerts with the same actions everywhere — topbar, dashboard, and the full notifications page." },
  { date: "This week", type: "Improved", area: "Mobile", title: "Tables now scroll as cards on mobile", description: "Every dense table across the app switches to a stacked-card layout instead of clipping columns." },
  { date: "Last week", type: "New", area: "Billing", title: "Redesigned checkout with plan switching", description: "Pick a plan, toggle monthly/annual, and apply a promo code — all live-priced in one page." },
  { date: "Last week", type: "New", area: "Comments", title: "Bulk auto-reply from All Comments", description: "Search, filter by status, and reply to one or many comments at once — with editable generated replies." },
  { date: "Last week", type: "Improved", area: "Analytics", title: "Revenue Transactions table", description: "A searchable, filterable, paginated ledger of every payout with bulk export." },
  { date: "Last week", type: "Fixed", area: "Analytics", title: "Geo Heatmap country cards", description: "Each country now gets a distinct color instead of a flat purple tint that hurt legibility." },
  { date: "2 weeks ago", type: "New", area: "Dashboard", title: "Full visual redesign", description: "New light theme, sharp corners, and a refreshed color system across every page." },
  { date: "2 weeks ago", type: "Improved", area: "Dashboard", title: "Sidebar grouped into sections", description: "Overview, Content, Growth, Revenue, and General — instead of one long flat list." },
  { date: "2 weeks ago", type: "Fixed", area: "Mobile", title: "Bottom nav no longer needs horizontal scrolling", description: "Trimmed to 4 primary tabs plus a “More” sheet for everything else." },
  { date: "3 weeks ago", type: "New", area: "Dashboard", title: "Getting Started checklist", description: "A dismissible onboarding checklist walks new users through their first 5 setup steps." },
  { date: "3 weeks ago", type: "New", area: "Comments", title: "Comment Automation rules", description: "Auto-reply to keyword matches, @handle drops, and AI-detected questions." },
  { date: "3 weeks ago", type: "Improved", area: "Dashboard", title: "Add Video moved to the Videos page", description: "No longer a permanent sidebar item — now a button right where you need it." },
];

const typeColor: Record<EntryType, string> = {
  New: "bg-success/15 text-success",
  Improved: "bg-warning/15 text-warning",
  Fixed: "bg-destructive/15 text-destructive",
};

const dates = [...new Set(entries.map((e) => e.date))];

function Changelog() {
  const [typeFilter, setTypeFilter] = useState<"All" | EntryType>("All");
  const [areaFilter, setAreaFilter] = useState<"All" | Area>("All");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const areas = [...new Set(entries.map((e) => e.area))];

  const filtered = entries.filter((e) => (typeFilter === "All" || e.type === typeFilter) && (areaFilter === "All" || e.area === areaFilter));

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <DashboardLayout title="Changelog">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Changelog</h1>
        <p className="mt-1 text-sm text-muted-foreground">New features, improvements, and fixes to Tubify.</p>
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          {(["All", "New", "Improved", "Fixed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${t === typeFilter ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Area</span>
          <button
            onClick={() => setAreaFilter("All")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${areaFilter === "All" ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
          >
            All
          </button>
          {areas.map((a) => (
            <button
              key={a}
              onClick={() => setAreaFilter(a)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${areaFilter === a ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        {dates.map((date) => {
          const dateEntries = filtered.filter((e) => e.date === date);
          if (dateEntries.length === 0) return null;
          return (
            <div key={date} className="mb-6 last:mb-0">
              <p className="mb-3 text-xs font-medium text-muted-foreground">{date}</p>
              <div className="space-y-2">
                {dateEntries.map((e) => {
                  const idx = entries.indexOf(e);
                  const isOpen = expanded.has(idx);
                  return (
                    <div key={idx} className="rounded-lg border border-border">
                      <button onClick={() => toggle(idx)} className="flex w-full items-center gap-3 p-3 text-left">
                        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${typeColor[e.type]}`}>{e.type}</span>
                        <span className="hidden shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-block">{e.area}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      {isOpen && (
                        <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">{e.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No updates match these filters.</p>
        )}
      </div>
    </DashboardLayout>
  );
}
