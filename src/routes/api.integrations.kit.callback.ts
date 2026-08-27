import { createFileRoute } from "@tanstack/react-router";
import { completeProviderConnection } from "./api.integrations";
export const Route = createFileRoute("/api/integrations/kit/callback")({ server: { handlers: { GET: ({ request }) => completeProviderConnection(request, "kit") } } });