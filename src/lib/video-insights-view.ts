// What the dashboard's Video Insights card says about the latest video, kept out of the route file
// so it can be tested on its own. Views and engagement come from the recent-videos list itself; the
// subscriber and device figures come from YouTube Analytics, which reports a video's figures a day
// or two after it is published. So the card shows what it has, and says exactly why anything is
// missing — never one vague message for every case.

export type VideosStatus = "available" | "unavailable" | "disabled";
export type InsightsStatus =
  "available" | "disabled" | "forbidden" | "temporarily_unavailable" | "unavailable";

export type VideoInsightsNotice =
  | { kind: "none" }
  /** Nothing to show at all: no latest video. `action` is what the reader can do about it. */
  | { kind: "empty"; message: string; action: "retry" | "settings" | null }
  /** The latest video's own figures are shown; only the analytics part is missing. */
  | { kind: "partial"; message: string; action: "settings" | "reconnect" | null };

export function videoInsightsNotice(input: {
  hasLatestVideo: boolean;
  videosStatus: VideosStatus | undefined;
  insightsStatus: InsightsStatus;
}): VideoInsightsNotice {
  if (!input.hasLatestVideo) {
    if (input.videosStatus === "unavailable")
      return {
        kind: "empty",
        message: "We couldn't load your latest videos from YouTube. Please try again.",
        action: "retry",
      };
    if (input.videosStatus === "disabled")
      return {
        kind: "empty",
        message: "Recent video sync is turned off in YouTube Integration settings.",
        action: "settings",
      };
    return {
      kind: "empty",
      message:
        "No public videos were found in your recent uploads. Unlisted, private and scheduled videos aren't shown here.",
      action: null,
    };
  }
  switch (input.insightsStatus) {
    case "available":
      return { kind: "none" };
    case "disabled":
      return {
        kind: "partial",
        message: "Subscriber and device figures need analytics import, which is turned off.",
        action: "settings",
      };
    case "forbidden":
      return {
        kind: "partial",
        message: "Reconnect YouTube to see subscriber and device figures for this video.",
        action: "reconnect",
      };
    case "temporarily_unavailable":
      return {
        kind: "partial",
        message:
          "Subscriber and device figures are temporarily unavailable. Please try again later.",
        action: null,
      };
    default:
      return {
        kind: "partial",
        message:
          "Subscriber and device figures appear once YouTube reports them, usually a day or two after publishing.",
        action: null,
      };
  }
}
