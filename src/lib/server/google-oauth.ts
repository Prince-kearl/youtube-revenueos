import { getServerEnv, requireServerEnv } from "./env";
import { latestYoutubeAccessToken, youtubeAccessTokenForRetry } from "./youtube-token-registry";

// Do NOT request the youtubepartner scope (out of MVP scope) — read-only access is sufficient
// for channel metadata, analytics, and revenue reporting. youtube.force-ssl IS requested despite
// otherwise favoring read-only scopes: Comment Automation's whole point is posting real replies
// (comments.insert), which read-only access cannot do. Channels connected before this scope was
// added won't have it on their existing token — see isInsufficientScopeError in youtube-tokens.ts
// for how that's detected and surfaced as a reconnect prompt rather than a silent failure.
//
// openid + email are requested for exactly one reason: they make Google return an id_token whose
// `sub` claim is the account's stable, non-reassignable identifier. That's what
// youtube_connections.google_subject_id is keyed on, so the same Google identity reconnecting to a
// workspace resolves to its existing connection instead of creating a duplicate one. Without it,
// there is no reliable way to deduplicate connections by identity (email can change; channel id is
// not the identity). No YouTube data access is gained or lost by adding these two scopes.
export const YOUTUBE_OAUTH_SCOPES = [
  "openid",
  "email",
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
  // select_account: Google always shows its account / channel picker (a Google account can own or
  // manage several channels; Google grants an app ONE per sign-in, the one picked there) instead
  // of silently reusing whichever account the browser is signed into. consent: see above.
  url.searchParams.set("prompt", "select_account consent");
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
  // Present because the `openid` scope was requested (see YOUTUBE_OAUTH_SCOPES) — carries the
  // stable `sub` claim used to identify the Google account. Absent on a token refresh unless
  // Google chooses to reissue one, which is why identity is captured at initial consent time.
  id_token?: string;
}

async function requestGoogleToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    // Google's body carries a short machine-readable code (invalid_grant, invalid_client, ...)
    // that tells a revoked/expired grant apart from a misconfigured OAuth client. It contains no
    // secret, so it is appended for logs and for isYoutubeTokenRefreshReauthError's classification.
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const code =
      typeof payload?.error === "string" ? payload.error.replace(/[^a-z_]/gi, "").slice(0, 40) : "";
    throw new Error(`GOOGLE_TOKEN_REQUEST_FAILED:${response.status}${code ? `:${code}` : ""}`);
  }
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

export interface GoogleIdentity {
  sub: string;
  email: string | null;
}

// Decodes the payload of an id_token Google's own token endpoint just returned in this same
// server-to-server exchange (see exchangeGoogleAuthorizationCode) — this is reading a value Google
// handed us directly over an HTTPS call authenticated with our client_secret, not accepting a
// bearer credential from an untrusted caller, so no signature verification is performed here.
// Never call this on an id_token that arrived from anywhere other than that direct exchange.
export function decodeGoogleIdentityFromIdToken(idToken: string): GoogleIdentity | null {
  const segments = idToken.split(".");
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { sub?: unknown; email?: unknown };
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
  } catch {
    return null;
  }
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
  /** The country set on the channel (ISO 3166 code, e.g. "GH"); null when none is set. */
  country: string | null;
}

interface RawYoutubeChannelItem {
  id: string;
  snippet: {
    title: string;
    customUrl?: string;
    country?: string;
    thumbnails?: { high?: { url: string }; default?: { url: string } };
  };
  statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

function mapYoutubeChannel(channel: RawYoutubeChannelItem): YoutubeChannelSummary {
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
    country: channel.snippet.country ?? null,
  };
}

