import { readStore, writeStore } from "./local-store";

// Getting-started guide. Completion is derived from real account state (see
// /api/onboarding/status) rather than a manually-ticked checkbox, so it always reflects what the
// account has actually done.
//
// Where the guide may appear is decided in one place, resolveOnboardingView below:
//
//   Dashboard            a small "Setup" pill naming the next step
//   the step's own page  a compact hint card — or, only while the user is actively following
//                        the guide, the spotlight on the real control
//   every other page     nothing
//
// It never follows the user around the app, and it never asks for a step they cannot do.
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

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStepId = OnboardingStep["id"];
export type OnboardingStatus = Record<OnboardingStepId, boolean>;

/** The page the Setup pill lives on. */
export const ONBOARDING_HOME = "/dashboard";

// ============================================================================================
// What the browser remembers (persisted): only decisions the user made about the guide
// ============================================================================================

export interface OnboardingState {
  /** The user closed the guide. It stays closed until they reopen it from Settings or Tubi. */
  dismissed: boolean;
  /** Steps the user chose to skip. A skipped step is never asked for again. */
  skipped: OnboardingStepId[];
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = { dismissed: false, skipped: [] };

/** Saved state may come from an older version: unknown fields are ignored (in particular the
 * "following the guide" flags older versions persisted — those are session-only now). */
export function normalizeOnboardingState(
  value: Partial<OnboardingState> | null | undefined,
): OnboardingState {
  return {
    dismissed: Boolean(value?.dismissed),
    skipped: Array.isArray(value?.skipped) ? value.skipped : [],
  };
}

// The guide's saved state is kept per signed-in user and deliberately OUTSIDE the "yroos." prefix
// that signing out clears: closing the guide used to be forgotten at every sign-out, so it came
// back on every sign-in.
export const LEGACY_ONBOARDING_KEY = "yroos.onboarding";
export function onboardingStorageKey(userId: string | null | undefined): string {
  return `tubify.onboarding.${userId ?? "anonymous"}`;
}

/** The slice of the Web Storage API the migration needs (so it can be tested without a browser). */
export interface OnboardingStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/**
 * One-time move of a dismissal saved under the old shared key to the signed-in user's own key.
 *
 * The old key is removed as soon as it has been looked at, whatever it contained, so it can be
 * claimed once and by one user only: a second account using the same browser finds nothing to
 * inherit. Safe to call any number of times. Returns the state to save for this user, or null
 * when there is nothing to migrate (no legacy state, or the user already has their own).
 */
export function migrateLegacyOnboarding(
  storage: OnboardingStorage,
  userId: string | null | undefined,
): OnboardingState | null {
  if (!userId) return null;
  try {
    const legacy = storage.getItem(LEGACY_ONBOARDING_KEY);
    if (legacy === null) return null;
    storage.removeItem(LEGACY_ONBOARDING_KEY);
    if (storage.getItem(onboardingStorageKey(userId)) !== null) return null;
    const dismissed = Boolean((JSON.parse(legacy) as { dismissed?: boolean }).dismissed);
    return dismissed ? { ...EMPTY_ONBOARDING_STATE, dismissed: true } : null;
  } catch {
    // Unreadable saved state is the same as none.
    return null;
  }
}

// ============================================================================================
// The current visit (never persisted): whether the user is following the guide right now
// ============================================================================================
//
// Kept in memory only. It survives moving between pages (the app does not reload), which is what
// lets Back/Next and the "next step" hand-off work — and it is gone after a reload, a new tab or
// a sign-in, so a spotlight never appears unless the user asked for the guide in this visit.

export interface OnboardingSession {
  /** The user opened the guide or pressed one of its buttons. Only then does a step's page get
   * the spotlight, and only then does finishing one step move them on to the next. */
  guided: boolean;
  /** Back/Next browsing: the step being looked at, done or not. null = the next step to do. */
  reviewIndex: number | null;
}

export const IDLE_ONBOARDING_SESSION: OnboardingSession = { guided: false, reviewIndex: null };

let session: OnboardingSession = IDLE_ONBOARDING_SESSION;
const sessionListeners = new Set<() => void>();

export function getOnboardingSession(): OnboardingSession {
  return session;
}

export function setOnboardingSession(next: OnboardingSession): void {
  if (next.guided === session.guided && next.reviewIndex === session.reviewIndex) return;
  session = next;
  sessionListeners.forEach((listener) => listener());
}

/** Stop following the guide (it stays available; nothing saved is changed). */
export function endOnboardingSession(): void {
  setOnboardingSession(IDLE_ONBOARDING_SESSION);
}

export function subscribeOnboardingSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

// The signed-in user the non-React helpers below act for. Set by the guide from an effect.
let activeKey = onboardingStorageKey(null);

/** Called (from an effect) when the signed-in user is known or changes. A different user never
 * continues someone else's guide: following ends, and the saved state read from here on is
 * that user's own. */
export function setOnboardingUser(userId: string | null | undefined): void {
  const key = onboardingStorageKey(userId);
  if (key === activeKey) return;
  activeKey = key;
  endOnboardingSession();
}

function readState(): OnboardingState {
  return normalizeOnboardingState(readStore<Partial<OnboardingState>>(activeKey, {}));
}

// ============================================================================================
// Where the guide appears
// ============================================================================================

export type OnboardingView =
  | { kind: "hidden" }
  /** Dashboard: a pill naming the next step. */
  | { kind: "nudge"; step: OnboardingStep; index: number; done: number; total: number }
  /** On the step's own page, not following the guide: a compact card, nothing dimmed. */
  | { kind: "hint"; step: OnboardingStep; index: number }
  /** On the step's own page while following the guide: the spotlight on the real control. */
  | { kind: "spotlight"; step: OnboardingStep; index: number };

export interface OnboardingViewInput {
  /** Real completion state, or null while it is unknown (loading or failed). */
  status: OnboardingStatus | null;
  /** What the user decided about the guide (saved). */
  state: OnboardingState;
  /** Whether they are following it in this visit (not saved). */
  session: OnboardingSession;
  pathname: string;
  /** Whether the signed-in user can open the step's page at all (role, plan, feature switch). */
  canUseStep: (step: OnboardingStep) => boolean;
}

/** Steps the user can actually do, in order. */
export function availableOnboardingSteps(canUseStep: (step: OnboardingStep) => boolean) {
  return ONBOARDING_STEPS.filter(canUseStep);
}

/** The next step to ask for: the first one the user can do that is neither done nor skipped. */
export function nextOnboardingStep(
  status: OnboardingStatus,
  state: Pick<OnboardingState, "skipped">,
  canUseStep: (step: OnboardingStep) => boolean,
): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find(
    (step) => canUseStep(step) && !status[step.id] && !state.skipped.includes(step.id),
  );
}

