// Exact, case-insensitive matching of a stored text value through the database API.
//
// The API's only case-insensitive comparison is ILIKE, which treats `_` as "any one character"
// and `%` as "any run of characters". Both are legal in an email address's local part, so a raw
// ILIKE on an address a visitor typed matches OTHER addresses ("a_b@x.com" matches
// "aXb@x.com"). The pattern is therefore escaped — and, because nothing about a pattern language
// should be trusted to decide identity, the caller also compares the rows it gets back with
// `sameTextIgnoringCase` before accepting one.

/** `value` as an ILIKE pattern that matches only itself (ignoring case): `\`, `%` and `_` are
 * escaped. */
export function exactIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** True only when the two are the same text apart from letter case. Never a pattern match. */
export function sameTextIgnoringCase(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}
