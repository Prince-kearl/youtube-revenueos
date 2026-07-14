import { Youtube } from "lucide-react";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-red shadow-lg">
        <Youtube className="h-5 w-5 text-white" fill="white" strokeWidth={1.5} />
      </div>
      {!collapsed && (
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-bold tracking-tight">
            YouTube <span className="text-primary">Revenue OS</span>
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">YROOS · v3.0</span>
        </div>
      )}
    </div>
  );
}
