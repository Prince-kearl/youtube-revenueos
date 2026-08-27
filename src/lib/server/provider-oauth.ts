import { encryptSecretToBytea } from "./crypto";
import { requireServerEnv } from "./env";

export type ExternalProvider = "google_analytics" | "stripe" | "kit";

const config = {
  google_analytics: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET", redirectUri: "GOOGLE_ANALYTICS_REDIRECT_URI", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/userinfo.profile" },
  stripe: { clientId: "STRIPE_CONNECT_CLIENT_ID", clientSecret: "STRIPE_SECRET_KEY", redirectUri: "STRIPE_CONNECT_REDIRECT_URI", authorize: "https://connect.stripe.com/oauth/authorize", token: "https://connect.stripe.com/oauth/token", scope: "read_write" },
  kit: { clientId: "KIT_CLIENT_ID", clientSecret: "KIT_CLIENT_SECRET", redirectUri: "KIT_REDIRECT_URI", authorize: "https://app.kit.com/oauth/authorize", token: "https://api.kit.com/v4/oauth/token", scope: "" },
} as const;

export function providerConfig(provider: ExternalProvider) {
  return config[provider];
}

export function providerRedirectUri(provider: ExternalProvider) {
  return requireServerEnv(config[provider].redirectUri);
}

export function buildProviderAuthorizationUrl(provider: ExternalProvider, state: string) {
  const current = config[provider];
  const url = new URL(current.authorize);
  url.searchParams.set("client_id", requireServerEnv(current.clientId));
  url.searchParams.set("redirect_uri", providerRedirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (current.scope) url.searchParams.set("scope", current.scope);
  return url.toString();
}

export async function exchangeProviderCode(provider: ExternalProvider, code: string) {
  const current = config[provider];
  const body = new URLSearchParams({
    code,
    client_id: requireServerEnv(current.clientId),
    client_secret: requireServerEnv(current.clientSecret),
    redirect_uri: providerRedirectUri(provider),
    grant_type: "authorization_code",
  });
  const response = await fetch(current.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`PROVIDER_TOKEN_FAILED:${provider}:${response.status}`);
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number; stripe_user_id?: string; account_id?: string };
}

export async function encryptProviderTokens(tokens: { access_token: string; refresh_token?: string; expires_in?: number }) {
  return {
    accessTokenCiphertext: await encryptSecretToBytea(tokens.access_token),
    refreshTokenCiphertext: tokens.refresh_token ? await encryptSecretToBytea(tokens.refresh_token) : null,
    tokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
  };
}