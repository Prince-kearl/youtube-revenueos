import type { User } from "@supabase/supabase-js";

/**
 * Demo mode is enabled only when VITE_DEMO_MODE=true at local preview startup.
 * It is intentionally client-only and never used by server routes or production auth.
 */
export const IS_LOCAL_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export const DEMO_USER = {
  id: "demo-user-local-preview",
  aud: "authenticated",
  role: "authenticated",
  email: "demo@tubify.local",
  email_confirmed_at: "2026-08-27T00:00:00.000Z",
  phone: "",
  confirmed_at: "2026-08-27T00:00:00.000Z",
  last_sign_in_at: "2026-08-27T00:00:00.000Z",
  app_metadata: { provider: "demo" },
  user_metadata: { name: "Demo Creator", full_name: "Demo Creator", avatar_url: "/logo.png" },
  identities: [],
  created_at: "2026-08-27T00:00:00.000Z",
  updated_at: "2026-08-27T00:00:00.000Z",
} as unknown as User;

const demoVideos = [
  {
    id: "demo-video-1",
    title: "How I Plan a Month of YouTube Content",
    thumbnail: "/landing-image.png",
    publishedAt: "2026-08-24T15:00:00.000Z",
    duration: "8:42",
    views: 842,
    likes: 67,
    comments: 12,
    url: "https://www.youtube.com/@prince_kearl",
  },
  {
    id: "demo-video-2",
    title: "Creator Revenue Systems That Actually Scale",
    thumbnail: "/landing-image.png",
    publishedAt: "2026-08-17T15:00:00.000Z",
    duration: "12:18",
    views: 519,
    likes: 41,
    comments: 8,
    url: "https://www.youtube.com/@prince_kearl",
  },
  {
    id: "demo-video-3",
    title: "Behind the Scenes: Building a Better Creator Workflow",
    thumbnail: "/landing-image.png",
    publishedAt: "2026-08-09T15:00:00.000Z",
    duration: "6:05",
    views: 311,
    likes: 29,
    comments: 5,
    url: "https://www.youtube.com/@prince_kearl",
  },
  {
    id: "demo-video-4",
    title: "The Simple YouTube Analytics Dashboard Tour",
    thumbnail: "/landing-image.png",
    publishedAt: "2026-08-02T15:00:00.000Z",
    duration: "10:27",
    views: 192,
    likes: 18,
    comments: 3,
    url: "https://www.youtube.com/@prince_kearl",
  },
] as const;

const demoAnalytics = [
  {
    month: "2025-09",
    views: 212,
    estimatedRevenue: 18.4,
    subscribersGained: 0,
    watchTimeMinutes: 84,
  },
  {
    month: "2025-10",
    views: 265,
    estimatedRevenue: 21.7,
    subscribersGained: 1,
    watchTimeMinutes: 106,
  },
  {
    month: "2025-11",
    views: 198,
    estimatedRevenue: 16.2,
    subscribersGained: 0,
    watchTimeMinutes: 79,
  },
  {
    month: "2025-12",
    views: 344,
    estimatedRevenue: 28.9,
    subscribersGained: 1,
    watchTimeMinutes: 138,
  },
  {
    month: "2026-01",
    views: 287,
    estimatedRevenue: 24.5,
    subscribersGained: 0,
    watchTimeMinutes: 115,
  },
  {
    month: "2026-02",
    views: 411,
    estimatedRevenue: 35.1,
    subscribersGained: 1,
    watchTimeMinutes: 164,
  },
  {
    month: "2026-03",
    views: 378,
    estimatedRevenue: 31.8,
    subscribersGained: 0,
    watchTimeMinutes: 151,
  },
  {
    month: "2026-04",
    views: 492,
    estimatedRevenue: 42.3,
    subscribersGained: 1,
    watchTimeMinutes: 197,
  },
  {
    month: "2026-05",
    views: 536,
    estimatedRevenue: 46.7,
    subscribersGained: 0,
    watchTimeMinutes: 214,
  },
  {
    month: "2026-06",
    views: 614,
    estimatedRevenue: 53.4,
    subscribersGained: 1,
    watchTimeMinutes: 246,
  },
  {
    month: "2026-07",
    views: 702,
    estimatedRevenue: 61.2,
    estimatedAdRevenue: 47.1,
    estimatedRedPartnerRevenue: 9.8,
    subscribersGained: 0,
    watchTimeMinutes: 281,
  },
  {
    month: "2026-08",
    views: 842,
    estimatedRevenue: 74.8,
    estimatedAdRevenue: 57.6,
    estimatedRedPartnerRevenue: 12.4,
    subscribersGained: 1,
    watchTimeMinutes: 337,
  },
] as const;

