import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Lock, Eye, EyeOff, ArrowRight, Zap, Loader2, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useAuthSession } from "@/lib/supabase/use-auth-session";
import { updatePassword } from "@/lib/supabase/auth";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  // Clicking the reset-password email link redirects here with Supabase establishing a
  // short-lived "recovery" session automatically (via the PKCE code in the URL) before this runs.
  const { user, loading: sessionLoading } = useAuthSession();
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) {
      const timeout = setTimeout(() => navigate({ to: "/dashboard" }), 1500);
      return () => clearTimeout(timeout);
    }
  }, [done, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");

    setSubmitting(true);
    const { error: updateError } = await updatePassword(password);
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="scale-125">
          <Logo />
        </div>
      </div>

      <div className="relative w-full max-w-md rounded-xl card-frost backdrop-blur-lg p-8 shadow-2xl">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <h1 className="text-2xl font-bold tracking-tight">Password updated</h1>
            <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
          </div>
        ) : !sessionLoading && !user ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Link expired</h1>
            <p className="text-sm text-muted-foreground">This password reset link is invalid or has expired.</p>
            <Link to="/forgot-password" className="mt-2 text-sm font-medium text-primary hover:underline">
              Request a new link
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-extrabold tracking-tight">Set a new password</h1>
            <p className="mt-1 text-muted-foreground">Choose a strong password for your account</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {error && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium">New password</label>
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
                <label className="mb-2 block text-sm font-medium">Confirm new password</label>
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
                disabled={submitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Update password <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
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
