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
const SAFE_KPI_ACCENT = "#0284c7";

/** KPI surfaces follow the primary theme except for attention colors that can imply status. */
export function kpiAccentForPrimary(primaryColor: string | undefined): string {
  const color = primaryColor?.trim();
  if (!color || !HEX_COLOR.test(color)) return SAFE_KPI_ACCENT;

  let digits = color.slice(1);
  if (digits.length === 3 || digits.length === 4)
    digits = digits
      .slice(0, 3)
      .split("")
      .map((digit) => digit + digit)
      .join("");
  else digits = digits.slice(0, 6);

  const [red, green, blue] = [0, 2, 4].map(
    (offset) => Number.parseInt(digits.slice(offset, offset + 2), 16) / 255,
  );
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (delta === 0 || maximum === 0) return color;

  let hue: number;
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  if (hue < 0) hue += 360;

  const saturation = delta / maximum;
  const isRedHue = saturation >= 0.15 && (hue < 20 || hue >= 340);
  const brightOrangeOrYellow = saturation >= 0.45 && maximum >= 0.8 && hue >= 20 && hue <= 70;
  return isRedHue || brightOrangeOrYellow ? SAFE_KPI_ACCENT : color;
}

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
  if (theme.primaryColor) {
    colors.push(`--primary:${theme.primaryColor}`);
    colors.push(`--kpi-accent:${kpiAccentForPrimary(theme.primaryColor)}`);
  }
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
