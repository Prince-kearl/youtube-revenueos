import { getServerEnv, requireServerEnv } from "./env";

// Do NOT request the youtubepartner scope (out of MVP scope) — read-only access is sufficient
// for channel metadata, analytics, and revenue reporting. youtube.force-ssl IS requested despite
// otherwise favoring read-only scopes: Comment Automation's whole point is posting real replies
// (comments.insert), which read-only access cannot do. Channels connected before this scope was
// added won't have it on their existing token — see isInsufficientScopeError in youtube-tokens.ts
// for how that's detected and surfaced as a reconnect prompt rather than a silent failure.
export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
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
  channelId: string | null;
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

function mapYoutubeVideo(item: {
  id: string;
  snippet: {
    title: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    thumbnails?: { medium?: { url: string }; default?: { url: string } };
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: string };
}): YoutubeVideoSummary {
  const durationSeconds = item.contentDetails?.duration
    ? parseIsoDurationSeconds(item.contentDetails.duration)
    : null;
  return {
    id: item.id,
    channelId: item.snippet.channelId ?? null,
    title: item.snippet.title,
    description: item.snippet.description ?? null,
    thumbnail:
      item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
    publishedAt: item.snippet.publishedAt ?? null,
    duration: durationSeconds === null ? null : formatDuration(durationSeconds),
    durationSeconds,
    privacyStatus: item.status?.privacyStatus ?? null,
    views: Number(item.statistics?.viewCount ?? 0),
    likes: item.statistics?.likeCount === undefined ? null : Number(item.statistics.likeCount),
    comments:
      item.statistics?.commentCount === undefined ? null : Number(item.statistics.commentCount),
    url: `https://www.youtube.com/watch?v=${item.id}`,
  };
}

export async function fetchPublicYoutubeVideoById(
  accessToken: string,
  videoId: string,
): Promise<YoutubeVideoSummary> {
  const response = await youtubeApiRequest<{
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        description?: string;
        publishedAt?: string;
        channelId?: string;
        thumbnails?: { medium?: { url: string }; default?: { url: string } };
      };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      status?: { privacyStatus?: string };
    }>;
  }>(accessToken, "videos", {
    part: "snippet,contentDetails,statistics,status",
    id: videoId,
  });
  const video = response.items?.[0];
  if (!video) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");
  return mapYoutubeVideo(video);
}

export async function fetchYoutubeVideoById(
  accessToken: string,
  videoId: string,
  expectedChannelId: string,
): Promise<YoutubeVideoSummary> {
  const response = await youtubeApiRequest<{
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        description?: string;
        publishedAt?: string;
        channelId?: string;
        thumbnails?: { medium?: { url: string }; default?: { url: string } };
      };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      status?: { privacyStatus?: string };
    }>;
  }>(accessToken, "videos", {
    part: "snippet,contentDetails,statistics,status",
    id: videoId,
  });
  const video = response.items?.[0];
  if (!video) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");
  if (video.snippet.channelId !== expectedChannelId) {
    throw new Error("YOUTUBE_VIDEO_CHANNEL_MISMATCH");
  }
  return mapYoutubeVideo(video);
}

export type YoutubeVideoPage = {
  videos: YoutubeVideoSummary[];
  nextPageToken: string | null;
};

