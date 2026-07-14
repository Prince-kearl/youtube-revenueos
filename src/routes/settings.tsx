import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Switch } from "@/components/ui/switch";
import { useChannelSettings } from "@/lib/channel-settings";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const menu = [
  { label: "Profile", icon: User },
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1">
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
    case "Dashboard Banner":
      return <DashboardBannerPanel />;
    case "Connected Accounts":
      return <ConnectedAccountsPanel />;
    case "YouTube Integration":
      return <YouTubeIntegrationPanel />;
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
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold">Profile Information</h3>

      <div className="mt-5 flex items-center gap-4">
        <div className="relative">
          <img src="https://i.pravatar.cc/96?img=13" alt="Alex Chen" className="h-16 w-16 rounded-xl object-cover" />
          <button className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Camera className="h-3.5 w-3.5" />
          </button>
        </div>
        <div>
          <p className="font-semibold">Alex Chen</p>
          <p className="text-sm text-muted-foreground">Premium Plan · 247 videos</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="Full Name" value="Alex Chen" />
        <Field label="Display Name" value="alexcreates" />
        <Field label="Email" value="alex@creator.io" />
        <Field label="Channel Handle" value="@AlexCreates" />
      </div>

      <div className="mt-5">
        <label className="mb-2 block text-sm text-muted-foreground">Bio</label>
        <textarea
          rows={3}
          defaultValue="YouTube creator, educator, and entrepreneur. Teaching creators how to build sustainable businesses online."
          className="w-full resize-none rounded-xl border border-border bg-accent/20 p-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <button className="mt-6 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Save Changes
      </button>
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
    <div className="rounded-xl border border-border bg-card p-6">
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

function YouTubeIntegrationPanel() {
  const settings = [
    { label: "Auto-sync videos", description: "Keep your channel videos up to date automatically.", enabled: true },
    { label: "Import analytics data", description: "Fetch watch time, revenue, and engagement stats.", enabled: true },
    { label: "Sync comment data", description: "Import comments for sentiment and reply tracking.", enabled: false },
    { label: "Import chapter markers", description: "Pull chapter timestamps from your uploads.", enabled: true },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold">YouTube Integration</h3>
        <p className="mt-1 text-sm text-muted-foreground">Manage your channel sync settings and data imports.</p>
      </div>

      <div className="rounded-xl border border-border bg-accent/20 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-3xl bg-brand-red text-white">
              <Youtube className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">@AlexCreates</p>
              <p className="text-sm text-muted-foreground">847,200 subscribers · 247 videos</p>
              <p className="mt-1 text-sm text-success">Connected & syncing</p>
            </div>
          </div>
          <button className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/15">
            Disconnect
          </button>
        </div>
      </div>

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
    <div className="rounded-xl border border-border bg-card p-6">
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
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
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
        <button className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:mt-0">
          Update
        </button>
      </div>
    </div>
  );
}

function SecurityPanel() {
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
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

      <button className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Update Password
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="mb-2 block text-sm text-muted-foreground">{label}</label>
      <input defaultValue={value} className="h-11 w-full rounded-xl border border-border bg-accent/20 px-4 text-sm outline-none focus:border-primary" />
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
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
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
          setSaved(true);
          window.setTimeout(() => setSaved(false), 2000);
        }}
        className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {saved ? <><Check className="h-4 w-4" /> Saved</> : "Save Changes"}
      </button>
    </div>
  );
}

