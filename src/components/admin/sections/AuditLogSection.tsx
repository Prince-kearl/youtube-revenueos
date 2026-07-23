import { useState } from "react";
import { ScrollText, CheckCircle2, XCircle } from "lucide-react";
import { StatCard } from "@/components/ui-bits";
import { useAuditLog } from "@/lib/stores";

export function AuditLogSection() {
  const [entries] = useAuditLog();
  const [moduleFilter, setModuleFilter] = useState("All");
  const modules = ["All", ...new Set(entries.map((e) => e.module))];
  const filtered = moduleFilter === "All" ? entries : entries.filter((e) => e.module === moduleFilter);
  const sorted = [...filtered].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every significant admin action, with before/after context and outcome.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={<ScrollText className="h-5 w-5" />} value={String(entries.length)} label="Total Events" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} value={String(entries.filter((e) => e.outcome === "Success").length)} label="Successful" />
        <StatCard icon={<XCircle className="h-5 w-5" />} value={String(entries.filter((e) => e.outcome === "Failed").length)} label="Failed" />
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {modules.map((m) => (
          <button key={m} onClick={() => setModuleFilter(m)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${moduleFilter === m ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{m}</button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-3 py-3 font-medium">Action</th>
              <th className="px-3 py-3 font-medium">Module</th>
              <th className="px-3 py-3 font-medium">Target</th>
              <th className="px-3 py-3 font-medium">IP</th>
              <th className="px-3 py-3 font-medium">Timestamp</th>
              <th className="px-3 py-3 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {sorted.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                <td className="px-4 py-3 font-medium">{e.actor}</td>
                <td className="px-3 py-3">{e.action}</td>
                <td className="px-3 py-3 text-muted-foreground">{e.module}</td>
                <td className="px-3 py-3 max-w-[220px] truncate text-muted-foreground">{e.target}</td>
                <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{e.ip}</td>
                <td className="px-3 py-3 text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${e.outcome === "Success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                    {e.outcome === "Success" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {e.outcome}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">No events for this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
