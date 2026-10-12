// The brand tokens a Superadmin sets in Customization → General (colours and corner radii), as
// they are sent with the very first HTML of every page.
//
// Why this exists: those settings live in the database, but the app's built-in defaults
// (styles.css and seedSiteContent) are a different colour. Until this was added, the saved brand
// only arrived after the page had loaded and fetched /api/settings, so every first-time visitor
// saw the default colour for a few seconds and then watched the page change colour.
//
// Pure, and safe to import anywhere. The values end up inside a <style> tag, so each one is
// validated here against a strict pattern — never interpolated as free text.

export interface BrandTheme {
  primaryColor: string;
  buttonTextColor: string;
  accentColor: string;
  cardRadius: number;
  buttonRadius: number;
  inputRadius: number;
  kpiCardRadius: number;
}

const COLOR_KEYS = ["primaryColor", "buttonTextColor", "accentColor"] as const;
const RADIUS_KEYS = ["cardRadius", "buttonRadius", "inputRadius", "kpiCardRadius"] as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MAX_RADIUS = 999;

/** Picks the brand tokens out of a saved settings object, dropping anything that is not a plain
 * hex colour or a sane radius. Whatever is dropped simply keeps its built-in default. */
export function sanitizeBrandTheme(content: unknown): Partial<BrandTheme> {
  const theme: Partial<BrandTheme> = {};
  if (!content || typeof content !== "object") return theme;
  const source = content as Record<string, unknown>;
  for (const key of COLOR_KEYS) {
    const value = source[key];
    if (typeof value === "string" && HEX_COLOR.test(value.trim())) theme[key] = value.trim();
  }
  for (const key of RADIUS_KEYS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_RADIUS)
      theme[key] = value;
  }
  return theme;
}

/**
 * The stylesheet that applies a brand theme before first paint, or "" when there is nothing to
 * apply. Mirrors what ThemeInjector sets once the app is running.
 *
 * `html:root` outranks both `:root` and `.dark` in styles.css, so the brand colour wins in
 * either colour scheme wherever this tag lands in <head>. The radii leave the "iOS 26 Design"
 * preference alone: with it on, ThemeInjector applies that design's own fixed radii.
 */
export function brandThemeCss(input: Partial<BrandTheme> | null | undefined): string {
  const theme = sanitizeBrandTheme(input);
  const colors: string[] = [];
  if (theme.primaryColor) colors.push(`--primary:${theme.primaryColor}`);
  if (theme.buttonTextColor) colors.push(`--primary-foreground:${theme.buttonTextColor}`);
  if (theme.accentColor) colors.push(`--brand-blue:${theme.accentColor}`);
  const radii: string[] = [];
  if (theme.cardRadius !== undefined) radii.push(`--card-radius:${theme.cardRadius}px`);
  if (theme.buttonRadius !== undefined) radii.push(`--button-radius:${theme.buttonRadius}px`);
  if (theme.inputRadius !== undefined) radii.push(`--input-radius:${theme.inputRadius}px`);
  if (theme.kpiCardRadius !== undefined) radii.push(`--kpi-card-radius:${theme.kpiCardRadius}px`);
  return [
    colors.length ? `html:root{${colors.join(";")}}` : "",
    radii.length ? `html:root:not(.ios26){${radii.join(";")}}` : "",
  ].join("");
}