// channels.list(mine=true) returns every channel the authenticated identity has account-level
// rights to — for most creators that's exactly one, but for a legacy Brand Account manager it can
// be several. This is the only channel-discovery entry point that should be used when the caller
// doesn't already know which single channel it's looking for; it never discards anything.
export async function fetchAuthorizedYoutubeChannels(
  accessToken: string,
): Promise<YoutubeChannelSummary[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("mine", "true");
  const response = await youtubeFetch(accessToken, url);
  if (!response.ok) throw new Error(`YOUTUBE_CHANNEL_FETCH_FAILED:${response.status}`);
  const data = (await response.json()) as { items?: RawYoutubeChannelItem[] };
  return (data.items ?? []).map(mapYoutubeChannel);
}

// For callers that already know the specific channel they're refreshing metadata for (sync jobs,
// comment automation, video fetches) — always pass expectedChannelId so a connection backing
// several channels can't silently overwrite one channel's row with another's data. Omitting
// expectedChannelId only makes sense when the connection is known to back exactly one channel;
// prefer fetchAuthorizedYoutubeChannels for anything that discovers channels.
export async function fetchAuthorizedYoutubeChannel(
  accessToken: string,
  expectedChannelId?: string,
): Promise<YoutubeChannelSummary> {
  const channels = await fetchAuthorizedYoutubeChannels(accessToken);
  const channel = expectedChannelId
    ? channels.find((item) => item.channelId === expectedChannelId)
    : channels[0];
  if (!channel) {
    throw new Error(
      expectedChannelId ? "YOUTUBE_CONNECTED_CHANNEL_MISMATCH" : "YOUTUBE_CHANNEL_NOT_FOUND",
    );
  }
  return channel;
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

/**
 * Every authenticated request to the YouTube Data / Analytics APIs goes through here.
 *
 * A 401 from one of those APIs is not, by itself, proof that the creator's authorization has been
 * revoked. So on a 401 — and only on a 401 — the token's connection is asked for a freshly
 * refreshed access token and the request is sent once more:
 *
 *   refresh rejected by Google   → the genuine "reauthorization required" error propagates
 *   refresh ok, retry succeeds   → the caller never sees the 401
 *   refresh ok, retry fails      → the second response is returned as it is, and the caller
 *                                  reports an ordinary API failure (it is not swallowed)
 *
 * There is exactly one retry and no loop. A token that was not issued by getValidAccessToken
 * (for example the one just obtained in the OAuth callback) cannot be refreshed here, so its 401
 * is returned unchanged. Successful requests and non-401 errors are never retried or refreshed.
 */
async function youtubeFetch(
  accessToken: string,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const send = (token: string) =>
    fetch(input, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  const response = await send(latestYoutubeAccessToken(accessToken));
  if (response.status !== 401) return response;

  let retryToken: string | null;
  try {
    retryToken = await youtubeAccessTokenForRetry(accessToken);
  } catch (error) {
    // Google refused the refresh: the grant is really gone. That error (raised, and recorded on
    // the connection, by youtube-tokens.ts) is the one that must reach the caller.
    if (error instanceof Error && error.message === "YOUTUBE_REAUTH_REQUIRED") throw error;
    // The refresh could not be attempted or completed for an unrelated reason (network, Google
    // 5xx): nothing was learned about the grant, so the original 401 stands as an API failure.
    return response;
  }
  if (retryToken === null) return response;
  return send(retryToken);
}

async function youtubeApiRequest<T>(
  accessToken: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const response = await youtubeFetch(accessToken, youtubeApiUrl(path, params));
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

/** Videos looked up directly by id, in any privacy state the token is allowed to see. An id
 * YouTube has no video for is simply missing from the result. At most 50 ids per call (the
 * videos.list limit). */
export async function fetchYoutubeVideosByIds(
  accessToken: string,
  videoIds: string[],
): Promise<YoutubeVideoSummary[]> {
  if (!videoIds.length) return [];
  if (videoIds.length > 50) throw new Error("YOUTUBE_VIDEOS_TOO_MANY_IDS");
  const response = await youtubeApiRequest<{
    items?: Array<Parameters<typeof mapYoutubeVideo>[0]>;
  }>(accessToken, "videos", {
    part: "snippet,contentDetails,statistics,status",
    id: videoIds.join(","),
    maxResults: "50",
  });
  return (response.items ?? []).map(mapYoutubeVideo);
}

export type YoutubeVideoPage = {
  videos: YoutubeVideoSummary[];
  // Every video id the uploads playlist listed on this page, including ones filtered out of
  // `videos` — the catalogue sync uses this to tell "already known" from "new".
  listedIds: string[];
  nextPageToken: string | null;
};

export async function fetchYoutubeVideosPage(
  accessToken: string,
  uploadsPlaylistId: string | null,
  pageToken?: string,
  limit = 50,
  // The pages shown to creators list public videos only. The catalogue sync passes
  // includeNonPublic so unlisted/private uploads (which still earn and still have history) are
  // not silently missing from the stored catalogue.
  options: { includeNonPublic?: boolean } = {},
): Promise<YoutubeVideoPage> {
  if (!uploadsPlaylistId || limit <= 0) return { videos: [], listedIds: [], nextPageToken: null };

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
  if (!ids.length)
    return { videos: [], listedIds: [], nextPageToken: playlist.nextPageToken ?? null };

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
      .filter((video) => options.includeNonPublic || video.status?.privacyStatus === "public")
      .map(mapYoutubeVideo)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    listedIds: ids,
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
  /** Replies in the thread, as YouTube counts them (null when not reported). */
  replyCount?: number | null;
}

// A commentThreads.list item. The comment's own text/author live under
// snippet.topLevelComment.snippet — the thread's snippet only carries thread-level fields
// (canReply, totalReplyCount, videoId, etc).
type YoutubeCommentThreadItem = {
  id: string;
  snippet: {
    videoId: string;
    channelId?: string;
    canReply?: boolean;
    totalReplyCount?: number;
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
};

function mapCommentThreads(items: YoutubeCommentThreadItem[] | undefined): YoutubeCommentSummary[] {
  const comments: YoutubeCommentSummary[] = [];
  for (const item of items ?? []) {
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
      replyCount:
        threadSnippet.totalReplyCount === undefined ? null : Number(threadSnippet.totalReplyCount),
    });
  }
  return comments.filter((comment) => comment.text);
}

/**
 * Recent top-level comments on up to 12 videos. A video whose comments are turned off (YouTube
 * answers 403 commentsDisabled — every "made for kids" video, for one) or that no longer exists
 * (404) has no comments to read: it is skipped and listed in `skippedVideoIds`, instead of failing
 * the whole read (which left a channel "Partially synced" on every sync). The quota running out,
 * missing permissions or any other failure still throws.
 */
export async function fetchRecentYoutubeCommentsDetailed(
  accessToken: string,
  videoIds: string[],
  limitPerVideo = 50,
): Promise<{ comments: YoutubeCommentSummary[]; skippedVideoIds: string[] }> {
  const comments: YoutubeCommentSummary[] = [];
  const skippedVideoIds: string[] = [];
  for (const videoId of videoIds.slice(0, 12)) {
    const response = await youtubeFetch(
      accessToken,
      youtubeApiUrl("commentThreads", {
        part: "snippet",
        videoId,
        maxResults: String(Math.min(limitPerVideo, 100)),
        order: "time",
      }),
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { errors?: Array<{ reason?: string }> };
      } | null;
      const reason = body?.error?.errors?.[0]?.reason;
      if (
        (response.status === 403 && reason === "commentsDisabled") ||
        (response.status === 404 && (reason === "videoNotFound" || reason === undefined))
      ) {
        skippedVideoIds.push(videoId);
        continue;
      }
      if (
        response.status === 403 &&
        (reason === "quotaExceeded" ||
          reason === "dailyLimitExceeded" ||
          reason === "rateLimitExceeded" ||
          reason === "userRateLimitExceeded")
      )
        throw new YoutubeQuotaExceededError();
      throw new Error(`YOUTUBE_COMMENTTHREADS_FAILED:${response.status}`);
    }
    const data = (await response.json()) as { items?: YoutubeCommentThreadItem[] };
    comments.push(...mapCommentThreads(data.items));
  }
  return { comments, skippedVideoIds };
}

export async function fetchRecentYoutubeComments(
  accessToken: string,
  videoIds: string[],
  limitPerVideo = 50,
): Promise<YoutubeCommentSummary[]> {
  return (await fetchRecentYoutubeCommentsDetailed(accessToken, videoIds, limitPerVideo)).comments;
}

/**
 * Comment threads looked up by id (at most 50 per request, 1 quota unit each), with the channel
 * each belongs to — so a caller can confirm a comment is on its own channel before replying to it.
 * An id YouTube has no thread for is simply missing from the result.
 */
export async function fetchCommentThreadsByIds(
  accessToken: string,
  threadIds: string[],
): Promise<Array<YoutubeCommentSummary & { channelId: string | null }>> {
  const found: Array<YoutubeCommentSummary & { channelId: string | null }> = [];
  for (let i = 0; i < threadIds.length; i += 50) {
    const chunk = threadIds.slice(i, i + 50);
    const response = await youtubeApiRequest<{ items?: YoutubeCommentThreadItem[] }>(
      accessToken,
      "commentThreads",
      { part: "snippet", id: chunk.join(","), maxResults: "50" },
    );
    const channelById = new Map(
      (response.items ?? []).map((item) => [item.id, item.snippet.channelId ?? null]),
    );
    for (const comment of mapCommentThreads(response.items))
      found.push({ ...comment, channelId: channelById.get(comment.id) ?? null });
  }
  return found;
}

/**
 * One page (up to 100, newest first) of the top-level comments on every video of a channel —
 * commentThreads.list with allThreadsRelatedToChannelId, 1 quota unit a page whatever the number
 * of videos. Pass the previous page's nextPageToken to continue; null when there are no more.
 */
export async function fetchChannelCommentsPage(
  accessToken: string,
  youtubeChannelId: string,
  pageToken: string | null,
): Promise<{ comments: YoutubeCommentSummary[]; nextPageToken: string | null }> {
  const params: Record<string, string> = {
    part: "snippet",
    allThreadsRelatedToChannelId: youtubeChannelId,
    maxResults: "100",
    order: "time",
  };
  if (pageToken) params.pageToken = pageToken;
  const response = await youtubeApiRequest<{
    items?: YoutubeCommentThreadItem[];
    nextPageToken?: string;
  }>(accessToken, "commentThreads", params);
  return {
    comments: mapCommentThreads(response.items),
    nextPageToken: response.nextPageToken ?? null,
  };
}

/** YouTube refused for quota (the project's daily quota, or a rate limit): try again later. */
export class YoutubeQuotaExceededError extends Error {
  constructor() {
    super("YOUTUBE_QUOTA_EXCEEDED");
    this.name = "YoutubeQuotaExceededError";
  }
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
  const response = await youtubeFetch(accessToken, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      if (
        reason === "quotaExceeded" ||
        reason === "dailyLimitExceeded" ||
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded"
      ) {
        throw new YoutubeQuotaExceededError();
      }
    }
    throw new Error(`YOUTUBE_COMMENT_REPLY_FAILED:${response.status}`);
  }
  const data = (await response.json()) as { id: string; snippet?: { publishedAt?: string } };
  return { id: data.id, publishedAt: data.snippet?.publishedAt ?? null };
}

