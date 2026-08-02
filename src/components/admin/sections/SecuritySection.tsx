import { useState } from "react";
import { Lock, ShieldAlert, Monitor, Plus, X, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/ui-bits";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useAdminSessions, useIpLists, usePlatformSettings } from "@/lib/stores";
import { uid } from "@/lib/local-store";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const suspiciousEvents = [
  { who: "Unknown device", detail: "5 failed logins for hiro@bytesize.dev, then a password reset request", time: "2026-07-21 22:41 UTC" },
  { who: "198.51.100.23", detail: "Rate-limited after 40 requests/min to the auth endpoint", time: "2026-07-20 03:12 UTC" },
  { who: "New device", detail: "Login for maya@glowup.co from a device not seen in 90 days", time: "2026-07-19 15:07 UTC" },
];

export function SecuritySection() {
  const [sessions, setSessions] = useAdminSessions();
  const [ipLists, setIpLists] = useIpLists();
  const [settings, setSettings] = usePlatformSettings();
  const log = useAuditLogger();
  const [newAllow, setNewAllow] = useState("");
  const [newBlock, setNewBlock] = useState("");

  const revoke = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    setSessions((prev) => prev.filter((x) => x.id !== id));
    if (s) { log("Revoked session", "Security", `${s.user} · ${s.device}`); toast.success(`Revoked session for ${s.user}`); }
  };
  const addIp = (list: "allow" | "block", ip: string) => {
    if (!ip.trim()) return;
    setIpLists((prev) => ({ ...prev, [list]: [...prev[list], { id: uid(), ip, note: "" }] }));
    log(`Added to IP ${list}list`, "Security", ip);
    toast.success(`${ip} added to the ${list} list`);
    list === "allow" ? setNewAllow("") : setNewBlock("");
  };
  const removeIp = (list: "allow" | "block", id: string) => {
    setIpLists((prev) => ({ ...prev, [list]: prev[list].filter((r) => r.id !== id) }));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Security Center</h1>
      <p className="mt-1 text-sm text-muted-foreground">Authentication policy, active sessions, and network access control.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Monitor className="h-5 w-5" />} value={String(sessions.length)} label="Active Admin Sessions" />
        <StatCard icon={<ShieldAlert className="h-5 w-5" />} value={String(suspiciousEvents.length)} label="Suspicious Events (7d)" />
        <StatCard icon={<Lock className="h-5 w-5" />} value={String(ipLists.block.length)} label="Blocked IPs" />
        <StatCard icon={<KeyRound className="h-5 w-5" />} value={settings.requireMfa ? "Enforced" : "Optional"} label="MFA Policy" />
      </div>

      <div className="relative mt-6 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <h3 className="text-sm font-semibold">Authentication</h3>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between"><span className="text-sm">Enforce MFA for all admins</span><Switch checked={settings.requireMfa} onCheckedChange={(v) => { setSettings({ ...settings, requireMfa: v }); log(v ? "Enforced MFA" : "Made MFA optional", "Security", "Authentication policy"); toast.success(v ? "MFA is now required for all admins" : "MFA is now optional"); }} /></div>
          <div className="flex items-center justify-between"><span className="text-sm">SSO (SAML / OIDC)</span><Switch checked={settings.ssoEnabled} onCheckedChange={(v) => { setSettings({ ...settings, ssoEnabled: v }); log(v ? "Enabled SSO" : "Disabled SSO", "Security", "Authentication policy"); toast.success(v ? "SSO enabled" : "SSO disabled"); }} /></div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="relative rounded-xl card-gradient-outline">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="p-5 pb-0 text-sm font-semibold">Active Sessions</h3>
          <div className="mt-3">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.user}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.device} · {s.location} · {s.lastActive}</p>
                </div>
                <button onClick={() => revoke(s.id)} className="shrink-0 rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10">Revoke</button>
              </div>
            ))}
            {sessions.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">No active sessions.</p>}
          </div>
        </div>

        <div className="relative rounded-xl card-gradient-outline">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="p-5 pb-0 text-sm font-semibold">Suspicious Activity</h3>
          <div className="mt-3">
            {suspiciousEvents.map((e, i) => (
              <div key={i} className="flex items-start gap-3 border-t border-border px-5 py-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.who}</p>
                  <p className="text-xs text-muted-foreground">{e.detail}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">{e.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IpListCard title="IP Allowlist" list={ipLists.allow} value={newAllow} onChange={setNewAllow} onAdd={() => addIp("allow", newAllow)} onRemove={(id) => removeIp("allow", id)} />
        <IpListCard title="IP Blocklist" list={ipLists.block} value={newBlock} onChange={setNewBlock} onAdd={() => addIp("block", newBlock)} onRemove={(id) => removeIp("block", id)} />
      </div>
    </div>
  );
}

function IpListCard({ title, list, value, onChange, onAdd, onRemove }: {
  title: string; list: { id: string; ip: string; note: string }[]; value: string;
  onChange: (v: string) => void; onAdd: () => void; onRemove: (id: string) => void;
}) {
  return (
    <div className="relative rounded-xl card-gradient-outline p-5">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {list.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-accent/30 px-3 py-2 text-sm">
            <div className="min-w-0"><p className="truncate font-mono text-xs">{r.ip}</p>{r.note && <p className="truncate text-xs text-muted-foreground">{r.note}</p>}</div>
            <button onClick={() => onRemove(r.id)} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {list.length === 0 && <p className="text-xs text-muted-foreground">No entries.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. 203.0.113.10" className="h-8 text-xs" />
        <button onClick={onAdd} className="flex h-8 shrink-0 items-center gap-1 rounded-[var(--button-radius)] bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-3.5 w-3.5" /> Add</button>
      </div>
    </div>
  );
}
