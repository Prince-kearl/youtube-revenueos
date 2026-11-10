// The optimization checklist for a video's YouTube details: objective checks computed by code,
// never by the AI, so a fixed item stays fixed — the same answer every time for the same video.
// Used by Analyze Video (the checklist and its "Ready" state), the content-analysis prompt (so
// the AI does not re-raise what passes) and the optimization prompt (so suggestions pass it).
// Pure, so every rule is unit-tested.

import { parseChapters } from "@/lib/youtube-description";

/** The Optimize tab that fixes a failing check. */
export type FixTab = "description" | "titles" | "tags" | "chapters" | "cta";

export type CheckStatus = "pass" | "fail" | "na";

export type ChecklistItem = {
  id: string;
  label: string;
  status: CheckStatus;
  /** What is wrong, or why it passes / does not apply — one short sentence. */
  detail: string;
  fix: FixTab;
};

export type ChecklistInput = {
  title: string;
  description: string;
  tags: string[];
  /** Null when unknown: checks that need it are not applicable. */
  durationSeconds: number | null;
};

// Shown in full in search results on most screens.
export const TITLE_MIN_CHARS = 20;
export const TITLE_MAX_CHARS = 70;
export const DESCRIPTION_MIN_CHARS = 200;
// What YouTube shows above "...more".
export const DESCRIPTION_OPENING_CHARS = 150;
export const TAGS_MIN = 5;
export const TAGS_MAX = 15;
// YouTube ignores every hashtag on a video that has more than this many.
export const HASHTAGS_MAX = 15;
// Shorter videos (Shorts) do not show chapters; longer ones benefit from them.
export const CHAPTERS_FROM_SECONDS = 180;

const STOPWORDS = new Set(
  "the and for with your you this that what when where which while from into about how why can cannot not are was were will have has had our their they them its it's than then just only also more most very what's who whom".split(
    " ",
  ),
);

const CTA_PATTERN =
  /\b(subscribe|comment|like (this|the) video|hit (the )?like|follow|join|download|sign up|signup|check out|grab|get (the|your|my)|watch (next|this|more)|visit|link (below|in)|turn on notifications|share)\b/i;

/** The title's topic words: 4+ letters, not common filler. */
export function topicWords(title: string): string[] {
  return [
    ...new Set(
      (title.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)),
    ),
  ];
}

const chars = (text: string) => [...text].length;

