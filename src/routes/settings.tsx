import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  User,
  Link2,
  Youtube,
  Bell,
  CreditCard,
  Shield,
  Camera,
  Check,
  LayoutDashboard,
  KeyRound,
  Globe,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  CircleHelp,
  MoreVertical,
  ArrowRight,
  BadgeCheck,
  Pencil,
  CalendarDays,
  MapPin,
  ExternalLink,
  Crown,
  ScanLine,
  X,
  Copy,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Switch } from "@/components/ui/switch";
import { useChannelSettings } from "@/lib/channel-settings";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useThemeMode, type ThemeMode } from "@/lib/theme";
import { ConfirmDialog } from "@/components/modals";
import { clearAllStores } from "@/lib/local-store";
import { useLocalStore } from "@/lib/local-store";
import { ACTIVE_YOUTUBE_CHANNEL_KEY } from "@/components/YoutubeChannelSwitcher";
import { useAuthSession } from "@/lib/supabase/use-auth-session";
import {
  challengeMfaFactor,
  enrollTotpFactor,
  listMfaFactors,
  unenrollMfaFactor,
  updatePassword,
  verifyMfaFactor,
} from "@/lib/supabase/auth";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const menu = [
  { label: "Profile", icon: User },
  { label: "Dashboard Banner", icon: LayoutDashboard },
  { label: "Connected Accounts", icon: Link2 },
  { label: "YouTube Integration", icon: Youtube },
  { label: "Google & YouTube Access", icon: KeyRound },
  { label: "Privacy & Data", icon: Globe },
  { label: "Notifications", icon: Bell },
  { label: "Billing", icon: CreditCard },
  { label: "Security", icon: Shield },
];

