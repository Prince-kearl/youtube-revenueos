import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { UserPlus, Users, Mail, Percent, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { TeamMemberDialog, ConfirmDialog } from "@/components/modals";
import { useTeam, TeamMember, TeamRole } from "@/lib/stores";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/team")({
  component: Team,
});

const roleColor: Record<TeamRole, string> = {
  Owner: "bg-brand-purple/15 text-brand-purple",
  Manager: "bg-brand-blue/15 text-brand-blue",
  Setter: "bg-brand-green/15 text-brand-green",
  Editor: "bg-brand-amber/15 text-brand-amber",
};

const shareColors = ["var(--color-brand-purple)", "var(--color-brand-blue)", "var(--color-brand-green)", "var(--color-brand-amber)", "var(--color-brand-red)"];

function Team() {
  const [members, setMembers] = useTeam();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState<TeamMember | null>(null);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "Active").length;
    const invited = members.filter((m) => m.status === "Invited").length;
    const withCommission = members.filter((m) => m.commission > 0);
    const avgCommission = withCommission.length
      ? Math.round(withCommission.reduce((a, m) => a + m.commission, 0) / withCommission.length)
      : 0;
    return { active, invited, avgCommission };
  }, [members]);

  const distributed = members.filter((m) => m.leadShare > 0);

  const save = (m: TeamMember) =>
    setMembers((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : [m, ...prev]));
  const remove = (m: TeamMember) => {
    setMembers((prev) => prev.filter((x) => x.id !== m.id));
    toast.success(`${m.name} removed from the team`);
  };

  return (
    <DashboardLayout title="Team">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite teammates, assign roles, and split lead distribution & commission across your pipeline.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <UserPlus className="h-4 w-4" /> Invite Member
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />} value={String(members.length)} label="Total Members" />
        <StatCard icon={<Users className="h-5 w-5" />} value={String(stats.active)} label="Active" />
        <StatCard icon={<Mail className="h-5 w-5" />} value={String(stats.invited)} label="Pending Invites" />
        <StatCard icon={<Percent className="h-5 w-5" />} value={`${stats.avgCommission}%`} label="Avg Commission" />
      </div>

      {distributed.length > 0 && (
        <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="font-semibold">Lead Distribution</h3>
          <p className="mt-1 text-sm text-muted-foreground">Percentage of new leads auto-assigned to each teammate.</p>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-accent">
            {distributed.map((m, i) => (
              <div key={m.id} style={{ width: `${m.leadShare}%`, background: shareColors[i % shareColors.length] }} title={`${m.name} — ${m.leadShare}%`} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {distributed.map((m, i) => (
              <span key={m.id} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: shareColors[i % shareColors.length] }} />
                {m.name} · {m.leadShare}%
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {members.map((m) => (
          <div key={m.id} className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <img src={m.avatar} alt={m.name} className="h-11 w-11 rounded-full object-cover" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground" aria-label="Member actions"><MoreHorizontal className="h-4 w-4" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(m)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDeleting(m)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Remove</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${roleColor[m.role]}`}>{m.role}</span>
              <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${m.status === "Active" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                {m.status}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-accent/30 p-3 text-center text-xs">
              <div>
                <p className="text-muted-foreground">Lead Share</p>
                <p className="mt-0.5 font-semibold">{m.leadShare}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Commission</p>
                <p className="mt-0.5 font-semibold">{m.commission}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <TeamMemberDialog open={creating} onOpenChange={setCreating} onSave={save} />
      <TeamMemberDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} onSave={save} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        description="They'll lose access to the team inbox and pipeline. This cannot be undone."
        onConfirm={() => { if (deleting) remove(deleting); setDeleting(null); }}
      />
    </DashboardLayout>
  );
}
