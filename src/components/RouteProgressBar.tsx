// Router-level defaultPendingComponent — the only thing standing between a route transition and
// a flash of blank page while its JS chunk loads (this app has no per-route `loader`s, so the
// router's "pending" state is driven purely by code-split module loading, not data fetching).
// Deliberately just a thin top bar, not a full-screen loader: each page already owns its own
// in-page loading state for real data, this only covers the transition itself.
export function RouteProgressBar() {
  return (
    <div className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-transparent" role="status" aria-label="Loading page">
      <div className="h-full w-1/3 animate-[route-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
    </div>
  );
}
