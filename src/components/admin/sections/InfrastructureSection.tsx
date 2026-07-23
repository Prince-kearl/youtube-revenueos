import { CheckCircle2, HardDrive, Database, Server, Cloud, Wifi, Play } from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/ui-bits";
import { useBackups, useTenants } from "@/lib/stores";
import { uid } from "@/lib/local-store";
import { useAuditLogger } from "../useAuditLogger";

const services = [
  { name: "API", icon: Wifi, latency: "82ms" },
  { name: "Database", icon: Database, latency: "11ms" },
  { name: "Background Queue", icon: Server, latency: "3 jobs queued" },
  { name: "CDN", icon: Cloud, latency: "24ms" },
];

export function InfrastructureSection() {
  const [backups, setBackups] = useBackups();
  const [tenants] = useTenants();
  const log = useAuditLogger();

  const storageUsed = tenants.reduce((a, t) => a + t.storageUsedGb, 0);
  const storageQuota = tenants.reduce((a, t) => a + t.storageQuotaGb, 0);

  const runBackup = () => {
    setBackups((prev) => [{ id: uid(), type: "Manual", size: `${(4 + Math.random()).toFixed(1)} GB`, createdAt: new Date().toISOString(), status: "Completed" }, ...prev]);
    log("Ran manual backup", "Infrastructure", "Database");
    toast.success("Manual backup completed");
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Infrastructure</h1>
      <p className="mt-1 text-sm text-muted-foreground">Service health, storage, and backups.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {services.map((s) => (
          <StatCard key={s.name} icon={<s.icon className="h-5 w-5" />} value="Operational" label={s.name} sub={s.latency} />
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Storage</h3></div>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground"><span>{storageUsed} GB used</span><span>{storageQuota} GB provisioned</span></div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-accent">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round((storageUsed / storageQuota) * 100))}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between p-5 pb-0">
          <h3 className="text-sm font-semibold">Backups</h3>
          <button onClick={runBackup} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Play className="h-3.5 w-3.5" /> Run backup now</button>
        </div>
        <div className="mt-3">
          {backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="font-medium">{b.type} backup</span>
                <span className="text-xs text-muted-foreground">{b.size}</span>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
