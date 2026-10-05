// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vercel is the current deployment target (wrangler.jsonc/Cloudflare KV are inert here — see
// that file's comment). Migrating to Hetzner later should only require changing this preset
// (e.g. to "node-server") plus environment variables, not application code.
//
// Declared as its own object because the Lovable wrapper's type only lists a few nitro options,
// although it passes the whole object through to nitro — routeRules does reach the build (see the
// headers route in .vercel/output/config.json).
const nitro = {
  preset: "vercel",
  // Baseline security headers on every response (pages, API and static assets). frame-ancestors
  // blocks clickjacking while still letting the Lovable editor embed its preview. Deliberately
  // not a full script/style CSP — that needs per-page testing before it can be enforced.
  routeRules: {
    "/**": {
      headers: {
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy":
          "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://*.lovable.app",
      },
    },
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro,
});