export function resolveOnboardingView(input: OnboardingViewInput): OnboardingView {
  const { status, state, session: visit, pathname, canUseStep } = input;
  if (!status || state.dismissed) return { kind: "hidden" };

  const reviewing = visit.reviewIndex !== null;
  const step = reviewing
    ? ONBOARDING_STEPS[visit.reviewIndex as number]
    : nextOnboardingStep(status, state, canUseStep);
  if (!step || !canUseStep(step)) return { kind: "hidden" };
  const index = ONBOARDING_STEPS.findIndex((candidate) => candidate.id === step.id);

  if (pathname === step.to)
    return { kind: visit.guided || reviewing ? "spotlight" : "hint", step, index };
  if (pathname === ONBOARDING_HOME) {
    const available = availableOnboardingSteps(canUseStep);
    return {
      kind: "nudge",
      step,
      index,
      done: available.filter((candidate) => status[candidate.id]).length,
      total: available.length,
    };
  }
  return { kind: "hidden" };
}

/** True when the user has walked away from the guide: they are on a page that is neither the
 * dashboard nor any step's page. Following the guide ends there, so nothing lingers. */
export function leftOnboardingFlow(pathname: string): boolean {
  return pathname !== ONBOARDING_HOME && !ONBOARDING_STEPS.some((step) => step.to === pathname);
}

// ============================================================================================
// Actions
// ============================================================================================

type Navigate = (opts: { to: string; search?: Record<string, string> }) => void;

// Call this right after a page completes the real action for one of these steps (a channel gets
// connected, a video gets saved, a rule or link gets created). While the user is following the
// guide it takes them to the next step that is still open — skipping any already done or skipped
// — or back to the dashboard once nothing is left. Outside the guide it does nothing: someone
// who just created a tracked link in the ordinary course of work is not sent anywhere.
export async function goToNextOnboardingStep(
  navigate: Navigate,
  completedStepId: OnboardingStepId,
): Promise<void> {
  if (!session.guided) return;
  const state = readState();
  if (state.dismissed) return;
  try {
    const response = await fetch("/api/onboarding/status", { cache: "no-store" });
    if (!response.ok) return;
    const { data } = (await response.json()) as { data?: OnboardingStatus };
    if (!data) return;
    const next = ONBOARDING_STEPS.find(
      (step) => step.id !== completedStepId && !data[step.id] && !state.skipped.includes(step.id),
    );
    setOnboardingSession({ guided: true, reviewIndex: null });
    navigate(next ? { to: next.to, search: next.search } : { to: ONBOARDING_HOME });
  } catch {
    // Best-effort — never block the page's own success flow over this.
  }
}

// Manually reopens the guide from wherever the user asked for it (the Tubi assistant, Settings) —
// un-dismisses it, forgets skipped steps and restarts review from the first step, regardless of
// what's already done, since the point of asking for it again is to see the whole thing.
export function openOnboardingGuide(navigate: Navigate): void {
  writeStore(activeKey, { ...EMPTY_ONBOARDING_STATE });
  setOnboardingSession({ guided: true, reviewIndex: 0 });
  const first = ONBOARDING_STEPS[0];
  navigate({ to: first.to, search: first.search });
}
