// A redirect target taken from a request (a query parameter or a cookie) is used only when it is
// a path inside this app. "Starts with / but not //" is not enough: browsers treat a backslash as
// a slash and drop tabs and newlines, so "/\evil.com" or "/<tab>/evil.com" become
// "//evil.com" — a link to another site. Anything that is not plainly an app path gets the
// fallback instead.

const BASE = "https://app.invalid";

export function safeAppPath(candidate: string | null | undefined, fallback: string): string {
  if (!candidate || candidate.length > 2048) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  // Backslashes and any control character (tab, newline, NUL…) are never part of an app path.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  try {
    const resolved = new URL(candidate, BASE);
    if (resolved.origin !== BASE) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
