// Wording for the Videos page's count line and empty states. Pure, so each case is unit-tested.
//
// Two different numbers meet on this page and must not be presented as the same thing:
//
//   listed videos        the public videos the YouTube Data API returns for the channel's
//                        uploads playlist — what the table shows
//   channel video count  YouTube's own channel statistic. It can include private, unlisted,
//                        scheduled or recently removed videos, so it can be higher than the list
//
// Neither is changed to match the other; the line says which is which.

const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

export interface VideosCountInput {
  /** Rows currently visible (after the search filter). */
  shown: number;
  /** Public videos loaded so far, before the search filter. */
  loaded: number;
  /** Whether more pages can still be loaded. */
  hasMore: boolean;
  /** YouTube's channel-level video count. */
  channelVideoCount: number;
  searching: boolean;
  /** Video sync is switched off in YouTube Integration settings: the list was not requested
   * from YouTube at all, so an empty list says nothing about the channel. */
  syncDisabled?: boolean;
}

export const CHANNEL_COUNT_HINT =
  "YouTube's channel total can include private, unlisted, scheduled or recently removed videos, which this list does not show.";

export function videosCountLine(input: VideosCountInput): { text: string; hint: string | null } {
  const { shown, loaded, hasMore, channelVideoCount, searching } = input;
  // Nothing was asked of YouTube, so no count of "listed" videos can be stated.
  if (input.syncDisabled) return { text: "Video sync is turned off", hint: null };
  if (searching)
    return {
      text: `${shown.toLocaleString()} of ${plural(loaded, "loaded video")} match`,
      hint: null,
    };
  if (hasMore)
    return {
      text: `Showing ${loaded.toLocaleString()} of ${plural(channelVideoCount, "video")}`,
      hint: null,
    };
  if (loaded === channelVideoCount) return { text: plural(loaded, "video"), hint: null };
  return {
    text: `${plural(loaded, "public video")} listed · YouTube counts ${channelVideoCount.toLocaleString()} on this channel`,
    hint: CHANNEL_COUNT_HINT,
  };
}

export type VideosEmptyKind = "no_match" | "no_videos" | "none_listed";

export interface VideosEmptyState {
  kind: VideosEmptyKind;
  title: string;
  description: string;
  /** What the single action does. */
  action: "clear_search" | "refresh";
  actionLabel: string;
}

/**
 * Why the table has no rows, for a connected channel whose list loaded successfully — or null
 * when no such explanation applies: with video sync switched off the page's own "sync is
 * disabled" notice is the whole story, and saying YouTube lists no videos would be untrue.
 */
export function videosEmptyState(input: {
  search: string;
  channelVideoCount: number;
  syncDisabled?: boolean;
}): VideosEmptyState | null {
  if (input.syncDisabled) return null;
  const search = input.search.trim();
  if (search)
    return {
      kind: "no_match",
      title: `No videos match “${search}”`,
      description: "Try a different title, or clear the search to see every loaded video.",
      action: "clear_search",
      actionLabel: "Clear search",
    };
  if (input.channelVideoCount <= 0)
    return {
      kind: "no_videos",
      title: "No videos on this channel yet",
      description: "Videos you publish on YouTube appear here automatically.",
      action: "refresh",
      actionLabel: "Refresh",
    };
  return {
    kind: "none_listed",
    title: "No public videos to show",
    description:
      `YouTube is not listing any public videos for this channel right now, although its channel total counts ${input.channelVideoCount.toLocaleString()}. ` +
      "Those may be private, unlisted, scheduled or removed.",
    action: "refresh",
    actionLabel: "Refresh",
  };
}
