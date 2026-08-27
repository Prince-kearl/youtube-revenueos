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

export async function fetchAuthorizedYoutubeChannel(
  accessToken: string,
  expectedChannelId?: string,
): Promise<YoutubeChannelSummary> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("mine", "true");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YOUTUBE_CHANNEL_FETCH_FAILED:${response.status}`);
  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        customUrl?: string;
        thumbnails?: { high?: { url: string }; default?: { url: string } };
      };
      statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  };
  const channel = expectedChannelId
    ? data.items?.find((item) => item.id === expectedChannelId)
    : data.items?.[0];
  if (!channel) {
    throw new Error(
      expectedChannelId ? "YOUTUBE_CONNECTED_CHANNEL_MISMATCH" : "YOUTUBE_CHANNEL_NOT_FOUND",
    );
  }
  return {
    channelId: channel.id,
    title: channel.snippet.title,
    handle: channel.snippet.customUrl ?? null,
    thumbnail:
      channel.snippet.thumbnails?.high?.url ?? channel.snippet.thumbnails?.default?.url ?? null,
    subscriberCount: Number(channel.statistics.subscriberCount ?? 0),
    viewCount: Number(channel.statistics.viewCount ?? 0),
    videoCount: Number(channel.statistics.videoCount ?? 0),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export interface YoutubeVideoSummary {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  duration: string | null;
  durationSeconds: number | null;
  privacyStatus: string | null;
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

async function youtubeApiRequest<T>(
  accessToken: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const response = await fetch(youtubeApiUrl(path, params), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`YOUTUBE_${path.toUpperCase()}_FAILED:${response.status}`);
  return (await response.json()) as T;
}

function parseIsoDurationSeconds(duration: string): number {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export async function fetchRecentYoutubeVideos(
  accessToken: string,
  uploadsPlaylistId: string | null,
  limit = 12,
): Promise<YoutubeVideoSummary[]> {
  if (!uploadsPlaylistId || limit <= 0) return [];

  // The uploads playlist can contain private, unlisted, deleted, or otherwise unavailable
  // entries. Walk enough playlist pages to collect the requested number of candidate IDs instead
  // of treating a short first page as proof that the channel has no published videos.
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5 && ids.length < limit; page += 1) {
    const params: Record<string, string> = {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: "50",
    };
    if (pageToken) params.pageToken = pageToken;
    const playlist = await youtubeApiRequest<{
      items?: Array<{ contentDetails?: { videoId?: string } }>;
      nextPageToken?: string;
    }>(accessToken, "playlistItems", params);
    for (const item of playlist.items ?? []) {
      const videoId = item.contentDetails?.videoId;
      if (videoId && !ids.includes(videoId)) ids.push(videoId);
      if (ids.length >= limit) break;
    }
    pageToken = playlist.nextPageToken;
    if (!pageToken || !playlist.items?.length) break;
  }
  if (!ids.length) return [];

  const videos = await youtubeApiRequest<{
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        description?: string;
        publishedAt?: string;
        thumbnails?: { medium?: { url: string }; default?: { url: string } };
      };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      status?: { privacyStatus?: string };
    }>;
  }>(accessToken, "videos", {
    part: "snippet,contentDetails,statistics,status",
    id: ids.join(","),
  });

  return (videos.items ?? [])
    .filter((video) => video.status?.privacyStatus === "public")
    .map((video) => {
      const durationSeconds = video.contentDetails?.duration
        ? parseIsoDurationSeconds(video.contentDetails.duration)
        : null;
      return {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description ?? null,
        thumbnail:
          video.snippet.thumbnails?.medium?.url ?? video.snippet.thumbnails?.default?.url ?? null,
        publishedAt: video.snippet.publishedAt ?? null,
        duration: durationSeconds === null ? null : formatDuration(durationSeconds),
        durationSeconds,
        privacyStatus: video.status?.privacyStatus ?? null,
        views: Number(video.statistics?.viewCount ?? 0),
        likes:
          video.statistics?.likeCount === undefined ? null : Number(video.statistics.likeCount),
        comments:
          video.statistics?.commentCount === undefined
            ? null
            : Number(video.statistics.commentCount),
        url: `https://www.youtube.com/watch?v=${video.id}`,
      };
    })
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, limit);
}

