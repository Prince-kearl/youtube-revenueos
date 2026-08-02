import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Sparkles, Loader2, FileText, Workflow, Code2, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmDialog } from "@/components/modals";
import { createGenerationJob, getGenerationJob, type GenerationJob } from "@/lib/mock-generation";
import { useProjectJobs } from "@/lib/stores";
import { toast } from "sonner";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [jobs, setJobs] = useProjectJobs();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<GenerationJob | null>(null);

  const canSubmit = useMemo(() => title.trim().length > 0 && prompt.trim().length > 0, [title, prompt]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    const created = createGenerationJob({
      title: title.trim(),
      prompt: prompt.trim(),
      references: ["reference sketch", "product brief"],
    });
    setJobs((current) => [created, ...current]);
    setTitle("");
    setPrompt("");

    setTimeout(() => {
      const updated = getGenerationJob(created.jobId);
      if (updated) setJobs((current) => current.map((j) => (j.jobId === updated.jobId ? updated : j)));
      setIsSubmitting(false);
    }, 1400);
  }

  const removeJob = (job: GenerationJob) => {
    setJobs((current) => current.filter((j) => j.jobId !== job.jobId));
    toast.success("Project removed");
  };

  return (
    <DashboardLayout title="Projects">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create prompts, queue AI generation, and review starter outputs.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4" /> Mock AI generation ready
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={handleSubmit} className="rounded-xl card-gradient-outline p-5">
          <h2 className="text-lg font-semibold">Create a new project</h2>
          <p className="mt-1 text-sm text-muted-foreground">Describe the product idea and queue a mock generation run.</p>

          <label className="mt-5 block text-sm font-medium">Project title</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Creator CRM"
            className="mt-2 w-full rounded-xl border border-border bg-accent/20 px-3 py-2.5 text-sm outline-none focus:border-primary"
          />

          <label className="mt-4 block text-sm font-medium">Prompt</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="Design a modern analytics workspace for creators to manage revenue and brand deals."
            className="mt-2 w-full resize-none rounded-xl border border-border bg-accent/20 px-3 py-2.5 text-sm outline-none focus:border-primary"
          />

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isSubmitting ? "Generating..." : "Generate project"}
          </button>
        </form>

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent jobs</h2>
            <span className="rounded-md bg-accent px-2.5 py-1 text-xs text-muted-foreground">Mock queue</span>
          </div>

          <div className="mt-4 space-y-3">
            {jobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No jobs yet. Create a project to see the mock generation workflow.
              </div>
            ) : (
              jobs.map((job) => (
                <div key={job.jobId} className="rounded-xl border border-border bg-accent/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{job.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{job.prompt}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium capitalize text-foreground">
                        {job.status}
                      </span>
                      <button onClick={() => setDeleting(job)} className="text-muted-foreground hover:text-destructive" aria-label="Delete project">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {job.output ? (
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2"><FileText className="h-4 w-4" />{job.output.summary}</div>
                      <div className="flex items-center gap-2"><Workflow className="h-4 w-4" />{job.output.wireframes[0]}</div>
                      <div className="flex items-center gap-2"><Code2 className="h-4 w-4" />{job.output.developerHandoff[0]}</div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.title}"?`}
        description="This removes the project and its generated output. This cannot be undone."
        onConfirm={() => { if (deleting) removeJob(deleting); setDeleting(null); }}
      />
    </DashboardLayout>
  );
}
