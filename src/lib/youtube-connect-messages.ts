// What the browser is told after Google's consent screen: /api/youtube/callback (and
// /api/youtube/auth) send it back to the page it started from with ?youtube=<status>. Shown by
// Settings and — for a connection started anywhere else, e.g. the channel switcher — by the
// switcher on every page, so no outcome is silently ignored.

export const YOUTUBE_CALLBACK_MESSAGES: Record<
  string,
  { type: "success" | "error"; text: string }
> = {
  connected: { type: "success", text: "YouTube channel connected." },
  denied: { type: "error", text: "YouTube connection was cancelled." },
  invalid_state: {
    type: "error",
    text: "That connection request expired or was invalid — try again.",
  },
  reauthorize_required: { type: "error", text: "Please reconnect and approve access again." },
  storage_failed: { type: "error", text: "We couldn't save your YouTube connection. Try again." },
  no_workspace: {
    type: "error",
    text: "We couldn't find your workspace — please sign out and back in, then try again.",
  },
  already_connected: { type: "success", text: "That YouTube account is already connected." },
  channel_limit: {
    type: "error",
    text: "Your plan's channel limit is reached, so no new channel was added. Disconnect one or upgrade in Billing to add another. Channels already connected were renewed.",
  },
  subscription_required: {
    type: "error",
    text: "Connecting a new channel needs an active subscription. Choose a plan in Billing — your first subscription starts with a 14-day free trial.",
  },
  connection_ambiguous: {
    type: "error",
    text: "We couldn't safely confirm this is the same Google account as an existing connection in this workspace, so nothing was changed. Contact support if you expected this to reconnect automatically.",
  },
  no_channels_found: {
    type: "error",
    text: "Google didn't return a channel this account owns or manages. If you were invited as an Editor/Manager/Viewer on someone else's channel (YouTube Studio → Settings → Permissions), that access isn't visible to any app's API — ask the channel owner to connect it directly, then invite you to this workspace instead.",
  },
  not_allowed: {
    type: "error",
    text: "Only the workspace owner or a manager can connect or disconnect YouTube channels.",
  },
  error: { type: "error", text: "Something went wrong connecting YouTube." },
};

/** The message for a ?youtube=<status>, or undefined for an unknown status. */
export function youtubeCallbackMessage(status: string | null | undefined) {
  return status ? YOUTUBE_CALLBACK_MESSAGES[status] : undefined;
}
