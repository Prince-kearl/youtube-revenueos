import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { UserPlus, MoreHorizontal, Pencil, Trash2, RefreshCw, Mail } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FlatKpiCard } from "@/components/KpiTrendCard";
import { ConfirmDialog } from "@/components/modals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/team")({
  component: Team,
});

type WorkspaceRole = "owner" | "manager" | "setter" | "editor";
type MemberStatus = "invited" | "active";

type WorkspaceMember = {
  id: string;
  user_id: string | null;
  invited_email: string;
  role: WorkspaceRole;
  status: MemberStatus;
  lead_share: number;
  commission: number;
  invited_at: string;
  joined_at: string | null;
  member: { name: string | null; email: string | null; avatar: string | null } | null;
};
type MembersResponse = { data?: WorkspaceMember[]; meta?: { role: WorkspaceRole }; error?: string };

const roleLabel: Record<WorkspaceRole, string> = {
  owner: "Owner",
  manager: "Manager",
  setter: "Setter",
  editor: "Editor",
};
const roleColor: Record<WorkspaceRole, string> = {
  owner: "bg-brand-purple/15 text-brand-purple",
  manager: "bg-brand-blue/15 text-brand-blue",
  setter: "bg-brand-green/15 text-brand-green",
  editor: "bg-brand-amber/15 text-brand-amber",
};
const ROLE_OPTIONS: WorkspaceRole[] = ["owner", "manager", "setter", "editor"];

const shareColors = [
  "var(--color-brand-purple)",
  "var(--color-brand-blue)",
  "var(--color-brand-green)",
  "var(--color-brand-amber)",
  "var(--color-brand-red)",
];

function canManageMembers(role: WorkspaceRole | undefined): boolean {
  return role === "owner" || role === "manager";
}
function canAssignRole(actingRole: WorkspaceRole | undefined, targetRole: WorkspaceRole): boolean {
  if (actingRole === "owner") return true;
  if (actingRole !== "manager") return false;
  return targetRole === "setter" || targetRole === "editor";
}
function displayName(m: WorkspaceMember): string {
  return m.member?.name || m.invited_email;
}

function errorMessage(error: string | undefined): string {
  const messages: Record<string, string> = {
    CANNOT_MANAGE_MEMBERS: "Only the workspace owner or a manager can do that.",
    CANNOT_ASSIGN_ROLE: "You can't assign that role.",
    ALREADY_A_MEMBER: "That person is already on your team.",
    ALREADY_HAS_WORKSPACE:
      "That person already owns their own Tubify workspace — one account can't belong to two workspaces yet.",
    ALREADY_INVITED: "You've already invited that email.",
    EMAIL_NOT_CONFIGURED: "Invite emails aren't set up in this environment yet.",
    INVITE_EMAIL_FAILED: "Couldn't send the invite email. Please try again.",
    CANNOT_CHANGE_OWN_ROLE: "You can't change your own role.",
    LAST_OWNER: "A workspace needs at least one owner.",
    MEMBER_NOT_FOUND: "That member couldn't be found.",
    VALIDATION_ERROR: "Check the invite details and try again.",
  };
  return messages[error ?? ""] ?? "Something went wrong. Please try again.";
}

