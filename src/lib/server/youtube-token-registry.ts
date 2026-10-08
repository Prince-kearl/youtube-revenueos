// Lets the YouTube API request layer recover from an HTTP 401 without knowing anything about
// connections, databases or encryption.
//
// The API helpers in google-oauth.ts are handed a bare access-token string. When YouTube answers
// one of their requests with 401, that alone does not prove the creator's authorization is gone
// — it has been observed on tokens Google issued seconds earlier. The only real test is to ask
// Google for a new access token:
//
//   - Google REJECTS the refresh  → the grant really is gone. The refresher (see
//     youtube-tokens.ts) records that reauthorization is required and throws; that is the one genuine
//     reauthorization signal.
//   - Google ISSUES a new token   → the grant is fine. The request is retried once with it. If
//     that also fails, it is an ordinary, retryable API failure — never a reason to tell the
//     creator to reconnect.
//
// getValidAccessToken registers each token it hands out together with a function that can force
// that refresh for the token's connection; the request layer looks the token up here on a 401.
//
// This module deliberately imports nothing, so both youtube-tokens.ts and google-oauth.ts can
// use it without a circular import. It never logs, and tokens exist here only as the same
// in-memory strings the callers already hold.

interface RegisteredToken {
  connectionId: string;
  /** Forces a refresh for the connection, persists it, registers the new token as forced, and
   * returns it. Throws when Google rejects the refresh. */
  forceRefresh: () => Promise<string>;
  registeredAt: number;
}

interface ConnectionState {
  /** The newest access token handed out for this connection. */
  token: string;
  /** When that token was minted by a forced refresh; 0 if it came from the normal path. */
  forcedAt: number;
  /** A forced refresh already under way, shared by every request that needs one. */
  inFlight: Promise<string> | null;
}

/** A token obtained by a forced refresh this recently is as fresh as it can be: forcing another
 * refresh cannot help, so a 401 on it is simply retried once with the same token. This also caps
 * forced refreshes at one per connection per window. */
const FRESHLY_FORCED_MS = 60_000;
/** Access tokens live for about an hour; nothing older is worth remembering. */
const ENTRY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

const tokens = new Map<string, RegisteredToken>();
const connections = new Map<string, ConnectionState>();

function prune(now: number) {
  if (tokens.size < MAX_ENTRIES) return;
  for (const [token, entry] of tokens)
    if (now - entry.registeredAt > ENTRY_TTL_MS || tokens.size >= MAX_ENTRIES) tokens.delete(token);
}

/** Record a token that was just handed out for a connection. `forced` marks one minted by a
 * forced refresh (see FRESHLY_FORCED_MS). */
export function registerYoutubeAccessToken(
  token: string,
  connectionId: string,
  forceRefresh: () => Promise<string>,
  options: { forced?: boolean; now?: number } = {},
): void {
  const now = options.now ?? Date.now();
  prune(now);
  tokens.set(token, { connectionId, forceRefresh, registeredAt: now });
  const state = connections.get(connectionId);
  // A token handed out by the normal path must not displace one that a forced refresh minted
  // moments ago: that would forget the connection was just refreshed (and force another refresh
  // on the next 401), and could put an older token back in use.
  if (!options.forced && state && state.forcedAt && now - state.forcedAt < FRESHLY_FORCED_MS)
    return;
  connections.set(connectionId, {
    token,
    forcedAt: options.forced ? now : 0,
    inFlight: state?.inFlight ?? null,
  });
}

/** The newest token known for the same connection as `token` — so a caller still holding the
 * token it was given before a forced refresh transparently uses the replacement. An unknown
 * token is returned unchanged. */
export function latestYoutubeAccessToken(token: string): string {
  const entry = tokens.get(token);
  if (!entry) return token;
  return connections.get(entry.connectionId)?.token ?? token;
}

/**
 * The token to retry with after YouTube answered `token` with 401, or null when this token was
 * never registered (nothing can refresh it; the caller reports the 401 as it always did).
 *
 * Forces at most one refresh per connection at a time and per FRESHLY_FORCED_MS. Rejects with
 * whatever the refresher throws — in particular the genuine "reauthorization required" error
 * when Google refuses the refresh.
 */
export async function youtubeAccessTokenForRetry(
  token: string,
  now: number = Date.now(),
): Promise<string | null> {
  const entry = tokens.get(token);
  if (!entry) return null;
  const state = connections.get(entry.connectionId);
  if (!state) return null;
  if (state.forcedAt && now - state.forcedAt < FRESHLY_FORCED_MS) return state.token;
  if (!state.inFlight) {
    state.inFlight = entry.forceRefresh().finally(() => {
      const current = connections.get(entry.connectionId);
      if (current) current.inFlight = null;
    });
  }
  return state.inFlight;
}

/** Test helper: forget everything. */
export function resetYoutubeTokenRegistry(): void {
  tokens.clear();
  connections.clear();
}
