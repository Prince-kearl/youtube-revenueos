import { createServerFn } from "@tanstack/react-start";
import { sanitizeBrandTheme, type BrandTheme } from "./brand-theme";

// Reads the saved brand tokens on the server, for the root route's loader (see __root.tsx), so
// they can be part of the first HTML. Only the handful of theme tokens is returned — never the
// whole settings object, which can carry inline logos and would bloat every page.
//
// Same data and same freshness as GET /api/settings (public, cached ~30s): kept in memory for
// that long so rendering a page does not cost a database query each time.
//
// Never throws. If the settings cannot be read the page renders with the built-in defaults and
// ThemeInjector applies the saved theme once the app is running, exactly as before.

const TTL_MS = 30_000;
let cached: { at: number; theme: Partial<BrandTheme> } | null = null;

export const getBrandTheme = createServerFn({ method: "GET" }).handler(
  async (): Promise<Partial<BrandTheme>> => {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.theme;
    try {
      const { createServiceSupabaseClient } = await import("./server/supabase");
      const { data, error } = await createServiceSupabaseClient()
        .from("site_settings")
        .select("content")
        .eq("id", "default")
        .maybeSingle();
      if (error) return cached?.theme ?? {};
      const theme = sanitizeBrandTheme(data?.content);
      cached = { at: Date.now(), theme };
      return theme;
    } catch {
      return cached?.theme ?? {};
    }
  },
);
