import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Check } from "lucide-react";
import { Logo } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { useAuthSession } from "@/lib/supabase/use-auth-session";
import { postLoginPath } from "@/lib/safe-redirect";
import {
  challengeMfaFactor,
  getMfaAssuranceLevel,
  listMfaFactors,
  resendSignupConfirmation,
  signInWithPassword,
  signInWithGoogle,
  verifyMfaFactor,
} from "@/lib/supabase/auth";

export const Route = createFileRoute("/")({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { user, loading: sessionLoading } = useAuthSession();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const [resendState, setResendState] = useState<
    "idle" | "needsEmail" | "sending" | "sent" | "failed"
  >("idle");
  const [linkExpired, setLinkExpired] = useState(false);
  // Sent here because a session was missing or had expired (e.g. clicking "Connect channel"):
  // where to return after signing in — always a safe app page (postLoginPath) — and why.
  // Read after the first render (the server has no address bar), so both render the same.
  // undefined until the address has been read; then a safe page, or null for "none".
  const [nextPath, setNextPath] = useState<string | null | undefined>(undefined);
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    setNextPath(next ? postLoginPath(next) : null);
    setSessionExpired(params.get("reason") === "session_expired");
  }, []);
  // After signing in: the remembered page, through the same "connect YouTube if needed" step.
  const afterSignIn = `/api/youtube/auth?returnTo=${encodeURIComponent(nextPath ?? "/dashboard")}&ifNeeded=1`;

  useEffect(() => {
    if (sessionLoading || !user || mfaRequired || nextPath === undefined) return;
    if (nextPath) window.location.replace(nextPath);
    else navigate({ to: "/dashboard" });
  }, [sessionLoading, user, mfaRequired, navigate, nextPath]);

  // /auth/callback sends people back here with ?auth_error=... when an emailed link or Google
  // sign-in could not be completed (most often a confirmation link opened after it expired).
  // Without this they simply landed on the sign-in page with no explanation.
  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get("auth_error");
    if (!authError) return;
    setError(
      authError === "missing_code"
        ? "That link is invalid or has expired. If you were confirming your email, enter it below and choose “Resend confirmation email” — otherwise just sign in."
        : "We couldn't complete that sign-in. Please try again.",
    );
    // Offer the resend straight away for an expired link — no need to attempt a sign-in first.
    setLinkExpired(authError === "missing_code");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const needsConfirmation = linkExpired || Boolean(error && /not confirmed/i.test(error));
  const handleResend = async () => {
    if (!email.trim()) {
      setResendState("needsEmail");
      return;
    }
    setResendState("sending");
    const { error: resendError } = await resendSignupConfirmation(email);
    setResendState(resendError ? "failed" : "sent");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setMfaRequired(true);
    setSubmitting(true);
    const { error: signInError } = await signInWithPassword(email, password);
    if (signInError) {
      setSubmitting(false);
      setMfaRequired(false);
      setError(signInError.message);
      return;
    }
    const { data: assurance, error: assuranceError } = await getMfaAssuranceLevel();
    if (assuranceError) {
      setSubmitting(false);
      setMfaRequired(false);
      setError("We couldn't verify your sign-in security level. Try again.");
      return;
    }
    if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      const { data: factors, error: factorError } = await listMfaFactors();
      const factor = factors?.totp.find(
        (item: { id: string; status: string }) => item.status === "verified",
      );
      if (factorError || !factor) {
        setSubmitting(false);
        setMfaRequired(false);
        setError("Two-factor authentication is required, but no authenticator is available.");
        return;
      }
      const { data: challenge, error: challengeError } = await challengeMfaFactor(factor.id);
      if (challengeError || !challenge) {
        setSubmitting(false);
        setMfaRequired(false);
        setError("Couldn't start two-factor verification. Try again.");
        return;
      }
      setMfaFactorId(factor.id);
      setMfaChallengeId(challenge.id);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setMfaRequired(false);
    window.location.href = afterSignIn;
  };

  const handleMfaVerify = async (event: FormEvent) => {
    event.preventDefault();
    if (!mfaFactorId || !mfaChallengeId || !/^\d{6}$/.test(mfaCode)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    const { error: verifyError } = await verifyMfaFactor(mfaFactorId, mfaChallengeId, mfaCode);
    setSubmitting(false);
    if (verifyError) {
      setError("The verification code is incorrect. Check your authenticator app and try again.");
      return;
    }
    window.location.href = afterSignIn;
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleSubmitting(true);
    const { error: oauthError } = await signInWithGoogle();
    if (oauthError) {
      setError(oauthError.message);
      setGoogleSubmitting(false);
    }
    // On success the browser navigates away to Google, so no further state update is needed here.
  };

  const inputClass =
    "h-12 w-full rounded-full border border-border bg-background text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15";

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel (desktop): the pitch, in the app's primary colour. */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{
          background:
            "linear-gradient(140deg, color-mix(in srgb, var(--primary) 78%, white) 0%, var(--primary) 45%, color-mix(in srgb, var(--primary) 72%, black) 100%)",
        }}
      >
        <Link to="/landing" className="relative inline-flex w-fit items-center">
          <img src={BRAND.wordmark} alt="Tubify" width={480} height={248} className="h-9 w-auto" />
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-[1.1] tracking-tight">
            Turn your YouTube channel into a revenue engine.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">
            Revenue, deals, links and comments for every video, in one dashboard.
          </p>
          <ul className="mt-8 space-y-3 text-[15px]">
            {[
              "See what each video actually earns",
              "Track every link, sponsor and sale",
              "Reply to comments and leads automatically",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/20">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/70">© {new Date().getFullYear()} Tubify</p>
      </aside>

      {/* The form */}
      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex justify-center lg:hidden">
            <Logo />
          </div>

          <h1 className="text-3xl font-bold tracking-tight">
            {mfaFactorId ? "Two-factor authentication" : "Welcome back"}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {mfaFactorId
              ? "Enter the 6-digit code from your authenticator app."
              : "Sign in to your creator dashboard"}
          </p>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleSubmitting || submitting}
            className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-border bg-background text-sm font-semibold shadow-sm transition-colors hover:bg-accent disabled:opacity-60"
          >
            {googleSubmitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <img src="https://www.google.com/favicon.ico" alt="Google" className="h-5 w-5" />
            )}
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              or
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {mfaFactorId ? (
            <form onSubmit={handleMfaVerify} className="space-y-5">
              {error && (
                <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                  {error}
                </p>
              )}
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))}
                className={`${inputClass} px-4 text-center text-lg tracking-[0.5em]`}
                placeholder="000000"
              />
              <button
                type="submit"
                disabled={submitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                Lost your device? Contact support to regain access.
              </p>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {sessionExpired && !error && (
                <p
                  role="status"
                  className="rounded-xl border border-border bg-accent/40 px-3.5 py-2.5 text-sm text-muted-foreground"
                >
                  Your session has expired. Sign in again to continue — you’ll go straight back to
                  where you were.
                </p>
              )}
              {error && (
                <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div>
                <label htmlFor="signin-email" className="mb-2 block text-sm font-medium">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="signin-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@creator.io"
                    className={`${inputClass} pl-12 pr-5`}
                  />
                </div>
                {/* Directly under the email field it depends on. */}
                {needsConfirmation && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {resendState === "sent" ? (
                      "If that email still needs confirming, a new link is on its way. Check your inbox and spam folder."
                    ) : (
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resendState === "sending"}
                        className="font-medium text-primary hover:underline disabled:opacity-60"
                      >
                        {resendState === "sending" ? "Sending…" : "Resend confirmation email"}
                      </button>
                    )}
                    {resendState === "needsEmail" && " Enter your email address above first."}
                    {resendState === "failed" &&
                      " We couldn't send it just now. Wait a minute and try again."}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="signin-password" className="block text-sm font-medium">
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="signin-password"
                    type={show ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pl-12 pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? (
                      <EyeOff className="h-[18px] w-[18px]" />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || googleSubmitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Sign in <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" className="font-semibold text-primary hover:underline">
              Create one
            </Link>
          </p>
          <p className="mt-3 text-center text-sm">
            <Link to="/landing" className="text-muted-foreground hover:text-foreground">
              New to Tubify? See what it does →
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
