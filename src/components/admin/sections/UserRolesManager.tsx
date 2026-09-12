import { useEffect, useState } from "react";
import { Search, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/modals";
import { Input } from "@/components/ui/input";

type AppRole = "superadmin" | "owner" | "manager" | "setter" | "editor" | "user";
type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: AppRole;
  created_at: string;
};
type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  old_value: { role?: string } | null;
  new_value: { role?: string } | null;
  created_at: string;
  admin: { name: string | null; email: string | null } | null;
};

// The real, server-authenticated role set — this is a UI-only mirror of src/lib/server/roles.ts's
// APP_ROLES, kept as a plain client-side array rather than importing the server module (which
// pulls in service-role Supabase access that must never reach the browser bundle).
const ROLE_OPTIONS: AppRole[] = ["superadmin", "owner", "manager", "setter", "editor", "user"];
const ROLE_LABEL: Record<AppRole, string> = {
  superadmin: "Superadmin",
  owner: "Owner",
  manager: "Manager",
  setter: "Setter",
  editor: "Editor",
  user: "User",
};

const ERROR_MESSAGE: Record<string, string> = {
  CANNOT_CHANGE_OWN_ROLE: "You can't change your own role.",
  PRIVILEGE_ESCALATION_BLOCKED: "You don't have permission to make that change.",
  CANNOT_REMOVE_LAST_SUPERADMIN: "Tubify must always have at least one Superadmin.",
  USER_NOT_FOUND: "That user no longer exists.",
};

function actionLabel(action: string): string {
  return action === "role_assigned" ? "Changed role" : action;
}

export function UserRolesManager() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [pendingChange, setPendingChange] = useState<{ user: UserRow; newRole: AppRole } | null>(
    null,
  );

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/audit", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([usersBody, auditBody]) => {
        if (!usersBody.data) throw new Error();
        setUsers(usersBody.data);
        setAuditLog((auditBody.data ?? []).filter((e: AuditEntry) => e.action === "role_assigned"));
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  const applyChange = async () => {
    if (!pendingChange) return;
    const { user, newRole } = pendingChange;
    try {
      const response = await fetch(`/api/admin/users?id=${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ROLE_CHANGE_FAILED");
      toast.success(`${user.name ?? user.email} is now ${ROLE_LABEL[newRole]}`);
      load();
    } catch (error) {
      const code = error instanceof Error ? error.message : "ROLE_CHANGE_FAILED";
      toast.error(ERROR_MESSAGE[code] ?? "Couldn't change that user's role. Please try again.");
    }
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Assign real, server-enforced roles to Tubify users. This is the actual authorization source
        — separate from the "Custom Roles" tab, which only controls what staff see inside this admin
        console.
      </p>

      <div className="mt-4 relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          className="pl-9"
        />
      </div>

      {status === "loading" && <p className="mt-4 text-sm text-muted-foreground">Loading users…</p>}

      {status === "error" && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load users.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Current Role</th>
                <th className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex rounded-md bg-accent px-2 py-1 text-[11px] font-medium">
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <select
                      value={u.role}
                      onChange={(e) => {
                        const newRole = e.target.value as AppRole;
                        if (newRole !== u.role) setPendingChange({ user: u, newRole });
                      }}
                      className="h-8 rounded-[var(--input-radius)] border border-border bg-background px-2 text-xs"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No users match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {auditLog.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent role changes
          </h4>
          <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {auditLog.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span>
                  <span className="font-medium text-foreground">{actionLabel(entry.action)}</span>
                  {entry.target ? ` · ${entry.target}` : ""}
                  {entry.old_value?.role && entry.new_value?.role
                    ? ` · ${entry.old_value.role} → ${entry.new_value.role}`
                    : ""}
                  {entry.admin?.name ? ` · by ${entry.admin.name}` : ""}
                </span>
                <span>{new Date(entry.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingChange}
        onOpenChange={(v) => !v && setPendingChange(null)}
        title={
          pendingChange
            ? `Change ${pendingChange.user.name ?? pendingChange.user.email}'s role to ${ROLE_LABEL[pendingChange.newRole]}?`
            : ""
        }
        description={
          pendingChange
            ? `This is a real, immediate permission change — from ${ROLE_LABEL[pendingChange.user.role]} to ${ROLE_LABEL[pendingChange.newRole]}.`
            : undefined
        }
        confirmLabel="Change role"
        destructive={pendingChange?.newRole === "user"}
        onConfirm={() => {
          void applyChange();
          setPendingChange(null);
        }}
      />
    </div>
  );
}

export function RoleSecurityNote() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Only Superadmin and Owner can change roles, and only within their own authority — Owner
        can't create another Owner or Superadmin, nobody can change their own role, and the last
        Superadmin can never be demoted. Every rule is enforced on the server, not just hidden in
        this UI.
      </span>
    </div>
  );
}
