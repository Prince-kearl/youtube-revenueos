import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Positive if a > b, negative if a < b, 0 if equal. Neither side is well-formed → treated as
// equal (fails safe: never blocks/nags over an unparseable version rather than guessing).
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// Public, unauthenticated — every client (including one whose session has expired) needs to be
// able to check this. Reads through the service-role client since app_releases has no public RLS
// policy, but only ever returns the few fields below — no build metadata, no internal history,
// no other releases' notes.
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const service = createServiceSupabaseClient();
          const { data: current } = await service
            .from("app_releases")
            .select("version, release_name, release_notes, minimum_supported_version, published_at")
            .eq("is_current", true)
            .maybeSingle();
          if (!current) return json({ error: "NO_CURRENT_RELEASE" }, { status: 503 });

          const clientVersion = new URL(request.url).searchParams.get("clientVersion");
          const minimumSupportedVersion = current.minimum_supported_version;

          const updateAvailable = clientVersion
            ? compareSemver(current.version, clientVersion) > 0
            : false;
          const updateRequired =
            clientVersion && minimumSupportedVersion
              ? compareSemver(clientVersion, minimumSupportedVersion) < 0
              : false;

          return json({
            data: {
              currentVersion: current.version,
              releaseName: current.release_name,
              releaseNotes: current.release_notes,
              minimumSupportedVersion,
              publishedAt: current.published_at,
              clientVersion,
              updateAvailable,
              updateRequired,
            },
          });
        } catch {
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
