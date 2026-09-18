import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { NotificationRow, type AppNotification } from "@/components/NotificationRow";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { ConfirmDialog } from "@/components/modals";

export const Route = createFileRoute("/notifications")({
  component: Notifications,
});

function Notifications() {
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const { data } = await res.json();
        setNotifs(data ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const shown = notifs
    .filter((n) => (tab === "archived" ? n.archived : !n.archived))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const markAllRead = () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    toast.success("All notifications marked as read");
  };
  const clearNotifs = () => {
    setNotifs([]);
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_all" }),
    });
    toast.success("Notifications cleared");
  };
  const patchNotification = (id: string, patch: Partial<AppNotification>) => {
    setNotifs((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    void fetch(`/api/notifications?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };
  const deleteNotification = (id: string) => {
    setNotifs((prev) => prev.filter((x) => x.id !== id));
    void fetch(`/api/notifications?id=${id}`, { method: "DELETE" });
  };

  return (
    <DashboardLayout title="Notifications">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications & Alerts</h1>
        </div>
        {notifs.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <button onClick={markAllRead} className="font-medium text-primary hover:underline">
              Mark all read
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              onClick={() => setClearConfirmOpen(true)}
              className="font-medium text-muted-foreground hover:text-destructive"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 inline-flex rounded-full bg-accent p-1 text-sm">
        {(["active", "archived"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 font-medium capitalize ${t === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="relative mt-4 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        {loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {tab === "archived" ? "No archived notifications" : "No notifications"}
          </p>
        ) : (
          <div className="space-y-2.5">
            {shown.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onMarkRead={() => patchNotification(n.id, { read: true })}
                onTogglePin={() => patchNotification(n.id, { pinned: !n.pinned })}
                onToggleArchive={() => patchNotification(n.id, { archived: !n.archived })}
                onDelete={() => deleteNotification(n.id)}
              />
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear all notifications?"
        description="This permanently deletes every notification in your history, active and archived. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={() => {
          clearNotifs();
          setClearConfirmOpen(false);
        }}
      />
    </DashboardLayout>
  );
}
