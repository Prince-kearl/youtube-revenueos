import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Mail, ArrowRight, Zap, Loader2, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { requestPasswordReset } from "@/lib/supabase/auth";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email) {
      setError("Enter your email.");
      return;
    }
    setSubmitting(true);
    const { error: resetError } = await requestPasswordReset(email);
    setSubmitting(false);
    // Always show the success state, even on error, so this endpoint can't be used to enumerate
    // which emails have an account.
    if (resetError) console.error(resetError);
    setSent(true);
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

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="font-medium text-foreground">{email}</span>, we sent a link to reset your password.
            </p>
            <Link to="/" className="mt-2 text-sm font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-extrabold tracking-tight">Forgot password?</h1>
            <p className="mt-1 text-muted-foreground">We'll email you a link to reset it</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {error && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
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

              <button
                type="submit"
                disabled={submitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send reset link <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link to="/" className="font-medium text-primary hover:underline">
                Back to sign in
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
