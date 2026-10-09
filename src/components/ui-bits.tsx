import type { ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";

export function StatCard({
  icon,
  value,
  label,
  sub,
  change,
  up,
  glow,
  frost,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  sub?: string;
  change?: string;
  up?: boolean;
  glow?: boolean;
  frost?: boolean;
}) {
  return (
    <div className={cn("relative rounded-xl p-4 backdrop-blur-lg", frost ? "card-frost" : "card-gradient-outline")}>
      {glow && <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />}
      <div className="flex items-start justify-between">
        <div className="stat-icon-chip flex h-8 w-8 items-center justify-center text-primary [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </div>
        {change && (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium ${
              up ? "text-success" : "text-destructive"
            }`}
          >
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {change}
          </span>
        )}
      </div>
      <p className="mt-3 text-xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-foreground">{label}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function ChangeCell({ change, up }: { change: string; up: boolean }) {
  return (
    <span className={`flex items-center gap-0.5 text-sm font-medium ${up ? "text-success" : "text-destructive"}`}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {change}
    </span>
  );
}

const tagColors: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  green: "bg-brand-green/15 text-brand-green",
  blue: "bg-brand-blue/15 text-brand-blue",
  amber: "bg-brand-amber/15 text-brand-amber",
  red: "bg-brand-red/15 text-brand-red",
  neutral: "bg-accent text-muted-foreground",
};

export function Tag({ label, color = "neutral" }: { label: string; color?: string }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${tagColors[color] ?? tagColors.neutral}`}>
      {label}
    </span>
  );
}

const statusColors: Record<string, string> = {
  "Top Performer": "bg-success/15 text-success",
  "High Revenue": "bg-brand-purple/15 text-brand-purple",
  Growing: "bg-success/15 text-success",
  Steady: "bg-warning/15 text-warning",
  Declining: "bg-destructive/15 text-destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${statusColors[status] ?? "bg-accent"}`}>
      {status}
    </span>
  );
}

// ---------- shared page states ----------
// One look for "nothing here yet", "couldn't load" and "loading" across the app, so each page
// only has to say what is missing, why, and what to do next.

/** Nothing to show. Say what is missing and why in `description`; put the next step in `children`. */
export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Actions: buttons or links. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
      )}
    </div>
  );
}

/** A request failed. `description` should say whether trying again is likely to help. */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center",
        className,
      )}
    >
      <div>
        <h2 className="text-base font-semibold text-destructive">{title}</h2>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Placeholder rows while a list loads: keeps the page's shape instead of a line of text. */
export function ListLoadingState({
  label,
  rows = 3,
  className,
}: {
  /** Read by screen readers, e.g. "Loading your deals". */
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-xl bg-accent/60" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
