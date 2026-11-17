import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, MailWarning, ShieldAlert, UserPlus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuthSession } from "@/lib/supabase/use-auth-session";
import { signOutSupabase } from "@/lib/supabase/auth";
import { buttonPrimary, buttonSecondary } from "@/lib/button-styles";
import { invitationPath } from "@/lib/invitations";
import { cn } from "@/lib/utils";

// The page an invitation link opens. Everything it shows comes from POST /api/invitations, which
// decides what may be shown: before sign-in, only whether the link works and which address it is
// for (masked); after sign-in with the invited address, the workspace, inviter and role.
// Accepting is the server's decision too (api.invitations.ts).

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

type Lookup =
  | { state: "invalid" | "revoked" | "expired" }
  | { state: "accepted"; alreadyJoined?: boolean }
  | {
      state: "pending";
      emailHint?: string;
      signedInEmail?: string | null;
      emailMatches?: boolean;
      emailConfirmed?: boolean;
      workspaceName?: string;
      inviterName?: string | null;
      role?: string;
      expiresAt?: string;
    };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  setter: "Setter",
  editor: "Editor",
};

const ACCEPT_ERROR: Record<string, string> = {
  wrong_account:
    "This invitation is for a different email address than the one you're signed in with.",
  EMAIL_NOT_CONFIRMED: "Confirm your email address first, then open this link again.",
  has_own_workspace:
    "Your account already has its own Tubify workspace in use (with channels, teammates or a subscription), and an account can only belong to one workspace. Ask for an invitation to a different email address, or contact support.",
  inviter_not_allowed:
    "The person who invited you can no longer add members with this role. Ask them for a new invitation.",
  WORKSPACE_NOT_ENTITLED:
    "This workspace can't add team members right now. Ask the person who invited you to check their plan.",
  expired: "This invitation has expired. Ask the person who invited you for a new link.",
  revoked: "This invitation was withdrawn. Ask the person who invited you for a new link.",
  used: "This invitation has already been used.",
  invalid: "This invitation link isn't valid.",
  RATE_LIMITED: "Too many attempts. Wait a few minutes and try again.",
};

