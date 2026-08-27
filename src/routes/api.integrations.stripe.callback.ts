import { createFileRoute } from "@tanstack/react-router";
import { completeProviderConnection } from "./api.integrations";
export const Route = createFileRoute("/api/integrations/stripe/callback")({ server: { handlers: { GET: ({ request }) => completeProviderConnection(request, "stripe") } } });