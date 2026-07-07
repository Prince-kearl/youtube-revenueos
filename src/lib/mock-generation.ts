export type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

export type GenerationOutput = {
  summary: string;
  wireframes: string[];
  flowchart: string[];
  developerHandoff: string[];
};

export type GenerationJob = {
  jobId: string;
  title: string;
  prompt: string;
  references: string[];
  status: GenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  output?: GenerationOutput;
  error?: string;
};

const jobs = new Map<string, GenerationJob>();

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildMockOutput(title: string, prompt: string): GenerationOutput {
  const topic = titleCase(title || prompt || "AI product");
  return {
    summary: `${topic} concept generated with a polished UI direction and a starter workflow.`,
    wireframes: [
      "Onboarding screen with clear CTA",
      "Dashboard layout with key metrics widgets",
      "Settings flow with saved preferences",
    ],
    flowchart: [
      "Prompt intake → concept board",
      "Wireframe sketch → polished UI",
      "Review loop → developer handoff",
    ],
    developerHandoff: [
      "Component map and layout tokens",
      "API contract for core actions",
      "Export-ready starter code bundle",
    ],
  };
}

export function listGenerationJobs(): GenerationJob[] {
  return Array.from(jobs.values()).sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
}

export function getGenerationJob(jobId: string): GenerationJob | undefined {
  return jobs.get(jobId);
}

export function createGenerationJob(input: { title: string; prompt: string; references: string[] }) {
  const jobId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const job: GenerationJob = {
    jobId,
    title: input.title || "Untitled Project",
    prompt: input.prompt,
    references: input.references,
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  jobs.set(jobId, job);
  void processGenerationJob(jobId);
  return job;
}

export async function processGenerationJob(jobId: string): Promise<GenerationJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  job.status = "running";
  job.updatedAt = new Date().toISOString();
  jobs.set(jobId, job);

  await new Promise((resolve) => setTimeout(resolve, 1200));

  job.status = "completed";
  job.output = buildMockOutput(job.title, job.prompt);
  job.updatedAt = new Date().toISOString();
  jobs.set(jobId, job);
  return job;
}