function Team() {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [myRole, setMyRole] = useState<WorkspaceRole | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<WorkspaceMember | null>(null);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/workspace/members", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as MembersResponse;
        if (!response.ok || !body.data) throw new Error();
        setMembers(body.data);
        setMyRole(body.meta?.role);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "active").length;
    const invited = members.filter((m) => m.status === "invited").length;
    const withCommission = members.filter((m) => m.commission > 0);
    const avgCommission = withCommission.length
      ? Math.round(withCommission.reduce((a, m) => a + m.commission, 0) / withCommission.length)
      : 0;
    return { active, invited, avgCommission };
  }, [members]);

  const distributed = members.filter((m) => m.status === "active" && m.lead_share > 0);
  const manageable = canManageMembers(myRole);

  const removeMember = async (member: WorkspaceMember) => {
    try {
      const response = await fetch(`/api/workspace/members?id=${member.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "REMOVE_FAILED");
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.success(`${displayName(member)} removed from the team`);
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : undefined));
    }
  };

  return (
    <DashboardLayout title="Team">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite teammates, assign roles, and split lead distribution &amp; commission across your
            pipeline.
          </p>
        </div>
        {manageable && (
          <button
            onClick={() => setInviting(true)}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" /> Invite Member
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <FlatKpiCard title="Total Members" value={String(members.length)} />
        <FlatKpiCard title="Active" value={String(stats.active)} />
        <FlatKpiCard title="Pending Invites" value={String(stats.invited)} />
        <FlatKpiCard title="Avg Commission" value={`${stats.avgCommission}%`} />
      </div>

      {status === "loading" && (
        <p className="mt-6 text-sm text-muted-foreground">Loading your team…</p>
      )}

      {status === "error" && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load your team.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          {distributed.length > 0 && (
            <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
              <h3 className="font-semibold">Lead Distribution</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Percentage of new leads auto-assigned to each teammate.
              </p>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-accent">
                {distributed.map((m, i) => (
                  <div
                    key={m.id}
                    style={{
                      width: `${m.lead_share}%`,
                      background: shareColors[i % shareColors.length],
                    }}
                    title={`${displayName(m)} — ${m.lead_share}%`}
                  />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {distributed.map((m, i) => (
                  <span key={m.id} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: shareColors[i % shareColors.length] }}
                    />
                    {displayName(m)} · {m.lead_share}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {members.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No team yet.
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {members.map((m) => (
                <div key={m.id} className="relative rounded-xl card-gradient-outline p-5">
                  <GlowingEffect
                    spread={40}
                    glow
                    disabled={false}
                    proximity={64}
                    inactiveZone={0.01}
                  />
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {m.member?.avatar ? (
                        <img
                          src={m.member.avatar}
                          alt={displayName(m)}
                          className="h-11 w-11 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-muted-foreground">
                          {m.status === "invited" ? (
                            <Mail className="h-4 w-4" />
                          ) : (
                            displayName(m).charAt(0).toUpperCase()
                          )}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{displayName(m)}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.invited_email}</p>
                      </div>
                    </div>
                    {manageable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Member actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(m)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setRemoving(m)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-[11px] font-medium ${roleColor[m.role]}`}
                    >
                      {roleLabel[m.role]}
                    </span>
                    <span
                      className={`rounded-md px-2 py-1 text-[11px] font-medium ${m.status === "active" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                    >
                      {m.status === "active" ? "Active" : "Invited"}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-accent/30 p-3 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Lead Share</p>
                      <p className="mt-0.5 font-semibold">{m.lead_share}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Commission</p>
                      <p className="mt-0.5 font-semibold">{m.commission}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} myRole={myRole} onInvited={load} />
      <EditMemberDialog
        member={editing}
        myRole={myRole}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={load}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Remove ${removing ? displayName(removing) : ""}?`}
        description="They'll lose access to this workspace. This cannot be undone."
        onConfirm={() => {
          if (removing) void removeMember(removing);
          setRemoving(null);
        }}
      />
    </DashboardLayout>
  );
}

function InviteDialog({
  open,
  myRole,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  myRole: WorkspaceRole | undefined;
  onOpenChange: (v: boolean) => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [leadShare, setLeadShare] = useState("0");
  const [commission, setCommission] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRole("editor");
    setLeadShare("0");
    setCommission("0");
  }, [open]);

  const assignableRoles = ROLE_OPTIONS.filter((r) => canAssignRole(myRole, r));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Enter an email address");
    setSubmitting(true);
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          leadShare: Number(leadShare) || 0,
          commission: Number(commission) || 0,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "INVITE_FAILED");
      toast.success(`Invite sent to ${email.trim()}`);
      onOpenChange(false);
      onInvited();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They'll get a real invite email. If they already have a Tubify account, they're added
            immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jamie@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <div className="flex flex-wrap gap-2">
              {assignableRoles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {roleLabel[r]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Lead share %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={leadShare}
                onChange={(e) => setLeadShare(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Commission %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Sending…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  myRole,
  onOpenChange,
  onSaved,
}: {
  member: WorkspaceMember | null;
  myRole: WorkspaceRole | undefined;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [leadShare, setLeadShare] = useState("0");
  const [commission, setCommission] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!member) return;
    setRole(member.role);
    setLeadShare(String(member.lead_share));
    setCommission(String(member.commission));
  }, [member]);

  if (!member) return null;
  const assignableRoles = ROLE_OPTIONS.filter((r) => r === member.role || canAssignRole(myRole, r));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch(`/api/workspace/members?id=${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role === member.role ? undefined : role,
          leadShare: Number(leadShare) || 0,
          commission: Number(commission) || 0,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "UPDATE_FAILED");
      toast.success("Team member updated");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {displayName(member)}</DialogTitle>
          <DialogDescription>Change their role or pipeline split.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <div className="flex flex-wrap gap-2">
              {assignableRoles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {roleLabel[r]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Lead share %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={leadShare}
                onChange={(e) => setLeadShare(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Commission %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
