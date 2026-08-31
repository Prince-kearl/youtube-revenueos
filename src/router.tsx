import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteProgressBar } from "@/components/RouteProgressBar";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // No route defines a `loader`, so "pending" here is purely code-split chunk loading — the
    // delay/min-show pair keeps it from flashing on the common case (chunk already cached) while
    // still covering a first visit to a not-yet-loaded page instead of a blank screen.
    defaultPendingComponent: RouteProgressBar,
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
  });

  return router;
};
