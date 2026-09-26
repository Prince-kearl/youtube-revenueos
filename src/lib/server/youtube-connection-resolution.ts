// Decides how a fresh Google OAuth grant should map onto youtube_connections, WITHOUT performing
// any I/O itself — every input here is already-fetched data, so this is plain, deterministic,
// fully unit-testable logic. The route (api.youtube.callback.ts) does the fetching and executes
// whatever this returns. Same split this codebase already uses for token refresh (see
// getValidAccessTokenWithDependencies in youtube-tokens.ts).
//
// Why this exists: migrating pre-existing per-channel tokens into youtube_connections (see
// 202610020001_youtube_oauth_connections.sql) left those backfilled connections with
// google_subject_id = NULL, since no `sub` was ever captured before that migration. Without this
// reconciliation step, the FIRST reconnect by that same identity after migration would never match
// the legacy row (NULL != any real sub) and would silently create a redundant, orphaned connection
// holding a live, unused token pair. This function is what prevents that — while refusing to guess
// when more than one legacy connection could plausibly be "the same identity".

export interface LegacyConnectionCandidate {
  id: string;
  // Both ciphertext columns are NOT NULL at the schema level, so this should always be true in
  // practice — checked anyway rather than trusting the schema blindly, since adopting a legacy
  // connection is exactly the kind of one-way operation (see the ambiguity rule below) worth being
  // defensive about.
  hasTokenPair: boolean;
}

export type ConnectionResolutionPlan =
  | { action: "reuse"; connectionId: string }
  | { action: "reconcile"; connectionId: string }
  | { action: "create" }
  | { action: "ambiguous"; candidateConnectionIds: string[] };

export interface PlanConnectionResolutionInput {
  // The result of the existing exact lookup: workspace_id + google_subject_id = identity.sub.
  exactMatchConnectionId: string | null;
  // Legacy (google_subject_id IS NULL) connections in this workspace that are referenced by at
  // least one of the channels this OAuth token's channels.list call just discovered AND that
  // already exist as a youtube_channels row in this workspace. An identity that discovers a
  // channel nobody in this workspace has ever connected before contributes nothing here — there is
  // nothing to reconcile against, and a brand new connection is exactly correct for it.
  eligibleLegacyConnections: LegacyConnectionCandidate[];
}

export function planYoutubeConnectionResolution(
  input: PlanConnectionResolutionInput,
): ConnectionResolutionPlan {
  if (input.exactMatchConnectionId) {
    return { action: "reuse", connectionId: input.exactMatchConnectionId };
  }

  const usable = input.eligibleLegacyConnections.filter((c) => c.hasTokenPair);

  if (usable.length === 1) {
    return { action: "reconcile", connectionId: usable[0].id };
  }

  if (usable.length > 1) {
    // Two or more distinct legacy connections are each backing a channel this identity can see.
    // There is no way to prove which one (if any) this specific Google account originally created
    // — merging any of them, or picking one, risks silently attaching an unrelated identity to
    // someone else's connection. A safe false-negative (create nothing, ask for a deliberate
    // reconnect) is strictly preferred over that.
    return { action: "ambiguous", candidateConnectionIds: usable.map((c) => c.id) };
  }

  return { action: "create" };
}
