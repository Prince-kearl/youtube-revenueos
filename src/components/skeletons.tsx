// Reusable, content-shaped loading primitives — the single place every page's loading state
// should draw from instead of hand-rolling its own `animate-pulse` divs (which is what most of
// the app did before this file existed). Each primitive approximates the real content's layout/
// dimensions so the page doesn't visually jump once data arrives. Purely decorative pieces are
// aria-hidden; the page-level container around them is responsible for the actual aria-busy/
// aria-label announcement (see usage sites) since that's the semantically meaningful unit, not
// each individual bar.
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

export function SkeletonLine({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-full", className)} aria-hidden="true" />;
}

export function SkeletonCircle({ className }: { className?: string }) {
  return <Skeleton className={cn("h-10 w-10 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

export function SkeletonCard({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5", className)} aria-hidden="true">
      {children}
    </div>
  );
}

// Mirrors ui-bits.tsx's smaller StatCard (icon chip, value, label, sub) — used wherever that
// component's data isn't ready yet (e.g. analytics.tsx), instead of "—" placeholder values.
export function StatCardSkeleton() {
  return (
    <div className="card-gradient-outline relative rounded-xl p-4" aria-hidden="true">
      <div className="flex items-start justify-between">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="mt-3 h-6 w-20" />
      <Skeleton className="mt-2 h-3.5 w-24" />
    </div>
  );
}

// Mirrors KpiTrendCard's exact structure (title+badge row, big number, delta line, chart block)
// so the dashboard's KPI grid keeps its shape/dimensions while data loads instead of jumping.
export function KpiTrendCardSkeleton() {
  return (
    <div
      className="flex flex-col gap-5 rounded-[28px] border border-border bg-card p-5 sm:flex-row sm:items-stretch sm:gap-4 sm:p-6"
      aria-hidden="true"
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="mt-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="mt-3 h-3.5 w-24" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <Skeleton className="h-full min-h-[130px] w-full rounded-xl" />
      </div>
    </div>
  );
}

export function ListRowSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-20 w-full rounded-xl", className)} aria-hidden="true" />;
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0" aria-hidden="true">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4", i === 0 ? "w-1/3" : "flex-1")} />
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-64 w-full rounded-xl", className)} aria-hidden="true" />;
}

export function AvatarRowSkeleton() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <SkeletonCircle />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// Label + description + switch, sized to match SecurityPanel/YouTubeIntegrationPanel's toggle
// rows — used so those settings never show a hardcoded default value as if it were the real
// saved state before the server actually responds.
export function ToggleRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border p-4" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-6 w-11 rounded-full" />
    </div>
  );
}

export function FieldSkeleton({ labelWidth = "w-24" }: { labelWidth?: string }) {
  return (
    <div className="space-y-1.5" aria-hidden="true">
      <Skeleton className={cn("h-3", labelWidth)} />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

// Minimal branded loading state for auth/app-boot — not a skeleton, since there's no page
// structure to shape yet (we don't know if the visitor even has a session). Callers should
// transition to a real skeleton (or the actual page) the moment the app shell/data is known,
// never linger here waiting on anything beyond the initial session check.
export function BrandedLoader({ label = "Loading Tubify…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background" role="status" aria-live="polite" aria-label={label}>
      <div className="animate-pulse">
        <Logo collapsed />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