function InvitePage() {
  const { token } = Route.useParams();
  const { user, loading: sessionLoading } = useAuthSession();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const here = invitationPath(token);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "lookup", token }),
      });
      const body = (await response.json().catch(() => ({}))) as { data?: Lookup };
      if (!response.ok || !body.data) throw new Error();
      setLookup(body.data);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  // Looked up again once the session is known, so a signed-in visitor sees the details.
  useEffect(() => {
    if (!sessionLoading) void load();
  }, [sessionLoading, user?.id, load]);

  useEffect(() => {
    if (!joined) return;
    const timer = setTimeout(() => window.location.assign("/dashboard"), 2500);
    return () => clearTimeout(timer);
  }, [joined]);

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", token }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { outcome: string };
        error?: string;
      };
      if (response.ok && body.data) {
        setJoined(true);
        return;
      }
      setAcceptError(
        ACCEPT_ERROR[body.error ?? ""] ?? "We couldn't accept the invitation. Try again.",
      );
    } catch {
      setAcceptError("We couldn't reach Tubify. Check your connection and try again.");
    } finally {
      setAccepting(false);
    }
  };

  const signOutAndReturn = async () => {
    await signOutSupabase();
    window.location.assign(`/?next=${encodeURIComponent(here)}`);
  };

  let body: React.ReactNode;
  if (joined) {
    body = (
      <Panel icon={<CheckCircle2 className="h-10 w-10 text-success" />} title="You're in!">
        <p>You've successfully joined the workspace. Taking you to your dashboard…</p>
        <a href="/dashboard" className={cn(buttonPrimary, "mt-5 w-full justify-center")}>
          Go to dashboard
        </a>
      </Panel>
    );
  } else if (loadError) {
    body = (
      <Panel
        icon={<ShieldAlert className="h-10 w-10 text-destructive" />}
        title="We couldn't open this invitation"
      >
        <p>Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => void load()}
          className={cn(buttonSecondary, "mt-5 w-full justify-center")}
        >
          Try again
        </button>
      </Panel>
    );
  } else if (!lookup || sessionLoading) {
    body = (
      <div className="flex flex-col items-center gap-3 py-10" role="status" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking your invitation…</p>
      </div>
    );
  } else if (lookup.state === "accepted") {
    body = lookup.alreadyJoined ? (
      <Panel
        icon={<CheckCircle2 className="h-10 w-10 text-success" />}
        title="You've already joined"
      >
        <p>This invitation was accepted with your account.</p>
        <a href="/dashboard" className={cn(buttonPrimary, "mt-5 w-full justify-center")}>
          Go to dashboard
        </a>
      </Panel>
    ) : (
      <Panel
        icon={<ShieldAlert className="h-10 w-10 text-muted-foreground" />}
        title="This invitation has been used"
      >
        <p>Each invitation link works once. Ask the person who invited you for a new one.</p>
      </Panel>
    );
  } else if (lookup.state !== "pending") {
    const copy = {
      invalid: [
        "This link isn't valid",
        "Check that you copied the whole link, or ask for a new one.",
      ],
      revoked: ["This invitation was withdrawn", "Ask the person who invited you for a new link."],
      expired: [
        "This invitation has expired",
        "Invitations last 7 days. Ask the person who invited you for a new link.",
      ],
    }[lookup.state];
    body = (
      <Panel
        icon={
          lookup.state === "expired" ? (
            <Clock className="h-10 w-10 text-muted-foreground" />
          ) : (
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          )
        }
        title={copy[0]}
      >
        <p>{copy[1]}</p>
      </Panel>
    );
  } else if (!user) {
    body = (
      <Panel
        icon={<UserPlus className="h-10 w-10 text-primary" />}
        title="You've been invited to Tubify"
      >
        <p>
          Someone invited you to join their Tubify workspace. Sign in or create an account with{" "}
          <span className="font-semibold text-foreground">
            {lookup.emailHint ?? "the invited email"}
          </span>{" "}
          to see the details and accept.
        </p>
        <div className="mt-5 grid gap-2">
          <a
            href={`/signup?next=${encodeURIComponent(here)}`}
            className={cn(buttonPrimary, "w-full justify-center")}
          >
            Create an account
          </a>
          <a
            href={`/?next=${encodeURIComponent(here)}`}
            className={cn(buttonSecondary, "w-full justify-center")}
          >
            I already have an account
          </a>
        </div>
      </Panel>
    );
  } else if (!lookup.emailMatches) {
    body = (
      <Panel icon={<MailWarning className="h-10 w-10 text-warning" />} title="Wrong account">
        <p>
          This invitation is for{" "}
          <span className="font-semibold text-foreground">{lookup.emailHint}</span>, but you're
          signed in as{" "}
          <span className="font-semibold text-foreground">
            {lookup.signedInEmail ?? "another account"}
          </span>
          {lookup.signedInEmail && lookup.emailConfirmed === false ? " (not confirmed yet)" : ""}.
          Sign out and sign in with the invited address.
        </p>
        <button
          type="button"
          onClick={() => void signOutAndReturn()}
          className={cn(buttonPrimary, "mt-5 w-full justify-center")}
        >
          Sign out and switch account
        </button>
      </Panel>
    );
  } else {
    body = (
      <Panel
        icon={<UserPlus className="h-10 w-10 text-primary" />}
        title={`Join ${lookup.workspaceName}`}
      >
        <p>
          {lookup.inviterName ? (
            <>
              <span className="font-semibold text-foreground">{lookup.inviterName}</span> invited
              you
            </>
          ) : (
            "You've been invited"
          )}{" "}
          to join <span className="font-semibold text-foreground">{lookup.workspaceName}</span> as{" "}
          <span className="font-semibold text-foreground">
            {ROLE_LABEL[lookup.role ?? ""] ?? lookup.role}
          </span>
          .
        </p>
        <p className="mt-2 text-xs">
          Your account can belong to one workspace. If you're not using your own Tubify workspace
          yet, you'll move to this one.
        </p>
        {acceptError && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive"
          >
            {acceptError}
          </p>
        )}
        <button
          type="button"
          onClick={() => void accept()}
          disabled={accepting}
          className={cn(buttonPrimary, "mt-5 w-full justify-center disabled:opacity-60")}
        >
          {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {accepting ? "Joining…" : "Accept invitation"}
        </button>
      </Panel>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 scale-125">
        <Logo />
      </div>
      <div className="w-full max-w-md rounded-[var(--card-radius)] card-frost p-8 shadow-2xl backdrop-blur-lg">
        {body}
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {icon}
      <h1 className="mt-3 text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-2 w-full text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
