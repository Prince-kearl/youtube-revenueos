import { useEffect, useRef, useState } from "react";
import {
  Search,
  MoreHorizontal,
  UserPlus,
  BadgeCheck,
  KeyRound,
  Eye,
  PauseCircle,
  PlayCircle,
  Ban,
  Trash2,
  RefreshCw,
  Copy,
  ChevronLeft,
  ChevronRight,
  Users,
  UserCheck,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { AdminKpiCard } from "@/components/admin/AdminKpiCard";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/modals";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserDirectoryMaintenance } from "./UserDirectoryMaintenance";
import { GlowingEffect } from "@/components/ui/glowing-effect";

type AppRole = "user" | "editor" | "setter" | "manager" | "owner" | "superadmin";
type UserStatus = "Active" | "Banned" | "Pending";
type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: AppRole;
  created_at: string;
  status: UserStatus;
  emailVerified: boolean;
  creatorVerified: boolean;
  bannedUntil: string | null;
  lastSignInAt: string | null;
};

const ROLE_OPTIONS: AppRole[] = ["user", "editor", "setter", "manager", "owner", "superadmin"];
const ROLE_LABEL: Record<AppRole, string> = {
  user: "User",
  editor: "Editor",
  setter: "Setter",
  manager: "Manager",
  owner: "Owner",
  superadmin: "Superadmin",
};
const statusColor: Record<UserStatus, string> = {
  Active: "bg-success/15 text-success",
  Banned: "bg-destructive/15 text-destructive",
  Pending: "bg-brand-blue/15 text-brand-blue",
};
type UserStats = { total: number; active: number; pending: number; banned: number };
type SortKey = "newest" | "oldest" | "email";
const SORT_LABEL: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  email: "Email A–Z",
};
const PAGE_SIZE = 25;

const ERROR_MESSAGE: Record<string, string> = {
  CANNOT_CHANGE_OWN_ROLE: "You can't change your own role or ban status.",
  CANNOT_DELETE_SELF: "You can't delete your own account.",
  CANNOT_IMPERSONATE_SELF: "You can't impersonate yourself.",
  PRIVILEGE_ESCALATION_BLOCKED: "You don't have permission to make that change.",
  CANNOT_REMOVE_LAST_SUPERADMIN: "Tubify must always have at least one Superadmin.",
  USER_NOT_FOUND: "That user no longer exists.",
  INVITE_FAILED: "Couldn't send the invite. Check the project's email settings.",
  RESET_FAILED: "Couldn't send the reset email.",
  LINK_FAILED: "Couldn't generate an impersonation link.",
};
const LOAD_ERROR_MESSAGE: Record<string, string> = {
  ADMIN_USERS_MIGRATION_REQUIRED:
    "The Users directory needs its database update before it can load. Ask an owner to apply the pending migration.",
  PERMISSION_REQUIRED: "You don't have permission to view users.",
};

function errorMessage(code: string): string {
  return ERROR_MESSAGE[code] ?? "That didn't work. Please try again.";
}

// A ban 10+ years out was almost certainly our own "876000h" permanent-ban duration, not a
// short suspension — worth telling apart in the status chip.
function banLabel(bannedUntil: string | null): string {
  if (!bannedUntil) return "Banned";
  const yearsOut = (new Date(bannedUntil).getTime() - Date.now()) / (365 * 24 * 3600 * 1000);
  return yearsOut > 10 ? "Banned" : `Suspended until ${new Date(bannedUntil).toLocaleDateString()}`;
}