// Deterministic (not Math.random) so the demo heatmap looks the same on every reload — a rough
// weekday pattern with a small per-day wobble, anchored to the same snapshot date as the rest of
// the demo dashboard data below.
const HEATMAP_ANCHOR = new Date("2026-08-27T00:00:00.000Z");
const demoEngagementHeatmap = Array.from({ length: 35 }, (_, i) => {
  const date = new Date(HEATMAP_ANCHOR);
  date.setUTCDate(date.getUTCDate() - (34 - i));
  const weekdayBase = [8, 14, 22, 30, 45, 60, 25][date.getUTCDay()];
  const wobble = ((i * 7) % 11) - 5;
  return { date: date.toISOString().slice(0, 10), views: Math.max(0, weekdayBase + wobble) };
});

export const DEMO_YOUTUBE_DASHBOARD = {
  channel: {
    channelId: "demo-channel-kearl",
    title: "Kearl",
    handle: "@prince_kearl",
    thumbnail: "/logo.png",
    subscriberCount: 4,
    viewCount: 5831,
    videoCount: 7,
    uploadsPlaylistId: "demo-uploads-playlist",
    url: "https://www.youtube.com/@prince_kearl",
  },
  videos: demoVideos,
  videosStatus: "available",
  analytics: demoAnalytics,
  analyticsStatus: "available",
  revenueStatus: "available",
  watchTimeStatus: "available",
  audience: {
    topCountries: [
      { country: "US", views: 3120 },
      { country: "IN", views: 1450 },
      { country: "GB", views: 610 },
      { country: "CA", views: 380 },
      { country: "NG", views: 271 },
      { country: "AU", views: 198 },
      { country: "DE", views: 142 },
    ],
    ageGroups: [
      { ageGroup: "age18-24", viewerPercentage: 34.5 },
      { ageGroup: "age25-34", viewerPercentage: 41.2 },
      { ageGroup: "age35-44", viewerPercentage: 14.1 },
      { ageGroup: "age45-54", viewerPercentage: 6.4 },
      { ageGroup: "age13-17", viewerPercentage: 3.8 },
    ],
    genders: [
      { gender: "male", viewerPercentage: 63.5 },
      { gender: "female", viewerPercentage: 34.9 },
      { gender: "user_specified", viewerPercentage: 1.6 },
    ],
  },
  audienceStatus: "available",
  videoInsights: {
    subscribersGained: 1,
    devices: { desktop: 62, mobile: 265, tablet: 21 },
  },
  videoInsightsStatus: "available",
  engagementHeatmap: demoEngagementHeatmap,
  engagementHeatmapStatus: "available",
  topRevenueVideos: [
    { videoId: "demo-video-1", views: 842, revenue: 74.8, changePercent: 27.3 },
    { videoId: "demo-video-2", views: 519, revenue: 46.2, changePercent: -4.1 },
    { videoId: "demo-video-3", views: 311, revenue: 27.9, changePercent: 12.6 },
    { videoId: "demo-video-4", views: 192, revenue: 17.1, changePercent: null },
  ],
  topRevenueVideosStatus: "available",
  fetchedAt: "2026-08-27T17:20:00.000Z",
  meta: { lastUpdated: "2026-08-27T17:20:00.000Z" },
  sections: {
    channel: { available: true },
    videos: { available: true },
    analytics: { available: true },
    revenue: { available: true },
    watchTime: { available: true },
    audience: { available: true },
    videoInsights: { available: true },
    engagementHeatmap: { available: true },
    topRevenueVideos: { available: true },
  },
};
