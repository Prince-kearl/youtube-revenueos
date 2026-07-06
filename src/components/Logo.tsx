import { Youtube } from "lucide-react";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-red shadow-lg">
        <Youtube className="h-5 w-5 text-white" fill="white" strokeWidth={1.5} />
      </div>
      {!collapsed && (
        <span className="text-lg font-bold tracking-tight">
          Revenue<span className="text-primary">OS</span>
        </span>
      )}
    </div>
  );
}
