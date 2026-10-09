// The admin console's navigation: which sections exist, what they are called, and how they are
// grouped. Pure data (no React, no icons) so the structure is unit-tested; AdminNav adds icons.
//
// Grouping only arranges the links. Each section keeps its own screen and its own
// responsibility — Feature Management is not Roles & Permissions, and platform-admin roles are
// not workspace roles — and every admin API still checks platform-admin rights on the server.

export type AdminSection =
  | "dashboard"
  | "users"
  | "roles"
  | "organizations"
  | "ai"
  | "billing"
  | "analytics"
  | "communications"
  | "content"
  | "system"
  | "security"
  | "audit"
  | "support"
  | "infrastructure"
  | "features"
  | "releases"
  | "roadmap"
  | "changelog";

export interface AdminNavGroup {
  label: string;
  items: { key: AdminSection; label: string }[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: "Overview & Insights",
    items: [
      { key: "dashboard", label: "Executive Dashboard" },
      { key: "analytics", label: "Analytics & Reporting" },
    ],
  },
  {
    label: "Accounts & Access",
    items: [
      { key: "users", label: "Users" },
      { key: "roles", label: "Roles & Permissions" },
      { key: "organizations", label: "Workspaces" },
    ],
  },
  { label: "Billing & Subscriptions", items: [{ key: "billing", label: "Billing" }] },
  {
    label: "Product Controls",
    items: [
      { key: "ai", label: "AI Management" },
      { key: "features", label: "Feature Management" },
    ],
  },
  {
    label: "Security & Audit",
    items: [
      { key: "security", label: "Security Center" },
      { key: "audit", label: "Audit Logs" },
    ],
  },
  {
    label: "Brand & Communications",
    items: [
      { key: "content", label: "Customization" },
      { key: "communications", label: "Communications" },
    ],
  },
  {
    label: "Releases & Roadmap",
    items: [
      // A registry of release records (version, notes, status, current/minimum version) — it
      // does not control source code or deployments, hence not "Version Control".
      { key: "releases", label: "Release Registry" },
      { key: "roadmap", label: "Roadmap" },
      { key: "changelog", label: "Changelog" },
    ],
  },
  {
    label: "System & Support",
    items: [
      { key: "system", label: "System" },
      { key: "infrastructure", label: "Infrastructure" },
      { key: "support", label: "Support" },
    ],
  },
];

export const ADMIN_SECTIONS: readonly AdminSection[] = ADMIN_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.key),
);

/** The four sections on the phone's bottom bar; the rest are under "More". */
export const ADMIN_MOBILE_PRIMARY: readonly AdminSection[] = [
  "dashboard",
  "users",
  "billing",
  "support",
];

/** The section a `?section=` value names, or the dashboard for anything unknown. */
export function adminSectionFrom(value: unknown): AdminSection {
  return typeof value === "string" && (ADMIN_SECTIONS as readonly string[]).includes(value)
    ? (value as AdminSection)
    : "dashboard";
}
