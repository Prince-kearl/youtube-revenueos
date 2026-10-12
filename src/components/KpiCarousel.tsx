import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// A row of KPI cards that is a carousel on phones and an ordinary grid from `sm` up — the same
// behaviour the Dashboard's KPI row has, as one reusable wrapper for every other page.
//
// On a phone exactly one card is in view. The row advances by itself every few seconds, loops
// without a visible jump back, and stops for good as soon as the visitor touches it. Dots under
// the row show the position and jump to a card.
//
// From `sm` up nothing here applies: each card's wrapper is `display: contents`, so the cards
// are the grid's own items and the page's grid classes lay them out exactly as before.

const AUTOPLAY_MS = 3000;
/** How long the smooth scroll onto the trailing clone takes before the silent jump back. */
const LOOP_RESET_MS = 500;
const DESKTOP_QUERY = "(min-width: 640px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The cards themselves: fragments and conditionals are flattened, empty children dropped. */
function slidesOf(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? slidesOf(child.props.children)
      : [child],
  );
}

function nearestIndex(el: HTMLElement): number {
  let nearest = 0;
  let smallest = Infinity;
  Array.from(el.children).forEach((child, index) => {
    const diff = Math.abs((child as HTMLElement).offsetLeft - el.scrollLeft);
    if (diff < smallest) {
      smallest = diff;
      nearest = index;
    }
  });
  return nearest;
}

export function KpiCarousel({
  children,
  className,
  gridClassName,
  loading = false,
  label = "KPI card pagination",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  /** Classes for the whole block (its margin). */
  className?: string;
  /** The row's gap and its grid columns from `sm` up, e.g. "gap-3 sm:grid-cols-2 lg:grid-cols-4". */
  gridClassName: string;
  /** Placeholders are showing: no autoplay, no loop clone and no dots. */
  loading?: boolean;
  /** Accessible name of the dots. */
  label?: string;
  "aria-label"?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const slides = slidesOf(children);
  const count = slides.length;
  // One card needs no carousel; placeholders are not worth sliding through.
  const sliding = !loading && count > 1;

  // Autoplay. The real cards are followed by a clone of the first one: scrolling onto the clone
  // and then jumping (without animation) to the real first card reads as continuous forward
  // motion instead of a rewind.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sliding) return;
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    const desktop = window.matchMedia(DESKTOP_QUERY);
    let paused = false;
    let reset: number | undefined;
    const pause = () => {
      paused = true;
    };
    el.addEventListener("pointerdown", pause);
    el.addEventListener("touchstart", pause, { passive: true });
    const interval = window.setInterval(() => {
      if (paused || desktop.matches || document.hidden) return;
      const items = Array.from(el.children) as HTMLElement[];
      const next = nearestIndex(el) + 1;
      if (next >= items.length) return;
      el.scrollTo({ left: items[next].offsetLeft, behavior: "smooth" });
      if (next === items.length - 1)
        reset = window.setTimeout(() => {
          if (!paused) el.scrollTo({ left: items[0].offsetLeft, behavior: "auto" });
        }, LOOP_RESET_MS);
    }, AUTOPLAY_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(reset);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("touchstart", pause);
    };
  }, [sliding, count]);

  // Which dot is lit. The clone stands in for the first card, so it maps back to index 0.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sliding) return;
    const update = () => setActive(nearestIndex(el) % count);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [sliding, count]);

  return (
    <div className={className}>
      <div
        ref={scrollRef}
        className={cn(
          "flex snap-x snap-mandatory overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:snap-none sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden",
          gridClassName,
        )}
        aria-busy={loading}
        aria-label={ariaLabel}
      >
        {slides.map((slide, index) => (
          <div key={index} className="w-full shrink-0 snap-start sm:contents">
            {slide}
          </div>
        ))}
        {sliding && (
          // Never reachable or announced: it only exists so the loop can scroll past the end.
          <div aria-hidden="true" inert className="w-full shrink-0 snap-start sm:hidden">
            {slides[0]}
          </div>
        )}
      </div>
      {sliding && (
        <div
          className="mt-3 flex items-center justify-center gap-1.5 sm:hidden"
          role="tablist"
          aria-label={label}
        >
          {slides.map((_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-label={`Go to KPI card ${index + 1}`}
              onClick={() => {
                const el = scrollRef.current;
                const target = el?.children[index] as HTMLElement | undefined;
                if (target) el?.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
              }}
              className={`h-1.5 rounded-full transition-all ${active === index ? "w-6 bg-foreground" : "w-1.5 bg-foreground/25"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
