import { requireServerEnv } from "./env";

// Do NOT request the youtubepartner scope (out of MVP scope) — read-only access is sufficient
// for channel metadata, analytics, and revenue reporting.
export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
];

export function buildGoogleAuthorizationUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", requireServerEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireServerEnv("GOOGLE_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_OAUTH_SCOPES.join(" "));
  // access_type=offline + prompt=consent is required to reliably get a refresh_token back,
  // otherwise the creator would have to reconnect every time the access token expires.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function requestGoogleToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`GOOGLE_TOKEN_REQUEST_FAILED:${response.status}`);
  return (await response.json()) as GoogleTokenResponse;
}

export function exchangeGoogleAuthorizationCode(code: string): Promise<GoogleTokenResponse> {
  return requestGoogleToken(
    new URLSearchParams({
      code,
      client_id: requireServerEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireServerEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireServerEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  );
}

export function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  return requestGoogleToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireServerEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireServerEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  );
}

export interface YoutubeChannelSummary {
  channelId: string;
  title: string;
  thumbnail: string | null;
  subscriberCount: number;
}

export async function fetchAuthorizedYoutubeChannel(accessToken: string): Promise<YoutubeChannelSummary> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("mine", "true");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YOUTUBE_CHANNEL_FETCH_FAILED:${response.status}`);
  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; thumbnails?: { default?: { url: string } } };
      statistics: { subscriberCount?: string };
    }>;
  };
  const channel = data.items?.[0];
  if (!channel) throw new Error("YOUTUBE_CHANNEL_NOT_FOUND");
  return {
    channelId: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.default?.url ?? null,
    subscriberCount: Number(channel.statistics.subscriberCount ?? 0),
  };
}

export interface YoutubeAnalyticsQuery {
  channelId: string;
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
}

export async function queryYoutubeAnalytics(accessToken: string, query: YoutubeAnalyticsQuery): Promise<unknown> {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", `channel==${query.channelId}`);
  url.searchParams.set("startDate", query.startDate);
  url.searchParams.set("endDate", query.endDate);
  url.searchParams.set("metrics", query.metrics.join(","));
  if (query.dimensions?.length) url.searchParams.set("dimensions", query.dimensions.join(","));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YOUTUBE_ANALYTICS_QUERY_FAILED:${response.status}`);
  return response.json();
}
