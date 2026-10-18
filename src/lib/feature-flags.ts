// Product switches for features that are built but not offered yet. Turning one off hides every
// way into it in the app (buttons, tabs, links) and sends its pages back to a sensible place; no
// data is deleted, so turning it back on restores it as it was.

/**
 * Pre-Publish (checking a video before it is published: "Analyze Before Publishing", the
 * Pre-Publish tab and the upload option on Analyze Video). Hidden for now.
 */
export const PRE_PUBLISH_ENABLED = false;

/**
 * Connected Accounts rows in Settings that are hidden for now: Google Analytics, Stripe and
 * ConvertKit. Existing connections are kept; only the rows are not shown.
 */
export const HIDDEN_CONNECTED_ACCOUNTS: readonly string[] = [
  "Google Analytics",
  "Stripe",
  "ConvertKit",
];
