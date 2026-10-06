// Dry run of the revenue-data sync against the REAL YouTube API for one connected channel, with
// an in-memory store. It exercises the production code path (catalogue → channel totals →
// per-video rows → verification/fallback) and prints what WOULD be stored, but writes nothing:
// no database rows, no token refresh persisted, no Google-side changes.
//
// Usage:  npx tsx scripts/verify-stats-sync.ts <youtube_connections.id>
// Needs the server variables from .env (Supabase service role, Google client, token key).

import { readFileSync } from "node:fs";
import { createStatsSyncApi } from "../src/lib/server/youtube-stats-store";
import {
  DEFAULT_STATS_SYNC_CONFIG,
  EMPTY_SYNC_STATE,
  RequestBudget,
  reconcileDay,
  runChannelSync,
  type CatalogueVideo,
  type DailyStats,
  type StatsSyncStore,
  type StoredVideo,
  type SyncState,
  type VideoDailyStats,
} from "../src/lib/server/youtube-stats-sync";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]])
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const connectionId = process.argv[2];
if (!connectionId) throw new Error("usage: verify-stats-sync.ts <connection id>");

const headers = {
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
  Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
};
const rest = async (path: string) =>
  (await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { headers })).json();

const hexToBytes = (hex: string) => {
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  return Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
};
const key = await crypto.subtle.importKey(
  "raw",
  Uint8Array.from(atob(env("TOKEN_ENCRYPTION_KEY")), (c) => c.charCodeAt(0)),
  "AES-GCM",
  false,
  ["decrypt"],
);
const decrypt = async (hex: string) => {
  const bytes = hexToBytes(hex);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)),
  );
};

const [connection] = await rest(
  `youtube_connections?id=eq.${connectionId}&select=id,status,refresh_token_ciphertext`,
);
const [channel] = await rest(
  `youtube_channels?connection_id=eq.${connectionId}&select=id,channel_name,youtube_channel_id,uploads_playlist_id&limit=1`,
);
if (!connection || !channel) throw new Error("connection or channel not found");

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    refresh_token: await decrypt(connection.refresh_token_ciphertext),
    client_id: env("GOOGLE_CLIENT_ID"),
    client_secret: env("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  }),
});
const token = (await tokenResponse.json()) as { access_token?: string; error?: string };
if (!token.access_token) throw new Error(`token refresh failed: ${token.error}`);

// ---- in-memory store: same contract as the Supabase one, nothing leaves this process ----
const state: SyncState = { ...EMPTY_SYNC_STATE };
const videos = new Map<string, StoredVideo & { title: string; seenAt: string }>();
const channelDays = new Map<string, DailyStats>();
const videoDays = new Map<string, VideoDailyStats & { fetchedAt: string }>();
const store: StatsSyncStore = {
  getState: async () => ({ ...state }),
  saveState: async (_id, patch) => void Object.assign(state, patch),
  listVideos: async () => [...videos.values()].map(({ title: _t, seenAt: _s, ...video }) => video),
  upsertCatalogueVideos: async (_id, list: CatalogueVideo[], seenAt) => {
    for (const video of list) {
      const existing = videos.get(video.youtubeVideoId);
      videos.set(video.youtubeVideoId, {
        id: existing?.id ?? `mem-${videos.size + 1}`,
        youtubeVideoId: video.youtubeVideoId,
        title: video.title,
        publishedAt: video.publishedAt,
        status: video.privacyStatus === "private" ? "archived" : "active",
        analyticsUpdatedAt: existing?.analyticsUpdatedAt ?? null,
        seenAt,
      });
    }
  },
  markVideosNotSeenAsDeleted: async (_id, since) => {
    let count = 0;
    for (const video of videos.values()) {
      if (video.status !== "deleted" && video.seenAt < since) {
        video.status = "deleted";
        count += 1;
      }
    }
    return count;
  },
  upsertChannelDays: async (_id, rows) => {
    for (const row of rows) channelDays.set(row.day, row);
  },
  replaceVideoDays: async (_id, ids, start, end, rows, fetchedAt) => {
    for (const row of rows) videoDays.set(`${row.videoId}:${row.day}`, { ...row, fetchedAt });
    for (const [k, row] of videoDays) {
      if (
        ids.includes(row.videoId) &&
        row.day >= start &&
        row.day <= end &&
        row.fetchedAt < fetchedAt
      )
        videoDays.delete(k);
    }
  },
  markVideosSynced: async (ids, at) => {
    for (const video of videos.values()) if (ids.includes(video.id)) video.analyticsUpdatedAt = at;
  },
};

const budget = new RequestBudget(DEFAULT_STATS_SYNC_CONFIG.requestBudget);
const result = await runChannelSync({
  channelId: channel.id,
  api: createStatsSyncApi(token.access_token, {
    youtubeChannelId: channel.youtube_channel_id,
    uploadsPlaylistId: channel.uploads_playlist_id,
  }),
  store,
  config: DEFAULT_STATS_SYNC_CONFIG,
  budget,
  now: new Date(),
});

console.log(`channel: ${channel.channel_name} (${channel.youtube_channel_id})`);
console.log("result:", JSON.stringify(result, null, 1));
console.log(
  "catalogue:",
  [...videos.values()].map((v) => `${v.youtubeVideoId} ${v.status} ${v.publishedAt?.slice(0, 10)}`),
);
const activeDays = [...channelDays.values()].filter((d) => d.views > 0);
console.log(
  `channel days stored: ${channelDays.size} (with views: ${activeDays.length}) | video-day rows: ${videoDays.size}`,
);
console.log(
  "day         channelViews  videoViews  unattributed  channelRevenueUsd  fullyAttributed",
);
for (const day of activeDays.sort((a, b) => a.day.localeCompare(b.day)).slice(-12)) {
  const rows = [...videoDays.values()].filter((r) => r.day === day.day);
  const r = reconcileDay(day, rows);
  console.log(
    `${day.day}  ${String(r.channelViews).padStart(12)}  ${String(r.attributedViews).padStart(10)}  ${String(r.unattributedViews).padStart(12)}  ${String(r.channelRevenueUsd).padStart(17)}  ${r.fullyAttributed}`,
  );
}
console.log("sample video rows:", JSON.stringify([...videoDays.values()].slice(0, 3)));
console.log("NOTHING WAS WRITTEN (in-memory store).");
