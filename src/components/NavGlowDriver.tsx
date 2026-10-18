import { useEffect } from "react";

// Drives --nav-glow-angle on every .nav-glow-motion element so their conic-gradients (landing nav
// pill, dashboard channel banner, a few buttons) rotate in sync — one rAF loop for the whole app
// rather than a CSS @property + @keyframes animation. See styles.css's comment above
// .nav-glow-motion::before for why: production CSS minifiers have silently dropped @property
// blocks, leaving the ring static (or invisible) only in deployed builds, never in dev.
//
// The angle is written on the ring elements themselves, never on :root. A custom property set on
// :root is inherited by the whole document, so writing it every frame made the browser re-check
// the styles of every element on the page ~60 times a second and repaint the frosted-glass
// (backdrop-filter) layers above the ring — continuous full-page work that kept phones' main
// thread pegged and got the page killed and reloaded by iOS Safari ("A problem repeatedly
// occurred"). On touch-first (coarse-pointer) devices the ring is not animated at all: it stays
// still at its starting angle, like GlowingEffect, which is skipped on touch for the same reason.
const ROTATION_PERIOD_MS = 5000;

export function NavGlowDriver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let frame: number;
    const tick = (now: number) => {
      const angle = `${((now % ROTATION_PERIOD_MS) / ROTATION_PERIOD_MS) * 360}deg`;
      for (const element of document.querySelectorAll<HTMLElement>(".nav-glow-motion"))
        element.style.setProperty("--nav-glow-angle", angle);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
