import { getServerEnv, requireServerEnv } from "./env";

// Do NOT request the youtubepartner scope (out of MVP scope) — read-only access is sufficient
// for channel metadata, analytics, and revenue reporting.
export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
];

// The redirect URI is deliberately NOT derived from the incoming request (Host/X-Forwarded-Host/
// origin) — those vary across preview deployments and proxies and previously caused a production
// redirect_uri_mismatch. GOOGLE_REDIRECT_URI is the single authoritative source per environment;
// callers cannot override it.
export function getConfiguredGoogleRedirectUri(): string {
  return requireServerEnv("GOOGLE_REDIRECT_URI");
}

interface YoutubeOAuthConfigStatus {
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUriConfigured: boolean;
  redirectUri: string | undefined;
  clientId: string | undefined;
}

export function getYoutubeOAuthConfigStatus(): YoutubeOAuthConfigStatus {
  return {
    clientIdConfigured: Boolean(getServerEnv("GOOGLE_CLIENT_ID")),
    clientSecretConfigured: Boolean(getServerEnv("GOOGLE_CLIENT_SECRET")),
    redirectUriConfigured: Boolean(getServerEnv("GOOGLE_REDIRECT_URI")),
    redirectUri: getServerEnv("GOOGLE_REDIRECT_URI"),
    clientId: getServerEnv("GOOGLE_CLIENT_ID"),
  };
}

// Fails fast with a clear server-side error (never a silently-derived fallback) if any of the
// three YouTube OAuth settings are missing.
export function assertYoutubeOAuthConfigured(): void {
  const missing = (
    [
      ["GOOGLE_CLIENT_ID", getServerEnv("GOOGLE_CLIENT_ID")],
      ["GOOGLE_CLIENT_SECRET", getServerEnv("GOOGLE_CLIENT_SECRET")],
      ["GOOGLE_REDIRECT_URI", getServerEnv("GOOGLE_REDIRECT_URI")],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`YouTube OAuth is not configured: missing ${missing.join(", ")}`);
  }
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", requireServerEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", getConfiguredGoogleRedirectUri());
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
      redirect_uri: getConfiguredGoogleRedirectUri(),
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
  handle: string | null;
  thumbnail: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId: string | null;
}

export async function fetchAuthorizedYoutubeChannel(accessToken: string): Promise<YoutubeChannelSummary> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("mine", "true");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YOUTUBE_CHANNEL_FETCH_FAILED:${response.status}`);
  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; customUrl?: string; thumbnails?: { high?: { url: string }; default?: { url: string } } };
      statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  };
  const channel = data.items?.[0];
  if (!channel) throw new Error("YOUTUBE_CHANNEL_NOT_FOUND");
  return {
    channelId: channel.id,
    title: channel.snippet.title,
    handle: channel.snippet.customUrl ?? null,
    thumbnail: channel.snippet.thumbnails?.high?.url ?? channel.snippet.thumbnails?.default?.url ?? null,
    subscriberCount: Number(channel.statistics.subscriberCount ?? 0),
    viewCount: Number(channel.statistics.viewCount ?? 0),
    videoCount: Number(channel.statistics.videoCount ?? 0),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export interface YoutubeVideoSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  url: string;
}

function youtubeApiUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function youtubeApiRequest<T>(accessToken: string, path: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(youtubeApiUrl(path, params), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YOUTUBE_${path.toUpperCase()}_FAILED:${response.status}`);
  return (await response.json()) as T;
}

function parseIsoDuration(duration: string): string {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return duration;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0) + hours * 60;
  const seconds = Number(match[3] ?? 0);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export async function fetchRecentYoutubeVideos(accessToken: string, uploadsPlaylistId: string | null, limit = 12): Promise<YoutubeVideoSummary[]> {
  if (!uploadsPlaylistId) return [];
  const playlist = await youtubeApiRequest<{ items?: Array<{ contentDetails: { videoId: string } }> }>(accessToken, "playlistItems", {
    part: "contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(limit, 50)),
  });
  const ids = (playlist.items ?? []).map((item) => item.contentDetails.videoId).filter(Boolean);
  if (!ids.length) return [];

  const videos = await youtubeApiRequest<{
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt?: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  }>(accessToken, "videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") });

  return (videos.items ?? []).map((video) => ({
    id: video.id,
    title: video.snippet.title,
    thumbnail: video.snippet.thumbnails?.medium?.url ?? video.snippet.thumbnails?.default?.url ?? null,
    publishedAt: video.snippet.publishedAt ?? null,
    duration: video.contentDetails?.duration ? parseIsoDuration(video.contentDetails.duration) : null,
    views: Number(video.statistics?.viewCount ?? 0),
    likes: video.statistics?.likeCount === undefined ? null : Number(video.statistics.likeCount),
    comments: video.statistics?.commentCount === undefined ? null : Number(video.statistics.commentCount),
    url: `https://www.youtube.com/watch?v=${video.id}`,
  }));
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
