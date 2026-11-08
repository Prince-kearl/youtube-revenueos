import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buttonPrimary, buttonSecondary } from "@/lib/button-styles";
import { cn } from "@/lib/utils";

// A complimentary plan for one account, in the admin user detail sheet: grant one (a plan for a
// number of days or with no end), extend it, or revoke it — each with a reason. The server
// (api.admin.subscription-grants.ts) checks the admin's permission and every rule; this only
// collects the input and words the answer.

type GrantPlan = "starter" | "pro" | "scale";
type Current = {
  id: string;
  plan: GrantPlan;
  startsAt: string;
  expiresAt: string | null;
  reason: string;
};
type HistoryItem = {
  event: "granted" | "extended" | "revoked" | "expired";
  at: string;
  reason: string | null;
  by: string | null;
  plan: string | null;
  expiresAt: string | null;
};

const PLAN_NAMES: Record<GrantPlan, string> = { starter: "Starter", pro: "Pro", scale: "Scale" };
const DURATIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "custom", label: "Custom number of days" },
  { value: "lifetime", label: "Lifetime (no end)" },
] as const;
const EVENT_LABEL: Record<HistoryItem["event"], string> = {
  granted: "Granted",
  extended: "Extended",
  revoked: "Revoked",
  expired: "Expired",
};

const ERRORS: Record<string, string> = {
  ACTIVE_GRANT_EXISTS: "This user already has a complimentary plan. Extend or revoke it instead.",
  PAID_SUBSCRIPTION_EXISTS:
    "This user already pays for a subscription, so a complimentary plan can't be added.",
  SELF_GRANT_NOT_ALLOWED: "You can't grant a plan to your own account.",
  GRANT_NOT_FOUND: "That plan is no longer active. Refresh to see its current state.",
  GRANT_ALREADY_LIFETIME: "This plan already has no end.",
  GRANT_NOT_LATER: "The new end must be later than the current one.",
  GRANT_END_IN_PAST: "The end date must be in the future.",
  GRANTS_NOT_AVAILABLE: "Complimentary plans aren't set up on this server yet.",
  USER_NOT_FOUND: "This user no longer exists.",
  VALIDATION_ERROR: "Check the details and try again.",
  ADMIN_REQUIRED: "You don't have permission to do this.",
  PERMISSION_REQUIRED: "You don't have permission to manage billing.",
};

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function endText(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return "no end date";
  const days = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
  return `until ${dateText(expiresAt)} (${days} ${days === 1 ? "day" : "days"} left)`;
}

type Mode = "grant" | "extend" | "revoke";

