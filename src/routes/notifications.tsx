import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { NotificationRow } from "@/components/NotificationRow";
import { useNotifications } from "@/lib/stores";
import { toast } from "sonner";

export const Route = createFileRoute("/notifications")({
  component: Notifications,
});

function Notifications() {
  const [notifs, setNotifs] = useNotifications();
  const [tab, setTab] = useState<"active" | "archived">("active");

  const shown = notifs
    .filter((n) => (tab === "archived" ? n.archived : !n.archived))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const markAllRead = () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  };
  const clearNotifs = () => {
    setNotifs([]);
    toast.success("Notifications cleared");
  };

  return (
    <DashboardLayout title="Notifications">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications & Alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Everything happening across your channel, deals, and automations.</p>
        </div>
        {notifs.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <button onClick={markAllRead} className="font-medium text-primary hover:underline">Mark all read</button>
            <span className="text-muted-foreground">·</span>
            <button onClick={clearNotifs} className="font-medium text-muted-foreground hover:text-destructive">Clear all</button>
          </div>
        )}
      </div>

      <div className="mt-5 inline-flex rounded-lg bg-accent p-1 text-sm">
        {(["active", "archived"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 font-medium capitalize ${t === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {tab === "archived" ? "No archived notifications" : "No notifications"}
          </p>
        ) : (
          <div className="space-y-2.5">
            {shown.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onMarkRead={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))}
                onTogglePin={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x)))}
                onToggleArchive={() => setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, archived: !x.archived } : x)))}
                onDelete={() => setNotifs((prev) => prev.filter((x) => x.id !== n.id))}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
