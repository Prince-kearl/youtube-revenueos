import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { buildSetCookie, getCookie, buildExpiredCookie } from "@/lib/server/cookies";
import { buildProviderAuthorizationUrl, exchangeProviderCode, encryptProviderTokens, type ExternalProvider } from "@/lib/server/provider-oauth";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";

const providers = ["google_analytics", "stripe", "kit"] as const;
function isProvider(value: string): value is ExternalProvider { return providers.includes(value as ExternalProvider); }
function json(body: unknown, init?: ResponseInit) { return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...init?.headers } }); }
function redirect(path: string, request: Request) { const appUrl = getServerEnv("APP_URL") ?? new URL(request.url).origin; return new Response(null, { status: 302, headers: { Location: `${appUrl}${path}` } }); }

export const Route = createFileRoute("/api/integrations")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        const { client } = await requireSessionUser(request);
        const { data, error } = await client.from("connected_integrations").select("id, provider, provider_account_id, account_name, metadata, connected_at, updated_at");
        if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
        return json({ data: data ?? [] });
      } catch (error) { if (error instanceof Response) return error; return json({ error: "SERVER_ERROR" }, { status: 500 }); }
    },
    DELETE: async ({ request }) => {
      try {
        const { client } = await requireSessionUser(request);
        const provider = new URL(request.url).searchParams.get("provider") ?? "";
        if (!isProvider(provider)) return json({ error: "INVALID_PROVIDER" }, { status: 422 });
        const { error } = await client.from("connected_integrations").delete().eq("provider", provider);
        if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
        return json({ success: true });
      } catch (error) { if (error instanceof Response) return error; return json({ error: "SERVER_ERROR" }, { status: 500 }); }
    },
    POST: async ({ request }) => {
      try {
        const { setCookieHeaders } = await requireSessionUser(request);
        const provider = new URL(request.url).searchParams.get("provider") ?? "";
        if (!isProvider(provider)) return json({ error: "INVALID_PROVIDER" }, { status: 422 });
        const state = crypto.randomUUID();
        const response = new Response(JSON.stringify({ url: buildProviderAuthorizationUrl(provider, state) }), { headers: { "Content-Type": "application/json" } });
        response.headers.append("Set-Cookie", buildSetCookie("provider_oauth_state", `${provider}:${state}`, { maxAge: 600 }));
        for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
        return response;
      } catch (error) { if (error instanceof Response) return error; return json({ error: error instanceof Error && error.message.startsWith("Missing required") ? "PROVIDER_NOT_CONFIGURED" : "SERVER_ERROR" }, { status: 500 }); }
    },
  } },
});

export async function completeProviderConnection(request: Request, provider: ExternalProvider) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const expected = getCookie(request, "provider_oauth_state");
  const returnTo = "/settings";
  if (!state || expected !== `${provider}:${state}`) return redirect(`${returnTo}?integration=invalid_state`, request);
  const { user, setCookieHeaders } = await requireSessionUser(request);
  const code = url.searchParams.get("code");
  if (!code) return redirect(`${returnTo}?integration=provider_error`, request);
  const tokens = await exchangeProviderCode(provider, code);
  const encrypted = await encryptProviderTokens(tokens);
  const service = createServiceSupabaseClient();
  const providerAccountId = provider === "stripe" ? tokens.stripe_user_id : tokens.account_id;
  const accountName = provider === "google_analytics" ? "Google Analytics account" : provider === "stripe" ? "Stripe account" : "Kit account";
  const { error } = await service.from("connected_integrations").upsert({ user_id: user.id, provider, provider_account_id: providerAccountId ?? null, account_name: accountName, ...encrypted }, { onConflict: "user_id,provider" });
  if (error) return redirect(`${returnTo}?integration=storage_failed`, request);
  const response = redirect(`${returnTo}?integration=${provider}`, request);
  response.headers.append("Set-Cookie", buildExpiredCookie("provider_oauth_state"));
  for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
  return response;
}