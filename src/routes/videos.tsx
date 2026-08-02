import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, ArrowUpDown, Filter, Eye, ThumbsUp, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ChangeCell, StatusBadge } from "@/components/ui-bits";
import { topVideos } from "@/lib/data";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/videos")({
  component: Videos,
});

function Videos() {
  return (
    <DashboardLayout title="Videos">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
          <p className="mt-1 text-sm text-muted-foreground">7 videos synced</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input placeholder="Search videos..." className="h-9 w-full rounded-[var(--input-radius)] border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary" />
          </div>
          <button className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3 text-sm text-muted-foreground hover:text-foreground">
            <ArrowUpDown className="h-4 w-4" /> Sort: Revenue
          </button>
          <button className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] border border-border bg-card px-3 text-sm text-muted-foreground hover:text-foreground">
            <Filter className="h-4 w-4" /> Filter
          </button>
          <Link to="/add-video" className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add Video
          </Link>
        </div>
      </div>

      {/* Mobile: stacked cards */}
      <div className="mt-6 space-y-3 sm:hidden">
        {topVideos.map((v) => (
          <div key={v.rank} className="relative rounded-xl card-gradient-outline p-4">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-red/40 to-brand-purple/40 text-[9px] font-bold text-white/70">
                ▶
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{v.title}</p>
                <p className="text-xs text-muted-foreground">{v.date}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Eye className="h-3.5 w-3.5" />{v.views}</span>
              <span className="text-sm font-semibold">{v.revenue}</span>
              <ChangeCell change={v.change} up={v.up} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-accent/30 p-2.5 text-center text-xs">
              <div>
                <p className="text-muted-foreground">CTR</p>
                <p className="mt-0.5 font-medium">{v.ctr}</p>
              </div>
              <div>
                <p className="text-muted-foreground">CPM</p>
                <p className="mt-0.5 font-medium">{v.cpm}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Likes</p>
                <p className="mt-0.5 flex items-center justify-center gap-1 font-medium"><ThumbsUp className="h-3 w-3" />{v.likes}</p>
              </div>
            </div>
            <div className="mt-3"><StatusBadge status={v.status} /></div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="relative mt-6 hidden overflow-x-auto rounded-xl card-gradient-outline sm:block">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-4 font-medium">Video</th>
              <th className="px-3 py-4 font-medium">Views</th>
              <th className="px-3 py-4 font-medium">Revenue</th>
              <th className="px-3 py-4 font-medium">CTR</th>
              <th className="px-3 py-4 font-medium">CPM</th>
              <th className="px-3 py-4 font-medium">Likes</th>
              <th className="px-3 py-4 font-medium">Status</th>
              <th className="px-3 py-4 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {topVideos.map((v) => (
              <tr key={v.rank} className="border-b border-border last:border-0 transition-colors hover:bg-accent/30">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-red/40 to-brand-purple/40 text-[9px] font-bold text-white/70">
                      ▶
                    </div>
                    <div>
                      <p className="font-medium">{v.title}</p>
                      <p className="text-xs text-muted-foreground">{v.date}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3.5 text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />{v.views}</span>
                </td>
                <td className="px-3 py-3.5 font-semibold">{v.revenue}</td>
                <td className="px-3 py-3.5 text-muted-foreground">{v.ctr}</td>
                <td className="px-3 py-3.5 text-muted-foreground">{v.cpm}</td>
                <td className="px-3 py-3.5 text-muted-foreground">
                  <span className="flex items-center gap-1.5"><ThumbsUp className="h-3.5 w-3.5" />{v.likes}</span>
                </td>
                <td className="px-3 py-3.5"><StatusBadge status={v.status} /></td>
                <td className="px-3 py-3.5">
                  <div className="flex justify-end"><ChangeCell change={v.change} up={v.up} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
