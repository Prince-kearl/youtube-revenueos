import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Zap } from "lucide-react";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  component: Login,
});

function Login() {
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex justify-center">
        <div className="scale-125">
          <Logo />
        </div>
      </div>

      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-muted-foreground">Sign in to your creator dashboard</p>

        <button className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-accent/40 text-sm font-medium transition-colors hover:bg-accent">
          <img src="https://www.google.com/favicon.ico" alt="Google" className="h-5 w-5" />
          Continue with Google
        </button>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-sm text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = "/dashboard";
          }}
          className="space-y-5"
        >
          <div>
            <label className="mb-2 block text-sm font-medium">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
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
                defaultValue="password"
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

          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => setRemember((r) => !r)}
                className={`flex h-4 w-4 items-center justify-center rounded border ${
                  remember ? "border-primary bg-primary" : "border-border bg-transparent"
                }`}
              >
                {remember && <span className="text-[10px] text-primary-foreground">✓</span>}
              </button>
              Remember me
            </label>
            <a href="#" className="text-sm font-medium text-primary hover:underline">
              Forgot password?
            </a>
          </div>

          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign In <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/dashboard" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>

      <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Zap className="h-4 w-4 text-brand-amber" fill="currentColor" />
        AI-powered revenue insights for top creators
      </p>
    </div>
  );
}
