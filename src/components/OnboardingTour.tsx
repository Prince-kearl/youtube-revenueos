import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { useOnboarding } from "@/lib/stores";
import { ONBOARDING_STEPS, type OnboardingStatus } from "@/lib/onboarding";

const SPOTLIGHT_PADDING = 8;
const TOOLTIP_WIDTH = 320;
const MANUAL_INDEX_KEY = "yroos.onboarding.manualIndex";

// Explicit Back/Next navigation overrides the default "first incomplete step" pick, so the user
// can browse the whole tour — including steps already done — not just the next thing to do.
// Backed by sessionStorage (not component state) because DashboardLayout, and this component with
// it, remounts on every route change, which would otherwise forget the override the instant
// Back/Next navigated anywhere.
function getManualIndex(): number | null {
  try {
    const raw = window.sessionStorage.getItem(MANUAL_INDEX_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
function setManualIndex(index: number): number {
  try {
    window.sessionStorage.setItem(MANUAL_INDEX_KEY, String(index));
  } catch {
    // ignore — worst case Back/Next forgets its place across a navigation
  }
  return index;
}

// Replaces the old fixed dashboard banner with a contextual spotlight tour: a small floating nudge
// points the user to whichever page has the next real, incomplete step, and once they're actually
// on that page, a dimmed overlay highlights the real control to use (see the matching
// data-onboarding-step attribute on that element) instead of just linking to it from afar.
export function OnboardingTour() {
  const [onboarding, setOnboarding] = useOnboarding();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [manualIndex, setManualIndexState] = useState<number | null>(() => getManualIndex());
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (onboarding.dismissed) return;
    const controller = new AbortController();
    fetch("/api/onboarding/status", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { data?: OnboardingStatus };
        if (body.data) setStatus(body.data);
      })
      .catch(() => {});
    return () => controller.abort();
    // Re-checked on every navigation so completing a step elsewhere (or the auto-advance
    // redirect) is picked up without needing a full page reload.
  }, [onboarding.dismissed, pathname]);

  const allDone = status ? ONBOARDING_STEPS.every((step) => status[step.id]) : false;
  const autoIndex = status ? ONBOARDING_STEPS.findIndex((step) => !status[step.id]) : -1;
  const activeIndex = manualIndex ?? autoIndex;
  const currentStep = allDone || activeIndex < 0 ? undefined : ONBOARDING_STEPS[activeIndex];
  const onTargetPage = currentStep?.to === pathname;

  useLayoutEffect(() => {
    if (!onTargetPage || !currentStep) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(`[data-onboarding-step="${currentStep.id}"]`);
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
  }, [onTargetPage, currentStep]);

  if (onboarding.dismissed || !currentStep) return null;

  const dismiss = () => setOnboarding((prev) => ({ ...prev, dismissed: true }));

  const goToIndex = (index: number) => {
    const target = ONBOARDING_STEPS[index];
    setManualIndexState(setManualIndex(index));
    if (target.to !== pathname) navigate({ to: target.to, search: target.search });
  };
  const canGoBack = activeIndex > 0;
  const canGoNext = activeIndex < ONBOARDING_STEPS.length - 1;

  if (!onTargetPage) {
    return (
      <Link
        to={currentStep.to}
        search={currentStep.search}
        className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-xl sm:bottom-6"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {activeIndex + 1}
        </span>
        {currentStep.label}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }}
          className="ml-1 rounded-full p-0.5 text-background/60 hover:text-background"
          aria-label="Dismiss getting started guide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </Link>
    );
  }

  // On the right page, but the real target element isn't there (the step is already done, e.g.
  // reviewing "Connect your channel" after it's connected — that UI is gone). Still let the user
  // browse via Back/Next, just without a spotlight to anchor to.
  if (!rect) {
    return (
      <div className="fixed bottom-20 left-4 z-40 w-80 rounded-2xl border border-border bg-background p-5 shadow-2xl sm:bottom-6">
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss getting started guide"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="pr-6 text-base font-bold">{currentStep.label}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{currentStep.desc}</p>
        <TourFooter
          activeIndex={activeIndex}
          canGoBack={canGoBack}
          canGoNext={canGoNext}
          onBack={() => goToIndex(activeIndex - 1)}
          onNext={() => goToIndex(activeIndex + 1)}
        />
      </div>
    );
  }

  const top = rect.top - SPOTLIGHT_PADDING;
  const left = rect.left - SPOTLIGHT_PADDING;
  const width = rect.width + SPOTLIGHT_PADDING * 2;
  const height = rect.height + SPOTLIGHT_PADDING * 2;
  const tooltipBelow = top + height + 220 < window.innerHeight;
  const tooltipLeft = Math.min(Math.max(left, 16), window.innerWidth - TOOLTIP_WIDTH - 16);

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        className="absolute rounded-xl ring-2 ring-primary transition-all duration-300"
        style={{ top, left, width, height, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)" }}
      />
      <div
        className="pointer-events-auto absolute rounded-2xl border border-border bg-background p-5 shadow-2xl"
        style={{
          width: TOOLTIP_WIDTH,
          left: tooltipLeft,
          ...(tooltipBelow
            ? { top: top + height + 16 }
            : { bottom: window.innerHeight - top + 16 }),
        }}
      >
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss getting started guide"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="pr-6 text-base font-bold">{currentStep.label}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{currentStep.desc}</p>
        <TourFooter
          activeIndex={activeIndex}
          canGoBack={canGoBack}
          canGoNext={canGoNext}
          onBack={() => goToIndex(activeIndex - 1)}
          onNext={() => goToIndex(activeIndex + 1)}
        />
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
}: {
  activeIndex: number;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {ONBOARDING_STEPS.map((step, i) => (
          <span
            key={step.id}
            className={`h-1.5 w-1.5 rounded-full ${i === activeIndex ? "bg-primary" : "bg-muted-foreground/25"}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
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
