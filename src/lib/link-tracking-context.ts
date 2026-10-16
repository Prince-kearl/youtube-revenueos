// The video context of the Link Tracking page (Phase 2D-1): a video's Revenue opportunities send
// the creator to /link-tracking?video=<YouTube id> (its links) or …&create=1 (create one for it).
//
// The URL is untrusted. These helpers only check its SHAPE; the page then asks the server, which
// resolves the id inside the caller's current workspace (GET /api/tracking-links?video=…) and
// answers with the video — or with nothing, for an unknown id and for another workspace's video
// alike. Nothing is shown about a video until the server has confirmed it.

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface LinkTrackingSearch {
  /** A YouTube video id. Anything else is dropped. */
  video?: string;
  /** "1": open the creation dialog for that video. */
  create?: "1";
}

/** The page's search parameters, keeping only well-formed ones. */
export function linkTrackingSearch(search: Record<string, unknown>): LinkTrackingSearch {
  const video =
    typeof search.video === "string" && YOUTUBE_VIDEO_ID.test(search.video)
      ? search.video
      : undefined;
  if (!video) return {};
  return search.create === "1" || search.create === 1 ? { video, create: "1" } : { video };
}

/** The list request for a context (or for the whole workspace). */
export function trackingLinksListUrl(video: string | undefined): string {
  return video ? `/api/tracking-links?video=${encodeURIComponent(video)}` : "/api/tracking-links";
}

/** An action href ("/link-tracking?video=…") as the router wants it: a path and its search. */
export function splitActionHref(href: string): {
  to: string;
  search: Record<string, string> | undefined;
} {
  const [to, query] = href.split("?", 2);
  return { to, search: query ? Object.fromEntries(new URLSearchParams(query)) : undefined };
}

/** The creation dialog's video choices: the chosen video is always one of them, first, even
 * when it is not among the videos the page listed (those are one channel's). */
export function videoChoices<T extends { id: string; title: string }>(
  videos: readonly T[],
  chosen: { id: string; title: string } | null,
): Array<{ id: string; title: string }> {
  return chosen && !videos.some((video) => video.id === chosen.id)
    ? [chosen, ...videos]
    : [...videos];
}

/** The video the server confirmed for the context. */
export interface LinkVideoContext {
  /** The video's id in this workspace (what a link is attached to). */
  id: string;
  youtubeVideoId: string;
  title: string;
}

export const CONTEXT_UNAVAILABLE =
  "That video isn't available in this workspace, so no link can be created for it here.";

export const CONTEXT_CREATED =
  "Link created for this video. It now shows under Revenue sources on the video's page; clicks appear there once viewers use it.";