export async function fetchYoutubeVideosPage(
  accessToken: string,
  uploadsPlaylistId: string | null,
  pageToken?: string,
  limit = 50,
): Promise<YoutubeVideoPage> {
  if (!uploadsPlaylistId || limit <= 0) return { videos: [], nextPageToken: null };

  const playlistParams: Record<string, string> = {
    part: "contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(Math.max(limit, 1), 50)),
  };
  if (pageToken) playlistParams.pageToken = pageToken;

  const playlist = await youtubeApiRequest<{
    items?: Array<{ contentDetails?: { videoId?: string } }>;
    nextPageToken?: string;
  }>(accessToken, "playlistItems", playlistParams);
  const ids = [
    ...new Set(
      (playlist.items ?? [])
        .map((item) => item.contentDetails?.videoId)
        .filter((videoId): videoId is string => Boolean(videoId)),
    ),
  ];
  if (!ids.length) return { videos: [], nextPageToken: playlist.nextPageToken ?? null };

  const videos = await youtubeApiRequest<{
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        description?: string;
        publishedAt?: string;
        channelId?: string;
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

  return {
    videos: (videos.items ?? [])
      .filter((video) => video.status?.privacyStatus === "public")
      .map(mapYoutubeVideo)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    nextPageToken: playlist.nextPageToken ?? null,
  };
}

export async function fetchRecentYoutubeVideos(
  accessToken: string,
  uploadsPlaylistId: string | null,
  limit = 12,
): Promise<YoutubeVideoSummary[]> {
  const page = await fetchYoutubeVideosPage(accessToken, uploadsPlaylistId, undefined, limit);
  return page.videos.slice(0, limit);
}

export interface YoutubeCommentSummary {
  id: string;
  videoId: string;
  parentCommentId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  authorAvatarUrl: string | null;
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
    // The actual comment text/author live under snippet.topLevelComment.snippet — the thread's
    // own snippet only carries thread-level fields (canReply, totalReplyCount, videoId, etc).
    const response = await youtubeApiRequest<{
      items?: Array<{
        id: string;
        snippet: {
          videoId: string;
          canReply?: boolean;
          topLevelComment?: {
            snippet?: {
              parentId?: string;
              textDisplay?: string;
              authorDisplayName?: string;
              authorProfileImageUrl?: string;
              authorChannelId?: { value?: string };
              likeCount?: number;
              publishedAt?: string;
              updatedAt?: string;
            };
          };
        };
      }>;
    }>(accessToken, "commentThreads", {
      part: "snippet",
      videoId,
      maxResults: String(Math.min(limitPerVideo, 100)),
      order: "time",
    });
    for (const item of response.items ?? []) {
      const threadSnippet = item.snippet;
      const snippet = threadSnippet.topLevelComment?.snippet;
      if (!snippet) continue;
      comments.push({
        id: item.id,
        videoId: threadSnippet.videoId,
        parentCommentId: snippet.parentId ?? null,
        authorName: snippet.authorDisplayName ?? null,
        authorChannelId: snippet.authorChannelId?.value ?? null,
        authorAvatarUrl: snippet.authorProfileImageUrl ?? null,
        text: snippet.textDisplay ?? "",
        likeCount: Number(snippet.likeCount ?? 0),
        publishedAt: snippet.publishedAt ?? null,
        updatedAt: snippet.updatedAt ?? null,
        canReply: threadSnippet.canReply ?? null,
      });
    }
  }
  return comments.filter((comment) => comment.text);
}

export class YoutubeInsufficientScopeError extends Error {
  constructor() {
    super("YOUTUBE_INSUFFICIENT_SCOPE");
    this.name = "YoutubeInsufficientScopeError";
  }
}

// Posts a real, public reply to a top-level comment (YouTube Data API: comments.insert with
// snippet.parentId). Costs 50 quota units — the caller is responsible for logging that, this
// function only knows how to make the call. Channels connected before youtube.force-ssl was added
// to YOUTUBE_OAUTH_SCOPES will get a 403 here; that's surfaced as YoutubeInsufficientScopeError so
// the route can tell the user to reconnect instead of a generic failure.
export async function postYoutubeCommentReply(
  accessToken: string,
  parentCommentId: string,
  text: string,
): Promise<{ id: string; publishedAt: string | null }> {
  const url = new URL("https://www.googleapis.com/youtube/v3/comments");
  url.searchParams.set("part", "snippet");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snippet: { parentId: parentCommentId, textOriginal: text } }),
  });
  if (!response.ok) {
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      const reason = (body as { error?: { errors?: Array<{ reason?: string }> } } | null)?.error
        ?.errors?.[0]?.reason;
      if (reason === "insufficientPermissions" || reason === "forbidden") {
        throw new YoutubeInsufficientScopeError();
      }
    }
    throw new Error(`YOUTUBE_COMMENT_REPLY_FAILED:${response.status}`);
  }
  const data = (await response.json()) as { id: string; snippet?: { publishedAt?: string } };
  return { id: data.id, publishedAt: data.snippet?.publishedAt ?? null };
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
