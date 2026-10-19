import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The admin console's KPI card: a tinted header strip (icon, monospaced uppercase label and a
// status dot in the card's tone) over the figure, with an optional caption chip beside it.
// Creator-facing pages keep FlatKpiCard; this is for the admin console only. Corners follow
// --kpi-card-radius (Customization → KPI Card Roundness), like every other KPI card; the site's
// generic --radius is 0, so the rounded-* scale would leave them almost square.

export type AdminKpiTone = "blue" | "amber" | "green" | "red" | "purple" | "neutral";

const TONE_COLOR: Record<AdminKpiTone, string> = {
  blue: "var(--brand-blue)",
  amber: "var(--brand-amber)",
  green: "var(--success)",
  red: "var(--destructive)",
  purple: "var(--brand-purple)",
  neutral: "var(--muted-foreground)",
};

export function AdminKpiCard({
  title,
  value,
  caption,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  title: string;
  value: string;
  caption?: string;
  icon: LucideIcon;
  tone?: AdminKpiTone;
  className?: string;
}) {
  const color = TONE_COLOR[tone];
  return (
    <div
      className={cn(
        "admin-kpi-card overflow-hidden rounded-[var(--kpi-card-radius)] border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      <div
        className="flex items-center gap-2 border-b border-border px-3 py-2"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 9%, transparent)` }}
      >
        <Icon className="h-4 w-4 shrink-0 text-foreground/70" aria-hidden />
        <p className="min-w-0 flex-1 break-words font-mono text-xs uppercase leading-tight tracking-wide text-foreground/85">
          {title}
        </p>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-3">
        <p className="min-w-0 break-words text-2xl font-semibold tracking-tight tabular-nums text-foreground sm:text-3xl">
          {value}
        </p>
        {caption && (
          <span className="rounded-[6px] border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
