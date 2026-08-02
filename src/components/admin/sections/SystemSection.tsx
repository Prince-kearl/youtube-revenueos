import { toast } from "sonner";
import { Plug, RefreshCw, Mail, Settings as SettingsIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useFeatureFlags, useIntegrations, useEmailTemplates, usePlatformSettings,
  FEATURE_META, type FeatureKey,
} from "@/lib/stores";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const integrationColor: Record<string, string> = {
  Connected: "bg-success/15 text-success",
  "Not Connected": "bg-accent text-muted-foreground",
  Error: "bg-destructive/15 text-destructive",
};

export function SystemSection() {
  const [flags, setFlags] = useFeatureFlags();
  const [integrations] = useIntegrations();
  const [templates] = useEmailTemplates();
  const [settings, setSettings] = usePlatformSettings();
  const log = useAuditLogger();

  const toggleFlag = (key: FeatureKey) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
    log(flags[key] ? "Disabled feature" : "Enabled feature", "System", FEATURE_META[key].label);
    toast.success(`${FEATURE_META[key].label} ${flags[key] ? "disabled" : "enabled"} for all users`);
  };
  const testConnection = (name: string) => toast.success(`${name} connection healthy`);
  const rotateKey = (name: string) => { log("Rotated API key", "System", name); toast.success(`${name} key rotated`); };
  const commitSettings = () => { log("Updated system settings", "System", "Global settings"); toast.success("Settings saved"); };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">System</h1>
      <p className="mt-1 text-sm text-muted-foreground">Feature rollout, integrations, and global platform configuration.</p>

      <h3 className="mt-6 text-sm font-semibold">Feature Flags</h3>
      <div className="relative mt-3 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <p className="text-sm text-muted-foreground">Turn a feature off and every workspace loses access to it immediately — no deploy required.</p>
        <div className="mt-4 divide-y divide-border">
          {(Object.keys(FEATURE_META) as FeatureKey[]).map((key) => {
            const meta = FEATURE_META[key];
            const enabled = flags[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {meta.label}
                    {!enabled && <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">DISABLED</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Switch checked={enabled} onCheckedChange={() => toggleFlag(key)} />
              </div>
            );
          })}
        </div>
      </div>

      <h3 className="mt-6 text-sm font-semibold">Integrations</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {integrations.map((i) => (
          <div key={i.id} className="relative flex items-center justify-between gap-3 rounded-xl card-gradient-outline p-4">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground"><Plug className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">{i.category} · checked {i.lastChecked}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-md px-2 py-1 text-[10px] font-medium ${integrationColor[i.status]}`}>{i.status}</span>
              <button onClick={() => testConnection(i.name)} title="Test connection" className="rounded-[var(--button-radius)] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
              <button onClick={() => rotateKey(i.name)} className="rounded-[var(--button-radius)] border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent">Rotate key</button>
            </div>
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Email Templates</h3>
      <div className="relative mt-3 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 border-b border-border p-4 last:border-0">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-muted-foreground"><Mail className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.subject}</p>
              </div>
            </div>
            <button onClick={() => toast("Template editor isn't wired up in this preview")} className="rounded-[var(--button-radius)] border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">Edit</button>
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Global Settings</h3>
      <div className="relative mt-3 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product name"><Input value={settings.productName} onChange={(e) => setSettings({ ...settings, productName: e.target.value })} onBlur={commitSettings} /></Field>
          <Field label="Support email"><Input value={settings.supportEmail} onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })} onBlur={commitSettings} /></Field>
          <Field label="Session timeout (minutes)"><Input type="number" value={settings.sessionTimeoutMins} onChange={(e) => setSettings({ ...settings, sessionTimeoutMins: Number(e.target.value) })} onBlur={commitSettings} /></Field>
          <Field label="Minimum password length"><Input type="number" value={settings.passwordMinLength} onChange={(e) => setSettings({ ...settings, passwordMinLength: Number(e.target.value) })} onBlur={commitSettings} /></Field>
          <Field label="Default language"><Input value={settings.defaultLanguage} onChange={(e) => setSettings({ ...settings, defaultLanguage: e.target.value })} onBlur={commitSettings} /></Field>
          <Field label="Default timezone"><Input value={settings.defaultTimezone} onChange={(e) => setSettings({ ...settings, defaultTimezone: e.target.value })} onBlur={commitSettings} /></Field>
          <Field label="Max upload size (MB)"><Input type="number" value={settings.maxUploadMb} onChange={(e) => setSettings({ ...settings, maxUploadMb: Number(e.target.value) })} onBlur={commitSettings} /></Field>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-2"><SettingsIcon className="h-4 w-4 text-muted-foreground" /><span className="text-sm">Require MFA for all admins</span></div>
          <Switch checked={settings.requireMfa} onCheckedChange={(v) => { setSettings({ ...settings, requireMfa: v }); commitSettings(); }} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
