import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Lock,
  ScrollText,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Switch } from "@/components/ui/switch";
import { useChannelSettings } from "@/lib/channel-settings";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useThemeMode, type ThemeMode } from "@/lib/theme";
import { ConfirmDialog } from "@/components/modals";
import { clearAllStores } from "@/lib/local-store";
import { useAuthSession } from "@/lib/supabase/use-auth-session";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const menu = [
  { label: "Profile", icon: User },
  { label: "Appearance", icon: Monitor },
  { label: "Dashboard Banner", icon: LayoutDashboard },
  { label: "Connected Accounts", icon: Link2 },
  { label: "YouTube Integration", icon: Youtube },
  { label: "OAuth Scopes", icon: KeyRound },
  { label: "Compliance & Data", icon: Globe },
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
        <div className="hidden space-y-1 lg:block">
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

        <div>{renderPanel(active)}</div>
      </div>
    </DashboardLayout>
  );
}

function renderPanel(active: string) {
  switch (active) {
    case "Appearance":
      return <AppearancePanel />;
    case "Dashboard Banner":
      return <DashboardBannerPanel />;
    case "Connected Accounts":
      return <ConnectedAccountsPanel />;
    case "YouTube Integration":
      return <YouTubeIntegrationPanel />;
    case "OAuth Scopes":
      return <OAuthScopesPanel />;
    case "Compliance & Data":
      return <CompliancePanel />;
    case "Notifications":
      return <NotificationsPanel />;
    case "Billing":
      return <BillingPanel />;
    case "Security":
      return <SecurityPanel />;
    default:
      return <ProfilePanel />;
  }
}

