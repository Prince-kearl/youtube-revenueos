// What the app says about the workspace's plan (Phase 4B-2). Pure; the server decides access
// (lib/server/plan-access.ts) and this only words what it reported.

export interface WorkspaceAccess {
  plan: "starter" | "pro" | "scale" | null;
  status: "active" | "trialing" | null;
  /** "subscription" | "staff_exception" | "none" | "unavailable" */
  source: string;
  /** The end of the current period (the trial's end while trialing), when known. */
  periodEnd: string | null;
  isOwner: boolean;
}

export interface PlanNotice {
  tone: "warning" | "info";
  title: string;
  body: string;
  /** Where the button leads; null when the reader cannot act on it themselves. */
  action: { label: string; to: "/billing" } | null;
}

const PLAN_NAMES = { starter: "Starter", pro: "Pro", scale: "Scale" } as const;

export function planNotice(
  access: WorkspaceAccess | null,
  now: Date = new Date(),
): PlanNotice | null {
  if (!access) return null;
  if (access.source === "unavailable") return null; // a passing failure: the pages report it
  if (!access.plan)
    return access.isOwner
      ? {
          tone: "warning",
          title: "Your workspace doesn't have an active subscription",
          body: "Choose a plan to use Tubify's analytics, revenue tools and AI — a first subscription starts with a 14-day free trial. Your data is kept and comes back as soon as a plan is active.",
          action: { label: "View plans", to: "/billing" },
        }
      : {
          tone: "warning",
          title: "This workspace's subscription isn't active",
          body: "Ask the workspace owner to renew it in Billing. Your data is kept.",
          action: null,
        };
  if (access.status === "trialing" && access.periodEnd) {
    const end = new Date(access.periodEnd);
    const days = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
    return {
      tone: "info",
      title: `${PLAN_NAMES[access.plan]} trial — ${days} ${days === 1 ? "day" : "days"} left`,
      body: `Billing starts on ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} unless you cancel before then.`,
      action: access.isOwner ? { label: "Manage billing", to: "/billing" } : null,
    };
  }
  return null;
}
