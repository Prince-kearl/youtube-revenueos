import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { FlatKpiCard } from "@/components/KpiTrendCard";

type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  admin: { name: string | null; email: string | null } | null;
};

// The complete, real action vocabulary written by logAdminAudit() across every admin route today
// (see api.admin.features.ts, api.admin.features.bulk.ts, api.admin.releases*.ts,
// api.admin.users*.ts, api.admin.support.tickets.ts) — billing/plan changes are logged separately
// to plan_audit_log and shown in the Billing tab instead, since they carry different fields.
const ACTION_LABEL: Record<string, string> = {
  role_assigned: "Changed user role",
  feature_enabled: "Enabled feature",
  feature_disabled: "Disabled feature",
  feature_bulk_change: "Bulk feature change",
  release_created: "Created release",
  release_published: "Published release",
  release_rolled_back: "Rolled back release",
  release_edited: "Edited release",
  release_deprecated: "Deprecated release",
  support_ticket_status_changed: "Changed ticket status",
  user_invited: "Invited user",
  user_deleted: "Deleted user",
  user_banned: "Banned user",
  user_unbanned: "Unbanned user",
  user_email_verified: "Verified user email",
  user_creator_verified: "Verified creator badge",
  user_creator_unverified: "Removed creator badge",
  user_password_reset_sent: "Sent password reset",
  user_impersonation_link_generated: "Generated impersonation link",
};
const MODULE_FROM_ACTION = (action: string): string => {
  if (action.startsWith("role_") || action.startsWith("user_")) return "Users";
  if (action.startsWith("feature_")) return "Features";
  if (action.startsWith("release_")) return "Releases";
  if (action.startsWith("support_")) return "Support";
  return "Other";
};

function summarizeChange(entry: AuditEntry): string | null {
  const oldRole = entry.old_value?.role;
  const newRole = entry.new_value?.role;
  if (typeof oldRole === "string" && typeof newRole === "string") return `${oldRole} → ${newRole}`;
  const oldStatus = entry.old_value?.status;
  const newStatus = entry.new_value?.status;
  if (typeof oldStatus === "string" && typeof newStatus === "string")
    return `${oldStatus} → ${newStatus}`;
  const banDuration = entry.new_value?.banDuration;
  if (typeof banDuration === "string")
    return banDuration === "none" ? "Unbanned" : `for ${banDuration}`;
  if (typeof newRole === "string" && entry.action === "user_invited") return `as ${newRole}`;
  return null;
}

export function AuditLogSection() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [moduleFilter, setModuleFilter] = useState("All");

  useEffect(() => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/admin/audit", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: AuditEntry[] };
        if (!response.ok || !body.data) throw new Error();
        setEntries(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [retryNonce]);

  const modules = ["All", ...new Set(entries.map((e) => MODULE_FROM_ACTION(e.action)))];
  const filtered =
    moduleFilter === "All"
      ? entries
      : entries.filter((e) => MODULE_FROM_ACTION(e.action) === moduleFilter);
  const uniqueAdmins = new Set(entries.map((e) => e.admin?.email).filter(Boolean)).size;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The most recent 50 real admin actions across roles, features, releases, and support —
        billing/plan changes have their own log in the Billing tab.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FlatKpiCard title="Total Events" value={String(entries.length)} />
        <FlatKpiCard title="Admins Involved" value={String(uniqueAdmins)} />
        <FlatKpiCard
          title="Most Recent"
          value={entries[0] ? new Date(entries[0].created_at).toLocaleDateString() : "—"}
        />
      </div>

      {status === "loading" && <p className="mt-5 text-sm text-muted-foreground">Loading…</p>}

      {status === "error" && (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load the audit log.</p>
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
          <div className="mt-5 flex flex-wrap gap-1.5">
            {modules.map((m) => (
              <button
                key={m}
                onClick={() => setModuleFilter(m)}
                className={`rounded-[var(--button-radius)] px-3 py-1.5 text-xs font-medium ${moduleFilter === m ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Admin</th>
                  <th className="px-3 py-3 font-medium">Action</th>
                  <th className="px-3 py-3 font-medium">Module</th>
                  <th className="px-3 py-3 font-medium">Target</th>
                  <th className="px-3 py-3 font-medium">Change</th>
                  <th className="px-3 py-3 font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {filtered.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-4 py-3 font-medium">
                      {e.admin?.name ?? e.admin?.email ?? "—"}
                    </td>
                    <td className="px-3 py-3">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {MODULE_FROM_ACTION(e.action)}
                    </td>
                    <td className="px-3 py-3 max-w-[220px] truncate text-muted-foreground">
                      {e.target ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{summarizeChange(e) ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">
                      No events for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