function Settings() {
  const [active, setActive] = useState("Profile");

  return (
    <DashboardLayout title="Settings">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* Mobile tab nav */}
      <div className="mt-5 lg:hidden">
        <div className="flex items-stretch border border-border bg-card p-1">
          {menu.map((m) => {
            const isActive = active === m.label;
            return (
              <button
                key={m.label}
                onClick={() => setActive(m.label)}
                aria-label={m.label}
                title={m.label}
                className={`flex h-10 min-w-0 flex-1 items-center justify-center transition-colors ${
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <m.icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <div className="hidden space-y-1 self-start lg:sticky lg:top-6 lg:block">
          {menu.map((m) => (
            <button
              key={m.label}
              onClick={() => setActive(m.label)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                active === m.label ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <m.icon className="h-[18px] w-[18px]" /> {m.label}
            </button>
          ))}
        </div>

        <div>{renderPanel(active, setActive)}</div>
      </div>
    </DashboardLayout>
  );
}

function renderPanel(active: string, setActive: (section: string) => void) {
  switch (active) {
    case "Appearance":
      return <AppearancePanel />;
    case "Dashboard Banner":
      return <DashboardBannerPanel />;
    case "Connected Accounts":
      return <ConnectedAccountsPanel />;
    case "YouTube Integration":
      return <YouTubeIntegrationPanel />;
    case "Google & YouTube Access":
      return <OAuthScopesPanel />;
    case "Privacy & Data":
      return <CompliancePanel />;
    case "Notifications":
      return <NotificationsPanel />;
    case "Billing":
      return <BillingPanel />;
    case "Security":
      return <SecurityPanel />;
    default:
      return <ProfilePanel onOpenSecurity={() => setActive("Security")} />;
  }
}

    function ProfilePanel({ onOpenSecurity }: { onOpenSecurity: () => void }) {
  const { user } = useAuthSession();
  const [profile, setProfile] = useLocalStore("yroos.profile", { name: "", email: "", avatar: "", role: "Owner", timezone: "", bio: "", location: "", website: "", cover_url: "" });
  const [channel, setChannel] = useState<ConnectedYoutubeChannel | null>(null);
  const [channelLoading, setChannelLoading] = useState(true);
  const [editor, setEditor] = useState<ProfileEditorMode | null>(null);
  const fallbackName = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email?.split("@")[0] ?? "Your profile";
  const name = profile.name || fallbackName;
  const email = profile.email || user?.email || "";
  const avatar = profile.avatar || (user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture) || channel?.thumbnail;
  const role = profile.role === "admin" ? "Admin" : "Owner";
  const [bio, setBio] = useState(profile.bio ?? "");
  const [saved, setSaved] = useState(false);
  const [profileTab, setProfileTab] = useState<"Overview" | "Activity" | "Connections" | "Preferences">("Overview");

  useEffect(() => {
    fetch("/api/profile")
      .then(async (response) => {
        const body = (await response.json()) as { data?: ProfileData };
        const profileData = body.data;
        if (!response.ok || !profileData) return;
        setProfile((current) => ({
          ...current,
          name: profileData.name ?? "",
          email: profileData.email ?? "",
          avatar: profileData.avatar ?? "",
          role: profileData.role ?? current.role,
          location: profileData.location ?? "",
          website: profileData.website ?? "",
          bio: profileData.bio ?? current.bio,
          cover_url: profileData.cover_url ?? "",
        }));
      })
      .catch(() => undefined);

    fetch("/api/youtube/channels")
      .then(async (response) => {
        const body = (await response.json()) as { data?: ConnectedYoutubeChannel[] };
        setChannel(response.ok ? body.data?.[0] ?? null : null);
      })
      .catch(() => setChannel(null))
      .finally(() => setChannelLoading(false));
  }, []);

  const channelUrl = channel
    ? channel.channel_handle
      ? `https://www.youtube.com/${channel.channel_handle.startsWith("@") ? channel.channel_handle : `@${channel.channel_handle}`}`
      : `https://www.youtube.com/channel/${channel.youtube_channel_id}`
    : "YouTube not connected";

  const saveProfile = (next: ProfileData) => {
    setProfile((current) => ({
      ...current,
      name: next.name ?? current.name,
      email: next.email ?? current.email,
      avatar: next.avatar ?? current.avatar,
      role: next.role === "admin" ? "Admin" : next.role === "user" ? "Owner" : next.role ?? current.role,
      location: next.location ?? current.location,
      website: next.website ?? current.website,
      bio: next.bio ?? current.bio,
      cover_url: next.cover_url ?? current.cover_url,
    }));
    setEditor(null);
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="relative h-32 overflow-hidden bg-[#151515] sm:h-40">
        {profile.cover_url ? <img src={profile.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_20%,rgba(255,0,0,0.28),transparent_34%),linear-gradient(115deg,#121212_0%,#292929_48%,#0b0b0b_100%)]" />}
        <div className="absolute -right-8 -top-20 h-64 w-64 rotate-12 border border-white/10 bg-white/[0.03]" />
        <button onClick={() => setEditor("cover")} aria-label="Edit profile cover" title="Edit profile cover" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/30 text-white hover:bg-black/50"><Pencil className="h-3.5 w-3.5" /></button>
      </div>

      <div className="relative px-5 pb-0 sm:px-7">
        <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="relative">
              {avatar ? <img src={avatar} alt={name} className="h-24 w-24 rounded-full border-4 border-card object-cover shadow-lg sm:h-28 sm:w-28" /> : <div className="grid h-24 w-24 place-items-center rounded-full border-4 border-card bg-primary text-2xl font-bold text-primary-foreground shadow-lg sm:h-28 sm:w-28">{name.charAt(0).toUpperCase()}</div>}
              <button onClick={() => setEditor("avatar")} aria-label="Edit profile photo" title="Edit profile photo" className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground"><Camera className="h-3.5 w-3.5" /></button>
            </div>
            <div className="pb-1">
              <div className="flex items-center gap-1.5"><h3 className="text-xl font-bold tracking-tight">{name}</h3><BadgeCheck className="h-4 w-4 fill-primary text-primary-foreground" /></div>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <button onClick={() => setEditor("profile")} className="inline-flex items-center justify-center gap-2 rounded-[var(--button-radius)] border border-border px-4 py-2 text-xs font-semibold hover:border-primary"><Pencil className="h-3.5 w-3.5" /> Edit profile</button>
        </div>

        <p className="mt-4 max-w-xl text-xs leading-5 text-muted-foreground">{bio || "Creator focused on building a smarter YouTube business with actionable insights and better workflows."}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "recently"}</span><span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {profile.location || "Location not set"}</span><span className="inline-flex items-center gap-1"><Crown className="h-3 w-3 text-primary" /> {role}</span></div>

        <div className="mt-5 flex gap-5 overflow-x-auto border-b border-border">
          {["Overview", "Activity", "Connections", "Preferences"].map((tab) => <button key={tab} onClick={() => setProfileTab(tab as typeof profileTab)} className={`relative shrink-0 pb-3 text-[11px] font-semibold transition-colors ${profileTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{tab}{profileTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</button>)}
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-7">
        {profileTab === "Overview" && <>
          <div className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between"><h4 className="text-xs font-bold">About</h4><button onClick={() => setEditor("about")} className="text-muted-foreground hover:text-primary" aria-label="Edit about" title="Edit about"><Pencil className="h-3 w-3" /></button></div><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><div><p className="text-[10px] text-muted-foreground">Account type</p><p className="mt-1 text-xs font-semibold">{role}</p></div><div><p className="text-[10px] text-muted-foreground">Email</p><p className="mt-1 truncate text-xs font-semibold">{email || "Not available"}</p></div><div><p className="text-[10px] text-muted-foreground">Location</p><p className="mt-1 text-xs font-semibold">{profile.location || "Not set"}</p></div><div><p className="text-[10px] text-muted-foreground">Website</p><p className="mt-1 truncate text-xs font-semibold text-primary">{profile.website || "Not set"}</p></div></div></div>
          <div className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between"><h4 className="text-xs font-bold">Recently connected</h4><button onClick={() => setProfileTab("Connections")} className="text-[10px] font-semibold text-primary hover:underline">View all <ArrowRight className="ml-1 inline h-3 w-3" /></button></div><div className="mt-3 flex items-center justify-between rounded-lg border border-border p-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-brand-red/10 text-brand-red">{channel?.thumbnail ? <img src={channel.thumbnail} alt="" className="h-full w-full object-cover" /> : <Youtube className="h-4 w-4" />}</span><div className="min-w-0"><p className="truncate text-xs font-semibold">{channel?.channel_name ?? "YouTube"}</p><p className="text-[10px] text-success">{channelLoading ? "Checking connection…" : channel ? `${channel.subscriber_count.toLocaleString()} subscribers` : "Not connected"}</p></div></div><button onClick={() => window.open(channelUrl, "_blank", "noopener,noreferrer")} disabled={!channel} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[10px] font-semibold disabled:opacity-50">Manage <ExternalLink className="h-3 w-3" /></button></div></div>
          <div className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between"><div><h4 className="text-xs font-bold">Account security</h4><p className="mt-1 text-[10px] text-muted-foreground">Protect your account with two-factor authentication.</p></div><button onClick={onOpenSecurity} className="text-[10px] font-semibold text-primary">Manage <ArrowRight className="ml-1 inline h-3 w-3" /></button></div><div className="mt-3 flex items-center justify-between rounded-lg bg-success/5 p-3"><span className="text-[10px] text-muted-foreground">Two-factor authentication</span><button onClick={onOpenSecurity} className="rounded-full bg-success/10 px-2 py-1 text-[10px] font-bold text-success hover:bg-success/20">Review settings</button></div></div>
        </>}
        {profileTab === "Activity" && <div className="rounded-xl border border-border bg-background p-5 text-xs text-muted-foreground">Your profile activity will appear here as you connect services and update account settings.</div>}
        {profileTab === "Connections" && <div className="rounded-xl border border-border bg-background p-5"><h4 className="text-xs font-bold">Connected services</h4><div className="mt-4 flex items-center justify-between rounded-lg border border-border p-3"><div className="flex min-w-0 items-center gap-3"><Youtube className="h-4 w-4 shrink-0 text-brand-red" /><div className="min-w-0"><p className="truncate text-xs font-semibold">{channel?.channel_name ?? "YouTube"}</p><p className="text-[10px] text-muted-foreground">{channel ? `${channel.subscriber_count.toLocaleString()} subscribers · ${(channel.video_count ?? 0).toLocaleString()} videos · ${(channel.view_count ?? 0).toLocaleString()} views` : "Not connected"}</p></div></div><Link2 className="h-4 w-4 shrink-0 text-muted-foreground" /></div></div>}
        {profileTab === "Preferences" && <div className="space-y-4"><div className="rounded-xl border border-border bg-background p-5"><div className="flex items-center justify-between"><div><h4 className="text-xs font-bold">Appearance</h4><p className="mt-1 text-[10px] text-muted-foreground">Choose how Tubify looks on this device.</p></div><AppearanceModeControl /></div></div><div className="rounded-xl border border-border bg-background p-5"><label className="mb-2 block text-xs font-semibold">Bio</label><textarea rows={4} value={bio} onChange={(event) => setBio(event.target.value)} className="w-full resize-none rounded-lg border border-border bg-accent/20 p-3 text-xs outline-none focus:border-primary" /><button onClick={async () => { try { const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bio: bio || null }) }); const body = (await response.json()) as { data?: ProfileData }; if (!response.ok || !body.data) throw new Error("save_failed"); saveProfile(body.data); setSaved(true); window.setTimeout(() => setSaved(false), 1800); toast.success("Profile preferences saved"); } catch { toast.error("Could not save profile preferences"); } }} className="mt-4 rounded-[var(--button-radius)] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">{saved ? "Saved" : "Save changes"}</button></div></div>}
      </div>
      {editor && <ProfileEditor mode={editor} profile={profile} onClose={() => setEditor(null)} onSaved={saveProfile} />}
    </div>
  );
}

type ProfileEditorMode = "profile" | "about" | "avatar" | "cover";
interface ProfileData { id?: string; name: string | null; email: string | null; avatar: string | null; role?: string; location: string | null; website: string | null; bio: string | null; cover_url: string | null; created_at?: string; updated_at?: string }

function ProfileEditor({ mode, profile, onClose, onSaved }: { mode: ProfileEditorMode; profile: ProfileData; onClose: () => void; onSaved: (profile: ProfileData) => void }) {
  const [values, setValues] = useState({ name: profile.name ?? "", avatar: profile.avatar ?? "", cover_url: profile.cover_url ?? "", location: profile.location ?? "", website: profile.website ?? "", bio: profile.bio ?? "" });
  const [saving, setSaving] = useState(false);
  const title = mode === "avatar" ? "Profile photo" : mode === "cover" ? "Profile cover" : mode === "about" ? "About profile" : "Edit profile";
  const imageField = mode === "avatar" ? "avatar" : "cover_url";
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Images must be 2 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setValues((current) => ({ ...current, [imageField]: reader.result }));
    };
    reader.onerror = () => toast.error("Could not read that image");
    reader.readAsDataURL(file);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = mode === "avatar" ? { avatar: values.avatar || null } : mode === "cover" ? { cover_url: values.cover_url || null } : mode === "about" ? { location: values.location || null, website: values.website || null, bio: values.bio || null } : { name: values.name, avatar: values.avatar || null, location: values.location || null, website: values.website || null, bio: values.bio || null, cover_url: values.cover_url || null };
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json()) as { data?: ProfileData; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "save_failed");
      onSaved(body.data);
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error && error.message === "PROFILE_MIGRATION_REQUIRED" ? "Profile database migration is required" : "Could not update profile");
    } finally {
      setSaving(false);
    }
  };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title"><form onSubmit={save} className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl"><div className="flex items-center justify-between"><h3 id="profile-editor-title" className="text-lg font-semibold">{title}</h3><button type="button" onClick={onClose} aria-label="Close" title="Close" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button></div>{mode !== "avatar" && mode !== "cover" && <label className="block text-xs font-semibold">Name<input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" required maxLength={120} /></label>}{mode !== "avatar" && mode !== "cover" && <label className="block text-xs font-semibold">Location<input value={values.location} onChange={(event) => setValues({ ...values, location: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" maxLength={120} /></label>}{mode !== "avatar" && mode !== "cover" && <label className="block text-xs font-semibold">Website<input type="url" value={values.website} onChange={(event) => setValues({ ...values, website: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="https://" /></label>}{mode !== "avatar" && mode !== "cover" && <label className="block text-xs font-semibold">Bio<textarea value={values.bio} onChange={(event) => setValues({ ...values, bio: event.target.value })} rows={3} className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm" maxLength={500} /></label>}{mode !== "about" && <div className="space-y-2"><label className="block text-xs font-semibold">Image URL<input type="url" value={values[imageField]} onChange={(event) => setValues({ ...values, [imageField]: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="https://" /></label><label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-primary">Upload image<input type="file" accept="image/*" onChange={handleImageUpload} className="sr-only" /></label><p className="text-[10px] text-muted-foreground">PNG, JPEG, WebP, or GIF up to 2 MB.</p></div>}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button></div></form></div>;
}

function AppearanceModeControl() {
  const [mode, setMode] = useThemeMode();
  const options: { key: ThemeMode; label: string; icon: typeof Sun }[] = [
    { key: "system", label: "System theme", icon: Monitor },
    { key: "light", label: "Light theme", icon: Sun },
    { key: "dark", label: "Dark theme", icon: Moon },
  ];

  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-background p-1.5 shadow-inner" role="group" aria-label="Appearance mode">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => setMode(option.key)}
          aria-label={option.label}
          aria-pressed={mode === option.key}
          title={option.label}
          className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${mode === option.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
        >
          <option.icon className="h-5 w-5" strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

function AppearancePanel() {
  return (
    <div className="relative rounded-xl card-gradient-outline p-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-lg font-semibold">Appearance</h3>
      <p className="mt-1 text-sm text-muted-foreground">Choose how Tubify looks on this device.</p>

      <div className="mt-5 flex justify-center"><AppearanceModeControl /></div>
    </div>
  );
}

function ConnectedAccountsPanel() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<ConnectedYoutubeChannel[]>([]);
  const [activeChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState<ExternalProvider | null>(null);

  useEffect(() => {
    fetch("/api/youtube/channels")
      .then(async (response) => {
        const body = (await response.json()) as { data?: ConnectedYoutubeChannel[] };
        setChannels(response.ok ? body.data ?? [] : []);
      })
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
    fetch("/api/integrations")
      .then(async (response) => {
        const body = (await response.json()) as { data?: ExternalIntegration[] };
        setIntegrations(response.ok ? body.data ?? [] : []);
      })
      .catch(() => setIntegrations([]))
      .finally(() => setIntegrationsLoading(false));
    const status = new URL(window.location.href).searchParams.get("integration");
    if (status === "google_analytics" || status === "stripe" || status === "kit") toast.success(`${status === "google_analytics" ? "Google Analytics" : status === "stripe" ? "Stripe" : "Kit"} connected`);
    if (status === "storage_failed") toast.error("Connection succeeded but could not be saved");
    if (status === "invalid_state") toast.error("That connection request expired. Try again.");
    if (status) {
      const url = new URL(window.location.href);
      url.searchParams.delete("integration");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const disconnectYoutube = async () => {
    const channel = channels.find((item) => item.id === activeChannelId) ?? channels[0];
    if (!channel) return;
    setDisconnecting(true);
    try {
      const response = await fetch(`/api/youtube/channels?id=${channel.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("disconnect_failed");
      setChannels((current) => current.filter((item) => item.id !== channel.id));
      toast.success("YouTube disconnected");
    } catch {
      toast.error("Couldn't disconnect YouTube. Try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  const googleConnected = integrations.some((item) => item.provider === "google_analytics");
  const connectExternal = async (provider: ExternalProvider) => {
    setConnecting(provider);
    try {
      const response = await fetch(`/api/integrations?provider=${provider}`, { method: "POST" });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "connect_failed");
      window.location.href = body.url;
    } catch (error) {
      toast.error(error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED" ? `${provider === "stripe" ? "Stripe" : "Kit"} integration is not configured` : "Could not start connection");
      setConnecting(null);
    }
  };
  const disconnectExternal = async (provider: ExternalProvider) => {
    setConnecting(provider);
    try {
      const response = await fetch(`/api/integrations?provider=${provider}`, { method: "DELETE" });
      if (!response.ok) throw new Error("disconnect_failed");
      setIntegrations((current) => current.filter((item) => item.provider !== provider));
      toast.success(`${provider === "stripe" ? "Stripe" : "Kit"} disconnected`);
    } catch { toast.error("Could not disconnect integration"); }
    finally { setConnecting(null); }
  };
  const stripeConnected = integrations.some((item) => item.provider === "stripe");
  const kitConnected = integrations.some((item) => item.provider === "kit");

  const accounts = [
    {
      title: "YouTube",
      domain: "youtube.com",
      logo: "https://cdn.simpleicons.org/youtube",
      iconClass: "text-brand-red",
      description: loading ? "Checking connection…" : channels.length ? `${channels.length} linked channel${channels.length === 1 ? "" : "s"} · ${channels.find((item) => item.id === activeChannelId)?.channel_name ?? channels[0].channel_name}` : "Link one or more YouTube channels",
      connected: channels.length > 0,
      action: channels.length ? disconnectYoutube : () => { window.location.href = "/api/youtube/auth?returnTo=/settings"; },
      actionLabel: channels.length ? (disconnecting ? "Disconnecting…" : "Disconnect active") : "Connect",
      disabled: loading || disconnecting,
    },
    {
      title: "Google Analytics",
      domain: "analytics.google.com",
      logo: "https://cdn.simpleicons.org/googleanalytics",
      iconClass: "text-brand-blue",
      description: googleConnected ? "Connected through your YouTube Google authorization." : "Connect YouTube to authorize Analytics access.",
      connected: googleConnected,
      action: googleConnected ? () => navigate({ to: "/analytics" }) : () => void connectExternal("google_analytics"),
      actionLabel: googleConnected ? "Open Analytics" : "Connect",
      disabled: integrationsLoading || connecting !== null,
    },
    {
      title: "Stripe",
      domain: "stripe.com",
      logo: "https://cdn.simpleicons.org/stripe",
      iconClass: "text-brand-purple",
      description: "Manage your subscription and billing workspace.",
      connected: stripeConnected,
      action: stripeConnected ? () => void disconnectExternal("stripe") : () => void connectExternal("stripe"),
      actionLabel: connecting === "stripe" ? "Working…" : stripeConnected ? "Disconnect" : "Connect Stripe",
      disabled: integrationsLoading || connecting !== null,
    },
    {
      title: "ConvertKit",
      domain: "convertkit.com",
      logo: "https://cdn.simpleicons.org/kit",
      logoClass: "dark:invert",
      iconClass: "text-brand-amber",
      description: "Manage email campaigns from the Email workspace.",
      connected: kitConnected,
      action: kitConnected ? () => void disconnectExternal("kit") : () => void connectExternal("kit"),
      actionLabel: connecting === "kit" ? "Working…" : kitConnected ? "Disconnect" : "Connect Kit",
      disabled: integrationsLoading || connecting !== null,
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl card-gradient-outline p-5 sm:p-8">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Link2 className="h-4 w-4" /></span>
              <h3 className="text-xl font-semibold tracking-tight">Sync profiles</h3>
            </div>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">Connect your other profiles to keep your creator presence in sync.</p>
          </div>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{channels.length ? `${channels.length} YouTube channel${channels.length === 1 ? "" : "s"} connected` : "Connect YouTube"}</span>
        </div>

        <div className="mt-6 space-y-2">
        {accounts.map((account) => (
          <div key={account.title} className="group flex flex-col gap-4 rounded-xl border border-border bg-background/70 p-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-accent/50">
                <img src={account.logo} alt={`${account.title} logo`} className={`h-6 w-6 object-contain ${account.logoClass ?? ""}`} loading="lazy" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{account.title}</p>
                <p className="text-xs text-muted-foreground">https://{account.domain}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{account.description}</p>
              </div>
            </div>
            <button
              onClick={account.action}
              disabled={account.disabled}
              className={`w-full rounded-lg px-4 py-2 text-xs font-semibold transition sm:w-auto sm:min-w-24 ${
                (account.title === "YouTube" || account.title === "Stripe" || account.title === "ConvertKit") && account.connected
                  ? "border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15"
                  : "border border-border bg-accent/40 text-foreground hover:border-primary/50 hover:bg-primary/10"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {account.actionLabel}
            </button>
          </div>
        ))}
        </div>

      </div>
    </div>
  );
}

interface ConnectedYoutubeChannel {
  id: string;
  youtube_channel_id: string;
  channel_name: string;
  channel_handle: string | null;
  thumbnail: string | null;
  subscriber_count: number;
  view_count?: number;
  video_count?: number;
  uploads_playlist_id?: string | null;
  connected_at: string;
  last_synced_at: string | null;
  last_sync_status: "never_synced" | "syncing" | "success" | "partial" | "failed" | "reauth_required";
  last_sync_error: string | null;
}

type ExternalProvider = "google_analytics" | "stripe" | "kit";
interface ExternalIntegration {
  id: string;
  provider: ExternalProvider;
  provider_account_id: string | null;
  account_name: string | null;
  metadata: Record<string, unknown>;
  connected_at: string;
  updated_at: string;
}

const YOUTUBE_CALLBACK_MESSAGES: Record<string, { type: "success" | "error"; text: string }> = {
  connected: { type: "success", text: "YouTube channel connected." },
  denied: { type: "error", text: "YouTube connection was cancelled." },
  invalid_state: { type: "error", text: "That connection request expired or was invalid — try again." },
  reauthorize_required: { type: "error", text: "Please reconnect and approve access again." },
  storage_failed: { type: "error", text: "We couldn't save your YouTube connection. Try again." },
  error: { type: "error", text: "Something went wrong connecting YouTube." },
};

function YouTubeIntegrationPanel() {
  const [channels, setChannels] = useState<ConnectedYoutubeChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useLocalStore<string | null>(ACTIVE_YOUTUBE_CHANNEL_KEY, null);
  const [integrationSettings, setIntegrationSettings] = useState({ auto_sync_videos: true, import_analytics: true, sync_comments: false, import_chapters: true });
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSetting, setSavingSetting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const loadChannels = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/youtube/channels");
      const body = (await response.json()) as { data?: ConnectedYoutubeChannel[] };
      const nextChannels = response.ok ? (body.data ?? []) : [];
      setChannels(nextChannels);
      if (nextChannels.length && (!activeChannelId || !nextChannels.some((channel) => channel.id === activeChannelId))) {
        setActiveChannelId(nextChannels[0].id);
      }
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  };

  const loadIntegrationSettings = async () => {
    setSettingsLoading(true);
    try {
      const query = activeChannelId ? `?channelId=${encodeURIComponent(activeChannelId)}` : "";
      const response = await fetch(`/api/youtube/settings${query}`);
      const body = (await response.json()) as { data?: typeof integrationSettings };
      if (response.ok && body.data) setIntegrationSettings(body.data);
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    const status = new URL(window.location.href).searchParams.get("youtube");
    const message = status ? YOUTUBE_CALLBACK_MESSAGES[status] : undefined;
    if (message) {
      if (message.type === "success") toast.success(message.text);
      else toast.error(message.text);
      const url = new URL(window.location.href);
      url.searchParams.delete("youtube");
      window.history.replaceState({}, "", url.toString());
    }
    void loadChannels();
  }, []);

  useEffect(() => {
    void loadIntegrationSettings();
  }, [activeChannelId]);

  const updateIntegrationSetting = async (key: keyof typeof integrationSettings, value: boolean) => {
    const previous = integrationSettings;
    const next = { ...previous, [key]: value };
    setIntegrationSettings(next);
    setSavingSetting(key);
    try {
      const query = activeChannelId ? `?channelId=${encodeURIComponent(activeChannelId)}` : "";
      const response = await fetch(`/api/youtube/settings${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = (await response.json()) as { data?: typeof integrationSettings };
      if (!response.ok || !body.data) throw new Error("settings_failed");
      setIntegrationSettings(body.data);
      toast.success("YouTube setting saved");
    } catch {
      setIntegrationSettings(previous);
      toast.error("Couldn't save YouTube setting. Try again.");
    } finally {
      setSavingSetting(null);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const query = activeChannelId ? `?channelId=${encodeURIComponent(activeChannelId)}` : "";
      const response = await fetch(`/api/youtube/sync${query}`, { method: "POST" });
      const body = (await response.json()) as { status?: string; result?: Record<string, string>; error?: string };
      if (!response.ok) throw new Error(body.error ?? "sync_failed");
      await loadChannels();
      toast.success(body.status === "partial" ? "YouTube sync completed with warnings" : "YouTube sync complete");
    } catch (error) {
      toast.error(error instanceof Error && error.message === "YOUTUBE_NOT_CONNECTED" ? "Connect YouTube before syncing." : "YouTube sync couldn't be completed.");
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async (id: string) => {
    setDisconnectingId(id);
    try {
      const response = await fetch(`/api/youtube/channels?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("DELETE_FAILED");
      toast.success("YouTube channel disconnected");
      await loadChannels();
    } catch {
      toast.error("Couldn't disconnect that channel. Try again.");
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">YouTube Integration</h3>
        <p className="mt-1 text-sm text-muted-foreground">Manage your channel sync settings and data imports.</p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-accent/20 p-5 text-sm text-muted-foreground">Loading connection status…</div>
      ) : channels.length === 0 ? (
        <div className="rounded-xl border border-border bg-accent/20 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-3xl bg-accent text-muted-foreground">
                <Youtube className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">No channel connected</p>
                <p className="text-sm text-muted-foreground">Connect your YouTube channel to enable analytics and revenue sync.</p>
              </div>
            </div>
            <a
              href="/api/youtube/auth"
              className="rounded-[var(--button-radius)] bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Connect YouTube Channel
            </a>
          </div>
        </div>
      ) : (
        channels.map((channel) => (
              <div key={channel.id} className={`rounded-xl border p-5 ${channel.id === activeChannelId ? "border-primary/60 bg-primary/5" : "border-border bg-accent/20"}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                {channel.thumbnail ? (
                  <img src={channel.thumbnail} alt={channel.channel_name} className="h-14 w-14 rounded-3xl object-cover" />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded-3xl bg-brand-red text-white">
                    <Youtube className="h-6 w-6" />
                  </div>
                )}
                <div>
                  <p className="font-semibold">{channel.channel_name}</p>
                  <p className="text-sm text-muted-foreground">{channel.subscriber_count.toLocaleString()} subscribers</p>
                  <p className={`mt-1 text-sm ${channel.last_sync_status === "failed" || channel.last_sync_status === "reauth_required" ? "text-destructive" : channel.last_sync_status === "partial" ? "text-warning" : "text-success"}`}>
                    {channel.last_sync_status === "syncing" ? "Syncing…" : channel.last_sync_status === "reauth_required" ? "Reconnect required" : channel.last_sync_status === "failed" ? "Sync failed" : channel.last_sync_status === "partial" ? "Partially synced" : channel.last_synced_at ? `Connected · last synced ${new Date(channel.last_synced_at).toLocaleString()}` : "Connected · Not synced yet"}
                  </p>
                </div>
              </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setActiveChannelId(channel.id)}
                      disabled={channel.id === activeChannelId || syncing}
                      className="rounded-[var(--button-radius)] border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-60"
                    >
                      {channel.id === activeChannelId ? "Active channel" : "Use this channel"}
                    </button>
                    <button
                onClick={() => disconnect(channel.id)}
                disabled={disconnectingId === channel.id || syncing}
                className="rounded-[var(--button-radius)] border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-60"
              >
                {disconnectingId === channel.id ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                </div>
              </div>
        ))
      )}

      <div className="space-y-4">
        {([
          ["auto_sync_videos", "Auto-sync videos", "Keep your channel videos up to date automatically."],
          ["import_analytics", "Import analytics data", "Fetch watch time, revenue, and engagement stats."],
          ["sync_comments", "Sync comment data", "Import comments for sentiment and reply tracking."],
          ["import_chapters", "Import chapter markers", "Pull chapter timestamps from your video descriptions."],
        ] as const).map(([key, label, description]) => (
          <div key={key} className="flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{label}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <Switch checked={integrationSettings[key]} disabled={loading || settingsLoading || !channels.length || savingSetting !== null || syncing} onCheckedChange={(value) => void updateIntegrationSetting(key, value)} />
          </div>
        ))}
      </div>

      {channels.length > 0 && (
        <button onClick={() => void syncNow()} disabled={syncing || loading || savingSetting !== null} className="flex items-center gap-2 rounded-[var(--button-radius)] border border-border px-4 py-2 text-sm font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      )}
    </div>
  );
}

function NotificationsPanel() {
  const notificationOptions = [
    { key: "revenue", label: "Revenue milestones", description: "Get notified when you hit new revenue records", enabled: true },
    { key: "deals", label: "Brand deal updates", description: "Alerts for deal status changes and deadlines", enabled: true },
    { key: "videos", label: "Video performance alerts", description: "CTR drops, viral spikes, and view milestones", enabled: true },
    { key: "ai", label: "AI optimization ready", description: "When AI descriptions are ready for review", enabled: false },
    { key: "digest", label: "Weekly digest", description: "Weekly performance summary via email", enabled: true },
    { key: "payments", label: "Payment processed", description: "AdSense and affiliate payment confirmations", enabled: true },
  ];
  const [preferences, setPreferences] = useLocalStore<Record<string, boolean>>("yroos.notificationPreferences", Object.fromEntries(notificationOptions.map((item) => [item.key, item.enabled])));

  return (
    <div className="relative rounded-xl card-gradient-outline p-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-lg font-semibold">Notification Preferences</h3>
      <p className="mt-1 text-sm text-muted-foreground">Choose which notifications you want to receive.</p>

      <div className="mt-6 space-y-4">
        {notificationOptions.map((item) => (
          <div key={item.label} className="flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{item.label}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            <Switch checked={preferences[item.key] ?? item.enabled} onCheckedChange={(value) => setPreferences((current) => ({ ...current, [item.key]: value }))} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BillingPanel() {
  const features = ["Unlimited videos", "AI descriptions", "Advanced analytics"];

  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-lg font-semibold">
            Pro Plan <span className="ml-2 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">Active</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Everything you need to keep your creator business growing.</p>
        </div>
        <p className="text-3xl font-semibold">$79<span className="ml-1 text-sm font-medium text-muted-foreground">/mo</span></p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {features.map((feature) => (
          <div key={feature} className="flex items-center gap-3 rounded-xl border border-border bg-accent/20 p-4">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
              <Check className="h-4 w-4" />
            </span>
            <p className="text-sm font-medium">{feature}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-accent/20 p-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Billing and payment method</p>
          <p className="text-sm text-muted-foreground">Manage your plan and payment method in the billing workspace.</p>
        </div>
        <Link
          to="/billing"
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:mt-0"
        >
          Manage billing
        </Link>
      </div>
    </div>
  );
}

function SecurityPanel() {
  const [newPassword, setNewPassword] = useState("");
  const [updating, setUpdating] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaFactor, setMfaFactor] = useState<{ id: string; friendlyName: string | null } | null>(null);
  const [pendingEnrollment, setPendingEnrollment] = useState<{ id: string; qrCode: string; secret: string } | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryRemaining, setRecoveryRemaining] = useState<number | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const verificationInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const loadMfaFactor = async () => {
    setMfaLoading(true);
    try {
      const { data, error } = await listMfaFactors();
      if (error) throw error;
      const factor = data.totp.find((item: { id: string; status: string; friendly_name?: string | null }) => item.status === "verified");
      setMfaFactor(factor ? { id: factor.id, friendlyName: factor.friendly_name } : null);
      if (factor) {
        const response = await fetch("/api/security/recovery-codes");
        const body = (await response.json()) as { remaining?: number };
        if (response.ok) setRecoveryRemaining(body.remaining ?? 0);
      } else {
        setRecoveryRemaining(null);
      }
    } catch {
      toast.error("Couldn't load two-factor authentication settings.");
    } finally {
      setMfaLoading(false);
    }
  };

  useEffect(() => {
    void loadMfaFactor();
  }, []);

  const handlePasswordUpdate = async () => {
    if (newPassword.length < 8) {
      toast.error("Use at least 8 characters for your new password.");
      return;
    }
    setUpdating(true);
    const { error } = await updatePassword(newPassword);
    setUpdating(false);
    if (error) {
      toast.error("Couldn't update your password. Try again.");
      return;
    }
    setNewPassword("");
    toast.success("Password updated");
  };

  const beginMfaEnrollment = async () => {
    setMfaSubmitting(true);
    try {
      const { data, error } = await enrollTotpFactor("Tubify");
      if (error || !data?.totp) throw error ?? new Error("enrollment_failed");
      setPendingEnrollment({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      toast.error("Couldn't start two-factor authentication. Try again.");
    } finally {
      setMfaSubmitting(false);
    }
  };

  const verifyMfaEnrollment = async () => {
    if (!pendingEnrollment || !/^\d{6}$/.test(verificationCode)) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setMfaSubmitting(true);
    try {
      const { data: challenge, error: challengeError } = await challengeMfaFactor(pendingEnrollment.id);
      if (challengeError || !challenge) throw challengeError ?? new Error("challenge_failed");
      const { error } = await verifyMfaFactor(pendingEnrollment.id, challenge.id, verificationCode);
      if (error) throw error;
      setPendingEnrollment(null);
      setVerificationCode("");
      await loadMfaFactor();
      const recoveryResponse = await fetch("/api/security/recovery-codes", { method: "POST" });
      const recoveryBody = (await recoveryResponse.json()) as { codes?: string[] };
      if (!recoveryResponse.ok || !recoveryBody.codes) throw new Error("recovery_codes_failed");
      setRecoveryCodes(recoveryBody.codes);
      setRecoveryRemaining(recoveryBody.codes.length);
      toast.success("Two-factor authentication enabled");
    } catch {
      toast.error("That code was not accepted. Check your authenticator app and try again.");
    } finally {
      setMfaSubmitting(false);
    }
  };

  const removeMfa = async () => {
    if (!mfaFactor) return;
    if (!/^\d{6}$/.test(disableCode)) {
      toast.error("Enter the current 6-digit code from your authenticator app.");
      return;
    }
    setMfaSubmitting(true);
    try {
      const { data: challenge, error: challengeError } = await challengeMfaFactor(mfaFactor.id);
      if (challengeError || !challenge) throw challengeError ?? new Error("challenge_failed");
      const { error: verifyError } = await verifyMfaFactor(mfaFactor.id, challenge.id, disableCode);
      if (verifyError) throw verifyError;
      const { error } = await unenrollMfaFactor(mfaFactor.id);
      if (error) throw error;
      setMfaFactor(null);
      setDisableCode("");
      setDisableOpen(false);
      setRecoveryCodes(null);
      setRecoveryRemaining(null);
      toast.success("Two-factor authentication disabled");
    } catch {
      toast.error("Couldn't disable two-factor authentication. Try again.");
    } finally {
      setMfaSubmitting(false);
    }
  };

  const regenerateRecoveryCodes = async () => {
    if (!window.confirm("Generating new recovery codes will permanently invalidate your existing recovery codes. Continue?")) return;
    setMfaSubmitting(true);
    try {
      const response = await fetch("/api/security/recovery-codes", { method: "POST" });
      const body = (await response.json()) as { codes?: string[] };
      if (!response.ok || !body.codes) throw new Error("recovery_codes_failed");
      setRecoveryCodes(body.codes);
      setRecoveryRemaining(body.codes.length);
      toast.success("New recovery codes generated");
    } catch {
      toast.error("Couldn't generate recovery codes. Verify your session and try again.");
    } finally {
      setMfaSubmitting(false);
    }
  };

  return (
    <div className="relative space-y-4">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Security</h3>
            <p className="mt-1 text-xs text-muted-foreground">Manage your account security and keep your data protected.</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-background p-4 sm:p-5">
          <div>
            <h4 className="text-sm font-bold">Password</h4>
            <p className="mt-1 text-xs text-muted-foreground">Update your password regularly to keep your account secure.</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="password" autoComplete="current-password" placeholder="Current password" className="h-11 rounded-[var(--input-radius)] border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary" />
            <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" className="h-11 rounded-[var(--input-radius)] border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary" />
          </div>
          <button onClick={() => void handlePasswordUpdate()} disabled={updating} className="mt-4 rounded-[var(--button-radius)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {updating ? "Updating…" : "Update password"}
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-background p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold">Two-factor authentication (2FA)</h4>
                {!mfaLoading && mfaFactor && <span className="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success">2FA is enabled <span aria-hidden="true">●</span></span>}
              </div>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Add an extra layer of security to your account. You'll be asked for a verification code each time you sign in on a new device.</p>
            </div>
            {!mfaLoading && !mfaFactor && <button onClick={() => void beginMfaEnrollment()} disabled={mfaSubmitting} className="shrink-0 rounded-[var(--button-radius)] bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{mfaSubmitting ? "Starting…" : "Enable 2FA"}</button>}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-success/5 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-success/10 text-success"><Smartphone className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="text-xs font-bold">Authenticator app</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Use an authenticator app like Google Authenticator, Microsoft Authenticator, or 1Password to generate 6-digit verification codes.</p>
                  {mfaFactor && <p className="mt-3 text-[10px] text-muted-foreground">Enabled on <strong className="text-foreground">{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong></p>}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="text-xs font-bold">Recovery codes</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Use recovery codes to sign in if you lose access to your authenticator app or device.</p>
                  {mfaFactor && <p className="mt-3 text-[10px] text-muted-foreground"><strong className="text-foreground">{recoveryRemaining ?? 0} codes available</strong></p>}
                </div>
              </div>
            </div>
          </div>

          {mfaFactor && (<div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button onClick={() => setRecoveryCodes(recoveryCodes)} className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold hover:border-primary">View recovery codes <ArrowRight className="ml-1 inline h-3 w-3" /></button>
            <button onClick={() => void regenerateRecoveryCodes()} disabled={mfaSubmitting} className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold hover:border-primary disabled:opacity-60">Regenerate codes</button>
            <button onClick={() => setDisableOpen((open) => !open)} disabled={mfaSubmitting} className="rounded-lg border border-destructive/30 px-3 py-2 text-[11px] font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-60">Disable 2FA</button>
          </div>)}

        {recoveryCodes && (
          <div className="mt-5 rounded-xl border border-warning/30 bg-warning/5 p-4">
            <p className="font-semibold">Save your recovery codes</p>
            <p className="mt-1 text-sm text-muted-foreground">These codes are shown once. Store them somewhere secure in case you lose access to your authenticator app.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-background p-3 font-mono text-sm sm:grid-cols-5">
              {recoveryCodes.map((code) => <span key={code}>{code}</span>)}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))} className="rounded-[var(--button-radius)] bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Copy codes</button>
              <button onClick={() => { const blob = new Blob([`Tubify recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "tubify-recovery-codes.txt"; link.click(); URL.revokeObjectURL(link.href); }} className="rounded-[var(--button-radius)] border border-border px-3 py-2 text-sm font-semibold">Download</button>
            </div>
          </div>
        )}

        {disableOpen && mfaFactor && (
          <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="font-semibold">Disable two-factor authentication?</p>
            <p className="mt-1 text-sm text-muted-foreground">This makes your account less secure. Enter a current authenticator code to continue.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, ""))} className="h-11 rounded-[var(--input-radius)] border border-border bg-background px-4 text-sm tracking-[0.3em] outline-none focus:border-primary" placeholder="000000" />
              <button onClick={() => void removeMfa()} disabled={mfaSubmitting} className="rounded-[var(--button-radius)] bg-destructive px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Disable 2FA</button>
            </div>
          </div>
        )}
      </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between"><div><h4 className="text-sm font-bold">Recent security activity</h4><p className="mt-1 text-xs text-muted-foreground">Keep an eye on important changes to your account.</p></div><button className="rounded-lg border border-border px-3 py-2 text-[10px] font-semibold">View all activity</button></div>
        <div className="mt-4 divide-y divide-border">{[{ icon: ShieldCheck, title: "Successful sign in", detail: "Current session · Chrome on Windows · Lagos, Nigeria", color: "text-success bg-success/10" }, { icon: ShieldCheck, title: "2FA enabled", detail: "Authenticator app · Security settings", color: "text-primary bg-primary/10" }, { icon: KeyRound, title: "Recovery codes generated", detail: "10 codes generated · Security settings", color: "text-primary bg-primary/10" }].map((event) => <div key={event.title} className="flex items-center gap-3 py-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${event.color}`}><event.icon className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">{event.title}</p><p className="truncate text-[10px] text-muted-foreground">{event.detail}</p></div><MoreVertical className="h-3.5 w-3.5 text-muted-foreground" /></div>)}</div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleHelp className="h-4 w-4" /></span><div><p className="text-xs font-bold">Need help?</p><p className="mt-1 text-[10px] text-muted-foreground">Lost access to your authenticator app or recovery codes?</p></div></div><Link to="/support" className="rounded-lg border border-border px-3 py-2 text-[10px] font-semibold">Contact support <ArrowRight className="ml-1 inline h-3 w-3" /></Link></div>

      <details className="rounded-xl border border-border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
          <div><h4 className="text-sm font-bold">How two-factor authentication works</h4><p className="mt-1 text-xs text-muted-foreground">A simple extra check keeps your account protected.</p></div>
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
        </summary>
        <div className="border-t border-border p-4 sm:p-5">
          <div className="grid gap-5 md:grid-cols-3">
            {[{ n: "1", title: "Enter your password", desc: "Sign in to your Tubify account using your password." }, { n: "2", title: "Enter verification code", desc: "Enter the 6-digit code from your authenticator app." }, { n: "3", title: "You're signed in", desc: "Access your account securely after verification." }].map((step) => <div key={step.n} className="relative text-center"><span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-destructive/10 text-[11px] font-bold text-destructive">{step.n}</span><p className="mt-3 text-xs font-bold">{step.title}</p><p className="mx-auto mt-1 max-w-[170px] text-[10px] leading-4 text-muted-foreground">{step.desc}</p>{step.n !== "3" && <ArrowRight className="absolute right-0 top-1 h-4 w-4 text-muted-foreground/50 max-md:hidden" />}</div>)}
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-lg bg-primary/5 p-3 text-[11px] leading-4 text-primary"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />Two-factor authentication significantly increases the security of your account by protecting it from unauthorized access, even if someone knows your password.</div>
        </div>
      </details>

      {pendingEnrollment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="setup-authenticator-title">
          <div className="w-full max-w-[480px] rounded-xl border border-white/10 bg-[#111111] p-6 text-white shadow-2xl sm:p-7">
            <div className="flex items-center justify-between">
              <h2 id="setup-authenticator-title" className="text-lg font-medium">Setup authenticator app</h2>
              <button onClick={() => { setPendingEnrollment(null); setVerificationCode(""); }} aria-label="Close setup dialog" title="Close" className="text-white/80 hover:text-white"><X className="h-6 w-6" /></button>
            </div>

            <div className="mt-8 flex items-center gap-3"><ScanLine className="h-6 w-6 text-white/80" /><h3 className="text-lg font-medium">Scan QR code</h3></div>
            <p className="mt-1 text-sm leading-6 text-white/45">Scan the QR code below or manually enter the secret key into your authenticator app.</p>

            <div className="mt-5 flex gap-5 rounded-xl border border-white/15 bg-white/[0.03] p-4 sm:items-center">
              <div className="grid h-32 w-32 shrink-0 place-items-center rounded-lg bg-white p-2 sm:h-36 sm:w-36"><img src={pendingEnrollment.qrCode} alt="Authenticator app setup QR code" className="h-full w-full" /></div>
              <div className="min-w-0 flex-1"><label className="block text-sm text-white/90">Can’t scan? Enter code manually:</label><code className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-white/15 bg-black/20 px-3 py-3 text-xs text-white/90">{pendingEnrollment.secret}</code><button onClick={() => void navigator.clipboard.writeText(pendingEnrollment.secret)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10"><Copy className="h-4 w-4" /> Copy code</button></div>
            </div>

            <div className="mt-8 flex items-center gap-3"><KeyRound className="h-5 w-5 text-white/75" /><h3 className="text-lg font-medium">Enter verification code</h3></div>
            <p className="mt-1 text-sm text-white/45">Enter the 6-digit code on your authenticator app.</p>
            <div className="mt-5 grid grid-cols-6 gap-2.5">
              {Array.from({ length: 6 }, (_, index) => <input key={index} ref={(element) => { verificationInputRefs.current[index] = element; }} autoFocus={index === 0} inputMode="numeric" maxLength={1} value={verificationCode[index] ?? ""} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(-1); const next = verificationCode.split(""); next[index] = digit; setVerificationCode(next.join("").slice(0, 6)); if (digit && index < 5) verificationInputRefs.current[index + 1]?.focus(); }} onKeyDown={(event) => { if (event.key === "Backspace" && !verificationCode[index] && index > 0) verificationInputRefs.current[index - 1]?.focus(); }} className="h-14 min-w-0 rounded-lg border border-white/15 bg-white/[0.04] text-center text-2xl text-white outline-none focus:border-primary" aria-label={`Verification digit ${index + 1}`} />)}
            </div>

            <div className="mt-8 flex justify-between gap-3"><button onClick={() => { setPendingEnrollment(null); setVerificationCode(""); }} className="rounded-lg bg-white/[0.07] px-4 py-3 text-sm font-semibold text-white/65 hover:bg-white/10">Cancel</button><button onClick={() => void verifyMfaEnrollment()} disabled={mfaSubmitting} className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{mfaSubmitting ? "Verifying…" : "Verify"}</button></div>
          </div>
        </div>
      )}

    </div>
  );
}

function Field({ label, value, readOnly = false }: { label: string; value: string; readOnly?: boolean }) {
  return (
    <div>
      <label className="mb-2 block text-sm text-muted-foreground">{label}</label>
      <input readOnly={readOnly} value={value} className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary read-only:cursor-default read-only:opacity-80" />
    </div>
  );
}

function DashboardBannerPanel() {
  const { settings, update } = useChannelSettings();
  const [saved, setSaved] = useState(false);

  const toggles: { key: "showName" | "showSubscribers" | "showAvatar" | "showVisitButton" | "showRecentPosts"; label: string; description: string }[] = [
    { key: "showName", label: "Channel name", description: "Show your YouTube channel name on the banner." },
    { key: "showSubscribers", label: "Subscriber count", description: "Display your subscriber total next to the name." },
    { key: "showAvatar", label: "Channel avatar", description: "Show your channel profile picture on the banner." },
    { key: "showVisitButton", label: "Visit channel button", description: "Show a button that opens your YouTube channel." },
    { key: "showRecentPosts", label: "Recent videos", description: "Show a preview grid of your recently published videos." },
  ];

  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">Dashboard Banner</h3>
        <p className="mt-1 text-sm text-muted-foreground">Customize what information and actions appear in your dashboard banner.</p>
      </div>

      <div className="space-y-4">
        {toggles.map((t) => (
          <div key={t.key} className="flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{t.label}</p>
              <p className="text-sm text-muted-foreground">{t.description}</p>
            </div>
            <Switch checked={settings[t.key]} onCheckedChange={(v) => update({ [t.key]: v })} />
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          try {
            // Re-persist current settings to surface any storage error.
            update({});
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
            toast.success("Dashboard banner saved", {
              description: "Your channel banner preferences were persisted.",
            });
          } catch (err) {
            toast.error("Couldn't save banner settings", {
              description: err instanceof Error ? err.message : "Local storage is unavailable.",
            });
          }
        }}
        className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {saved ? <><Check className="h-4 w-4" /> Saved</> : "Save changes"}
      </button>
    </div>
  );
}

function OAuthScopesPanel() {
  const scopes = [
    { name: "YouTube channel data", scope: "youtube.readonly", purpose: "Read your channel, videos, thumbnails, and public statistics." },
    { name: "YouTube Analytics", scope: "yt-analytics.readonly", purpose: "Read views, watch time, engagement, and audience metrics." },
    { name: "YouTube revenue analytics", scope: "yt-analytics-monetary.readonly", purpose: "Read estimated revenue and RPM where YouTube makes this information available." },
  ];
  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">Google &amp; YouTube Access</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Tubify requests only the permissions needed to sync your connected YouTube channel and analytics.
        </p>
      </div>
      <div className="space-y-3">
        {scopes.map((s) => (
          <div key={s.name} className="flex flex-col gap-2 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{s.name}</p>
              <code className="text-xs text-muted-foreground">{s.scope}</code>
              <p className="mt-1 text-sm text-muted-foreground">{s.purpose}</p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Required</span>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          Your YouTube connection can be removed at any time from Connected Accounts. Credentials are encrypted on the server and are never displayed here.
        </p>
      </div>
    </div>
  );
}

function CompliancePanel() {
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteAccount = () => {
    clearAllStores();
    toast.success("Local workspace data cleared", { description: "Your locally stored Tubify data has been erased." });
    setDeleteOpen(false);
    setTimeout(() => navigate({ to: "/landing" }), 400);
  };

  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">Privacy &amp; Data</h3>
        <p className="mt-1 text-sm text-muted-foreground">Manage your data, privacy preferences, and locally stored information.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          onClick={() => {
            const exportData = Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("yroos.")));
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "tubify-data-export.json";
            link.click();
            URL.revokeObjectURL(url);
            toast.success("Data export downloaded");
          }}
          className="rounded-xl border border-border bg-accent/20 p-4 text-left hover:border-primary"
        >
          <p className="text-sm font-semibold">Export my data</p>
          <p className="mt-1 text-xs text-muted-foreground">Download your Tubify data as a JSON archive.</p>
        </button>
        <button
          onClick={() => {
            localStorage.removeItem("tubify_cookie_consent");
            toast.success("Cookie choice reset", { description: "The cookie notice will appear again on the public landing page." });
          }}
          className="rounded-xl border border-border bg-accent/20 p-4 text-left hover:border-primary"
        >
          <p className="text-sm font-semibold">Manage consents</p>
          <p className="mt-1 text-xs text-muted-foreground">Control tracking, analytics, and AI-processing preferences.</p>
        </button>
        <button
          onClick={() => setDeleteOpen(true)}
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-left hover:border-destructive"
        >
          <p className="text-sm font-semibold text-destructive">Clear local data</p>
          <p className="mt-1 text-xs text-muted-foreground">Remove locally stored workspace data from this browser.</p>
        </button>
      </div>
      <div className="border-t border-border pt-5">
        <h4 className="text-sm font-semibold">Privacy &amp; Security</h4>
        <div className="mt-3 flex flex-col items-start gap-2 text-sm">
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <a href="/privacy#security" className="text-primary hover:underline">Security &amp; Data Protection</a>
          <a href="/privacy#sharing" className="text-primary hover:underline">Data Processing / Subprocessors</a>
        </div>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Clear local workspace data?"
        description="This permanently erases your profile preferences, channel settings, deals, leads, and other locally stored records from this browser. This cannot be undone."
        confirmLabel="Clear local data"
        onConfirm={deleteAccount}
      />
    </div>
  );
}


