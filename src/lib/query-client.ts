import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "./api-client";

export const SESSION_QUERY_ROOT = "session";

/**
 * Each router gets its own client (important for SSR isolation). Sensitive API results remain
 * memory-only; they are never persisted to localStorage or another durable browser cache.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 1;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Drop prior-account query data on identity changes; logout clears the whole in-memory cache. */
export function clearSessionQueryData(
  queryClient: QueryClient,
  currentUserId: string | null,
): void {
  if (!currentUserId) {
    queryClient.clear();
    return;
  }

  queryClient.removeQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === SESSION_QUERY_ROOT && queryKey[1] !== currentUserId,
  });
  // Mutation variables/results can contain user data too. Clear them whenever the account changes.
  queryClient.getMutationCache().clear();
}
