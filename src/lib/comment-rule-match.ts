// Which Comment Automation rule answers a comment, and the reply text it produces. Shared by the
// Comment Automation page (single and selected replies) and the server's reply queue ("all on
// YouTube"), so both choose the same rule and write the same reply.

export const GENERIC_REPLY = "Thanks for your comment! 🙌";

/** The parts of a rule that decide whether it matches. */
export interface MatchableRule {
  id: string;
  active: boolean;
  trigger_type: "keyword" | "handle" | "question";
  keywords: string[];
  reply_template: string;
  /** The rule's video (our internal videos.id) when it is scoped to one video. */
  video: { id: string } | null;
}

export interface MatchableComment {
  /** The YouTube video id the comment is on. */
  videoId: string;
  text: string;
}

// videoIdByRuleVideoId maps a rule's video (our internal videos.id, the value stored in
// rule.video.id) to that video's real YouTube video ID, since incoming comments are keyed by the
// latter — without this a rule scoped to "this video only" would never actually match anything,
// or would need string comparison across two different ID spaces.
export function matchRule<R extends MatchableRule>(
  comment: MatchableComment,
  rules: R[],
  videoIdByRuleVideoId: Map<string, string>,
): R | undefined {
  const active = rules.filter(
    (r) => r.active && (!r.video || videoIdByRuleVideoId.get(r.video.id) === comment.videoId),
  );
  if (/@\w+/.test(comment.text)) {
    const handleRule = active.find((r) => r.trigger_type === "handle");
    if (handleRule) return handleRule;
  }
  for (const r of active.filter((r) => r.trigger_type === "keyword")) {
    if (r.keywords.some((k) => comment.text.toLowerCase().includes(k.toLowerCase()))) return r;
  }
  if (comment.text.trim().endsWith("?")) {
    const questionRule = active.find((r) => r.trigger_type === "question");
    if (questionRule) return questionRule;
  }
  return undefined;
}

/**
 * The reply as sent: "{name}" in a template becomes the commenter's first name (or is dropped
 * when there is none), so replies built from one template are not all word-for-word identical.
 */
export function personalizeReply(template: string, authorName: string | null): string {
  const first = (authorName ?? "").replace(/^@/, "").trim().split(/\s+/)[0] ?? "";
  const text = first
    ? template.replace(/\{name\}/gi, first)
    : template.replace(/\s*\{name\}\s*/gi, " ").replace(/\s+([!?.,])/g, "$1");
  return text.replace(/[ \t]{2,}/g, " ").trim();
}
