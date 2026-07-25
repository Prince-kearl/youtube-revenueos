import { useEffect, useState } from "react";

// iOS Safari's position:fixed doesn't reliably reposition during on-screen keyboard show/hide —
// a long-documented WebKit quirk. window.visualViewport does reliably shrink though, so this
// measures the keyboard's actual height in pixels for callers to position/hide fixed UI against,
// instead of trusting dvh/position:fixed to react correctly on their own.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    handler();
    vv.addEventListener("resize", handler);
    vv.addEventListener("scroll", handler);
    return () => {
      vv.removeEventListener("resize", handler);
      vv.removeEventListener("scroll", handler);
    };
  }, []);
  return inset;
}
