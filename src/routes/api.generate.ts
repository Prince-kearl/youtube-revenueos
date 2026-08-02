import { createFileRoute } from "@tanstack/react-router";
import { createGenerationJob, processGenerationJob } from "@/lib/mock-generation";

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            title?: string;
            prompt?: string;
            references?: string[];
          };
          const job = createGenerationJob({
            title: body.title ?? "Untitled project",
            prompt: body.prompt ?? "",
            references: body.references ?? [],
          });
          void processGenerationJob(job.jobId);
          return new Response(JSON.stringify({ success: true, job }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
