import { encryptSecretToBytea } from "./crypto";
import { requireServerEnv } from "./env";

export type ExternalProvider = "google_analytics" | "stripe" | "kit" | "instagram";

const config = {
  google_analytics: {
    clientId: "GOOGLE_CLIENT_ID",
    clientSecret: "GOOGLE_CLIENT_SECRET",
    redirectUri: "GOOGLE_ANALYTICS_REDIRECT_URI",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope:
      "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/userinfo.profile",
  },
  stripe: {
    clientId: "STRIPE_CONNECT_CLIENT_ID",
    clientSecret: "STRIPE_SECRET_KEY",
    redirectUri: "STRIPE_CONNECT_REDIRECT_URI",
    authorize: "https://connect.stripe.com/oauth/authorize",
    token: "https://connect.stripe.com/oauth/token",
    scope: "read_write",
  },
  kit: {
    clientId: "KIT_CLIENT_ID",
    clientSecret: "KIT_CLIENT_SECRET",
    redirectUri: "KIT_REDIRECT_URI",
    authorize: "https://app.kit.com/oauth/authorize",
    token: "https://api.kit.com/v4/oauth/token",
    scope: "",
  },
  // "Instagram API with Instagram Login" (Meta's current product for this — the older Instagram
  // Basic Display API this used to require is deprecated). Unlike the other three, the code
  // exchange only returns a short-lived (~1h) token; exchangeInstagramLongLivedToken below does
  // the required follow-up hop to a 60-day token, since storing the 1h one would make "connected"
  // silently stop working within the hour.
  instagram: {
    clientId: "INSTAGRAM_CLIENT_ID",
    clientSecret: "INSTAGRAM_CLIENT_SECRET",
    redirectUri: "INSTAGRAM_REDIRECT_URI",
    authorize: "https://www.instagram.com/oauth/authorize",
    token: "https://api.instagram.com/oauth/access_token",
    scope:
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish",
  },
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
  const response = await fetch(current.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`PROVIDER_TOKEN_FAILED:${provider}:${response.status}`);
  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    stripe_user_id?: string;
    account_id?: string;
    user_id?: string | number;
  };
}

// Instagram-only follow-up: the code exchange above hands back a token valid for only ~1 hour.
// This trades it for a 60-day one, which is what actually gets stored/encrypted — see
// completeProviderConnection in api.integrations.ts, the only caller.
export async function exchangeInstagramLongLivedToken(shortLivedAccessToken: string) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", requireServerEnv(config.instagram.clientSecret));
  url.searchParams.set("access_token", shortLivedAccessToken);
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`PROVIDER_TOKEN_FAILED:instagram:${response.status}`);
  return (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };
}

export async function encryptProviderTokens(tokens: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}) {
  return {
    accessTokenCiphertext: await encryptSecretToBytea(tokens.access_token),
    refreshTokenCiphertext: tokens.refresh_token
      ? await encryptSecretToBytea(tokens.refresh_token)
      : null,
    tokenExpiry: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
  };
}
