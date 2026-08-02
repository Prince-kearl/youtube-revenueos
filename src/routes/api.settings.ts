import { createFileRoute } from "@tanstack/react-router";

// Backs global Customization/Design Studio settings (src/lib/stores.ts useSiteContent) via a
// Cloudflare KV namespace (see wrangler.jsonc), so a Superadmin's changes apply for every
// browser/device/user instead of just the one that made them — KV is nitro's own sanctioned way
// to reach Workers bindings from a route handler; TanStack Start's Request type doesn't expose
// them, see wrangler.jsonc's comment for how the binding gets there. Every write is a full
// overwrite of one JSON blob (the whole SiteContent object) — there's exactly one row here, not
// a table, so no schema/migrations are needed.
const SETTINGS_KEY = "site-content";

interface CloudflareEnv {
  SETTINGS_KV?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
}

// Nitro's cloudflare-module preset sets this on every request before your handler runs (see
// node_modules/nitro/dist/presets/cloudflare/runtime/_module-handler.mjs) — it's per-isolate, not
// per-request state, so reading it from a module-level function is safe. Absent entirely outside
// a deployed/`wrangler dev` Cloudflare runtime (e.g. plain `vite dev`), which is why every handler
// below treats a missing binding as "not configured yet" rather than throwing.
function getSettingsKv() {
  const env = (globalThis as Record<string, unknown>).__env__ as CloudflareEnv | undefined;
  return env?.SETTINGS_KV;
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: async () => {
        const kv = getSettingsKv();
        // 200, not 501 — this is the expected state in any environment without the KV binding
        // wired up (e.g. plain `vite dev`), not a server error, and callers already branch on
        // the `success` field rather than HTTP status. A non-2xx here would also make every
        // browser log a "failed to load resource" console error on every single settings edit
        // for as long as KV isn't configured, which is needlessly noisy for an expected case.
        if (!kv) return json({ success: false, error: "KV_NOT_CONFIGURED" });
        const raw = await kv.get(SETTINGS_KEY);
        return json({ success: true, content: raw ? JSON.parse(raw) : null });
      },
      PUT: async ({ request }) => {
        const kv = getSettingsKv();
        // 200, not 501 — this is the expected state in any environment without the KV binding
        // wired up (e.g. plain `vite dev`), not a server error, and callers already branch on
        // the `success` field rather than HTTP status. A non-2xx here would also make every
        // browser log a "failed to load resource" console error on every single settings edit
        // for as long as KV isn't configured, which is needlessly noisy for an expected case.
        if (!kv) return json({ success: false, error: "KV_NOT_CONFIGURED" });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ success: false, error: "INVALID_JSON" }, { status: 400 });
        }
        await kv.put(SETTINGS_KEY, JSON.stringify(body));
        return json({ success: true });
      },
    },
  },
});