export function UsersSection() {
  // One page at a time from the server (search, filters, sorting, counting and paging all happen
  // in the database — see api.admin.users.ts). Nothing here holds more than the visible page.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | UserStatus>("All");
  const [roleFilter, setRoleFilter] = useState<"All" | AppRole>("All");
  const [sort, setSort] = useState<SortKey>("newest");
  // cursors[i] opens page i (page 0 has none); the next page's cursor comes with each page.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [detailUser, setDetailUser] = useState<UserRow | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [impersonateLink, setImpersonateLink] = useState<string | null>(null);

  // The search box waits for a pause in typing, and a one-character search is not sent (the
  // server asks for at least two characters, so it can use its indexes).
  useEffect(() => {
    const trimmed = query.trim();
    const id = window.setTimeout(() => setSearch(trimmed.length === 1 ? "" : trimmed), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  // A new search, filter or ordering starts again at page 1. The page position belongs to the
  // filters it was reached with, so the very render that changes a filter already asks for page 1
  // (never page 3's cursor with the new filters, which the server would refuse).
  const filterKey = JSON.stringify([search, statusFilter, roleFilter, sort]);
  const [pagerKey, setPagerKey] = useState(filterKey);
  const samePager = pagerKey === filterKey;
  useEffect(() => {
    if (samePager) return;
    setPagerKey(filterKey);
    setCursors([null]);
    setPageIndex(0);
    setSelected(new Set());
  }, [samePager, filterKey]);
  const currentPage = samePager ? pageIndex : 0;
  const cursor = samePager ? (cursors[pageIndex] ?? null) : null;
  useEffect(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), sort });
    if (search) params.set("q", search);
    if (roleFilter !== "All") params.set("role", roleFilter);
    if (statusFilter !== "All") params.set("status", statusFilter.toLowerCase());
    if (cursor) params.set("cursor", cursor);
    else params.set("stats", "1");
    setStatus((prev) => (prev === "error" ? "loading" : prev));
    setLoadError(null);
    fetch(`/api/admin/users?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: UserRow[];
          page?: { nextCursor: string | null; total: number | null };
          stats?: UserStats;
          error?: string;
        };
        if (!response.ok || !body.data) throw new Error(body.error ?? "LOAD_FAILED");
        setRows(body.data);
        setNextCursor(body.page?.nextCursor ?? null);
        if (!cursor) {
          setTotal(body.page?.total ?? null);
          if (body.stats) setStats(body.stats);
        }
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "LOAD_FAILED");
        setStatus("error");
      });
    return () => controller.abort();
  }, [search, statusFilter, roleFilter, sort, cursor, retryNonce]);

  // After a change to an account: reload the page being looked at (and the totals with it).
  const load = () => {
    if (currentPage === 0) setRetryNonce((n) => n + 1);
    else {
      setCursors([null]);
      setPageIndex(0);
    }
  };
  const goNext = () => {
    if (!nextCursor) return;
    setCursors((prev) => [...prev.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
    setSelected(new Set());
  };
  const goPrevious = () => {
    if (currentPage === 0) return;
    setPageIndex((i) => i - 1);
    setSelected(new Set());
  };
  const filtered = rows;
  const firstShown = rows.length ? currentPage * PAGE_SIZE + 1 : 0;
  const lastShown = currentPage * PAGE_SIZE + rows.length;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((u) => u.id)),
    );

  async function patchUser(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/users?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "REQUEST_FAILED");
    return data;
  }

  const setBan = async (u: UserRow, banDuration: string, label: string) => {
    try {
      await patchUser(u.id, { banDuration });
      toast.success(`${u.name ?? u.email} ${label}`);
      load();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "REQUEST_FAILED"));
    }
  };
  const verifyEmail = async (u: UserRow) => {
    try {
      await patchUser(u.id, { emailConfirm: true });
      toast.success(`Email verified for ${u.name ?? u.email}`);
      load();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "REQUEST_FAILED"));
    }
  };
  const toggleCreatorVerified = async (u: UserRow) => {
    try {
      await patchUser(u.id, { creatorVerified: !u.creatorVerified });
      toast.success(
        `${u.creatorVerified ? "Removed" : "Added"} creator badge for ${u.name ?? u.email}`,
      );
      load();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "REQUEST_FAILED"));
    }
  };
  const bulkRole = async (role: AppRole) => {
    const results = await Promise.allSettled([...selected].map((id) => patchUser(id, { role })));
    const failed = results.filter((r) => r.status === "rejected").length;
    toast[failed ? "error" : "success"](
      failed
        ? `Assigned ${role} to ${results.length - failed}, ${failed} failed`
        : `Assigned ${role} to ${results.length} users`,
    );
    setSelected(new Set());
    load();
  };
  const bulkBan = async (banDuration: string, label: string) => {
    const results = await Promise.allSettled(
      [...selected].map((id) => patchUser(id, { banDuration })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    toast[failed ? "error" : "success"](
      failed
        ? `${label} ${results.length - failed}, ${failed} failed`
        : `${label} ${results.length} users`,
    );
    setSelected(new Set());
    load();
  };

  const resetPassword = async (u: UserRow) => {
    if (!u.email) return;
    try {
      const response = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "RESET_FAILED");
      toast.success(`Password reset email sent to ${u.email}`);
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "RESET_FAILED"));
    }
  };
  const impersonate = async (u: UserRow) => {
    try {
      const response = await fetch("/api/admin/users/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "LINK_FAILED");
      setImpersonateLink(data.data.url);
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "LINK_FAILED"));
    }
  };

  const removeUser = async (u: UserRow) => {
    try {
      const response = await fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "DELETE_FAILED");
      toast.success(`${u.name ?? u.email} was deleted`);
      setDeleting(null);
      load();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "DELETE_FAILED"));
    }
  };
  const bulkDelete = async () => {
    const results = await Promise.allSettled(
      [...selected].map((id) => fetch(`/api/admin/users?id=${id}`, { method: "DELETE" })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    toast[failed ? "error" : "success"](
      failed
        ? `Deleted ${results.length - failed}, ${failed} failed`
        : `Deleted ${results.length} users`,
    );
    setSelected(new Set());
    setBulkDeleting(false);
    load();
  };

  const bulkExport = () => {
    const rows = selected.size > 0 ? filtered.filter((u) => selected.has(u.id)) : filtered;
    const csv = [
      "Name,Email,Role,Status,Created",
      ...rows.map((u) =>
        [u.name ?? "", u.email ?? "", u.role, u.status, u.created_at]
          .map((v) => `"${v}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} users from this page as CSV`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every real Tubify account. Role changes here are the same ones in Roles &amp;
            Permissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDirectoryOpen(true)}
            className="flex h-9 items-center rounded-[var(--button-radius)] border border-border px-3.5 text-sm font-medium hover:bg-accent"
          >
            Directory health
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" /> Invite User
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AdminKpiCard
          icon={Users}
          tone="blue"
          title="Total Users"
          value={stats ? stats.total.toLocaleString() : "…"}
        />
        <AdminKpiCard
          icon={UserCheck}
          tone="green"
          title="Active"
          value={stats ? stats.active.toLocaleString() : "…"}
        />
        <AdminKpiCard
          icon={Ban}
          tone="red"
          title="Banned"
          value={stats ? stats.banned.toLocaleString() : "…"}
        />
        <AdminKpiCard
          icon={Clock}
          tone="amber"
          title="Pending"
          value={stats ? stats.pending.toLocaleString() : "…"}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or user ID…"
            aria-label="Search users by name, email or user ID"
            maxLength={100}
            className="h-9 w-full rounded-[var(--input-radius)] border border-border bg-accent/20 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as "All" | AppRole)}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All roles</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Sort users">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1.5">
          {(["All", "Active", "Banned", "Pending"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-[var(--button-radius)] px-3 py-1.5 text-xs font-medium ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {query.trim().length === 1 && (
        <p className="mt-2 text-xs text-muted-foreground">Type at least 2 characters to search.</p>
      )}
      {status === "error" && loadError === "ADMIN_USERS_DIRECTORY_INCOMPLETE" && (
        <div className="mt-4 rounded-xl border border-dashed border-border p-5">
          <p className="mb-3 text-sm text-muted-foreground">
            The user directory is still being built, so the list is not shown yet — a partial list
            would look complete when it isn&apos;t.
          </p>
          <UserDirectoryMaintenance onComplete={() => setRetryNonce((n) => n + 1)} />
        </div>
      )}
      {status === "error" && loadError !== "ADMIN_USERS_DIRECTORY_INCOMPLETE" && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {LOAD_ERROR_MESSAGE[loadError ?? ""] ?? "Couldn't load users."}
          </p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button
              onClick={() => void bulkBan("24h", "Suspended")}
              className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Bulk Suspend (24h)
            </button>
            <button
              onClick={bulkExport}
              className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Export selected
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-[var(--button-radius)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent">
                  Bulk Role…
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {ROLE_OPTIONS.map((r) => (
                  <DropdownMenuItem key={r} onSelect={() => void bulkRole(r)}>
                    {ROLE_LABEL[r]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => setBulkDeleting(true)}
              className="rounded-[var(--button-radius)] bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Bulk Delete
            </button>
          </div>
        </div>
      )}

      <div
        className={`mt-4 hidden overflow-x-auto rounded-xl border border-border ${status === "error" ? "" : "sm:block"}`}
        aria-busy={status === "loading"}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-5 py-3">
                <Checkbox
                  checked={
                    selected.size > 0 && selected.size === filtered.length && filtered.length > 0
                  }
                  onCheckedChange={toggleAll}
                  disabled={filtered.length === 0}
                />
              </th>
              <th className="px-3 py-3 font-medium">User</th>
              <th className="px-3 py-3 font-medium">Role</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Verified</th>
              <th className="px-3 py-3 font-medium">Last Login</th>
              <th className="px-3 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-card">
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                <td className="px-5 py-3.5">
                  <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} />
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-3">
                    {u.avatar ? (
                      <img
                        referrerPolicy="no-referrer"
                        src={u.avatar}
                        alt={u.name ?? ""}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold">
                        {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetailUser(u)}
                      className="min-w-0 text-left hover:text-primary"
                    >
                      <p className="truncate font-medium">{u.name ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </button>
                  </div>
                </td>
                <td className="px-3 py-3.5 text-muted-foreground">{ROLE_LABEL[u.role]}</td>
                <td className="px-3 py-3.5">
                  <span
                    className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-medium ${statusColor[u.status]}`}
                  >
                    {u.status === "Banned" ? banLabel(u.bannedUntil) : u.status}
                  </span>
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-1">
                    {u.emailVerified ? (
                      <BadgeCheck className="h-4 w-4 text-success" aria-label="Email verified" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Unverified</span>
                    )}
                    {u.creatorVerified && (
                      <BadgeCheck
                        className="h-4 w-4 text-brand-purple"
                        aria-label="Creator verified"
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3.5 text-muted-foreground">
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "Never"}
                </td>
                <td className="px-3 py-3.5 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="User actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => void impersonate(u)}>
                        <Eye className="mr-2 h-4 w-4" /> Get impersonation link
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void resetPassword(u)}>
                        <KeyRound className="mr-2 h-4 w-4" /> Send password reset
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {!u.emailVerified && (
                        <DropdownMenuItem onSelect={() => void verifyEmail(u)}>
                          <BadgeCheck className="mr-2 h-4 w-4" /> Verify email
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => void toggleCreatorVerified(u)}>
                        <BadgeCheck className="mr-2 h-4 w-4" />
                        {u.creatorVerified ? "Remove creator badge" : "Verify creator"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Access</DropdownMenuLabel>
                      {u.status === "Banned" ? (
                        <DropdownMenuItem onSelect={() => void setBan(u, "none", "was unbanned")}>
                          <PlayCircle className="mr-2 h-4 w-4" /> Unban
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem
                            onSelect={() => void setBan(u, "24h", "was suspended for 24h")}
                          >
                            <PauseCircle className="mr-2 h-4 w-4" /> Suspend (24h)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void setBan(u, "876000h", "was banned")}
                            className="text-destructive focus:text-destructive"
                          >
                            <Ban className="mr-2 h-4 w-4" /> Ban permanently
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleting(u)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete user
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">
                  {status === "loading" ? "Loading users…" : "No users match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className={`mt-4 space-y-3 sm:hidden ${status === "error" ? "hidden" : ""}`}>
        {filtered.map((u) => (
          <div key={u.id} className="relative rounded-xl card-gradient-outline p-4">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} />
                {u.avatar ? (
                  <img
                    referrerPolicy="no-referrer"
                    src={u.avatar}
                    alt={u.name ?? ""}
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold">
                    {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setDetailUser(u)}
                  className="min-w-0 text-left"
                >
                  <p className="truncate font-medium">{u.name ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="shrink-0 text-muted-foreground hover:text-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => void impersonate(u)}>
                    <Eye className="mr-2 h-4 w-4" /> Impersonation link
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void resetPassword(u)}>
                    <KeyRound className="mr-2 h-4 w-4" /> Reset password
                  </DropdownMenuItem>
                  {u.status === "Banned" ? (
                    <DropdownMenuItem onSelect={() => void setBan(u, "none", "was unbanned")}>
                      <PlayCircle className="mr-2 h-4 w-4" /> Unban
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={() => void setBan(u, "24h", "was suspended for 24h")}
                    >
                      <PauseCircle className="mr-2 h-4 w-4" /> Suspend
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => setDeleting(u)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${statusColor[u.status]}`}
              >
                {u.status === "Banned" ? banLabel(u.bannedUntil) : u.status}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {ROLE_LABEL[u.role]} · last login{" "}
                {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "never"}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {status === "loading" ? "Loading users…" : "No users match your filters."}
          </p>
        )}
      </div>

      {status !== "error" && (rows.length > 0 || currentPage > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span aria-live="polite">
            {rows.length
              ? `Showing ${firstShown.toLocaleString()}–${lastShown.toLocaleString()}${total !== null ? ` of ${total.toLocaleString()}` : ""}`
              : "No more users"}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrevious}
              disabled={currentPage === 0 || status === "loading"}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!nextCursor || status === "loading"}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-50"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <UserDetailSheet user={detailUser} onOpenChange={(open) => !open && setDetailUser(null)} />
      <Sheet open={directoryOpen} onOpenChange={setDirectoryOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>User directory</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {directoryOpen && (
              <UserDirectoryMaintenance onComplete={() => setRetryNonce((n) => n + 1)} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <CreateUserDialog open={creating} onOpenChange={setCreating} onCreated={load} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name ?? deleting?.email}?`}
        description="This permanently deletes their real Supabase account. This cannot be undone."
        onConfirm={() => deleting && void removeUser(deleting)}
      />
      <ConfirmDialog
        open={bulkDeleting}
        onOpenChange={setBulkDeleting}
        title={`Delete ${selected.size} users?`}
        description="This permanently deletes their real Supabase accounts. This cannot be undone."
        onConfirm={() => void bulkDelete()}
      />
      <Dialog open={!!impersonateLink} onOpenChange={(v) => !v && setImpersonateLink(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>One-time sign-in link</DialogTitle>
            <DialogDescription>
              Open this in a new private window to sign in as that user. It's single-use and logged
              to the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={impersonateLink ?? ""} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                if (impersonateLink) void navigator.clipboard.writeText(impersonateLink);
                toast.success("Copied to clipboard");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setImpersonateLink(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("user");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setRole("user");
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Email is required");
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || null, role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "INVITE_FAILED");
      toast.success(`Invite sent to ${email}`);
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast.error(errorMessage(error instanceof Error ? error.message : "INVITE_FAILED"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Sends a real Supabase invite email — they'll set their own password and show as Pending
            until they accept it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              <UserPlus className="mr-2 h-4 w-4" /> {submitting ? "Sending…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type UserDetail = {
  identity: {
    id: string;
    name: string | null;
    email: string | null;
    role: AppRole;
    createdAt: string;
  };
  account: {
    status: UserStatus | null;
    emailVerified: boolean;
    creatorVerified: boolean;
    bannedUntil: string | null;
    lastSignInAt: string | null;
  };
  workspaces: {
    total: number;
    items: {
      workspaceId: string;
      name: string | null;
      isOwner: boolean;
      role: string;
      status: string;
      joinedAt: string | null;
    }[];
  };
  subscription: {
    plan: string | null;
    status: string;
    billingInterval: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  channels: {
    total: number;
    items: {
      id: string;
      name: string;
      handle: string | null;
      connected: boolean;
      lastSyncedAt: string | null;
      lastSyncStatus: string | null;
    }[];
  };
  recentAdminActions: { action: string; at: string }[];
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "—");

// One account in detail: identity and status, workspaces, plan, channels and the latest admin
// actions on it. Read-only — the actions stay in the row menu.
function UserDetailSheet({
  user,
  onOpenChange,
}: {
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setDetail(null);
    setState("loading");
    fetch(`/api/admin/users/detail?${new URLSearchParams({ id: user.id })}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { data?: UserDetail };
        if (!response.ok || !body.data) throw new Error();
        setDetail(body.data);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [user]);

  return (
    <Sheet open={!!user} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{user?.name ?? user?.email ?? "User"}</SheetTitle>
        </SheetHeader>
        {state === "loading" && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
        {state === "error" && (
          <p className="mt-4 text-sm text-muted-foreground">Couldn't load this user.</p>
        )}
        {state === "ready" && detail && (
          <div className="mt-4 space-y-5 text-sm">
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </h4>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate">{detail.identity.email ?? "—"}</dd>
                <dt className="text-muted-foreground">User ID</dt>
                <dd className="truncate font-mono text-xs">{detail.identity.id}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{ROLE_LABEL[detail.identity.role]}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  {detail.account.status === "Banned"
                    ? banLabel(detail.account.bannedUntil)
                    : (detail.account.status ?? "—")}
                </dd>
                <dt className="text-muted-foreground">Email verified</dt>
                <dd>{detail.account.emailVerified ? "Yes" : "No"}</dd>
                <dt className="text-muted-foreground">Creator badge</dt>
                <dd>{detail.account.creatorVerified ? "Yes" : "No"}</dd>
                <dt className="text-muted-foreground">Joined</dt>
                <dd>{formatDate(detail.identity.createdAt)}</dd>
                <dt className="text-muted-foreground">Last sign-in</dt>
                <dd>
                  {detail.account.lastSignInAt ? formatDate(detail.account.lastSignInAt) : "Never"}
                </dd>
              </dl>
            </section>

            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Subscription
              </h4>
              {detail.subscription ? (
                <p className="mt-2">
                  {detail.subscription.plan ?? "Unknown plan"} · {detail.subscription.status} ·{" "}
                  {detail.subscription.billingInterval === "year" ? "yearly" : "monthly"}
                  {detail.subscription.currentPeriodEnd
                    ? ` · ${detail.subscription.cancelAtPeriodEnd ? "ends" : "renews"} ${formatDate(detail.subscription.currentPeriodEnd)}`
                    : ""}
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground">No subscription.</p>
              )}
            </section>

            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspaces ({detail.workspaces.total})
              </h4>
              {detail.workspaces.items.length ? (
                <ul className="mt-2 space-y-1.5">
                  {detail.workspaces.items.map((w) => (
                    <li key={w.workspaceId} className="flex justify-between gap-2">
                      <span className="truncate">{w.name ?? "Untitled workspace"}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {w.isOwner ? "Owner" : w.role}
                        {w.status !== "active" ? ` · ${w.status}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">Not in any workspace.</p>
              )}
              {detail.workspaces.total > detail.workspaces.items.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing the latest {detail.workspaces.items.length}.
                </p>
              )}
            </section>

            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                YouTube channels ({detail.channels.total})
              </h4>
              {detail.channels.items.length ? (
                <ul className="mt-2 space-y-1.5">
                  {detail.channels.items.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {c.connected ? `synced ${formatDate(c.lastSyncedAt)}` : "disconnected"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">No channels connected.</p>
              )}
            </section>

            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent admin actions
              </h4>
              {detail.recentAdminActions.length ? (
                <ul className="mt-2 space-y-1.5">
                  {detail.recentAdminActions.map((a, i) => (
                    <li key={`${a.action}-${a.at}-${i}`} className="flex justify-between gap-2">
                      <span className="truncate">{a.action.replaceAll("_", " ")}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(a.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">None recorded.</p>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
