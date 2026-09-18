import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Sparkles,
  Loader2,
  FileText,
  Workflow,
  GitBranch,
  Code2,
  Trash2,
  Clock,
  AlertTriangle,
  RefreshCw,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmDialog } from "@/components/modals";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

type ProjectStatus = "queued" | "processing" | "completed" | "failed";

type ProjectOutput = {
  summary: string;
  wireframes: string[];
  flowchart: string[];
  developerHandoff: string[];
};

type Project = {
  id: string;
  title: string;
  prompt: string;
  status: ProjectStatus;
  output: ProjectOutput | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_STYLES: Record<ProjectStatus, { label: string; badge: string }> = {
  queued: { label: "Queued", badge: "bg-accent text-muted-foreground" },
  processing: { label: "Generating…", badge: "bg-primary/15 text-primary" },
  completed: { label: "Ready", badge: "bg-success/15 text-success" },
  failed: { label: "Failed", badge: "bg-destructive/15 text-destructive" },
};

function errorMessage(error: string): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "Add a title and a prompt before generating a project.",
    AI_PROVIDER_NOT_CONFIGURED: "AI generation isn't configured yet. Add a provider API key in Settings.",
    DATABASE_ERROR: "We couldn't save that. Please try again.",
    SERVER_MISCONFIGURED: "Something went wrong. Please try again in a moment.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

function outputFileCount(project: Project): number {
  if (!project.output) return 0;
  return (
    1 +
    project.output.wireframes.length +
    project.output.flowchart.length +
    project.output.developerHandoff.length
  );
}

// Purely decorative variety so a grid of projects isn't a wall of identical gold folders — status
// is still communicated separately via StatusBadge, so recoloring here can't hide real state.
const FOLDER_PALETTE = [
  { "--folder-back-1": "#f7c14b", "--folder-back-2": "#e9a52f", "--folder-front-1": "#ffd970", "--folder-front-2": "#fbc548", "--folder-edge": "#d68f23" }, // gold
  { "--folder-back-1": "#7fb0f5", "--folder-back-2": "#4f86d9", "--folder-front-1": "#a9cdfc", "--folder-front-2": "#7fb0f5", "--folder-edge": "#4f86d9" }, // blue
  { "--folder-back-1": "#8fd699", "--folder-back-2": "#5cb86b", "--folder-front-1": "#b6ecc0", "--folder-front-2": "#8fd699", "--folder-edge": "#5cb86b" }, // green
  { "--folder-back-1": "#c9a6f0", "--folder-back-2": "#a370df", "--folder-front-1": "#ddc2fa", "--folder-front-2": "#c9a6f0", "--folder-edge": "#a370df" }, // purple
  { "--folder-back-1": "#f6a8c9", "--folder-back-2": "#e97ba9", "--folder-front-1": "#fccfe1", "--folder-front-2": "#f6a8c9", "--folder-edge": "#e97ba9" }, // pink
  { "--folder-back-1": "#7ed7d1", "--folder-back-2": "#45b6ae", "--folder-front-1": "#aeeae6", "--folder-front-2": "#7ed7d1", "--folder-edge": "#45b6ae" }, // teal
  { "--folder-back-1": "#f5a35f", "--folder-back-2": "#e8823a", "--folder-front-1": "#fbc998", "--folder-front-2": "#f5a35f", "--folder-edge": "#e8823a" }, // orange
  { "--folder-back-1": "#f0959a", "--folder-back-2": "#dd6870", "--folder-front-1": "#f8bfc2", "--folder-front-2": "#f0959a", "--folder-edge": "#dd6870" }, // rose
] satisfies Record<string, string>[];

function folderColorVars(projectId: string): CSSProperties {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return FOLDER_PALETTE[hash % FOLDER_PALETTE.length] as CSSProperties;
}

// Statuses other than "completed" get a small badge over the folder, since the glossy shape
// itself has no built-in status slot and a "ready" folder needs no extra explanation.
function StatusBadge({ status }: { status: ProjectStatus }) {
  if (status === "completed") return null;
  const badgeStyle =
    status === "processing"
      ? "bg-primary text-primary-foreground"
      : status === "failed"
        ? "bg-destructive text-destructive-foreground"
        : "bg-muted-foreground text-background";
  return (
    <span
      className={cn(
        "absolute right-1 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full shadow",
        badgeStyle,
      )}
      aria-hidden="true"
    >
      {status === "processing" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === "failed" ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
    </span>
  );
}

function ProjectFolder({
  project,
  selected,
  onSelect,
  onDelete,
}: {
  project: Project;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const fileCount = outputFileCount(project);
  const style = STATUS_STYLES[project.status];
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onDelete();
        }}
        aria-label="Delete project"
        className="absolute right-1.5 top-1.5 z-20 rounded-md p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <label className="folder" style={folderColorVars(project.id)}>
        <input
          type="checkbox"
          className="folder__toggle"
          checked={selected}
          onChange={onSelect}
          aria-label={selected ? `Close ${project.title}` : `Open ${project.title}`}
        />
        <span className="folder__shape">
          <span className="folder__back"></span>
          <span className="folder__papers">
            <span className="paper paper--1"></span>
            <span className="paper paper--2"></span>
            <span className="paper paper--3"></span>
          </span>
          <span className="folder__front"></span>
          <StatusBadge status={project.status} />
        </span>
        <span className="folder__meta">
          <span className="folder__title">{project.title}</span>
          <span className="folder__count">
            {project.output ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : style.label}
          </span>
        </span>
      </label>
    </div>
  );
}

function FolderSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2" aria-hidden="true">
      <Skeleton className="aspect-[5/4] w-full max-w-[6.5em] rounded-lg" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2.5 w-1/2" />
    </div>
  );
}

function DetailGroup({
  icon: Icon,
  label,
  items,
}: {
  icon: typeof FileText;
  label: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ProjectsPage() {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const canSubmit = useMemo(() => title.trim().length > 0 && prompt.trim().length > 0, [title, prompt]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    setPageStatus("loading");
    fetch("/api/projects", { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { data?: Project[]; error?: string };
        if (!response.ok || !body.data) throw new Error(body.error ?? "SERVER_MISCONFIGURED");
        setProjects(body.data);
        setPageStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPageStatus("error");
      });
    return () => controller.abort();
  }, [retryNonce]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), prompt: prompt.trim() }),
      });
      const body = (await response.json()) as { data?: Project; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "SERVER_MISCONFIGURED");
      setProjects((current) => [body.data as Project, ...current]);
      setSelectedProjectId(body.data.id);
      setTitle("");
      setPrompt("");
      if (body.data.status === "failed") {
        toast.error(body.data.error ?? "Generation failed. Try creating the project again.");
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "SERVER_MISCONFIGURED";
      toast.error(errorMessage(code));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeProject(project: Project) {
    const previous = projects;
    setProjects((current) => current.filter((p) => p.id !== project.id));
    if (selectedProjectId === project.id) setSelectedProjectId(null);
    try {
      const response = await fetch(`/api/projects?id=${project.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast.success("Project removed");
    } catch {
      setProjects(previous);
      toast.error("We couldn't remove that project. Please try again.");
    }
  }

  return (
    <DashboardLayout title="Projects">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Describe a product idea and let AI draft a starter concept.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4" /> AI-generated concepts
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={handleSubmit} className="rounded-xl card-gradient-outline p-5">
          <h2 className="text-lg font-semibold">Create a new project</h2>
          <p className="mt-1 text-sm text-muted-foreground">Describe the product idea and generate a starter concept.</p>

          <label className="mt-5 block text-sm font-medium">Project title</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Creator CRM"
            className="mt-2 w-full rounded-[10px] border border-border bg-accent/20 px-3 py-2.5 text-sm outline-none focus:border-primary"
          />

          <label className="mt-4 block text-sm font-medium">Prompt</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="Design a modern analytics workspace for creators to manage revenue and brand deals."
            className="mt-2 w-full resize-none rounded-[10px] border border-border bg-accent/20 px-3 py-2.5 text-sm outline-none focus:border-primary"
          />

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isSubmitting ? "Generating..." : "Generate project"}
          </button>
        </form>

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your projects</h2>
          </div>

          {pageStatus === "loading" && (
            <div
              className="mt-4 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5"
              aria-label="Loading projects"
              aria-busy="true"
            >
              {[1, 2, 3, 4, 5].map((item) => (
                <FolderSkeleton key={item} />
              ))}
            </div>
          )}

          {pageStatus === "error" && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <p>We couldn't load your projects.</p>
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          )}

          {pageStatus === "ready" && projects.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No projects yet. Create one and it’ll show up here as a folder you can open.
            </div>
          )}

          {pageStatus === "ready" && projects.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
              {projects.map((project) => (
                <ProjectFolder
                  key={project.id}
                  project={project}
                  selected={selectedProjectId === project.id}
                  onSelect={() =>
                    setSelectedProjectId((current) => (current === project.id ? null : project.id))
                  }
                  onDelete={() => setDeleting(project)}
                />
              ))}
            </div>
          )}

          {selectedProject && (
            <div className="mt-5 rounded-xl border border-border bg-accent/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{selectedProject.title}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        STATUS_STYLES[selectedProject.status].badge,
                      )}
                    >
                      {STATUS_STYLES[selectedProject.status].label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedProject.prompt}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProjectId(null)}
                  aria-label="Close project details"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedProject.output ? (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailGroup icon={FileText} label="Summary" items={[selectedProject.output.summary]} />
                  <DetailGroup icon={Workflow} label="Wireframes" items={selectedProject.output.wireframes} />
                  <DetailGroup icon={GitBranch} label="Flowchart" items={selectedProject.output.flowchart} />
                  <DetailGroup icon={Code2} label="Developer handoff" items={selectedProject.output.developerHandoff} />
                </div>
              ) : selectedProject.status === "failed" ? (
                <p className="mt-4 text-sm text-destructive">
                  {selectedProject.error ?? "Generation failed. Try creating the project again."}
                </p>
              ) : (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating your project…
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.title}"?`}
        description="This removes the project and its generated output. This cannot be undone."
        onConfirm={() => {
          if (deleting) removeProject(deleting);
          setDeleting(null);
        }}
      />
    </DashboardLayout>
  );
}
