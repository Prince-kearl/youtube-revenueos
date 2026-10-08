// What Settings tells the creator after "Sync now", from the response of POST /api/youtube/sync.
//
// That response carries two separate outcomes:
//
//   status       the channel sync (channel details, recent videos, comments, chapters)
//   revenueData  the stored revenue-data sync that the revenue figures are read from:
//                "complete", "paused" (it stopped at its request budget and resumes on the next
//                run — normal while history is still loading) or "failed"
//
// A failed revenue-data sync does not change the channel's status, but it is not a clean sync
// either, so it gets the same warning as a partly failed channel sync. It is never an
// authorization problem: only the channel sync can report "reauth_required".
//
// Pure, so each case is unit-tested.

export interface YoutubeSyncResponse {
  status?: string;
  error?: string;
  revenueData?: { status?: string } | null;
}

export interface YoutubeSyncToast {
  kind: "success" | "error";
  message: string;
}

export const YOUTUBE_SYNC_COMPLETE = "YouTube sync complete";
export const YOUTUBE_SYNC_WARNINGS = "YouTube sync completed with warnings";
export const YOUTUBE_SYNC_REAUTH = "YouTube authorization needs to be renewed before syncing.";

export function youtubeSyncToast(body: YoutubeSyncResponse): YoutubeSyncToast {
  if (body.status === "reauth_required") return { kind: "error", message: YOUTUBE_SYNC_REAUTH };
  const warnings = body.status === "partial" || body.revenueData?.status === "failed";
  return { kind: "success", message: warnings ? YOUTUBE_SYNC_WARNINGS : YOUTUBE_SYNC_COMPLETE };
}
