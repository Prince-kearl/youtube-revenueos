import { useEffect, useState } from "react";
import { Search, MoreHorizontal, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Tag } from "@/components/ui-bits";
import { FlatKpiCard } from "@/components/KpiTrendCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlowingEffect } from "@/components/ui/glowing-effect";

type PlanStatus = "Active" | "Trial" | "Past Due" | "Canceled" | "Incomplete" | "Free";
type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerAvatar: string | null;
  memberCount: number;
  planName: string | null;
  planStatus: PlanStatus;
  mrrCents: number;
};

const statusColor: Record<PlanStatus, string> = {
  Active: "bg-success/15 text-success",
  Trial: "bg-brand-blue/15 text-brand-blue",
  "Past Due": "bg-warning/15 text-warning",
  Canceled: "bg-destructive/15 text-destructive",
  Incomplete: "bg-warning/15 text-warning",
  Free: "bg-accent text-muted-foreground",
};
const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function OrganizationsSection() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Workspace | null>(null);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    fetch("/api/admin/workspaces", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: Workspace[] };
        if (!response.ok || !body.data) throw new Error();
        setWorkspaces(body.data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const filtered = workspaces.filter(
    (w) =>
      w.name.toLowerCase().includes(query.toLowerCase()) ||
      (w.ownerName ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (w.ownerEmail ?? "").toLowerCase().includes(query.toLowerCase()),
  );
  const totalMembers = workspaces.reduce((a, w) => a + w.memberCount, 0);
  const paying = workspaces.filter((w) =>
    ["Active", "Trial", "Past Due"].includes(w.planStatus),
  ).length;
  const totalMrr = workspaces.reduce((a, w) => a + w.mrrCents, 0);

  const rename = async (w: Workspace, name: string) => {
    try {
      const response = await fetch(`/api/admin/workspaces?id=${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "RENAME_FAILED");
      toast.success(`Renamed to "${name}"`);
      setEditing(null);
      load();
    } catch {
      toast.error("Couldn't rename that workspace. Please try again.");
    }
  };

  if (status === "loading") {
    return <p className="mt-4 text-sm text-muted-foreground">Loading workspaces…</p>;
  }
  if (status === "error") {
    return (
      <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load workspaces.</p>
        <button
          onClick={() => setRetryNonce((n) => n + 1)}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Workspaces</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every real workspace on the platform — Tubify's actual tenant boundary, with its owner,
        team, and subscription.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FlatKpiCard title="Workspaces" value={String(workspaces.length)} />
        <FlatKpiCard title="Total Members" value={String(totalMembers)} />
        <FlatKpiCard title="Paying" value={String(paying)} />
        <FlatKpiCard title="MRR" value={money(totalMrr)} />
      </div>

      <div className="relative mt-5 max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workspaces…"
          className="h-9 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filtered.map((w) => (
          <div key={w.id} className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                {w.ownerAvatar ? (
                  <img
                    src={w.ownerAvatar}
                    alt={w.ownerName ?? ""}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold">
                    {(w.name || "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{w.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {w.ownerName ?? w.ownerEmail ?? "Unknown owner"}
                  </p>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="shrink-0 text-muted-foreground hover:text-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(w)}>
                    <Pencil className="mr-2 h-4 w-4" /> Rename workspace
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {w.planName && <Tag label={w.planName} color="blue" />}
              <span
                className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[w.planStatus]}`}
              >
                {w.planStatus}
              </span>
              <span className="text-xs text-muted-foreground">
                joined {new Date(w.createdAt).toLocaleDateString()}
              </span>
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{w.memberCount}</strong>{" "}
                {w.memberCount === 1 ? "member" : "members"}
              </span>
              {w.mrrCents > 0 && (
                <span>
                  <strong className="text-foreground">{money(w.mrrCents)}</strong>/mo
                </span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No workspaces match your search.
          </p>
        )}
      </div>

      <RenameDialog
        open={!!editing}
        workspace={editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSave={rename}
      />
    </div>
  );
}

function RenameDialog({
  open,
  workspace,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  workspace: Workspace | null;
  onOpenChange: (v: boolean) => void;
  onSave: (w: Workspace, name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open && workspace) setName(workspace.name);
  }, [open, workspace]);
  if (!workspace) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Workspace</DialogTitle>
          <DialogDescription>
            This changes the real workspace name for its owner too.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave(workspace, name.trim());
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Workspace name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
