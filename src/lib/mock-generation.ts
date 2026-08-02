import { llm, type GenerationOutput } from "@/lib/llm";

export type { GenerationOutput };
export type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

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
  return job;
}

// Not called automatically by createGenerationJob — callers decide whether to await it directly
// (projects.tsx) or fire it in the background and let a client poll separately (api.generate.ts).
export async function processGenerationJob(jobId: string): Promise<GenerationJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  job.status = "running";
  job.updatedAt = new Date().toISOString();
  jobs.set(jobId, job);

  job.output = await llm.generateProjectConcept({ title: job.title, prompt: job.prompt });
  job.status = "completed";
  job.updatedAt = new Date().toISOString();
  jobs.set(jobId, job);
  return job;
}
