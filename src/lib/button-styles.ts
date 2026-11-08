// The app's two button styles. Use these (with `cn` for layout-only extras such as `w-full`,
// `mt-4` or `shrink-0`) rather than writing a button's size, shape or colours by hand, so every
// button in the app looks the same.

/** The main action: a filled pill in the brand colour. */
export const buttonPrimary =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60";

/** A secondary action beside or instead of the main one: the same pill, outlined. */
export const buttonSecondary =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";