// ---------- replies within a comment thread ----------

/** A reply in a comment thread (comments.list), with who wrote it and what it answers. */
export interface YoutubeCommentReply {
  id: string;
  parentId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  authorAvatarUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
}

type YoutubeCommentItem = {
  id: string;
  snippet?: {
    parentId?: string;
    textDisplay?: string;
    textOriginal?: string;
    authorDisplayName?: string;
    authorProfileImageUrl?: string;
    authorChannelId?: { value?: string };
    likeCount?: number;
    publishedAt?: string;
    updatedAt?: string;
  };
};

function mapCommentItems(items: YoutubeCommentItem[] | undefined): YoutubeCommentReply[] {
  return (items ?? []).flatMap((item) => {
    const s = item.snippet;
    if (!s) return [];
    return [
      {
        id: item.id,
        parentId: s.parentId ?? null,
        authorName: s.authorDisplayName ?? null,
        authorChannelId: s.authorChannelId?.value ?? null,
        authorAvatarUrl: s.authorProfileImageUrl ?? null,
        // textOriginal is the author's own text (what an edit starts from); textDisplay is the
        // rendered form, used when the original is not returned.
        text: s.textOriginal ?? s.textDisplay ?? "",
        likeCount: Number(s.likeCount ?? 0),
        publishedAt: s.publishedAt ?? null,
        updatedAt: s.updatedAt ?? null,
      },
    ];
  });
}