export function SubscriptionGrantPanel({ userId }: { userId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [current, setCurrent] = useState<Current | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setState("loading");
      fetch(`/api/admin/subscription-grants?${new URLSearchParams({ userId })}`, {
        cache: "no-store",
        signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            data?: { current: Current | null; history: HistoryItem[] };
          };
          if (!response.ok || !body.data) throw new Error();
          setCurrent(body.data.current);
          setHistory(body.data.history);
          setState("ready");
        })
        .catch(() => {
          if (!signal?.aborted) setState("error");
        });
    },
    [userId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section data-testid="subscription-grant-panel">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Complimentary plan
      </h4>
      {state === "loading" && <p className="mt-2 text-muted-foreground">Loading…</p>}
      {state === "error" && (
        <p className="mt-2 text-muted-foreground">
          Couldn't load complimentary plans.{" "}
          <button type="button" className="font-medium text-primary" onClick={() => load()}>
            Try again
          </button>
        </p>
      )}
      {state === "ready" && (
        <>
          {current ? (
            <div className="mt-2 rounded-xl border border-border p-3">
              <p className="flex items-center gap-2 font-medium">
                <Gift className="h-4 w-4 text-primary" aria-hidden="true" />
                {PLAN_NAMES[current.plan]} · {endText(current.expiresAt)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Since {dateText(current.startsAt)} · {current.reason}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {current.expiresAt !== null && (
                  <button
                    type="button"
                    className={buttonSecondary}
                    onClick={() => setMode("extend")}
                  >
                    Extend
                  </button>
                )}
                <button
                  type="button"
                  className={cn(buttonSecondary, "text-destructive")}
                  onClick={() => setMode("revoke")}
                >
                  Revoke
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-muted-foreground">
                None. A complimentary plan gives this user's own workspaces a paid plan without
                payment.
              </p>
              <button
                type="button"
                className={cn(buttonPrimary, "mt-3")}
                onClick={() => setMode("grant")}
              >
                <Gift className="h-4 w-4" aria-hidden="true" /> Grant a plan
              </button>
            </div>
          )}
          {history.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {history.slice(0, 6).map((item, index) => (
                <li
                  key={`${item.event}-${item.at}-${index}`}
                  className="flex justify-between gap-2"
                >
                  <span className="min-w-0 truncate">
                    {EVENT_LABEL[item.event]}
                    {item.plan ? ` ${PLAN_NAMES[item.plan as GrantPlan] ?? item.plan}` : ""}
                    {item.by ? ` by ${item.by}` : item.event === "expired" ? " automatically" : ""}
                    {item.reason ? ` — ${item.reason}` : ""}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{dateText(item.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <GrantDialog
        mode={mode}
        userId={userId}
        current={current}
        onClose={() => setMode(null)}
        onDone={() => {
          setMode(null);
          load();
        }}
      />
    </section>
  );
}

function GrantDialog({
  mode,
  userId,
  current,
  onClose,
  onDone,
}: {
  mode: Mode | null;
  userId: string;
  current: Current | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState<GrantPlan>("pro");
  const [duration, setDuration] = useState<string>("30");
  const [customDays, setCustomDays] = useState("14");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    setPlan("pro");
    setDuration("30");
    setCustomDays("14");
    setReason("");
    setError(null);
  }, [mode]);

  const days = duration === "custom" ? Number(customDays) : Number(duration);
  const durationValid =
    mode === "revoke" ||
    duration === "lifetime" ||
    (Number.isInteger(days) && days >= 1 && days <= 3650);
  const reasonValid = reason.trim().length >= 3;

  const submit = async () => {
    if (!mode || !durationValid || !reasonValid) return;
    setSaving(true);
    setError(null);
    const durationBody = duration === "lifetime" ? "lifetime" : { days };
    const body =
      mode === "grant"
        ? { action: "grant", userId, plan, duration: durationBody, reason: reason.trim() }
        : mode === "extend"
          ? {
              action: "extend",
              userId,
              grantId: current?.id,
              duration: durationBody,
              reason: reason.trim(),
            }
          : { action: "revoke", userId, grantId: current?.id, reason: reason.trim() };
    try {
      const response = await fetch("/api/admin/subscription-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(ERRORS[result.error ?? ""] ?? "Something went wrong. Please try again.");
        return;
      }
      toast.success(
        mode === "grant" ? "Plan granted" : mode === "extend" ? "Plan extended" : "Plan revoked",
      );
      onDone();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === "grant"
      ? "Grant a complimentary plan"
      : mode === "extend"
        ? "Extend the complimentary plan"
        : "Revoke the complimentary plan";
  const description =
    mode === "grant"
      ? "The user's own workspaces get this plan without payment, from now until the end you choose."
      : mode === "extend"
        ? `Adds time to the current end${current?.expiresAt ? ` (${dateText(current.expiresAt)})` : ""}, or removes the end.`
        : "The plan ends now. The user keeps all their data and can subscribe in Billing.";

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === "grant" && (
            <div className="space-y-1.5">
              <Label htmlFor="grant-plan">Plan</Label>
              <Select value={plan} onValueChange={(value) => setPlan(value as GrantPlan)}>
                <SelectTrigger id="grant-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PLAN_NAMES) as GrantPlan[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLAN_NAMES[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode !== "revoke" && (
            <div className="space-y-1.5">
              <Label htmlFor="grant-duration">{mode === "extend" ? "Add" : "Duration"}</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="grant-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {duration === "custom" && (
                <Input
                  aria-label="Number of days"
                  type="number"
                  min={1}
                  max={3650}
                  value={customDays}
                  onChange={(event) => setCustomDays(event.target.value)}
                />
              )}
              {!durationValid && (
                <p className="text-xs text-destructive">Enter between 1 and 3650 days.</p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="grant-reason">Reason (required)</Label>
            <Textarea
              id="grant-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                mode === "revoke" ? "Why is this plan ending?" : "e.g. Partner creator, beta tester"
              }
            />
            <p className="text-xs text-muted-foreground">Saved to the audit log with your name.</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <button type="button" className={buttonSecondary} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className={cn(
                buttonPrimary,
                mode === "revoke" && "bg-destructive hover:bg-destructive/90",
              )}
              disabled={saving || !durationValid || !reasonValid}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "grant" ? "Grant plan" : mode === "extend" ? "Extend" : "Revoke plan"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