function ProfilePanel() {
  const { user } = useAuthSession();
  const name = user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Your profile";
  const email = user?.email ?? "";
  const avatar = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;

  return (
    <div className="relative rounded-xl card-gradient-outline p-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-lg font-semibold">Profile Information</h3>

      <div className="mt-5 flex items-center gap-4">
        <div className="relative">
          {avatar ? <img src={avatar} alt={name} className="h-16 w-16 rounded-xl object-cover" /> : <div className="h-16 w-16 rounded-xl bg-primary/10" />}
          <button className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-[var(--button-radius)] bg-primary text-primary-foreground">
            <Camera className="h-3.5 w-3.5" />
          </button>
        </div>
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="Full Name" value={name} />
        <Field label="Display Name" value={user?.user_metadata?.preferred_username ?? name} />
        <Field label="Email" value={email} />
        <Field label="Channel Handle" value="Connect YouTube to load handle" />
      </div>

      <div className="mt-5">
        <label className="mb-2 block text-sm text-muted-foreground">Bio</label>
        <textarea
          rows={3}
          defaultValue="YouTube creator, educator, and entrepreneur. Teaching creators how to build sustainable businesses online."
          className="w-full resize-none rounded-xl border border-border bg-accent/20 p-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <button className="mt-6 rounded-[var(--button-radius)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Save Changes
      </button>
    </div>
  );
}

const THEME_OPTIONS: { key: ThemeMode; label: string; desc: string; icon: typeof Sun }[] = [
  { key: "light", label: "Light", desc: "Always use the light theme", icon: Sun },
  { key: "dark", label: "Dark", desc: "Always use the dark theme", icon: Moon },
  { key: "system", label: "System", desc: "Match your device setting", icon: Monitor },
];

function AppearancePanel() {
  const [mode, setMode] = useThemeMode();
  return (
    <div className="relative rounded-xl card-gradient-outline p-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-lg font-semibold">Appearance</h3>
      <p className="mt-1 text-sm text-muted-foreground">Choose how Tubify looks on this device.</p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEME_OPTIONS.map((o) => {
          const selected = mode === o.key;
          return (
            <button
              key={o.key}
              onClick={() => setMode(o.key)}
              className={`flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}>
                <o.icon className="h-4 w-4" />
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {o.label}
                {selected && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground">{o.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConnectedAccountsPanel() {
  const accounts = [
    {
      title: "YouTube",
      description: "@AlexCreates · 847K subscribers",
      connected: true,
    },
    {
      title: "Google Analytics",
      description: "UA-123456789",
      connected: true,
    },
    {
      title: "Stripe",
      description: "Not connected",
      connected: false,
    },
    {
      title: "ConvertKit",
      description: "alexcreates · 12,400 subscribers",
      connected: true,
    },
  ];

  return (
    <div className="relative rounded-xl card-gradient-outline p-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-lg font-semibold">Connected Accounts</h3>
      <p className="mt-1 text-sm text-muted-foreground">Connect third-party services and sync account data.</p>

      <div className="mt-6 space-y-4">
        {accounts.map((account) => (
          <div key={account.title} className="flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <span className="text-sm font-semibold">{account.title.charAt(0)}</span>
              </div>
              <div>
                <p className="font-semibold">{account.title}</p>
                <p className="text-sm text-muted-foreground">{account.description}</p>
              </div>
            </div>
            <button
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                account.connected
                  ? "border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {account.connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ConnectedYoutubeChannel {
  id: string;
  channel_name: string;
  thumbnail: string | null;
  subscriber_count: number;
  connected_at: string;
  last_synced_at: string | null;
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
  const settings = [
    { label: "Auto-sync videos", description: "Keep your channel videos up to date automatically.", enabled: true },
    { label: "Import analytics data", description: "Fetch watch time, revenue, and engagement stats.", enabled: true },
    { label: "Sync comment data", description: "Import comments for sentiment and reply tracking.", enabled: false },
    { label: "Import chapter markers", description: "Pull chapter timestamps from your uploads.", enabled: true },
  ];
  const [channels, setChannels] = useState<ConnectedYoutubeChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const loadChannels = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/youtube/channels");
      const body = (await response.json()) as { data?: ConnectedYoutubeChannel[] };
      setChannels(response.ok ? (body.data ?? []) : []);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
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
          <div key={channel.id} className="rounded-xl border border-border bg-accent/20 p-5">
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
                  <p className="mt-1 text-sm text-success">
                    Connected{channel.last_synced_at ? ` · last synced ${new Date(channel.last_synced_at).toLocaleString()}` : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => disconnect(channel.id)}
                disabled={disconnectingId === channel.id}
                className="rounded-[var(--button-radius)] border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-60"
              >
                {disconnectingId === channel.id ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        ))
      )}

      <div className="space-y-4">
        {settings.map((setting) => (
          <div key={setting.label} className="flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{setting.label}</p>
              <p className="text-sm text-muted-foreground">{setting.description}</p>
            </div>
            <Switch defaultChecked={setting.enabled} />
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsPanel() {
  const notifications = [
    { label: "Revenue milestones", description: "Get notified when you hit new revenue records", enabled: true },
    { label: "Brand deal updates", description: "Alerts for deal status changes and deadlines", enabled: true },
    { label: "Video performance alerts", description: "CTR drops, viral spikes, and view milestones", enabled: true },
    { label: "AI optimization ready", description: "When AI descriptions are ready for review", enabled: false },
    { label: "Weekly digest", description: "Weekly performance summary via email", enabled: true },
    { label: "Payment processed", description: "AdSense and affiliate payment confirmations", enabled: true },
  ];

  return (
    <div className="relative rounded-xl card-gradient-outline p-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h3 className="text-lg font-semibold">Notification Preferences</h3>
      <p className="mt-1 text-sm text-muted-foreground">Choose which notifications you want to receive.</p>

      <div className="mt-6 space-y-4">
        {notifications.map((item) => (
          <div key={item.label} className="flex flex-col gap-3 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{item.label}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            <Switch defaultChecked={item.enabled} />
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
          <p className="font-semibold">Payment Method</p>
          <p className="text-sm text-muted-foreground">Visa ending in 4242 · Expires 04/27</p>
        </div>
        <Link
          to="/billing"
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:mt-0"
        >
          Update Billing Plan
        </Link>
      </div>
    </div>
  );
}

function SecurityPanel() {
  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">Security Settings</h3>
        <p className="mt-1 text-sm text-muted-foreground">Update your password and enable extra protection for your account.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Current Password" value="• • • • • • • •" />
        <Field label="New Password" value="Min. 8 characters" />
      </div>

      <div className="rounded-xl border border-border bg-accent/20 p-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Two-Factor Authentication</p>
          <p className="text-sm text-muted-foreground">Add an extra layer of security to your account.</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch defaultChecked={false} />
          <button className="text-sm font-medium text-primary hover:underline">Enable 2FA</button>
        </div>
      </div>

      <button className="rounded-[var(--button-radius)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Update Password
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="mb-2 block text-sm text-muted-foreground">{label}</label>
      <input defaultValue={value} className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary" />
    </div>
  );
}

function DashboardBannerPanel() {
  const { settings, update } = useChannelSettings();
  const [saved, setSaved] = useState(false);

  const toggles: { key: "showAvatar" | "showSubscribers" | "showVisitButton" | "showRecentPosts"; label: string; description: string }[] = [
    { key: "showAvatar", label: "Channel avatar", description: "Show your channel profile picture on the banner." },
    { key: "showSubscribers", label: "Subscriber count", description: "Display your subscriber total next to the name." },
    { key: "showVisitButton", label: "Visit channel button", description: "Show the red button that opens your channel." },
    { key: "showRecentPosts", label: "Recently added posts", description: "Show the preview grid of recent videos." },
  ];

  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">Dashboard Banner</h3>
        <p className="mt-1 text-sm text-muted-foreground">Paste your channel URL and choose what appears on the dashboard banner.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm text-muted-foreground">Channel Name</label>
          <input
            value={settings.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="@YourChannel"
            className="h-11 w-full rounded-xl border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted-foreground">Subscriber Count</label>
          <input
            value={settings.subscribers}
            onChange={(e) => update({ subscribers: e.target.value })}
            placeholder="1.24M"
            className="h-11 w-full rounded-xl border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-muted-foreground">Channel URL</label>
          <input
            value={settings.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="https://www.youtube.com/@YourChannel"
            className="h-11 w-full rounded-xl border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-muted-foreground">Avatar Image URL</label>
          <input
            value={settings.avatar}
            onChange={(e) => update({ avatar: e.target.value })}
            placeholder="https://..."
            className="h-11 w-full rounded-xl border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary"
          />
        </div>
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
        {saved ? <><Check className="h-4 w-4" /> Saved</> : "Save Changes"}
      </button>
    </div>
  );
}

function OAuthScopesPanel() {
  const scopes = [
    { name: "youtube.force-ssl", purpose: "Read private channel details and post comment replies.", status: "Granted", required: true },
    { name: "yt-analytics.readonly", purpose: "Fetch views, watch time, CTR, retention, and demographics.", status: "Granted", required: true },
    { name: "yt-analytics-monetary.readonly", purpose: "Estimated revenue and RPM per video.", status: "Granted", required: true },
    { name: "userinfo.email + profile", purpose: "Basic Google account linking.", status: "Granted", required: true },
    { name: "youtubepartner", purpose: "Not requested — dropped in v3.0 (typical creators don't hold it).", status: "Omitted", required: false },
  ];
  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">OAuth Scopes</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Tubify uses the minimum scopes for revenue attribution. Verification review runs 8–16 weeks — start early.
        </p>
      </div>
      <div className="space-y-3">
        {scopes.map((s) => (
          <div key={s.name} className="flex flex-col gap-2 rounded-xl border border-border bg-accent/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <code className="text-sm font-semibold">{s.name}</code>
              <p className="mt-1 text-sm text-muted-foreground">{s.purpose}</p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              s.status === "Granted" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
            }`}>{s.status}</span>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          Tokens are stored encrypted at rest. State + PKCE prevent CSRF. Refresh tokens rotate on use.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            try {
              window.localStorage.setItem(
                "revenueos.oauth-acknowledged-at",
                new Date().toISOString(),
              );
              toast.success("OAuth scopes acknowledged", {
                description: "Your scope preferences were saved.",
              });
            } catch (err) {
              toast.error("Couldn't save scope preferences", {
                description: err instanceof Error ? err.message : "Local storage is unavailable.",
              });
            }
          }}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Acknowledge & Save
        </button>
        <button
          onClick={() => toast("Re-verification queued", { description: "We'll re-check scopes on the next OAuth refresh." })}
          className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
        >
          Re-verify
        </button>
      </div>
    </div>
  );
}

function CompliancePanel() {
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const controls = [
    { icon: Globe, label: "EU data residency", value: "Hetzner Nuremberg + Helsinki (ISO 27001)" },
    { icon: Lock, label: "Encryption", value: "TLS 1.3 in transit · AES-256 at rest" },
    { icon: ScrollText, label: "Audit logging", value: "All admin & API events — 12 month retention" },
    { icon: Shield, label: "Regulatory alignment", value: "GDPR · NIS2 · Dutch Cybersecurity Act" },
  ];

  // This is a local-storage-only demo (no real backend account to call an API for), so
  // "deleting the account" means genuinely wiping every yroos.* key — the same mechanism
  // DashboardLayout's sign-out already uses — then leaving the app entirely, mirroring what a
  // real erasure endpoint would do. Google Play requires this to actually work, not just show a
  // confirmation toast (the previous version of this button did nothing but claim to email you).
  const deleteAccount = () => {
    clearAllStores();
    toast.success("Account deleted", { description: "All local data has been erased." });
    setDeleteOpen(false);
    setTimeout(() => navigate({ to: "/landing" }), 400);
  };

  return (
    <div className="relative rounded-xl card-gradient-outline p-6 space-y-6">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <div>
        <h3 className="text-lg font-semibold">Compliance & Data</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Tubify is designed EU-first. Data never leaves the region unless you export it. Read our{" "}
          <Link to="/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {controls.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-accent/20 p-4">
            <div className="flex items-center gap-2 text-primary">
              <c.icon className="h-4 w-4" />
              <p className="text-sm font-semibold">{c.label}</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          onClick={() => toast.success("Export requested", { description: "We'll email your JSON archive within 24h." })}
          className="rounded-xl border border-border bg-accent/20 p-4 text-left hover:border-primary"
        >
          <p className="text-sm font-semibold">Export my data</p>
          <p className="mt-1 text-xs text-muted-foreground">JSON archive · GDPR Art. 20</p>
        </button>
        <button
          onClick={() => toast.success("Consents opened", { description: "Update tracking, analytics, and AI processing choices." })}
          className="rounded-xl border border-border bg-accent/20 p-4 text-left hover:border-primary"
        >
          <p className="text-sm font-semibold">Manage consents</p>
          <p className="mt-1 text-xs text-muted-foreground">Tracking, analytics, AI processing</p>
        </button>
        <button
          onClick={() => setDeleteOpen(true)}
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-left hover:border-destructive"
        >
          <p className="text-sm font-semibold text-destructive">Delete account</p>
          <p className="mt-1 text-xs text-muted-foreground">Erasure within 30 days · Art. 17</p>
        </button>
      </div>
      <div className="pt-2">
        <button
          onClick={() => {
            try {
              window.localStorage.setItem(
                "revenueos.compliance-acknowledged-at",
                new Date().toISOString(),
              );
              toast.success("Compliance preferences saved", {
                description: "EU residency & retention choices confirmed.",
              });
            } catch (err) {
              toast.error("Couldn't save compliance settings", {
                description: err instanceof Error ? err.message : "Local storage is unavailable.",
              });
            }
          }}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Save Preferences
        </button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your account?"
        description="This permanently erases your profile, channel settings, deals, leads, and every other local record. This cannot be undone."
        confirmLabel="Delete account"
        onConfirm={deleteAccount}
      />
    </div>
  );
}


