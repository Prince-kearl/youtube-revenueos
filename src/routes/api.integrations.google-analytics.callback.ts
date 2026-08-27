import { createFileRoute } from "@tanstack/react-router";
import { completeProviderConnection } from "./api.integrations";
export const Route = createFileRoute("/api/integrations/google-analytics/callback")({ server: { handlers: { GET: ({ request }) => completeProviderConnection(request, "google_analytics") } } });