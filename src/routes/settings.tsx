import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { User, Link2, Youtube, Bell, CreditCard, Shield, Camera } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const menu = [
  { label: "Profile", icon: User },
  { label: "Connected Accounts", icon: Link2 },
  { label: "YouTube Integration", icon: Youtube },
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

        <div className="rounded-2xl border border-border bg-card p-6">
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
      </div>
    </DashboardLayout>
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
