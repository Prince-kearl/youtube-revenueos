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

// ---- title and tags (YouTube's own limits) ----

/** YouTube's limit on a video title, in characters. */
export const YOUTUBE_TITLE_MAX_CHARS = 100;
/** YouTube's limit on all of a video's tags together (see tagsLength). */
export const YOUTUBE_TAGS_MAX_CHARS = 500;

export type TitleProblem = "TITLE_EMPTY" | "TITLE_TOO_LONG" | "TITLE_ANGLE_BRACKETS";

export function titleProblem(title: string): TitleProblem | null {
  if (!title.trim()) return "TITLE_EMPTY";
  if (/[<>]/.test(title)) return "TITLE_ANGLE_BRACKETS";
  if ([...title].length > YOUTUBE_TITLE_MAX_CHARS) return "TITLE_TOO_LONG";
  return null;
}

/** Tags as YouTube counts them toward its 500-character limit: each tag's length, plus 2 for
 * the quotes YouTube adds around a tag containing a space, plus a comma between tags. */
export function tagsLength(tags: string[]): number {
  if (!tags.length) return 0;
  return (
    tags.reduce((sum, tag) => sum + [...tag].length + (/\s/.test(tag) ? 2 : 0), 0) +
    (tags.length - 1)
  );
}

/** Trimmed, blank ones dropped, duplicates (ignoring case) removed, order kept. */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export type TagsProblem = "TAGS_TOO_LONG" | "TAGS_ANGLE_BRACKETS";

export function tagsProblem(tags: string[]): TagsProblem | null {
  if (tags.some((tag) => /[<>]/.test(tag))) return "TAGS_ANGLE_BRACKETS";
  if (tagsLength(tags) > YOUTUBE_TAGS_MAX_CHARS) return "TAGS_TOO_LONG";
  return null;
}

// ---- chapters (YouTube reads them from timestamp lines in the description) ----

export type Chapter = { seconds: number; title: string };

const TIMESTAMP_LINE = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:|]?\s*(.*)$/;

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** One chapter per line ("0:00 Intro", "1:05:30 - Wrap up"). Null for a line that is not one. */
export function parseChapterLine(line: string): Chapter | null {
  const match = TIMESTAMP_LINE.exec(line);
  if (!match) return null;
  const [, h, m, s, title] = match;
  if (Number(s) >= 60 || (h !== undefined && Number(m) >= 60)) return null;
  if (!title.trim()) return null;
  return { seconds: Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s), title: title.trim() };
}

export type ChaptersProblem =
  | "CHAPTERS_BAD_LINE"
  | "CHAPTERS_TOO_FEW"
  | "CHAPTERS_FIRST_NOT_ZERO"
  | "CHAPTERS_OUT_OF_ORDER"
  | "CHAPTERS_TOO_SHORT"
  | "CHAPTERS_PAST_END";

/** The chapters typed in the editor, and why YouTube would not show them as chapters, if it
 * would not. YouTube's rules: the first starts at 0:00, at least 3, in order, each at least 10
 * seconds long. */
export function parseChapters(
  text: string,
  durationSeconds: number | null,
): { chapters: Chapter[]; problem: ChaptersProblem | null } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const chapters: Chapter[] = [];
  for (const line of lines) {
    const chapter = parseChapterLine(line);
    if (!chapter) return { chapters, problem: "CHAPTERS_BAD_LINE" };
    chapters.push(chapter);
  }
  let problem: ChaptersProblem | null = null;
  if (chapters.length < 3) problem = "CHAPTERS_TOO_FEW";
  else if (chapters[0].seconds !== 0) problem = "CHAPTERS_FIRST_NOT_ZERO";
  else {
    for (let i = 1; i < chapters.length && !problem; i++) {
      const gap = chapters[i].seconds - chapters[i - 1].seconds;
      if (gap <= 0) problem = "CHAPTERS_OUT_OF_ORDER";
      else if (gap < 10) problem = "CHAPTERS_TOO_SHORT";
    }
    const last = chapters[chapters.length - 1].seconds;
    if (!problem && durationSeconds !== null && durationSeconds - last < 10)
      problem = last >= durationSeconds ? "CHAPTERS_PAST_END" : "CHAPTERS_TOO_SHORT";
  }
  return { chapters, problem };
}

export function chaptersBlock(chapters: Chapter[]): string {
  return chapters.map((c) => `${formatTimestamp(c.seconds)} ${c.title}`).join("\n");
}

/** The description with its chapter list replaced by `block`: the existing list (the run of
 * timestamp lines that starts at 0:00) is swapped in place; without one, the block is added at
 * the end. Everything else in the description is kept as it is. */
