import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // bg-accent (not shadcn's default bg-primary/10) to match every hand-rolled pulse placeholder
  // already in the app, which all used bg-accent/bg-accent/50 — see src/components/skeletons.tsx
  // for the content-shaped primitives built on top of this.
  return <div className={cn("animate-pulse rounded-md bg-accent", className)} {...props} />;
}

export { Skeleton };
