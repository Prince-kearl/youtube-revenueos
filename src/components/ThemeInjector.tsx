import { useEffect } from "react";
import { useSiteContent, useSiteContentLocal } from "@/lib/stores";

// Applies the Superadmin's Visual Style choices (Customization → General) app-wide by
// overriding the CSS custom properties defined in styles.css, rather than only affecting the
// landing page — matches the "Global Primary Color" framing in the Design Studio UI.
export function ThemeInjector() {
  const [content] = useSiteContent();
  const [, setLocal] = useSiteContentLocal();

  // Pulls the latest Customization settings from the global settings API (Cloudflare KV, see
  // src/routes/api.settings.ts) once per app load, so a change a Superadmin made from a different
  // browser/device shows up here too — not just the browser that made it. Uses the raw local
  // setter (not useSiteContent's wrapped one) so this doesn't immediately PUT the same value
  // straight back to the server it was just read from. Silently keeps whatever's already in
  // localStorage (or the seed defaults) if the request fails or the KV binding isn't configured
  // in this environment (e.g. plain `vite dev` without `wrangler dev`) — this was already the
  // only source of truth before this endpoint existed, so there's nothing to break.
  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && data.content) setLocal(data.content);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--primary", content.primaryColor);
    root.setProperty("--primary-foreground", content.buttonTextColor);
    root.setProperty("--brand-blue", content.accentColor);
    // iOS 26 Design overrides the Superadmin's card/button/input roundness sliders with the
    // fixed iOS scale (large card radius, pill buttons/inputs) instead of layering on top of
    // them — every rounded-[var(--card-radius)]/[var(--button-radius)]/[var(--input-radius)]
    // in the app (the app-wide convention established for these three tokens) picks this up
    // automatically with no per-component change. Turning the toggle off restores whatever the
    // admin had configured, unchanged.
    if (content.ios26Design) {
      root.setProperty("--card-radius", "24px");
      root.setProperty("--button-radius", "999px");
      root.setProperty("--input-radius", "16px");
    } else {
      root.setProperty("--card-radius", `${content.cardRadius}px`);
      root.setProperty("--button-radius", `${content.buttonRadius}px`);
      root.setProperty("--input-radius", `${content.inputRadius}px`);
    }
  }, [content.primaryColor, content.buttonTextColor, content.accentColor, content.cardRadius, content.buttonRadius, content.inputRadius, content.ios26Design]);

  // iOS 26 Design toggle — flips a single class on <html> (same mechanism as the .dark theme
  // class) that every Liquid Glass utility in styles.css keys off of. Disabling it swaps those
  // surfaces back to their standard flat rendering purely via CSS; no layout, data, or permission
  // logic reads this flag.
  useEffect(() => {
    document.documentElement.classList.toggle("ios26", content.ios26Design);
  }, [content.ios26Design]);
  return null;
}
