import { useEffect } from "react";
import { useLocalStore } from "./local-store";

export type ThemeMode = "light" | "dark" | "system";

export const useThemeMode = () => useLocalStore<ThemeMode>("yroos.theme", "system");

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
