import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecretFromBytea } from "./crypto";

// Revoking Tubify's access at Google when a channel is disconnected (youtube-disconnect.ts).
//
// Deleting the stored tokens stops Tubify using them; revoking also tells Google to end the grant,
// so the creator's Google account no longer lists Tubify as having access. Google's YouTube API
// compliance rules expect both.
//
// Google revokes per Google account and app, not per token: revoking ends Tubify's access for
// that whole Google account, including any OTHER connection to it — for example the same Google
// account connected by a creator and, separately, by their agency in another workspace. So access
// is revoked only when no other connection uses the same Google account (google_subject_id,
// Google's stable account id). When that cannot be told (an old connection without it), nothing is
// revoked: the tokens are still deleted, and the creator can remove Tubify from their Google
// account themselves.
//
// Best effort, and never in the way of the disconnect: whatever happens here, the caller deletes
// the stored tokens next. Nothing here logs a token.

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type GoogleRevokeOutcome =
  /** Google ended the grant. */
  | "revoked"
  /** Google no longer knew the token (already revoked or expired): nothing left to end. */
  | "already_invalid"
  /** Another connection uses the same Google account: revoking would cut it off. */
  | "skipped_shared_account"
  /** The Google account behind the connection is not recorded. */
  | "skipped_unknown_account"
  /** The connection could not be read, or Google could not be reached. */
  | "failed";

export async function revokeGoogleGrant(
  service: SupabaseClient,
  input: {
    connectionId: string;
    workspaceId: string;
    /** Connections being deleted at the same time: they do not count as sharing the account. */
    alsoRemoving?: string[];
  },
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<GoogleRevokeOutcome> {
  try {
    const { data: connection, error } = await service
      .from("youtube_connections")
      .select("id, google_subject_id, refresh_token_ciphertext")
      .eq("id", input.connectionId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (error || !connection) return "failed";
    const subject = (connection.google_subject_id as string | null) ?? null;
    if (!subject) return "skipped_unknown_account";

    // Every workspace, on purpose: another workspace's connection to the same Google account
    // would lose its access too.
    const excluded = [input.connectionId, ...(input.alsoRemoving ?? [])];
    const { count, error: countError } = await service
      .from("youtube_connections")
      .select("id", { count: "exact", head: true })
      .eq("google_subject_id", subject)
      .not("id", "in", `(${excluded.join(",")})`);
    if (countError) return "failed";
    if ((count ?? 0) > 0) return "skipped_shared_account";

    const refreshToken = await decryptSecretFromBytea(
      connection.refresh_token_ciphertext as string,
    );
    const response = await (options.fetch ?? fetch)(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (response.ok) return "revoked";
    // 400 invalid_token: Google has already forgotten this grant (revoked by the creator, or long
    // expired). The goal — no live grant — is met.
    if (response.status === 400) return "already_invalid";
    return "failed";
  } catch {
    return "failed";
  }
}

/**
 * Before an account is deleted: ends Tubify's access at Google for every connection the deletion
 * removes — those the user made, and those of the workspaces they own (both cascade). Best effort
 * and bounded: it never stops the deletion. Returns the outcome of each, for the caller to count.
 */
export async function revokeGoogleGrantsOfUser(
  service: SupabaseClient,
  userId: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<GoogleRevokeOutcome[]> {
  try {
    const { data: owned } = await service.from("workspaces").select("id").eq("owner_id", userId);
    const ownedIds = (owned ?? []).map((w) => w.id as string);
    const byUser = await service
      .from("youtube_connections")
      .select("id, workspace_id")
      .eq("user_id", userId);
    const byWorkspace = ownedIds.length
      ? await service
          .from("youtube_connections")
          .select("id, workspace_id")
          .in("workspace_id", ownedIds)
      : { data: [] as { id: string; workspace_id: string }[] };
    const connections = new Map<string, string>();
    for (const row of [...(byUser.data ?? []), ...(byWorkspace.data ?? [])])
      connections.set(row.id as string, row.workspace_id as string);
    const outcomes: GoogleRevokeOutcome[] = [];
    const removing = [...connections.keys()];
    for (const [connectionId, workspaceId] of [...connections].slice(0, 50))
      outcomes.push(
        await revokeGoogleGrant(
          service,
          { connectionId, workspaceId, alsoRemoving: removing },
          options,
        ),
      );
    return outcomes;
  } catch {
    return ["failed"];
  }
}