/**
 * The replies to one top-level comment (comments.list with parentId), oldest first, up to
 * `maxPages` pages of 100 (1 quota unit a page). `pages` is how many were read.
 */
export async function fetchCommentReplies(
  accessToken: string,
  parentId: string,
  maxPages = 3,
): Promise<{ replies: YoutubeCommentReply[]; pages: number; more: boolean }> {
  const replies: YoutubeCommentReply[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params: Record<string, string> = {
      part: "snippet",
      parentId,
      maxResults: "100",
      textFormat: "plainText",
    };
    if (pageToken) params.pageToken = pageToken;
    const response = await youtubeApiRequest<{
      items?: YoutubeCommentItem[];
      nextPageToken?: string;
    }>(accessToken, "comments", params);
    pages += 1;
    replies.push(...mapCommentItems(response.items));
    pageToken = response.nextPageToken;
  } while (pageToken && pages < maxPages);
  replies.sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
  return { replies, pages, more: Boolean(pageToken) };
}

/** Comments (replies included) looked up by id, 1 quota unit per 50. Missing ids are left out. */
export async function fetchCommentsByIds(
  accessToken: string,
  ids: string[],
): Promise<YoutubeCommentReply[]> {
  const found: YoutubeCommentReply[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const response = await youtubeApiRequest<{ items?: YoutubeCommentItem[] }>(
      accessToken,
      "comments",
      {
        part: "snippet",
        id: ids.slice(i, i + 50).join(","),
        textFormat: "plainText",
      },
    );
    found.push(...mapCommentItems(response.items));
  }
  return found;
}

