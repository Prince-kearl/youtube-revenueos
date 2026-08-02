import { useEffect, useState } from "react";
import {
  Search, MoreHorizontal, UserPlus, BadgeCheck, KeyRound, LogOut, Eye,
  PauseCircle, PlayCircle, Ban, Trash2, Mail, Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/ui-bits";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/modals";
import { useUsers, PLATFORM_ROLES, type PlatformUser, type UserStatus, type PlatformRole } from "@/lib/stores";
import { uid } from "@/lib/local-store";
import { useAuditLogger } from "../useAuditLogger";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const statusColor: Record<UserStatus, string> = {
  Active: "bg-success/15 text-success",
  Suspended: "bg-warning/15 text-warning",
  Banned: "bg-destructive/15 text-destructive",
  Pending: "bg-brand-blue/15 text-brand-blue",
};

export function UsersSection() {
  const [users, setUsers] = useUsers();
  const log = useAuditLogger();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | UserStatus>("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PlatformUser | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filtered = users.filter(
    (u) =>
      (statusFilter === "All" || u.status === statusFilter) &&
      (u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase()) || u.org.toLowerCase().includes(query.toLowerCase())),
  );

  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((u) => u.id))));

  const setStatus = (u: PlatformUser, status: UserStatus) => {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, status } : x)));
    log(`Set status: ${status}`, "Users", u.name);
    toast.success(`${u.name} is now ${status.toLowerCase()}`);
  };
  const verify = (u: PlatformUser, field: "emailVerified" | "creatorVerified") => {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, [field]: true } : x)));
    log(field === "emailVerified" ? "Verified email" : "Verified creator badge", "Users", u.name);
    toast.success(`${field === "emailVerified" ? "Email" : "Creator badge"} verified for ${u.name}`);
  };
  const resetPassword = (u: PlatformUser) => { log("Reset password", "Users", u.name); toast.success(`Password reset email sent to ${u.email}`); };
  const forceLogout = (u: PlatformUser) => { log("Forced logout", "Users", u.name); toast.success(`All sessions for ${u.name} were revoked`); };
  const impersonate = (u: PlatformUser) => { log("Impersonated user", "Users", u.name); toast(`Impersonating ${u.name} — logged to the audit trail`, { icon: "🕵️" }); };
  const removeUser = (u: PlatformUser) => {
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    log("Deleted user", "Users", u.name);
    toast.success(`${u.name} was deleted`);
    setDeleting(null);
  };

  const bulkSuspend = () => {
    setUsers((prev) => prev.map((x) => (selected.has(x.id) ? { ...x, status: "Suspended" } : x)));
    log("Bulk suspend", "Users", `${selected.size} users`);
    toast.success(`Suspended ${selected.size} users`);
    setSelected(new Set());
  };
  const bulkDelete = () => {
    setUsers((prev) => prev.filter((x) => !selected.has(x.id)));
    log("Bulk delete", "Users", `${selected.size} users`);
    toast.success(`Deleted ${selected.size} users`);
    setSelected(new Set());
    setBulkDeleting(false);
  };
  const bulkEmail = () => { log("Bulk email", "Users", `${selected.size} users`); toast.success(`Queued an email to ${selected.size} users`); };
  const bulkExport = () => { log("Bulk export", "Users", `${selected.size || users.length} users`); toast.success(`Exported ${selected.size || users.length} users as CSV`); };
  const bulkRole = (role: PlatformRole) => {
    setUsers((prev) => prev.map((x) => (selected.has(x.id) ? { ...x, role } : x)));
    log(`Bulk role assignment: ${role}`, "Users", `${selected.size} users`);
    toast.success(`Assigned ${role} to ${selected.size} users`);
    setSelected(new Set());
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Complete user lifecycle management across every organization.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <UserPlus className="h-4 w-4" /> Create User
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<UsersIcon className="h-5 w-5" />} value={String(users.length)} label="Total Users" />
        <StatCard icon={<PlayCircle className="h-5 w-5" />} value={String(users.filter((u) => u.status === "Active").length)} label="Active" />
        <StatCard icon={<PauseCircle className="h-5 w-5" />} value={String(users.filter((u) => u.status === "Suspended" || u.status === "Banned").length)} label="Suspended / Banned" />
        <StatCard icon={<Mail className="h-5 w-5" />} value={String(users.filter((u) => !u.emailVerified).length)} label="Unverified Emails" />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or org…" className="h-9 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["All", "Active", "Suspended", "Banned", "Pending"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-[var(--button-radius)] px-3 py-1.5 text-xs font-medium ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{s}</button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button onClick={bulkSuspend} className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent">Bulk Suspend</button>
            <button onClick={bulkEmail} className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent">Bulk Email</button>
            <button onClick={bulkExport} className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent">Bulk Export</button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent">Bulk Role…</button></DropdownMenuTrigger>
              <DropdownMenuContent>
                {PLATFORM_ROLES.map((r) => <DropdownMenuItem key={r} onSelect={() => bulkRole(r)}>{r}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <button onClick={() => setBulkDeleting(true)} className="rounded-[var(--button-radius)] bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90">Bulk Delete</button>
          </div>
        </div>
      )}

      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-5 py-3"><Checkbox checked={selected.size > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} disabled={filtered.length === 0} /></th>
              <th className="px-3 py-3 font-medium">User</th>
              <th className="px-3 py-3 font-medium">Organization</th>
              <th className="px-3 py-3 font-medium">Role</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Verified</th>
              <th className="px-3 py-3 font-medium">Last Login</th>
              <th className="px-3 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                <td className="px-5 py-3.5"><Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} /></td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-3">
                    <img src={u.avatar} alt={u.name} className="h-8 w-8 rounded-full object-cover" />
                    <div className="min-w-0"><p className="truncate font-medium">{u.name}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div>
                  </div>
                </td>
                <td className="px-3 py-3.5 max-w-[180px] truncate text-muted-foreground">{u.org}</td>
                <td className="px-3 py-3.5 text-muted-foreground">{u.role}</td>
                <td className="px-3 py-3.5"><span className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[u.status]}`}>{u.status}</span></td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-1">
                    {u.emailVerified ? <BadgeCheck className="h-4 w-4 text-success" aria-label="Email verified" /> : <span className="text-xs text-muted-foreground">Unverified</span>}
                    {u.creatorVerified && <BadgeCheck className="h-4 w-4 text-brand-purple" aria-label="Creator verified" />}
                  </div>
                </td>
                <td className="px-3 py-3.5 text-muted-foreground">{u.lastLogin}</td>
                <td className="px-3 py-3.5 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="text-muted-foreground hover:text-foreground" aria-label="User actions"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => impersonate(u)}><Eye className="mr-2 h-4 w-4" /> Impersonate user</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => resetPassword(u)}><KeyRound className="mr-2 h-4 w-4" /> Reset password</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => forceLogout(u)}><LogOut className="mr-2 h-4 w-4" /> Force logout</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {!u.emailVerified && <DropdownMenuItem onSelect={() => verify(u, "emailVerified")}><BadgeCheck className="mr-2 h-4 w-4" /> Verify email</DropdownMenuItem>}
                      {!u.creatorVerified && <DropdownMenuItem onSelect={() => verify(u, "creatorVerified")}><BadgeCheck className="mr-2 h-4 w-4" /> Verify creator</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Change status</DropdownMenuLabel>
                      {u.status !== "Active" && <DropdownMenuItem onSelect={() => setStatus(u, "Active")}><PlayCircle className="mr-2 h-4 w-4" /> Reactivate</DropdownMenuItem>}
                      {u.status !== "Suspended" && <DropdownMenuItem onSelect={() => setStatus(u, "Suspended")}><PauseCircle className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>}
                      {u.status !== "Banned" && <DropdownMenuItem onSelect={() => setStatus(u, "Banned")} className="text-destructive focus:text-destructive"><Ban className="mr-2 h-4 w-4" /> Ban</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setDeleting(u)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete user</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">No users match your filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mt-4 space-y-3 sm:hidden">
        {filtered.map((u) => (
          <div key={u.id} className="relative rounded-xl card-gradient-outline p-4">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} />
                <img src={u.avatar} alt={u.name} className="h-9 w-9 shrink-0 rounded-full object-cover" />
                <div className="min-w-0"><p className="truncate font-medium">{u.name}</p><p className="truncate text-xs text-muted-foreground">{u.org}</p></div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="shrink-0 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => impersonate(u)}><Eye className="mr-2 h-4 w-4" /> Impersonate</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => resetPassword(u)}><KeyRound className="mr-2 h-4 w-4" /> Reset password</DropdownMenuItem>
                  {u.status !== "Suspended" ? <DropdownMenuItem onSelect={() => setStatus(u, "Suspended")}><PauseCircle className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem> : <DropdownMenuItem onSelect={() => setStatus(u, "Active")}><PlayCircle className="mr-2 h-4 w-4" /> Reactivate</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => setDeleting(u)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${statusColor[u.status]}`}>{u.status}</span>
              <span className="text-[11px] text-muted-foreground">{u.role} · last login {u.lastLogin}</span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No users match your filters.</p>}
      </div>

      <CreateUserDialog open={creating} onOpenChange={setCreating} onCreate={(u) => { setUsers((prev) => [u, ...prev]); log("Created user", "Users", u.name); }} />
      <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete ${deleting?.name}?`} description="This permanently removes their account. This cannot be undone." onConfirm={() => deleting && removeUser(deleting)} />
      <ConfirmDialog open={bulkDeleting} onOpenChange={setBulkDeleting} title={`Delete ${selected.size} users?`} description="This permanently removes their accounts. This cannot be undone." onConfirm={bulkDelete} />
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (u: PlatformUser) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState<PlatformRole>("Editor");

  useEffect(() => { if (open) { setName(""); setEmail(""); setOrg(""); setRole("Editor"); } }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return toast.error("Name and email are required");
    onCreate({
      id: uid(), name, email, org: org || "Unassigned", role, status: "Pending",
      emailVerified: false, creatorVerified: false, lastLogin: "—",
      avatar: `https://i.pravatar.cc/64?img=${Math.floor(Math.random() * 70) + 1}`,
      joined: new Date().toISOString().slice(0, 10),
    });
    onOpenChange(false);
    toast.success(`${name} was created`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Add a new account directly — they'll show as Pending until they verify their email.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Organization</Label><Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Optional" /></div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as PlatformRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PLATFORM_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit"><UserPlus className="mr-2 h-4 w-4" /> Create User</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
