import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, Youtube, XCircle } from "lucide-react";
import { Logo } from "@/components/Logo";

// The page a client opens from a connect link. The client is not a Tubify user: they see who
// invited them and exactly what they would share, then "Continue with Google", where they pick
// the ONE channel to share and approve. Results come back here (?result=…). The link's secret is
// in the address, so the page asks browsers not to pass it on (no-referrer) and not to index it.

export const Route = createFileRoute("/connect/$token")({
  component: ConnectChannel,
  head: () => ({
    meta: [
      { title: "Connect your YouTube channel — Tubify" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type PublicInvite = {
  state: "valid" | "expired" | "used" | "revoked" | "invalid";
  workspaceName?: string | null;
  inviterName?: string | null;
  label?: string | null;
  expiresAt?: string;
  choices?: Array<{ channelId: string; title: string; thumbnail: string | null }> | null;
};

const RESULT_TEXT: Record<string, { tone: "ok" | "error"; title: string; text: string }> = {
  denied: {
    tone: "error",
    title: "Nothing was shared",
    text: "You cancelled on Google’s screen. You can try again whenever you’re ready.",
  },
  invalid_state: {
    tone: "error",
    title: "That took a little too long",
    text: "For your security the request expired. Please continue with Google again.",
  },
  no_channels: {
    tone: "error",
    title: "No YouTube channel on that account",
    text: "Google didn’t return a channel for the account you chose. Try again and pick the account or brand account that owns your channel.",
  },
  channel_limit: {
    tone: "error",
    title: "The workspace is full",
    text: "The person who invited you can’t add more channels on their current plan. Let them know — nothing was shared.",
  },
  subscription_required: {
    tone: "error",
    title: "The workspace can’t add channels right now",
    text: "Let the person who invited you know — nothing was shared.",
  },
  reauthorize_required: {
    tone: "error",
    title: "Google needs you to approve again",
    text: "Please continue with Google again and approve access when asked.",
  },
  storage_failed: {
    tone: "error",
    title: "Something went wrong",
    text: "Nothing was shared. Please try again in a moment.",
  },
  error: {
    tone: "error",
    title: "Something went wrong",
    text: "Nothing was shared. Please try again in a moment.",
  },
};

function ConnectChannel() {
  const { token } = Route.useParams();
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [connectedChannel, setConnectedChannel] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setResult(params.get("result"));
    setConnectedChannel(params.get("channel"));
    fetch(`/api/connect-invites/public?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
      .then(async (response) => {
        const body = (await response.json()) as { data?: PublicInvite };
        if (!response.ok || !body.data) throw new Error();
        setInvite(body.data);
      })
      .catch(() => setLoadFailed(true));
  }, [token]);

  const pick = async (channelId: string, title: string) => {
    setPicking(channelId);
    setPickError(null);
    try {
      const response = await fetch("/api/connect-invites/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, channelId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        const known = RESULT_TEXT[(body.error ?? "").toLowerCase()];
        throw new Error(
          known ? known.text : "That didn’t work. Please continue with Google again.",
        );
      }
      setResult("connected");
      setConnectedChannel(title);
    } catch (error) {
      setPickError(error instanceof Error ? error.message : "That didn’t work. Please try again.");
    } finally {
      setPicking(null);
    }
  };

  const who = invite?.inviterName
    ? `${invite.inviterName}${invite.workspaceName ? ` (${invite.workspaceName})` : ""}`
    : (invite?.workspaceName ?? "Someone you work with");

  let body: React.ReactNode;
  if (result === "connected") {
    body = (
      <Message
        tone="ok"
        title="Your channel is connected"
        text={`${connectedChannel ? `“${connectedChannel}” is` : "Your channel is"} now shared with ${who}. You can close this page. To remove access later, go to your Google Account → Security → Third-party apps, and remove Tubify.`}
      />
    );
  } else if (loadFailed) {
    body = (
      <Message
        tone="error"
        title="This page didn’t load"
        text="Please refresh, or ask for a new link."
      />
    );
  } else if (!invite) {
    body = (
      <div className="flex justify-center py-10" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (invite.state === "used") {
    body = (
      <Message
        tone="ok"
        title="This link has already been used"
        text="A channel was connected with it. If that wasn’t you, ask for a new link."
      />
    );
  } else if (invite.state !== "valid") {
    body = (
      <Message
        tone="error"
        title={invite.state === "expired" ? "This link has expired" : "This link isn’t valid"}
        text="Ask the person who sent it for a new link."
      />
    );
  } else if (result === "pick" && invite.choices?.length) {
    body = (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Which channel do you want to share?</h1>
        <p className="text-sm text-muted-foreground">
          Your Google account has several channels. Only the one you choose is shared with {who}.
        </p>
        <ul className="space-y-2">
          {invite.choices.map((choice) => (
            <li key={choice.channelId}>
              <button
                type="button"
                onClick={() => void pick(choice.channelId, choice.title)}
                disabled={picking !== null}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary disabled:opacity-60"
              >
                {choice.thumbnail ? (
                  <img
                    src={choice.thumbnail}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <Youtube className="h-10 w-10 text-brand-red" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{choice.title}</span>
                {picking === choice.channelId && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            </li>
          ))}
        </ul>
        {pickError && <p className="text-sm text-destructive">{pickError}</p>}
      </div>
    );
  } else {
    const outcome = result ? RESULT_TEXT[result] : undefined;
    body = (
      <div className="space-y-5">
        {outcome && <Message tone={outcome.tone} title={outcome.title} text={outcome.text} />}
        <div>
          <h1 className="text-xl font-semibold">Connect your YouTube channel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <strong className="text-foreground">{who}</strong> invited you to connect your YouTube
            channel{invite.label ? ` (${invite.label})` : ""} to Tubify, so they can manage it for
            you. You don’t need a Tubify account.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-accent/30 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-success" /> What you’ll share
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Only the one channel you pick on Google’s screen — not your Google account or other
              channels.
            </li>
            <li>
              Its videos, comments, analytics and revenue reports, and replying to comments on it.
            </li>
            <li>
              You never share your password, and you can remove access anytime from your Google
              Account.
            </li>
          </ul>
        </div>
        <a
          href={`/api/connect-invites/start?token=${encodeURIComponent(token)}`}
          referrerPolicy="no-referrer"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Youtube className="h-4 w-4" /> Continue with Google
        </a>
        {invite.expiresAt && (
          <p className="text-center text-xs text-muted-foreground">
            This link works once and expires{" "}
            {new Date(invite.expiresAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
            })}
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">{body}</div>
      </div>
    </main>
  );
}

function Message({ tone, title, text }: { tone: "ok" | "error"; title: string; text: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : XCircle;
  return (
    <div role="status" className="flex gap-3">
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${tone === "ok" ? "text-success" : "text-destructive"}`}
      />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
