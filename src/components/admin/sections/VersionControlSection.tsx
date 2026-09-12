import { useEffect, useState, type ReactNode } from "react";
import { Plus, RefreshCw, CheckCircle2, Undo2, Ban, Pencil } from "lucide-react";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/modals";

type ReleaseStatus = "draft" | "testing" | "published" | "deprecated" | "rolled_back";
type Release = {
  id: string;
  version: string;
  build_number: string | null;
  release_name: string | null;
  release_notes: string | null;
  status: ReleaseStatus;
  is_current: boolean;
  minimum_supported_version: string | null;
  created_at: string;
  published_at: string | null;
};
type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  created_at: string;
  admin: { name: string | null; email: string | null } | null;
};

const STATUS_STYLE: Record<ReleaseStatus, string> = {
  draft: "bg-accent text-muted-foreground",
  testing: "bg-warning/15 text-warning",
  published: "bg-success/15 text-success",
  deprecated: "bg-accent text-muted-foreground",
  rolled_back: "bg-destructive/15 text-destructive",
};

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    release_created: "Created release",
    release_edited: "Edited release",
    release_published: "Published release",
    release_deprecated: "Deprecated release",
    release_rolled_back: "Rolled back to release",
  };
  return labels[action] ?? action;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export function VersionControlSection() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [releases, setReleases] = useState<Release[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Release | null>(null);
  const [publishTarget, setPublishTarget] = useState<Release | null>(null);
  const [deprecateTarget, setDeprecateTarget] = useState<Release | null>(null);

  const load = () => {
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    Promise.all([
      fetch("/api/admin/releases", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/audit", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([releasesBody, auditBody]) => {
        if (!releasesBody.data) throw new Error();
        setReleases(releasesBody.data);
        setAuditLog(
          (auditBody.data ?? []).filter((e: AuditEntry) => e.action.startsWith("release_")),
        );
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, [retryNonce]);

  const current = releases.find((r) => r.is_current) ?? null;
  const isRollbackTarget = (release: Release) =>
    !!current && new Date(release.created_at) < new Date(current.created_at);

  const publish = async (id: string) => {
    try {
      const response = await fetch("/api/admin/releases/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "PUBLISH_FAILED");
      toast.success("Release marked as current");
      load();
    } catch {
      toast.error("Couldn't update the current release. Please try again.");
    }
  };

  const deprecate = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/releases?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "deprecated" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "DEPRECATE_FAILED");
      toast.success("Release deprecated");
      load();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "CANNOT_DEPRECATE_CURRENT_RELEASE"
          ? "Publish a different release as current before deprecating this one."
          : "Couldn't deprecate that release. Please try again.",
      );
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Version Control</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tubify's own release metadata — separate from git/source control and from the actual
        deployment infrastructure. Marking a release "current" updates what the app reports as its
        version; it does not redeploy or roll back code.
      </p>

      {status === "loading" && (
        <p className="mt-4 text-sm text-muted-foreground">Loading releases…</p>
      )}

      {status === "error" && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load releases.</p>
          <button
            onClick={() => setRetryNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          <div className="relative mt-4 rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            {current ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Current Version</p>
                  <p className="mt-1 text-xl font-bold">v{current.version}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <span
                    className={`mt-1 inline-flex rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[current.status]}`}
                  >
                    {current.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Released</p>
                  <p className="mt-1 text-sm font-medium">
                    {current.published_at
                      ? new Date(current.published_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Minimum Supported</p>
                  <p className="mt-1 text-sm font-medium">
                    {current.minimum_supported_version
                      ? `v${current.minimum_supported_version}`
                      : "—"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No release is currently marked as active.
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <h3 className="text-sm font-semibold">All Releases</h3>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Create Release
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Version</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Created</th>
                  <th className="px-3 py-3 font-medium">Published</th>
                  <th className="px-3 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {releases.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        v{r.version}{" "}
                        {r.is_current && (
                          <CheckCircle2 className="inline h-3.5 w-3.5 text-success" />
                        )}
                      </p>
                      {r.release_name && (
                        <p className="text-xs text-muted-foreground">{r.release_name}</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {r.published_at ? new Date(r.published_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {!r.is_current && (
                          <button
                            onClick={() => setPublishTarget(r)}
                            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                          >
                            <Undo2 className="h-3 w-3" />{" "}
                            {isRollbackTarget(r) ? "Rollback" : "Publish"}
                          </button>
                        )}
                        {!r.is_current && r.status !== "deprecated" && (
                          <button
                            onClick={() => setDeprecateTarget(r)}
                            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                          >
                            <Ban className="h-3 w-3" /> Deprecate
                          </button>
                        )}
                        <button
                          onClick={() => setEditing(r)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Edit release"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {auditLog.length > 0 && (
            <div className="mt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent release changes
              </h4>
              <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                {auditLog.slice(0, 8).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                  >
                    <span>
                      <span className="font-medium text-foreground">
                        {actionLabel(entry.action)}
                      </span>
                      {entry.target ? ` · v${entry.target}` : ""}
                      {entry.admin?.name ? ` · by ${entry.admin.name}` : ""}
                    </span>
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <CreateReleaseDialog open={creating} onOpenChange={setCreating} onCreated={load} />
      <EditReleaseDialog
        release={editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={load}
      />

      <ConfirmDialog
        open={!!publishTarget}
        onOpenChange={(v) => !v && setPublishTarget(null)}
        title={
          publishTarget
            ? `Are you sure you want to mark v${publishTarget.version} as the current release?`
            : ""
        }
        description="This changes Tubify's release metadata/state only — it does not redeploy code, run migrations, or touch your actual hosting infrastructure."
        confirmLabel="Mark release as current"
        destructive={false}
        onConfirm={() => {
          if (publishTarget) void publish(publishTarget.id);
          setPublishTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!deprecateTarget}
        onOpenChange={(v) => !v && setDeprecateTarget(null)}
        title={deprecateTarget ? `Deprecate v${deprecateTarget.version}?` : ""}
        description="Marks this release as no longer recommended. It stays in your release history."
        confirmLabel="Deprecate"
        destructive
        onConfirm={() => {
          if (deprecateTarget) void deprecate(deprecateTarget.id);
          setDeprecateTarget(null);
        }}
      />
    </div>
  );
}

function CreateReleaseDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [version, setVersion] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [minimumSupportedVersion, setMinimumSupportedVersion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setVersion("");
      setReleaseName("");
      setReleaseNotes("");
      setMinimumSupportedVersion("");
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d+\.\d+\.\d+$/.test(version.trim())) {
      return toast.error("Use semantic versioning, e.g. 1.5.0");
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: version.trim(),
          releaseName: releaseName.trim() || null,
          releaseNotes: releaseNotes.trim() || null,
          minimumSupportedVersion: minimumSupportedVersion.trim() || null,
          status: "draft",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "CREATE_FAILED");
      toast.success(`v${version} created as a draft`);
      onOpenChange(false);
      onCreated();
    } catch (error) {
      const code = error instanceof Error ? error.message : "CREATE_FAILED";
      toast.error(
        code === "VERSION_ALREADY_EXISTS"
          ? "That version already exists."
          : "Couldn't create the release.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Release</DialogTitle>
          <DialogDescription>
            Created as a draft — publish it separately when ready.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Version">
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.5.0"
              required
            />
          </Field>
          <Field label="Release name">
            <Input
              value={releaseName}
              onChange={(e) => setReleaseName(e.target.value)}
              placeholder="AI Video Intelligence"
            />
          </Field>
          <Field label="Release notes">
            <Textarea
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              rows={4}
              placeholder="• Improved video analysis&#10;• Added AI recommendations"
            />
          </Field>
          <Field label="Minimum supported version (optional)">
            <Input
              value={minimumSupportedVersion}
              onChange={(e) => setMinimumSupportedVersion(e.target.value)}
              placeholder="1.4.0"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Creating…" : "Create Release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditReleaseDialog({
  release,
  onOpenChange,
  onSaved,
}: {
  release: Release | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [releaseName, setReleaseName] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [minimumSupportedVersion, setMinimumSupportedVersion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (release) {
      setReleaseName(release.release_name ?? "");
      setReleaseNotes(release.release_notes ?? "");
      setMinimumSupportedVersion(release.minimum_supported_version ?? "");
    }
  }, [release]);

  if (!release) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/releases?id=${release.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseName: releaseName.trim() || null,
          releaseNotes: releaseNotes.trim() || null,
          minimumSupportedVersion: minimumSupportedVersion.trim() || null,
        }),
      });
      if (!response.ok) throw new Error();
      toast.success("Release updated");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Couldn't save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!release} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit v{release.version}</DialogTitle>
          <DialogDescription>Version numbers can't be changed after creation.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Release name">
            <Input value={releaseName} onChange={(e) => setReleaseName(e.target.value)} />
          </Field>
          <Field label="Release notes">
            <Textarea
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              rows={4}
            />
          </Field>
          <Field label="Minimum supported version">
            <Input
              value={minimumSupportedVersion}
              onChange={(e) => setMinimumSupportedVersion(e.target.value)}
              placeholder="1.4.0"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
