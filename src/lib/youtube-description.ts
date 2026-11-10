// Shared by the AI Description Lab (browser) and the publish route (server), so the page and the
// server apply the same rules. Pure, so every case is unit-tested.

import type { WorkspaceRole } from "@/lib/team-policy";

/** YouTube's limit on a video description, in UTF-8 bytes (not characters). */
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;

/** Publishes and undos one workspace may make in a quota day (midnight Pacific). Each costs about
 * 51 units of the app's shared 10,000 (one read, one write). */
export const DESCRIPTION_PUBLISH_DAILY_LIMIT = 20;

/** Workspace roles that may change a video's description on YouTube. Setters may not. */
export const DESCRIPTION_PUBLISH_ROLES: readonly WorkspaceRole[] = ["owner", "manager", "editor"];

export function canPublishDescription(role: WorkspaceRole | null | undefined): boolean {
  return !!role && DESCRIPTION_PUBLISH_ROLES.includes(role);
}

export type DescriptionProblem = "EMPTY" | "TOO_LONG" | "ANGLE_BRACKETS";

export function descriptionBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Why YouTube would refuse this description, or null when it is acceptable. */
export function descriptionProblem(text: string): DescriptionProblem | null {
  if (!text.trim()) return "EMPTY";
  if (/[<>]/.test(text)) return "ANGLE_BRACKETS";
  if (descriptionBytes(text) > YOUTUBE_DESCRIPTION_MAX_BYTES) return "TOO_LONG";
  return null;
}

export const DESCRIPTION_PROBLEM_TEXT: Record<DescriptionProblem, string> = {
  EMPTY: "Write a description before publishing.",
  ANGLE_BRACKETS:
    "YouTube doesn't allow the < or > characters in a description. Remove them first.",
  TOO_LONG: `YouTube allows up to ${YOUTUBE_DESCRIPTION_MAX_BYTES.toLocaleString("en-US")} bytes in a description. Shorten it first.`,
};

/** What the publish route answers, as words for the page. */
export function publishErrorMessage(code: string | undefined): string {
  const messages: Record<string, string> = {
    ROLE_NOT_ALLOWED:
      "Your role in this workspace can't publish to YouTube. Ask an owner or manager.",
    FEATURE_DISABLED: "The AI Description Lab is turned off for your role.",
    FEATURE_UNAVAILABLE: "The AI Description Lab isn't available right now.",
    CHANNEL_NOT_FOUND: "We couldn't find that YouTube channel. Choose it again and retry.",
    VIDEO_NOT_FOUND: "We couldn't find that video on your channel. It may have been deleted.",
    DESCRIPTION_CHANGED_ON_YOUTUBE:
      "This video's description was changed on YouTube after you opened it. Reload the video to see the latest version, then publish again.",
    NOTHING_TO_UNDO: "There's no earlier description to restore for this video.",
    DAILY_LIMIT_REACHED: `Your workspace has reached today's limit of ${DESCRIPTION_PUBLISH_DAILY_LIMIT} description updates. It resets at midnight Pacific time.`,
    YOUTUBE_QUOTA_EXCEEDED:
      "YouTube's daily limit for Tubify has been reached. Try again after midnight Pacific time.",
    YOUTUBE_REAUTH_REQUIRED: "Reconnect your YouTube channel in Settings, then try again.",
    YOUTUBE_INSUFFICIENT_SCOPE:
      "Tubify doesn't have permission to edit this channel's videos. Reconnect YouTube in Settings.",
    YOUTUBE_REFUSED:
      "YouTube refused this description. Check it for unusual characters and try again.",
    EMPTY: DESCRIPTION_PROBLEM_TEXT.EMPTY,
    ANGLE_BRACKETS: DESCRIPTION_PROBLEM_TEXT.ANGLE_BRACKETS,
    TOO_LONG: DESCRIPTION_PROBLEM_TEXT.TOO_LONG,
  };
  return (
    (code && messages[code]) ||
    "We couldn't update YouTube just now. Nothing was changed. Try again."
  );
}

// ---- status badges for listed uploads ----

export type VideoVisibility = "public" | "unlisted" | "private" | "scheduled" | "processing";

export function videoVisibility(video: {
  privacyStatus: string | null;
  uploadStatus?: string | null;
  publishAt?: string | null;
}): VideoVisibility {
  if (video.uploadStatus === "uploaded") return "processing";
  if (video.privacyStatus === "private" && video.publishAt) return "scheduled";
  if (video.privacyStatus === "unlisted") return "unlisted";
  if (video.privacyStatus === "private") return "private";
  return "public";
}

export const VISIBILITY_LABEL: Record<VideoVisibility, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
  scheduled: "Scheduled",
  processing: "Processing",
};

/** True when the video has no description yet (blank or whitespace only). */
export function hasNoDescription(video: { description?: string | null }): boolean {
  return !video.description?.trim();
}
