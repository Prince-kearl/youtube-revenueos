import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { useOnboarding } from "@/lib/stores";
import {
  IDLE_ONBOARDING_SESSION,
  ONBOARDING_STEPS,
  endOnboardingSession,
  getOnboardingSession,
  leftOnboardingFlow,
  migrateLegacyOnboarding,
  normalizeOnboardingState,
  onboardingStorageKey,
  resolveOnboardingView,
  setOnboardingSession,
  setOnboardingUser,
  subscribeOnboardingSession,
  type OnboardingState,
  type OnboardingStatus,
  type OnboardingStep,
} from "@/lib/onboarding";

const SPOTLIGHT_PADDING = 8;
const TOOLTIP_WIDTH = 320;

// The getting-started guide. Where it may appear is decided by resolveOnboardingView (see
// lib/onboarding.ts): a "Setup" pill on the Dashboard, a compact hint on the page a step belongs
// to, and — only while the user is actively following the guide — a spotlight on the real
// control (see the matching data-onboarding-step attribute on that element). Nothing is shown on
// any other page, and nothing is ever asked for that the user's role or plan cannot do.
export function OnboardingTour({
  userId,
  canUseRoute,
  accessReady,
}: {
  /** The signed-in user; the guide's state is remembered per user. */
  userId: string | null;
  /** Whether this user may open a page (role, plan and feature switches — same rule as the nav). */
  canUseRoute: (to: string) => boolean;
  /** False until the real access rules have loaded, so a step is never offered and then withdrawn. */
  accessReady: boolean;
}) {
  // Saved decisions (closed, skipped steps) are per user. Rendering only READS them; anything
  // that writes happens in the effect below or in response to a click.
  const [saved, setSaved] = useOnboarding(onboardingStorageKey(userId));
  const onboarding = normalizeOnboardingState(saved);
  const setOnboarding = (update: (previous: OnboardingState) => OnboardingState) =>
    setSaved((previous) => update(normalizeOnboardingState(previous)));
  // Whether the user is following the guide right now lives in memory only (never saved), so a
  // reload or a later visit never starts with a spotlight nobody asked for.
  const session = useSyncExternalStore(
    subscribeOnboardingSession,
    getOnboardingSession,
    () => IDLE_ONBOARDING_SESSION,
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The user whose completion state `status` describes: after an account change the previous
  // user's answer is never applied to the new one.
  const [statusFor, setStatusFor] = useState<string | null>(null);

  // When the signed-in user is known or changes: point the guide's helpers at that user (which
  // also ends any guide the previous user was following) and, once, carry over a dismissal
  // saved under the old shared key. Nothing can be shown before this runs — the guide stays
  // hidden until the completion state below has loaded.
  useEffect(() => {
    setOnboardingUser(userId);
    if (!userId) return;
    const migrated = migrateLegacyOnboarding(window.localStorage, userId);
    if (migrated) setSaved(migrated);
    // setSaved is re-created each render; only a change of user should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (onboarding.dismissed || !userId) return;
    const controller = new AbortController();
    fetch("/api/onboarding/status", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { data?: OnboardingStatus };
        if (body.data) {
          setStatus(body.data);
          setStatusFor(userId);
        }
      })
      .catch(() => {});
    return () => controller.abort();
    // Re-checked on every navigation so completing a step elsewhere (or the auto-advance
    // redirect) is picked up without needing a full page reload.
  }, [onboarding.dismissed, pathname, userId]);

  // Walking away from the guide ends it: once the user is on a page that belongs to no step,
  // "following the guide" and any Back/Next position are forgotten, so no spotlight is waiting
  // for them the next time they happen to open a step's page.
  const following = session.guided || session.reviewIndex !== null;
  useEffect(() => {
    if (following && leftOnboardingFlow(pathname)) endOnboardingSession();
  }, [pathname, following]);

  const view = resolveOnboardingView({
    status: accessReady && userId && statusFor === userId ? status : null,
    state: onboarding,
    session,
    pathname,
    canUseStep: (step: OnboardingStep) => canUseRoute(step.to),
  });
  const spotlightStepId = view.kind === "spotlight" ? view.step.id : null;

  useLayoutEffect(() => {
    if (!spotlightStepId) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(`[data-onboarding-step="${spotlightStepId}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [spotlightStepId]);

  // Escape closes the spotlight without closing the guide for good.
  useEffect(() => {
    if (!spotlightStepId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") endOnboardingSession();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spotlightStepId]);

  if (view.kind === "hidden") return null;
  const { step, index } = view;

  // Closes the guide for good (until it is reopened from Settings or the Tubi assistant).
  const dismiss = () => {
    endOnboardingSession();
    setOnboarding((previous) => ({ ...previous, dismissed: true }));
  };
  // Sets one step aside; the guide moves on to the next one that is still open.
  const skip = () => {
    setOnboardingSession({ guided: session.guided, reviewIndex: null });
    setOnboarding((previous) => ({
      ...previous,
      skipped: previous.skipped.includes(step.id)
        ? previous.skipped
        : [...previous.skipped, step.id],
    }));
  };
  // An explicit request for the guide in this visit: this is what turns the spotlight on.
  const follow = () => setOnboardingSession({ guided: true, reviewIndex: session.reviewIndex });

  const goToIndex = (target: number) => {
    const next = ONBOARDING_STEPS[target];
    setOnboardingSession({ guided: true, reviewIndex: target });
    if (next.to !== pathname) navigate({ to: next.to, search: next.search });
  };
  const canGoBack = index > 0 && canUseRoute(ONBOARDING_STEPS[index - 1].to);
  const canGoNext =
    index < ONBOARDING_STEPS.length - 1 && canUseRoute(ONBOARDING_STEPS[index + 1].to);
  const footer = (
    <TourFooter
      activeIndex={index}
      canGoBack={canGoBack}
      canGoNext={canGoNext}
      onBack={() => goToIndex(index - 1)}
      onNext={() => goToIndex(index + 1)}
      onSkip={status && !status[step.id] ? skip : undefined}
    />
  );
  const closeButton = (
    <button
      onClick={dismiss}
      className="absolute right-3 top-3 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label="Close the getting started guide"
    >
      <X className="h-4 w-4" />
    </button>
  );

  if (view.kind === "nudge") {
    return (
      <Link
        to={step.to}
        search={step.search}
        onClick={follow}
        // Bottom-right: clear of the sidebar on desktop (sits beside the help button) and above
        // the bottom navigation on phones, where it collapses to a short label so it doesn't
        // cover a full row of page content.
        aria-label={`Getting started, ${view.done} of ${view.total} done. Next: ${step.label}`}
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-foreground px-3 py-2 text-sm font-medium text-background shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:bottom-7 md:right-24 md:px-4 md:py-2.5 print:hidden"
      >
        <span className="flex h-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
          {view.done}/{view.total}
        </span>
        <span className="md:hidden">Setup</span>
        <span className="hidden md:inline">Next: {step.label}</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }}
          className="ml-1 rounded-full p-0.5 text-background/60 hover:text-background"
          aria-label="Close the getting started guide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </Link>
    );
  }

  // On the step's own page without having asked for the guide: a compact card in the corner.
  // Nothing is dimmed and nothing is blocked; "Show me" turns on the spotlight.
  if (view.kind === "hint") {
    return (
      <aside
        aria-label="Getting started"
        className="fixed bottom-20 right-4 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background p-4 shadow-xl md:bottom-6 md:right-24 print:hidden"
      >
        {closeButton}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Getting started
        </p>
        <h3 className="mt-0.5 pr-6 text-sm font-bold">{step.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{step.desc}</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={follow}
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Show me
          </button>
          <button
            onClick={skip}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Skip this step
          </button>
        </div>
      </aside>
    );
  }

  // Following the guide, on the right page, but the real target element isn't there (the step is
  // already done, e.g. reviewing "Connect your channel" after it's connected — that UI is gone).
  // Still let the user browse via Back/Next, just without a spotlight to anchor to.
  if (!rect) {
    return (
      <aside
        aria-label="Getting started"
        className="fixed bottom-20 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background p-5 shadow-2xl md:bottom-6 md:right-24 print:hidden"
      >
        {closeButton}
        <h3 className="pr-6 text-base font-bold">{step.label}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{step.desc}</p>
        {footer}
      </aside>
    );
  }

  const top = rect.top - SPOTLIGHT_PADDING;
  const left = rect.left - SPOTLIGHT_PADDING;
  const width = rect.width + SPOTLIGHT_PADDING * 2;
  const height = rect.height + SPOTLIGHT_PADDING * 2;
  const tooltipBelow = top + height + 220 < window.innerHeight;
  const tooltipWidth = Math.min(TOOLTIP_WIDTH, window.innerWidth - 32);
  const tooltipLeft = Math.min(Math.max(left, 16), window.innerWidth - tooltipWidth - 16);

  // pointer-events-none: the page underneath stays fully usable, including its navigation.
  return (
    <div className="pointer-events-none fixed inset-0 z-50 print:hidden">
      <div
        className="absolute rounded-xl ring-2 ring-primary transition-all duration-300"
        style={{ top, left, width, height, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)" }}
      />
      <div
        role="dialog"
        aria-label={`Getting started: ${step.label}`}
        className="pointer-events-auto absolute rounded-2xl border border-border bg-background p-5 shadow-2xl"
        style={{
          width: tooltipWidth,
          left: tooltipLeft,
          ...(tooltipBelow
            ? { top: top + height + 16 }
            : { bottom: window.innerHeight - top + 16 }),
        }}
      >
        {closeButton}
        <h3 className="pr-6 text-base font-bold">{step.label}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{step.desc}</p>
        {footer}
      </div>
    </div>
  );
}

function TourFooter({
  activeIndex,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  onSkip,
}: {
  activeIndex: number;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
  /** Present only for a step that is not done yet. */
  onSkip?: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {ONBOARDING_STEPS.map((step, i) => (
          <span
            key={step.id}
            className={`h-1.5 w-1.5 rounded-full ${i === activeIndex ? "bg-primary" : "bg-muted-foreground/25"}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <button
            onClick={onSkip}
            className="rounded-full px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
        )}
        {canGoBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
        )}
        {canGoNext && (
          <button
            onClick={onNext}
            className="flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
