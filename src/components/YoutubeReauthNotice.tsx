import { KeyRound, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function YoutubeReauthNotice({
  channelName,
  onRetry,
  compact = false,
}: {
  channelName?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <Alert variant="destructive" className={compact ? "py-2.5" : undefined}>
      <KeyRound className="h-4 w-4" />
      <AlertTitle>YouTube authorization needs to be renewed</AlertTitle>
      <AlertDescription>
        <p>
          {channelName
            ? `${channelName} can no longer be accessed with the saved authorization.`
            : "The saved YouTube authorization can no longer be used."}{" "}
          Renew access to load current channel data.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href="/api/youtube/auth?returnTo=/settings"
            className="inline-flex items-center rounded-[var(--button-radius)] bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
          >
            Reconnect YouTube
          </a>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-[var(--button-radius)] border border-destructive/30 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
