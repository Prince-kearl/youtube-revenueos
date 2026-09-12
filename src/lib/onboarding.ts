// Getting-started checklist shown on the dashboard. Completion is derived from real account state
// (see /api/onboarding/status) rather than a manually-ticked checkbox, so it always reflects what
// the account has actually done.
export const ONBOARDING_STEPS = [
  {
    id: "channel",
    label: "Connect your YouTube channel",
    desc: "Sync real analytics and revenue data.",
    to: "/settings",
    search: { tab: "YouTube Integration" },
  },
  {
    id: "video",
    label: "Add your first video",
    desc: "Paste a YouTube URL to auto-generate an AI description.",
    to: "/add-video",
    search: undefined,
  },
  {
    id: "comments",
    label: "Create a comment automation rule",
    desc: "Auto-reply to comments asking for links or info.",
    to: "/comments",
    search: undefined,
  },
  {
    id: "link",
    label: "Create a tracked link",
    desc: "Track clicks and revenue from your video descriptions.",
    to: "/link-tracking",
    search: undefined,
  },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];
export type OnboardingStatus = Record<OnboardingStepId, boolean>;

function isOnboardingDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem("yroos.onboarding");
    return raw ? Boolean((JSON.parse(raw) as { dismissed?: boolean }).dismissed) : false;
  } catch {
    return false;
  }
}

// Call this right after a page completes the real action for one of these steps (a channel gets
// connected, a video gets saved, a rule or link gets created). Sends the user straight to the next
// incomplete step — skipping any already done — or back to the dashboard once everything is,
// instead of leaving them to find the next thing themselves.
export async function goToNextOnboardingStep(
  navigate: (opts: { to: string; search?: Record<string, string> }) => void,
  completedStepId: OnboardingStepId,
): Promise<void> {
  if (isOnboardingDismissed()) return;
  try {
    const response = await fetch("/api/onboarding/status", { cache: "no-store" });
    if (!response.ok) return;
    const { data } = (await response.json()) as { data?: OnboardingStatus };
    if (!data) return;
    const next = ONBOARDING_STEPS.find((step) => step.id !== completedStepId && !data[step.id]);
    navigate(next ? { to: next.to, search: next.search } : { to: "/dashboard" });
  } catch {
    // Best-effort — never block the page's own success flow over this.
  }
}
