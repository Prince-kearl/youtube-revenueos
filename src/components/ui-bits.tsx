import type { ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export function StatCard({
  icon,
  value,
  label,
  sub,
  change,
  up,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  sub?: string;
  change?: string;
  up?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-primary [&_svg]:h-4 [&_svg]:w-4">
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
    <span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColors[status] ?? "bg-accent"}`}>
      {status}
    </span>
  );
}
