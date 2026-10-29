// Tubify's brand images (public/brand), one per situation. They are built in: logos uploaded in
// Customization earlier are no longer used.
// - wordmark: the "Tubify" lettering with the mascot, wherever the name is shown in full (expanded
//   sidebar, sign-in and sign-up, landing nav and footer, legal pages, link previews);
// - appIcon: the rounded-square icon, wherever space is tight or an icon is expected (browser tab,
//   home screen, collapsed sidebar, phone header, loading screen);
// - mascot: Tubi on its own, wherever the character speaks or cheers (the Tubi assistant, calls to
//   action, sample avatars).
export const BRAND = {
  wordmark: "/brand/tubify-wordmark.webp",
  /** PNG for link previews (social sites don't all accept WebP). */
  wordmarkPng: "/brand/tubify-wordmark.png",
  appIcon: "/brand/tubify-app-icon.webp",
  favicon: "/brand/favicon-64.png",
  appleTouchIcon: "/brand/apple-touch-icon.png",
  mascot: "/brand/tubify-mascot.webp",
} as const;
