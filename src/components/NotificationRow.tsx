import { useState } from "react";
import {
  MessageSquare, CheckCircle2, DollarSign, AlertTriangle, Zap, Clock,
  MoreVertical, Pin, PinOff, Archive, ArchiveRestore, Trash2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/modals";
import type { Notification } from "@/lib/stores";

const notifIcons = { message: MessageSquare, check: CheckCircle2, dollar: DollarSign, alert: AlertTriangle, zap: Zap, clock: Clock };
const notifColor: Record<string, string> = {
  purple: "bg-brand-purple/15 text-brand-purple",
  green: "bg-brand-green/15 text-brand-green",
  amber: "bg-brand-amber/15 text-brand-amber",
  red: "bg-brand-red/15 text-brand-red",
  blue: "bg-brand-blue/15 text-brand-blue",
};

export function NotificationRow({
  notification,
  onMarkRead,
  onTogglePin,
  onToggleArchive,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const Icon = notifIcons[notification.icon];

  const openDetail = () => {
    if (!notification.read) onMarkRead();
    setDetailOpen(true);
  };

  return (
    <>
      <div className={`group flex items-start gap-3 rounded-xl border border-border p-3 ${notification.read ? "bg-accent/30" : "bg-primary/5"}`}>
        <button onClick={openDetail} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--button-radius)] ${notifColor[notification.color]}`} aria-label="Open notification">
          <Icon className="h-4 w-4" />
        </button>
        <button onClick={openDetail} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-1.5 text-sm font-medium leading-snug">
            {notification.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" fill="currentColor" />}
            <span className="truncate">{notification.title}</span>
          </p>
          <p className="text-xs text-muted-foreground">{notification.time}</p>
        </button>
        {!notification.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Notification actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={openDetail}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={onTogglePin}>
              {notification.pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
              {notification.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleArchive}>
              {notification.archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              {notification.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${notifColor[notification.color]}`}>
              <Icon className="h-5 w-5" />
            </div>
            <DialogTitle className="mt-3">{notification.title}</DialogTitle>
            <DialogDescription>{notification.time}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this notification?"
        description="This can't be undone."
        onConfirm={() => { setConfirmDelete(false); onDelete(); }}
      />
    </>
  );
}
