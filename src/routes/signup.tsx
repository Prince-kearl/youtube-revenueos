import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, Zap, Loader2, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useAuthSession } from "@/lib/supabase/use-auth-session";
import { signUpWithPassword, signInWithGoogle } from "@/lib/supabase/auth";

export const Route = createFileRoute("/signup")({
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const { user, loading: sessionLoading } = useAuthSession();
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  useEffect(() => {
    if (!sessionLoading && user) navigate({ to: "/dashboard" });
  }, [sessionLoading, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter your full name.");
    if (!email) return setError("Enter your email.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");

    setSubmitting(true);
    const { data, error: signUpError } = await signUpWithPassword(email, password, name.trim());
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // A session on the returned user means email confirmation is disabled for this project —
    // otherwise Supabase requires the confirmation link before a session exists.
    if (data.session) {
      navigate({ to: "/dashboard" });
      return;
    }
    setConfirmationSent(true);
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleSubmitting(true);
    const { error: oauthError } = await signInWithGoogle();
    if (oauthError) {
      setError(oauthError.message);
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="scale-125">
          <Logo />
        </div>
        <Link to="/landing" className="text-sm font-medium text-primary hover:underline">
          New to Tubify? See what it does →
        </Link>
      </div>

      <div className="relative w-full max-w-md rounded-xl card-frost backdrop-blur-lg p-8 shadow-2xl">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />

        {confirmationSent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Click it to activate your account.
            </p>
            <Link to="/" className="mt-2 text-sm font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-extrabold tracking-tight">Create your account</h1>
            <p className="mt-1 text-muted-foreground">Start turning your channel into a sales engine</p>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleSubmitting || submitting}
              className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-[var(--button-radius)] border border-border bg-accent/40 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              {googleSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <img src="https://www.google.com/favicon.ico" alt="Google" className="h-5 w-5" />}
              Continue with Google
            </button>

            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-sm text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Rivera"
                    className="h-12 w-full rounded-xl border border-border bg-accent/30 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@creator.io"
                    className="h-12 w-full rounded-xl border border-border bg-accent/30 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={show ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-xl border border-border bg-accent/30 pl-11 pr-11 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={show ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 w-full rounded-xl border border-border bg-accent/30 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || googleSubmitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create Account <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>

      <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Zap className="h-4 w-4 text-brand-amber" fill="currentColor" />
        Tubify — turn your YouTube channel into a sales engine
      </p>
    </div>
  );
}