export function descriptionWithChapters(description: string, block: string): string {
  const lines = description.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => parseChapterLine(line)?.seconds === 0);
  if (start === -1) {
    const base = lines.join("\n").replace(/\s+$/, "");
    return base ? `${base}\n\n${block}` : block;
  }
  let end = start;
  while (end + 1 < lines.length && parseChapterLine(lines[end + 1])) end++;
  return [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end + 1)].join("\n");
}

/** The description with a call to action added at the end (unchanged if it is already there). */
export function descriptionWithCallToAction(description: string, cta: string): string {
  const text = cta.trim();
  const base = description.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  if (!text || base.includes(text)) return base;
  return base ? `${base}\n\n${text}` : text;
}

// ---- messages ----

export const PUBLISH_PROBLEM_TEXT: Record<
  DescriptionProblem | TitleProblem | TagsProblem | ChaptersProblem,
  string
> = {
  ...DESCRIPTION_PROBLEM_TEXT,
  TITLE_EMPTY: "Choose or write a title first.",
  TITLE_TOO_LONG: `YouTube allows up to ${YOUTUBE_TITLE_MAX_CHARS} characters in a title. Shorten it first.`,
  TITLE_ANGLE_BRACKETS: "YouTube doesn't allow the < or > characters in a title.",
  TAGS_TOO_LONG: `YouTube allows up to ${YOUTUBE_TAGS_MAX_CHARS} characters of tags in total. Remove some first.`,
  TAGS_ANGLE_BRACKETS: "YouTube doesn't allow the < or > characters in tags.",
  CHAPTERS_BAD_LINE:
    'Write one chapter per line, starting with its time, for example "0:00 Intro".',
  CHAPTERS_TOO_FEW: "YouTube needs at least 3 chapters.",
  CHAPTERS_FIRST_NOT_ZERO: "The first chapter has to start at 0:00.",
  CHAPTERS_OUT_OF_ORDER: "Put the chapters in time order.",
  CHAPTERS_TOO_SHORT: "Each chapter has to be at least 10 seconds long.",
  CHAPTERS_PAST_END: "A chapter starts after the end of the video.",
};

/** What the publish route answers, as words for the page. */
export function publishErrorMessage(code: string | undefined): string {
  const messages: Record<string, string> = {
    ...PUBLISH_PROBLEM_TEXT,
    ROLE_NOT_ALLOWED:
      "Your role in this workspace can't publish to YouTube. Ask an owner or manager.",
    FEATURE_DISABLED: "Publishing to YouTube is turned off for your role.",
    FEATURE_UNAVAILABLE: "Publishing to YouTube isn't available right now.",
    CHANNEL_NOT_FOUND: "We couldn't find that YouTube channel. Choose it again and retry.",
    VIDEO_NOT_FOUND: "We couldn't find that video on your channel. It may have been deleted.",
    CHANGED_ON_YOUTUBE:
      "This video was changed on YouTube after you opened it. Reload the video to see the latest version, then publish again.",
    NOTHING_TO_UNDO: "There's no earlier version to restore for this video.",
    NOTHING_TO_PUBLISH: "Nothing to publish.",
    DAILY_LIMIT_REACHED: `Your workspace has reached today's limit of ${DESCRIPTION_PUBLISH_DAILY_LIMIT} YouTube updates. It resets at midnight Pacific time.`,
    YOUTUBE_QUOTA_EXCEEDED:
      "YouTube's daily limit for Tubify has been reached. Try again after midnight Pacific time.",
    YOUTUBE_REAUTH_REQUIRED: "Reconnect your YouTube channel in Settings, then try again.",
    YOUTUBE_INSUFFICIENT_SCOPE:
      "Tubify doesn't have permission to edit this channel's videos. Reconnect YouTube in Settings.",
    YOUTUBE_REFUSED: "YouTube refused this change. Check it for unusual characters and try again.",
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

// ---- what a content analysis judged ----

/**
 * A fingerprint of the video details a content analysis was made from: title, description, tags
 * and visibility. Stored with the analysis, so a page can tell whether the analysis still
 * describes the video as it is on YouTube. Not a security measure (FNV-1a, 32-bit) — just a
 * cheap, stable comparison that works the same in the browser and on the server.
 */
export function analysisBasis(details: {
  title: string;
  description: string | null;
  tags?: string[] | null;
  privacyStatus?: string | null;
}): string {
  const text = JSON.stringify([
    details.title.trim(),
    (details.description ?? "").replace(/\r\n?/g, "\n").trim(),
    details.tags ?? [],
    details.privacyStatus ?? "",
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `v1:${hash.toString(16).padStart(8, "0")}`;
}
