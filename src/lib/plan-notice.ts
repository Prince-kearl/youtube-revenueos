// What the app says about the workspace's plan (Phase 4B-2). Pure; the server decides access
// (lib/server/plan-access.ts) and this only words what it reported.

export interface WorkspaceAccess {
  plan: "starter" | "pro" | "scale" | null;
  status: "active" | "trialing" | null;
  /** grant: a plan given by Tubify staff without payment, until periodEnd (null = no end). */
  source: "subscription" | "grant" | "staff_exception" | "transition" | "none" | "unavailable";
  /** The end of the current period (the trial's end while trialing; the transition's end during
   * the existing-customer transition), when known. */
  periodEnd: string | null;
  isOwner: boolean;
}

/** Whether the server-confirmed workspace entitlement may enter the app. */
export function hasWorkspaceAppAccess(
  access: WorkspaceAccess | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!access) return false;
  if (access.source === "subscription")
    return access.plan !== null && (access.status === "active" || access.status === "trialing");
  if (access.source === "grant") {
    if (access.plan === null || access.status !== "active") return false;
    if (access.periodEnd === null) return true;
    const end = Date.parse(access.periodEnd);
    return Number.isFinite(end) && end > now.getTime();
  }
  if (access.source === "staff_exception")
    return access.plan === "scale" && access.status === "active";
  if (access.source === "transition") {
    const end = access.periodEnd ? Date.parse(access.periodEnd) : Number.NaN;
    return access.plan === null && Number.isFinite(end) && end > now.getTime();
  }
  return false;
}

export interface PlanNotice {
  tone: "warning" | "info";
  title: string;
  body: string;
  /** Where the button leads; null when the reader cannot act on it themselves. */
  action: { label: string; to: "/billing" } | null;
}

const PLAN_NAMES = { starter: "Starter", pro: "Pro", scale: "Scale" } as const;

/** A granted plan's end is announced this many days ahead. */
export const GRANT_NOTICE_DAYS = 7;

/** "Nov 3, 2026, 15:00 UTC" — the exact end, in UTC, the same for every reader. */
export function transitionEndText(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${day}, ${time} UTC`;
}

export function planNotice(
  access: WorkspaceAccess | null,
  now: Date = new Date(),
  options: {
    /** Whether new subscriptions can be started right now (Stripe checkout is available). When
     * they cannot, an owner is told so instead of being invited to start a trial. */
    checkoutAvailable?: boolean;
  } = {},
): PlanNotice | null {
  if (!access) return null;
  const checkoutAvailable = options.checkoutAvailable ?? true;
  if (access.source === "unavailable") return null; // a passing failure: the pages report it
  // The existing-customer transition: access continues until a fixed date. Not a trial.
  if (access.source === "transition" && access.periodEnd) {
    const end = transitionEndText(access.periodEnd);
    if (access.isOwner && !checkoutAvailable)
      return {
        tone: "info",
        title: `Your current access continues until ${end}`,
        body: "Tubify now has paid plans, but subscription payments aren't available yet — please check back soon or contact support. After that date a subscription is required.",
        action: null,
      };
    return access.isOwner
      ? {
          tone: "info",
          title: `Your current access continues until ${end}`,
          body: "Tubify now has paid plans. Choose a plan before then to keep using paid features — a first subscription starts with a 14-day free trial. After that date a subscription is required. Your data is kept either way.",
          action: { label: "View plans", to: "/billing" },
        }
      : {
          tone: "info",
          title: `This workspace's current access continues until ${end}`,
          body: "After that date the workspace owner will need to choose a plan in Billing. You don't need a subscription of your own, and your data is kept.",
          action: null,
        };
  }
  if (!access.plan && access.isOwner && !checkoutAvailable)
    return {
      tone: "warning",
      title: "Your workspace doesn't have an active subscription",
      body: "Subscription payments aren't available yet — please check back soon or contact support.",
      action: null,
    };
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
  // A granted plan with a week or less left: say when it ends (no notice before then, or for one
  // with no end).
  if (access.source === "grant" && access.periodEnd) {
    const end = new Date(access.periodEnd);
    const days = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
    if (days > GRANT_NOTICE_DAYS) return null;
    const date = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return access.isOwner
      ? {
          tone: "info",
          title: `Your complimentary ${PLAN_NAMES[access.plan]} plan ends ${date}`,
          body: checkoutAvailable
            ? "Choose a plan before then to keep using paid features. Your data is kept either way."
            : "After that date a subscription is required. Your data is kept either way.",
          action: checkoutAvailable ? { label: "View plans", to: "/billing" } : null,
        }
      : {
          tone: "info",
          title: `This workspace's complimentary ${PLAN_NAMES[access.plan]} plan ends ${date}`,
          body: "After that the workspace owner will need to choose a plan in Billing. Your data is kept.",
          action: null,
        };
  }
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