export interface YoutubeCommentSummary {
  id: string;
  videoId: string;
  parentCommentId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  text: string;
  likeCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  canReply: boolean | null;
}

export async function fetchRecentYoutubeComments(
  accessToken: string,
  videoIds: string[],
  limitPerVideo = 50,
): Promise<YoutubeCommentSummary[]> {
  const comments: YoutubeCommentSummary[] = [];
  for (const videoId of videoIds.slice(0, 12)) {
    const response = await youtubeApiRequest<{
      items?: Array<{
        id: string;
        snippet: {
          videoId: string;
          parentId?: string;
          textDisplay?: string;
          authorDisplayName?: string;
          authorChannelId?: { value?: string };
          likeCount?: number;
          publishedAt?: string;
          updatedAt?: string;
          canReply?: boolean;
        };
      }>;
    }>(accessToken, "commentThreads", {
      part: "snippet",
      videoId,
      maxResults: String(Math.min(limitPerVideo, 100)),
      order: "time",
    });
    for (const item of response.items ?? []) {
      const snippet = item.snippet;
      comments.push({
        id: item.id,
        videoId: snippet.videoId,
        parentCommentId: snippet.parentId ?? null,
        authorName: snippet.authorDisplayName ?? null,
        authorChannelId: snippet.authorChannelId?.value ?? null,
        text: snippet.textDisplay ?? "",
        likeCount: Number(snippet.likeCount ?? 0),
        publishedAt: snippet.publishedAt ?? null,
        updatedAt: snippet.updatedAt ?? null,
        canReply: snippet.canReply ?? null,
      });
    }
  }
  return comments.filter((comment) => comment.text);
}

export interface YoutubeAnalyticsQuery {
  channelId: string;
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export async function queryYoutubeAnalytics(
  accessToken: string,
  query: YoutubeAnalyticsQuery,
): Promise<unknown> {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", `channel==${query.channelId}`);
  url.searchParams.set("startDate", query.startDate);
  url.searchParams.set("endDate", query.endDate);
  url.searchParams.set("metrics", query.metrics.join(","));
  if (query.dimensions?.length) url.searchParams.set("dimensions", query.dimensions.join(","));
  if (query.filters) url.searchParams.set("filters", query.filters);
  if (query.sort) url.searchParams.set("sort", query.sort);
  if (query.maxResults) url.searchParams.set("maxResults", String(query.maxResults));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`YOUTUBE_ANALYTICS_QUERY_FAILED:${response.status}`);
  return response.json();
}

export type YoutubeAnalyticsPayload = {
  columnHeaders?: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows?: Array<Array<string | number>>;
};

/**
 * YouTube Analytics accepts `day` for the channel reports used here. The dashboard presents
 * monthly trends, so daily rows are aggregated locally after the API returns them.
 */
export function aggregateYoutubeAnalyticsByMonth(
  payload: YoutubeAnalyticsPayload,
): YoutubeAnalyticsPayload {
  const reportHeaders = payload.columnHeaders ?? [];
  const names = reportHeaders.map((header) => header.name);
  const dayIndex = names.indexOf("day");
  if (dayIndex < 0) return payload;

  const monthHeaders = reportHeaders.map((header) =>
    header.name === "day"
      ? { ...header, name: "month", columnType: "DIMENSION", dataType: "STRING" }
      : header,
  );
  const monthRows = new Map<string, Array<string | number>>();

  for (const row of payload.rows ?? []) {
    const day = String(row[dayIndex] ?? "");
    const month = day.slice(0, 7);
    if (month.length !== 7) continue;
    const merged =
      monthRows.get(month) ?? monthHeaders.map((header, index) => (index === dayIndex ? month : 0));
    for (let index = 0; index < names.length; index += 1) {
      if (index === dayIndex) continue;
      const value = row[index];
      if (typeof value === "number") merged[index] = Number(merged[index] ?? 0) + value;
      else if (value !== undefined) merged[index] = value;
    }
    monthRows.set(month, merged);
  }

  return {
    columnHeaders: monthHeaders,
    rows: [...monthRows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row),
  };
}
