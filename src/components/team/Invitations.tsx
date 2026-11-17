import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Share2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buttonSecondary } from "@/lib/button-styles";
import { cn } from "@/lib/utils";
import {
  INVITATION_EMAIL_SUBJECT,
  INVITATION_STATE_LABEL,
  invitationMessage,
  mailtoShareUrl,
  whatsappShareUrl,
  type InvitationState,
} from "@/lib/invitations";

// Shareable invitations on the Team page: the panel listing them (api.workspace.invitations.ts)
// and the dialog that shows a new link once, with ways to share it. Tubify sends no email — the
// person inviting shares the link themselves.

export type Invitation = {
  id: string;
  email: string;
  role: string;
  state: InvitationState;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type LegacyInvite = {
  memberId: string;
  email: string;
  role: string;
  invitedBy: string | null;
  createdAt: string;
};

export type SharedLink = { url: string; email: string };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  setter: "Setter",
  editor: "Editor",
};

const ERROR_TEXT: Record<string, string> = {
  INVITATION_RATE_LIMITED: "You've created a lot of invitations recently. Try again in a while.",
  TOO_MANY_PENDING_INVITATIONS: "There are too many open invitations. Revoke some first.",
  INVITATION_NOT_OPEN: "That invitation can no longer be changed.",
  INVITATION_NOT_FOUND: "That invitation couldn't be found.",
  CANNOT_MANAGE_MEMBERS: "You don't have permission to manage that invitation.",
  CANNOT_ASSIGN_ROLE: "You can't assign that role.",
  PLAN_REQUIRED: "Team management is available on Scale.",
  ALREADY_INVITED: "There's already an open invitation for that email.",
};

const date = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );

/** Calls the invitation management API; returns a new link when one was issued. */
export async function invitationAction(
  body: { action: "revoke" | "regenerate"; id: string } | { action: "convert"; memberId: string },
): Promise<{ inviteUrl?: string; email?: string }> {
  const response = await fetch("/api/workspace/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    data?: { inviteUrl?: string; invitation?: { email: string } };
    error?: string;
  };
  if (!response.ok || !result.data)
    throw new Error(ERROR_TEXT[result.error ?? ""] ?? "Something went wrong. Please try again.");
  return { inviteUrl: result.data.inviteUrl, email: result.data.invitation?.email };
}

