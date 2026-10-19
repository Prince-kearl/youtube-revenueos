import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock, Plus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The phone navigation used by the workspace app and the admin console: a glass pill with the
// primary destinations as icons, and a round button beside it ("+", turning into "×") that opens
// every destination as a panel of tiles in the pill's place.
//
// Sizes step down below 360px so the pill and button always fit; the tile grid takes as many
// columns as fit (two to four) and labels wrap to two lines rather than being cut off. Radii are
// explicit pixels: the site's generic --radius is 0, so the rounded-* scale would leave these
// shapes nearly square. The pill is given an explicit height (border included) so it always
// matches the round button.

export interface DockItem {
  key: string;
  label: string;
  /** A shorter label for the panel tile, where space is tight; the full label stays its name. */
  shortLabel?: string;
  Icon: LucideIcon;
  active: boolean;
  locked?: boolean;
  /** A page to go to; otherwise onSelect is called. */
  to?: string;
  onSelect?: () => void;
}

export interface DockSection {
  label: string;
  items: DockItem[];
}

const HIDE_AT = { md: "md:hidden", lg: "lg:hidden" } as const;

export function MobileDock({
  label,
  panelLabel,
  moreLabel,
  primary,
  sections,
  hideAt,
  hidden = false,
  resetKey,
}: {
  /** Accessible name of the nav landmark. */
  label: string;
  /** Accessible name of the open panel. */
  panelLabel: string;
  /** Accessible name of the round button while the panel is closed. */
  moreLabel: string;
  primary: DockItem[];
  sections: DockSection[];
  /** The breakpoint from which the desktop navigation takes over. */
  hideAt: keyof typeof HIDE_AT;
  /** Hide the dock (e.g. while the on-screen keyboard is up). */
  hidden?: boolean;
  /** The panel closes whenever this changes (the current page or section). */
  resetKey: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Focus moves into the panel when it opens and back to its button when it closes; Escape
  // closes it; it never stays open across a page or section change.
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("keydown", onKey);
      wasOpen.current = true;
      return () => document.removeEventListener("keydown", onKey);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);
  useEffect(() => setOpen(false), [resetKey]);

  const visibleSections = sections.filter((section) => section.items.length > 0);
  // The current destination lives in the panel, not the pill: the button shows it.
  const currentInPanelOnly =
    !primary.some((item) => item.active) &&
    visibleSections.some((section) => section.items.some((item) => item.active));

  // In the pill a destination is an icon alone, so it carries its name as a label and tooltip;
  // in the panel the visible label names it. Choosing one in the panel closes the panel.
  const destination = (
    item: DockItem,
    className: string,
    children: ReactNode,
    inPanel: boolean,
  ) => {
    const close = inPanel;
    const common = {
      "aria-current": item.active ? ("page" as const) : undefined,
      "aria-label": inPanel && !item.shortLabel ? undefined : item.label,
      title: inPanel ? undefined : item.label,
      className,
    };
    return item.to ? (
      <Link key={item.key} to={item.to} onClick={() => close && setOpen(false)} {...common}>
        {children}
      </Link>
    ) : (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          item.onSelect?.();
          if (close) setOpen(false);
        }}
        {...common}
      >
        {children}
      </button>
    );
  };

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className={cn(
            "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 print:hidden",
            HIDE_AT[hideAt],
          )}
        />
      )}
      <nav
        aria-label={label}
        className={cn(
          "fixed inset-x-2 bottom-3 z-50 flex items-end justify-center gap-2 print:hidden min-[360px]:inset-x-3 min-[360px]:bottom-4 min-[360px]:gap-3",
          HIDE_AT[hideAt],
          hidden && "hidden",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {open ? (
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={panelLabel}
            className="glass-pill min-w-0 max-w-[22rem] flex-1 overflow-y-auto p-2 backdrop-blur-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 min-[360px]:p-3"
            style={{ borderRadius: 28, maxHeight: "calc(100dvh - 7rem)" }}
          >
            {visibleSections.map((section, index) => (
              <div
                key={section.label}
                role="group"
                aria-label={section.label}
                className={cn(
                  "grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-x-1.5 gap-y-3 min-[360px]:grid-cols-4 min-[360px]:gap-x-2",
                  index > 0 && "mt-3 border-t border-border/60 pt-3",
                )}
              >
                {section.items.map((item) =>
                  destination(
                    item,
                    "group relative flex min-w-0 flex-col items-center gap-1.5 text-center outline-none",
                    <>
                      <span
                        className={cn(
                          "flex aspect-square w-full max-w-14 items-center justify-center transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                          item.active
                            ? "bg-foreground/15 text-foreground"
                            : item.locked
                              ? "bg-foreground/[0.06] text-muted-foreground/40"
                              : "bg-foreground/[0.06] text-foreground/85 group-hover:bg-foreground/10",
                        )}
                        style={{ borderRadius: 18 }}
                      >
                        <item.Icon
                          className="h-5 w-5 min-[360px]:h-6 min-[360px]:w-6"
                          strokeWidth={1.75}
                        />
                      </span>
                      {item.locked && (
                        <Lock className="absolute right-1 top-1 h-3 w-3 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "line-clamp-2 w-full text-[11px] leading-tight [overflow-wrap:anywhere]",
                          item.active ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {item.shortLabel ?? item.label}
                      </span>
                    </>,
                    true,
                  ),
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-pill flex h-12 min-w-0 items-center gap-1 p-1 backdrop-blur-2xl min-[360px]:h-14 min-[360px]:p-1.5">
            {primary.map((item) =>
              destination(
                item,
                cn(
                  "flex h-full w-14 min-w-0 shrink items-center justify-center rounded-full transition-colors",
                  item.active
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                ),
                <>
                  <item.Icon
                    className="h-5 w-5 shrink-0 min-[360px]:h-[22px] min-[360px]:w-[22px]"
                    strokeWidth={1.75}
                  />
                </>,
                false,
              ),
            )}
          </div>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Close menu" : moreLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          title={open ? "Close" : "More"}
          className={cn(
            "glass-pill flex h-12 w-12 shrink-0 items-center justify-center backdrop-blur-2xl transition-colors min-[360px]:h-14 min-[360px]:w-14",
            !open && currentInPanelOnly
              ? "text-foreground ring-2 ring-foreground/20"
              : "text-foreground/85 hover:text-foreground",
          )}
        >
          <Plus
            className={cn("h-6 w-6 transition-transform duration-200", open && "rotate-45")}
            strokeWidth={1.75}
          />
        </button>
      </nav>
    </>
  );
}
