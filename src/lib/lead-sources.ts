// Where leads come from, and which of those places the signed-in user may open. Pure, so the
// rule is unit-tested.
//
// Access comes from the existing server-backed feature map (GET /api/features/access — the same
// one the navigation uses). Nothing new is decided here: a source is linked only when that map
// has loaded and does not switch the feature off for this user's role.

export interface LeadSourceLink {
  to: "/comments" | "/freebie";
  label: string;
  /** The key of the feature in the server's feature map. */
  feature: string;
}

export const LEAD_SOURCES: readonly LeadSourceLink[] = [
  { to: "/comments", label: "Set up comment automation", feature: "comment_automation" },
  { to: "/freebie", label: "Create a freebie", feature: "freebie" },
];

/**
 * The lead sources to link to. `features` is null while access is unknown (still loading, or the
 * request failed): no link is offered on a guess. Once loaded, a feature the map does not
 * mention is enabled — the same default the server and the navigation apply.
 */
export function leadSourceLinks(features: Record<string, boolean> | null): LeadSourceLink[] {
  if (!features) return [];
  return LEAD_SOURCES.filter((source) => features[source.feature] ?? true);
}
