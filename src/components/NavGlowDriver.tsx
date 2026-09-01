import { useEffect } from "react";

// Drives --nav-glow-angle on :root every frame so every .nav-glow-motion element's conic-gradient
// (landing nav pill, dashboard channel banner, a few buttons) rotates in sync — one rAF loop for
// the whole app rather than a CSS @property + @keyframes animation. See styles.css's comment above
// .nav-glow-motion::before for why: production CSS minifiers have silently dropped @property
// blocks, leaving the ring static (or invisible) only in deployed builds, never in dev.
const ROTATION_PERIOD_MS = 5000;

export function NavGlowDriver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame: number;
    const tick = (now: number) => {
      const angle = ((now % ROTATION_PERIOD_MS) / ROTATION_PERIOD_MS) * 360;
      document.documentElement.style.setProperty("--nav-glow-angle", `${angle}deg`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
