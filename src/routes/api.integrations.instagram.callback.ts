import { createFileRoute } from "@tanstack/react-router";
import { completeProviderConnection } from "./api.integrations";
export const Route = createFileRoute("/api/integrations/instagram/callback")({
  server: { handlers: { GET: ({ request }) => completeProviderConnection(request, "instagram") } },
});
