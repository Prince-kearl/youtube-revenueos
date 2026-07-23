import { useEffect, useState } from "react";
import { ShieldCheck, Plus, Copy, Pencil, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/modals";
import { useCustomRoles, PERMISSION_MODULES, type CustomRole, type PermissionModule } from "@/lib/stores";
import { uid } from "@/lib/local-store";
import { useAuditLogger } from "../useAuditLogger";

export function RolesSection() {
  const [roles, setRoles] = useCustomRoles();
  const log = useAuditLogger();
  const [editing, setEditing] = useState<CustomRole | null | "new">(null);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);

  const save = (role: CustomRole) => {
    setRoles((prev) => (prev.some((r) => r.id === role.id) ? prev.map((r) => (r.id === role.id ? role : r)) : [...prev, role]));
    log(roleExists(role, roles) ? "Updated role" : "Created role", "Roles", role.name);
  };
  const clone = (role: CustomRole) => {
    const copy: CustomRole = { ...role, id: uid(), name: `${role.name} (Copy)`, isSystem: false };
    setRoles((p) => [...p, copy]);
    log("Cloned role", "Roles", `${role.name} → ${copy.name}`);
    toast.success(`Cloned "${role.name}"`);
  };
  const remove = (role: CustomRole) => {
    setRoles((p) => p.filter((r) => r.id !== role.id));
    log("Deleted role", "Roles", role.name);
    toast.success(`Deleted role "${role.name}"`);
    setDeleting(null);
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create custom roles and control exactly which modules each one can reach.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Create Role
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <div key={role.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple"><ShieldCheck className="h-4 w-4" /></span>
                <p className="font-semibold">{role.name}</p>
              </div>
              {role.isSystem && <span className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-muted-foreground"><Lock className="h-3 w-3" /> System</span>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {role.permissions.slice(0, 4).map((p) => <span key={p} className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{p}</span>)}
              {role.permissions.length > 4 && <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">+{role.permissions.length - 4} more</span>}
            </div>
            <div className="mt-4 flex gap-2 border-t border-border pt-3">
              <button onClick={() => setEditing(role)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs font-medium hover:bg-accent"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              <button onClick={() => clone(role)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs font-medium hover:bg-accent"><Copy className="h-3.5 w-3.5" /> Clone</button>
              {!role.isSystem && (
                <button onClick={() => setDeleting(role)} className="flex items-center justify-center rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      <RoleDialog
        open={!!editing}
        role={editing === "new" ? null : editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSave={(r) => { save(r); setEditing(null); }}
      />
      <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete "${deleting?.name}"?`} description="Any admins assigned this role will lose the permissions it grants." onConfirm={() => deleting && remove(deleting)} />
    </div>
  );
}

function roleExists(role: CustomRole, roles: CustomRole[]) {
  return roles.some((r) => r.id === role.id);
}

function RoleDialog({ open, role, onOpenChange, onSave }: { open: boolean; role: CustomRole | null; onOpenChange: (v: boolean) => void; onSave: (r: CustomRole) => void }) {
  const [form, setForm] = useState<CustomRole>({ id: "", name: "", description: "", isSystem: false, permissions: [] });

  useEffect(() => {
    if (open) setForm(role ?? { id: uid(), name: "", description: "", isSystem: false, permissions: ["Dashboard"] });
  }, [open, role]);

  const togglePerm = (m: PermissionModule) => {
    setForm((f) => ({ ...f, permissions: f.permissions.includes(m) ? f.permissions.filter((p) => p !== m) : [...f.permissions, m] }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Role name is required");
    onSave(form);
    toast.success(role ? "Role updated" : "Role created");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? "Edit Role" : "Create Role"}</DialogTitle>
          <DialogDescription>Group permissions by module — assignees can only reach what's checked below.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Role name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={form.isSystem} /></div>
          <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Permissions by module</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border p-3">
              {PERMISSION_MODULES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.permissions.includes(m)} onCheckedChange={() => togglePerm(m)} />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{role ? "Save Changes" : "Create Role"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