export function videoChecklist(input: ChecklistInput): ChecklistItem[] {
  const title = input.title.trim();
  const description = input.description.replace(/\r\n?/g, "\n").trim();
  const opening = description.slice(0, DESCRIPTION_OPENING_CHARS);
  const firstLine = description.split("\n").find((line) => line.trim()) ?? "";
  const titleLength = chars(title);
  const words = topicWords(title);
  const hashtags = description.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const tagCount = input.tags.filter((t) => t.trim()).length;
  const chapters = chaptersIn(description, input.durationSeconds);

  const items: ChecklistItem[] = [
    {
      id: "title_length",
      label: `Title is ${TITLE_MIN_CHARS}–${TITLE_MAX_CHARS} characters`,
      status: titleLength >= TITLE_MIN_CHARS && titleLength <= TITLE_MAX_CHARS ? "pass" : "fail",
      detail:
        titleLength > TITLE_MAX_CHARS
          ? `It's ${titleLength} characters, so search results cut it off.`
          : titleLength < TITLE_MIN_CHARS
            ? `It's only ${titleLength} characters, too short to say what the video is about.`
            : `${titleLength} characters, shown in full in search.`,
      fix: "titles",
    },
    {
      id: "description_length",
      label: `Description has at least ${DESCRIPTION_MIN_CHARS} characters`,
      status: chars(description) >= DESCRIPTION_MIN_CHARS ? "pass" : "fail",
      detail: description
        ? `${chars(description).toLocaleString("en-US")} characters.`
        : "There's no description yet.",
      fix: "description",
    },
    {
      id: "description_opening",
      label: "Description opens by saying what the video is about",
      status:
        chars(firstLine) >= 40 && !/https?:\/\//i.test(firstLine) && !/^\s*#/.test(firstLine)
          ? "pass"
          : "fail",
      detail: !description
        ? "There's no description yet."
        : /https?:\/\//i.test(firstLine) || /^\s*#/.test(firstLine)
          ? 'It opens with a link or hashtags; viewers see only the first lines before "...more".'
          : chars(firstLine) < 40
            ? "The first line is very short; use it to describe the video."
            : "The first line describes the video.",
      fix: "description",
    },
    {
      id: "description_topic",
      label: "Opening lines repeat the title's topic",
      status: !words.length
        ? "na"
        : words.some((w) => opening.toLowerCase().includes(w))
          ? "pass"
          : "fail",
      detail: !words.length
        ? "The title has no topic words to look for."
        : words.some((w) => opening.toLowerCase().includes(w))
          ? "The opening lines mention the title's topic."
          : `None of the title's topic words (${words.slice(0, 4).join(", ")}) appear in the first ${DESCRIPTION_OPENING_CHARS} characters.`,
      fix: "description",
    },
    {
      id: "call_to_action",
      label: "Description asks viewers to do something",
      status: CTA_PATTERN.test(description) ? "pass" : "fail",
      detail: CTA_PATTERN.test(description)
        ? "There's a call to action."
        : "No call to action (subscribe, comment, a link to visit…).",
      fix: "cta",
    },
    {
      id: "hashtags",
      label: `No more than ${HASHTAGS_MAX} hashtags`,
      status: hashtags <= HASHTAGS_MAX ? "pass" : "fail",
      detail:
        hashtags > HASHTAGS_MAX
          ? `${hashtags} hashtags: YouTube ignores all of them above ${HASHTAGS_MAX}.`
          : `${hashtags} hashtag${hashtags === 1 ? "" : "s"}.`,
      fix: "description",
    },
    {
      id: "tags",
      label: `${TAGS_MIN}–${TAGS_MAX} tags`,
      status: tagCount >= TAGS_MIN && tagCount <= TAGS_MAX ? "pass" : "fail",
      detail:
        tagCount < TAGS_MIN
          ? `${tagCount} tag${tagCount === 1 ? "" : "s"}; add a few that describe the topic.`
          : tagCount > TAGS_MAX
            ? `${tagCount} tags; keep the ${TAGS_MAX} most relevant.`
            : `${tagCount} tags.`,
      fix: "tags",
    },
    {
      id: "chapters",
      label: "Chapters for a longer video",
      status:
        input.durationSeconds === null || input.durationSeconds < CHAPTERS_FROM_SECONDS
          ? "na"
          : chapters
            ? "pass"
            : "fail",
      detail:
        input.durationSeconds === null
          ? "The video's length isn't known."
          : input.durationSeconds < CHAPTERS_FROM_SECONDS
            ? "Not needed for a video this short."
            : chapters
              ? "The description has a chapter list YouTube can use."
              : "No chapter list YouTube can use (0:00 first, at least 3).",
      fix: "chapters",
    },
  ];
  return items;
}

/** Whether the description holds a chapter list YouTube would accept. */
function chaptersIn(description: string, durationSeconds: number | null): boolean {
  const lines = description.split("\n");
  const start = lines.findIndex((line) => /^\s*(?:\d{1,2}:)?0?0:00\b/.test(line));
  if (start === -1) return false;
  const run: string[] = [];
  for (let i = start; i < lines.length && /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s/.test(lines[i]); i++)
    run.push(lines[i]);
  return parseChapters(run.join("\n"), durationSeconds).problem === null;
}

/** Every applicable check passes. */
export function checklistComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.status !== "fail");
}

/** The checklist as plain lines, for an AI prompt. */
export function checklistForPrompt(items: ChecklistItem[]): string {
  return items
    .map(
      (item) =>
        `- ${item.label}: ${item.status === "pass" ? "PASS" : item.status === "fail" ? "FAIL" : "not applicable"} (${item.detail})`,
    )
    .join("\n");
}

/** The rules, as instructions for the AI that writes suggestions, so what it writes passes. */
export const CHECKLIST_WRITING_RULES = [
  `titles between ${TITLE_MIN_CHARS} and ${TITLE_MAX_CHARS} characters`,
  `a description of at least ${DESCRIPTION_MIN_CHARS} characters whose first line (at least 40 characters, no link, no hashtag) says what the video is about and uses the title's main topic words`,
  "a short call to action in the description",
  `no more than ${HASHTAGS_MAX} hashtags`,
  `${TAGS_MIN} to ${TAGS_MAX} tags`,
].join("; ");