export function InvitationsPanel({
  refreshKey,
  onLink,
  onCounts,
}: {
  /** Changes when the list should be fetched again (after inviting). */
  refreshKey: number;
  /** A new link was issued: show it once. */
  onLink: (link: SharedLink) => void;
  onCounts?: (open: number) => void;
}) {
  const [items, setItems] = useState<Invitation[]>([]);
  const [legacy, setLegacy] = useState<LegacyInvite[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "hidden">("loading");
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Invitation | null>(null);

  const load = useCallback(() => {
    fetch("/api/workspace/invitations", { cache: "no-store" })
      .then(async (response) => {
        // Only owners and managers manage invitations; for anyone else the panel is not shown.
        if (response.status === 403) return setStatus("hidden");
        const body = (await response.json()) as { data?: Invitation[]; legacy?: LegacyInvite[] };
        if (!response.ok || !body.data) throw new Error();
        setItems(body.data);
        setLegacy(body.legacy ?? []);
        setStatus("ready");
        onCounts?.(
          body.data.filter((i) => i.state === "pending").length + (body.legacy ?? []).length,
        );
      })
      .catch(() => setStatus("error"));
  }, [onCounts]);

  useEffect(load, [load, refreshKey]);

  const run = async (
    key: string,
    body: Parameters<typeof invitationAction>[0],
    success: string,
  ) => {
    setBusy(key);
    try {
      const result = await invitationAction(body);
      if (result.inviteUrl) onLink({ url: result.inviteUrl, email: result.email ?? "" });
      else toast.success(success);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  if (status === "hidden") return null;
  const open = items.filter((i) => i.state === "pending" || i.state === "expired");
  const history = items.filter((i) => i.state === "accepted" || i.state === "revoked");
  const shown = showHistory ? [...open, ...history] : open;

  return (
    <section
      className="mt-6 rounded-[var(--card-radius)] card-frost p-5"
      aria-labelledby="invitations-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="invitations-title" className="font-semibold">
            Invitations
          </h2>
          <p className="text-xs text-muted-foreground">
            Links you've shared. Each works once, for the invited email, and expires after 7 days.
          </p>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showHistory
              ? "Hide accepted and revoked"
              : `Show accepted and revoked (${history.length})`}
          </button>
        )}
      </div>

      {status === "loading" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invitations…
        </p>
      )}
      {status === "error" && (
        <div className="mt-4 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>We couldn't load your invitations.</span>
          <button type="button" onClick={load} className={cn(buttonSecondary, "h-8")}>
            Try again
          </button>
        </div>
      )}
      {status === "ready" && !shown.length && !legacy.length && (
        <p className="mt-4 text-sm text-muted-foreground">No open invitations.</p>
      )}

      {status === "ready" && (shown.length > 0 || legacy.length > 0) && (
        <ul className="mt-4 divide-y divide-border">
          {legacy.map((item) => (
            <li key={item.memberId} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.email}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABEL[item.role] ?? item.role} · invited {date(item.createdAt)}
                  {item.invitedBy ? ` by ${item.invitedBy}` : ""} · sent by email before links
                </p>
              </div>
              <StateBadge state="pending" />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    item.memberId,
                    { action: "convert", memberId: item.memberId },
                    "Link created",
                  )
                }
                className={cn(buttonSecondary, "h-8 text-xs")}
              >
                {busy === item.memberId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Create link
              </button>
            </li>
          ))}
          {shown.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.email}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABEL[item.role] ?? item.role} · invited {date(item.createdAt)}
                  {item.invitedBy ? ` by ${item.invitedBy}` : ""}
                  {item.state === "pending" ? ` · expires ${date(item.expiresAt)}` : ""}
                  {item.state === "accepted" && item.acceptedAt
                    ? ` · accepted ${date(item.acceptedAt)}`
                    : ""}
                  {item.state === "revoked" && item.revokedAt
                    ? ` · revoked ${date(item.revokedAt)}`
                    : ""}
                </p>
              </div>
              <StateBadge state={item.state} />
              {(item.state === "pending" || item.state === "expired") && (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(item.id, { action: "regenerate", id: item.id }, "New link created")
                    }
                    className={cn(buttonSecondary, "h-8 text-xs")}
                    title="Creates a new link to copy or share. The previous link stops working."
                  >
                    {busy === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {item.state === "expired" ? "Renew link" : "New link"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setConfirmRevoke(item)}
                    className="flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Revoke
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        For security, a link is shown only when it's created. To share it again, create a new link —
        the old one stops working.
      </p>

      <Dialog open={confirmRevoke !== null} onOpenChange={(v) => !v && setConfirmRevoke(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke this invitation?</DialogTitle>
            <DialogDescription>
              The link sent to {confirmRevoke?.email} will stop working. You can invite them again
              later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => setConfirmRevoke(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-full"
              onClick={() => {
                const item = confirmRevoke;
                setConfirmRevoke(null);
                if (item)
                  void run(item.id, { action: "revoke", id: item.id }, "Invitation revoked");
              }}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StateBadge({ state }: { state: InvitationState }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        state === "pending" && "bg-primary/10 text-primary",
        state === "accepted" && "bg-success/15 text-success",
        state === "expired" && "bg-warning/15 text-warning",
        state === "revoked" && "bg-accent text-muted-foreground",
      )}
    >
      {INVITATION_STATE_LABEL[state]}
    </span>
  );
}

/** Shows a just-issued link once, with ways to share it. Nothing is sent by Tubify. */
export function InvitationShareDialog({
  link,
  onOpenChange,
}: {
  link: SharedLink | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link?.url]);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Invitation link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      await navigator.share({
        title: INVITATION_EMAIL_SUBJECT,
        text: invitationMessage(link.url),
      });
    } catch (error) {
      // Cancelling the share sheet is not an error; anything else falls back to copying.
      if (!(error instanceof DOMException && error.name === "AbortError")) await copy();
    }
  };

  return (
    <Dialog open={link !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-success" /> Invitation created
          </DialogTitle>
          <DialogDescription>
            Send this link to {link?.email || "your client"} yourself — Tubify doesn't email it. It
            works once, only for that email address, and expires in 7 days.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-accent/30 p-2">
          <input
            readOnly
            value={link?.url ?? ""}
            aria-label="Invitation link"
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent px-1 font-mono text-xs outline-none"
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => void copy()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy invitation link"}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {canShare && (
            <button
              type="button"
              onClick={() => void share()}
              className={cn(buttonSecondary, "justify-center")}
            >
              <Share2 className="h-4 w-4" /> Share…
            </button>
          )}
          <a
            href={link ? whatsappShareUrl(link.url) : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonSecondary, "justify-center")}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
          <a
            href={link ? mailtoShareUrl(link.url, link.email) : "#"}
            className={cn(buttonSecondary, "justify-center")}
          >
            <Mail className="h-4 w-4" /> Email
          </a>
        </div>
        <p className="text-[11px] text-muted-foreground">
          You won't be able to see this link again. If you lose it, create a new one from
          Invitations.
        </p>
        <DialogFooter>
          <Button type="button" className="rounded-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
