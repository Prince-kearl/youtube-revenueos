import { useEffect } from "react";
import { useLocalStore } from "./local-store";

export type ThemeMode = "light" | "dark" | "system";

export const useThemeMode = () => useLocalStore<ThemeMode>("yroos.theme", "system");

// Personal, per-device preference (Settings → Preferences) — was previously a single
// Superadmin-controlled switch for every user (Customization → General); moved here so each
// person can opt into the Liquid Glass / iOS 26-inspired look for their own view instead. Defaults
// to on, matching the old site-wide default. See ThemeInjector for what it actually changes
// (an .ios26 class plus card/button/input radius CSS vars).
export const useIos26Design = () => useLocalStore<boolean>("yroos.ios26Design", true);

// Sub-preference of the above — lets someone keep the glass surfaces/rounded corners without the
// ios26_light/ios26_dark photo backdrop (see the .ios26-wallpaper class in styles.css). Only
// meaningful while useIos26Design is on; the Settings UI hides/disables it otherwise rather than
// this hook enforcing that itself.
export const useIos26Wallpaper = () => useLocalStore<boolean>("yroos.ios26Wallpaper", true);

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Applies the persisted theme mode to <html class="dark">, resolving "system" via the OS media
// query and staying in sync if it changes while "system" is selected. The actual first-paint
// application (avoiding a light-mode flash before hydration) happens via an inline script in
// __root.tsx's RootShell — this hook keeps it in sync afterward and reacts to user changes.
export function useApplyTheme() {
  const [mode] = useThemeMode();
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.classList.toggle("dark", mode === "dark" || (mode === "system" && prefersDark()));
    };
    apply();
    if (mode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [mode]);
}