/**
 * Changes the text of a comment the authorized channel wrote (comments.update, 50 quota units).
 * YouTube itself refuses an edit to anyone else's comment; callers check ownership first anyway.
 */
export async function updateYoutubeComment(
  accessToken: string,
  commentId: string,
  text: string,
): Promise<void> {
  const url = new URL("https://www.googleapis.com/youtube/v3/comments");
  url.searchParams.set("part", "snippet");
  const response = await youtubeFetch(accessToken, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: commentId, snippet: { textOriginal: text } }),
  });
  if (!response.ok) {
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      const reason = (body as { error?: { errors?: Array<{ reason?: string }> } } | null)?.error
        ?.errors?.[0]?.reason;
      if (reason === "insufficientPermissions" || reason === "forbidden")
        throw new YoutubeInsufficientScopeError();
      if (
        reason === "quotaExceeded" ||
        reason === "dailyLimitExceeded" ||
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded"
      )
        throw new YoutubeQuotaExceededError();
    }
    throw new Error(`YOUTUBE_COMMENT_UPDATE_FAILED:${response.status}`);
  }
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
  // ISO 4217 code for revenue metrics. The API defaults to USD when omitted and rejects codes it
  // does not support (e.g. GHS), so stored revenue always passes "USD" explicitly.
  currency?: string;
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
  if (query.currency) url.searchParams.set("currency", query.currency);
  const response = await youtubeFetch(accessToken, url);
  if (!response.ok) throw new Error(`YOUTUBE_ANALYTICS_QUERY_FAILED:${response.status}`);
  return response.json();
}

export type YoutubeAnalyticsPayload = {
  columnHeaders?: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows?: Array<Array<string | number>>;
};
