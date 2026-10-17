import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CreditCard, Sparkles } from "lucide-react";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import { planNotice, type PlanNotice, type WorkspaceAccess } from "@/lib/plan-notice";

// The top of every app page: why paid features are unavailable (no active subscription) and how
// to get them back, or how long a trial has left. The server enforces access; this only explains
// it, from GET /api/billing/subscription.

export function SubscriptionNotice() {
  const [notice, setNotice] = useState<PlanNotice | null>(null);

  useEffect(() => {
    if (IS_LOCAL_DEMO) return;
    const controller = new AbortController();
    fetch("/api/billing/subscription", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          data?: { access?: WorkspaceAccess | null; stripeConfigured?: boolean };
        };
        // While checkout is unavailable, no one is invited to start a subscription or a trial.
        setNotice(
          planNotice(body.data?.access ?? null, new Date(), {
            checkoutAvailable: body.data?.stripeConfigured !== false,
          }),
        );
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!notice) return null;
  const warning = notice.tone === "warning";
  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        warning ? "border-warning/30 bg-warning/10" : "border-primary/20 bg-primary/5"
      }`}
      role="status"
      data-testid="subscription-notice"
      data-tone={notice.tone}
    >
      <div className="flex min-w-0 items-start gap-2">
        {warning ? (
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <p>
          <span className="font-semibold">{notice.title}.</span>{" "}
          <span className="text-muted-foreground">{notice.body}</span>
        </p>
      </div>
      {notice.action && (
        <Link
          to={notice.action.to}
          className="inline-flex shrink-0 items-center rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {notice.action.label}
        </Link>
      )}
    </div>
  );
}
