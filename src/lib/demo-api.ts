import { IS_LOCAL_DEMO, DEMO_YOUTUBE_DASHBOARD } from "./demo-youtube";

/**
 * Populates every other page (analytics, videos, comments, leads, brand deals, affiliate, email,
 * link tracking, projects, reports, notifications, support, team, freebie, settings, billing)
 * with realistic client-only demo data, the same way dashboard.tsx already does for /dashboard —
 * only active when VITE_DEMO_MODE=true (see demo-youtube.ts). Implemented as a single window.fetch
 * interceptor (matched by request pathname) rather than editing each route file individually: it
 * never touches production code paths, is trivial to review/extend/remove, and every real page
 * keeps calling the exact same `fetch("/api/...")` it always has — the interceptor answers before
 * the request ever reaches the network.
 *
 * Reuses the same channel/video identities as DEMO_YOUTUBE_DASHBOARD (Kearl, @prince_kearl,
 * demo-video-1..4) everywhere so every page tells one consistent story instead of four different
 * channels.
 */

const CHANNEL_ROW_ID = "10000000-0000-4000-8000-000000000001";
const CHANNEL = DEMO_YOUTUBE_DASHBOARD.channel;
const VIDEOS = DEMO_YOUTUBE_DASHBOARD.videos;

function videoById(id: string | null) {
  return VIDEOS.find((v) => v.id === id) ?? VIDEOS[0];
}

// ============ features/access ============
// DashboardLayout calls this on every page to decide nav/feature gating — fails open (see
// getFeatureAccessForRole's own doc comment) when a feature key is missing, so an empty map is
// enough to render every page as fully enabled, same as the real "owner" role would see.
function demoFeaturesAccess() {
  return { data: { role: "owner", previewing: false, effectiveRole: "owner", features: {} } };
}

// ============ youtube/dashboard ============
// analytics.tsx calls this endpoint directly (in addition to dashboard.tsx, which already
// short-circuits to DEMO_YOUTUBE_DASHBOARD client-side and never reaches fetch) — needs its own
// handler here so Analytics' top KPI row and Revenue by Source chart aren't left empty.
function demoDashboard() {
  return {
    status: "connected",
    data: {
      ...DEMO_YOUTUBE_DASHBOARD,
      cpmByMonth: DEMO_YOUTUBE_DASHBOARD.analytics.map((row) => ({
        month: row.month,
        cpm: Number((row.estimatedRevenue / (row.views / 1000)).toFixed(2)),
      })),
      cpmStatus: "available",
    },
  };
}

// ============ youtube/breakdowns ============
function demoBreakdowns() {
  return {
    data: {
      range: "12M",
      startDate: "2025-09-19",
      endDate: "2026-09-19",
      video: {
        rows: VIDEOS.map((v, i) => ({
          video: v.id,
          title: v.title,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt,
          url: v.url,
          views: v.views,
          estimatedMinutesWatched: Math.round(v.views * (2.1 - i * 0.15)),
          estimatedRevenue: Number((v.views * (0.088 - i * 0.006)).toFixed(2)),
        })),
        revenueAvailable: true,
      },
      trafficSources: {
        rows: [
          { insightTrafficSourceType: "YT_SEARCH", views: 812, estimatedMinutesWatched: 1620 },
          {
            insightTrafficSourceType: "SUGGESTED_VIDEO",
            views: 604,
            estimatedMinutesWatched: 1180,
          },
          { insightTrafficSourceType: "BROWSE", views: 388, estimatedMinutesWatched: 745 },
          { insightTrafficSourceType: "EXT_URL", views: 142, estimatedMinutesWatched: 260 },
          { insightTrafficSourceType: "NOTIFICATION", views: 96, estimatedMinutesWatched: 180 },
        ],
        revenueAvailable: false,
      },
    },
    meta: { source: "youtube_analytics_api", fetchedAt: new Date().toISOString() },
  };
}

// ============ youtube/audience ============
function demoAudience() {
  const a = DEMO_YOUTUBE_DASHBOARD.audience;
  return {
    status: "connected",
    data: {
      range: "12M",
      startDate: "2025-09-19",
      endDate: "2026-09-19",
      availability: "available",
      topCountries: a.topCountries,
      ageGroups: a.ageGroups,
      genders: a.genders,
      previous: {
        topCountries: a.topCountries.map((c) => ({ ...c, views: Math.round(c.views * 0.86) })),
        ageGroups: a.ageGroups,
        genders: a.genders,
        available: true,
      },
    },
  };
}

// ============ youtube/videos ============
function demoVideosList() {
  return {
    status: "connected",
    data: {
      channel: {
        id: CHANNEL_ROW_ID,
        youtubeChannelId: CHANNEL.channelId,
        title: CHANNEL.title,
        handle: CHANNEL.handle,
        thumbnail: CHANNEL.thumbnail,
        videoCount: CHANNEL.videoCount,
      },
      videos: VIDEOS.map((v, i) => ({
        id: v.id,
        title: v.title,
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt,
        duration: v.duration,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        url: v.url,
        estimatedRevenue: Number((v.views * (0.088 - i * 0.006)).toFixed(2)),
        cpm: Number((4.2 - i * 0.3).toFixed(2)),
        changePercent: [22.2, -4.1, 12.6, null][i] ?? null,
        status: ["Top Performer", "Steady", "Growing", "Steady"][i] ?? "Steady",
      })),
      nextPageToken: null,
      videosStatus: "available",
      totalVideoCount: CHANNEL.videoCount,
      revenueAvailable: true,
    },
  };
}

// ============ youtube/video (detail) ============
function demoVideoDetail(url: URL) {
  const videoId = url.searchParams.get("videoId");
  const v = videoById(videoId);
  const days = 14;
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date("2026-09-06T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + i);
    const wave = Math.sin(i / 2.3) * 0.35 + 0.65;
    return {
      date: d.toISOString().slice(0, 10),
      views: Math.max(1, Math.round((v.views / days) * wave)),
      watchTimeMinutes: Math.max(1, Math.round((v.views / days) * wave * 2.1)),
      averageViewDurationSeconds: 200 + Math.round(wave * 180),
      averageViewPercentage: Number((38 + wave * 28).toFixed(1)),
      likes: Math.round((v.likes / days) * wave),
      comments: Math.round((v.comments / days) * wave),
      shares: Math.round(wave * 2),
      subscribersGained: i % 4 === 0 ? 1 : 0,
      subscribersLost: 0,
      estimatedRevenue: Number(((v.views / days) * wave * 0.088).toFixed(2)),
    };
  });
  const sum = (key: keyof (typeof rows)[number]) =>
    rows.reduce((a, r) => a + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
  return {
    data: {
      range: "12M",
      startDate: "2025-09-19",
      endDate: "2026-09-19",
      channel: { id: CHANNEL_ROW_ID, title: CHANNEL.title, handle: CHANNEL.handle },
      video: {
        id: v.id,
        title: v.title,
        description:
          "In this video I break down exactly how I plan, script, and ship content every month without burning out — the same system behind every upload on this channel.",
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt,
        duration: v.duration,
        privacyStatus: "public",
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        url: v.url,
        channelId: CHANNEL.channelId,
      },
      summary: {
        available: true,
        views: v.views,
        watchTimeMinutes: Math.round(sum("watchTimeMinutes")),
        averageViewDurationSeconds: Math.round(sum("averageViewDurationSeconds") / days),
        averageViewPercentage: Number((sum("averageViewPercentage") / days).toFixed(1)),
        likes: v.likes,
        comments: v.comments,
        shares: Math.round(sum("shares")),
        subscribersGained: Math.round(sum("subscribersGained")),
        subscribersLost: 0,
        estimatedRevenue: Number(sum("estimatedRevenue").toFixed(2)),
        cpm: 3.8,
        playbackBasedCpm: 2.4,
        revenueAvailable: true,
      },
      timeline: { available: true, rows, revenueAvailable: true },
      trafficSources: {
        available: true,
        rows: [
          {
            source: "YT_SEARCH",
            views: Math.round(v.views * 0.38),
            watchTimeMinutes: Math.round(v.views * 0.8),
            estimatedRevenue: Number((v.views * 0.033).toFixed(2)),
          },
          {
            source: "SUGGESTED_VIDEO",
            views: Math.round(v.views * 0.28),
            watchTimeMinutes: Math.round(v.views * 0.58),
            estimatedRevenue: Number((v.views * 0.024).toFixed(2)),
          },
          {
            source: "BROWSE",
            views: Math.round(v.views * 0.19),
            watchTimeMinutes: Math.round(v.views * 0.39),
            estimatedRevenue: Number((v.views * 0.017).toFixed(2)),
          },
          {
            source: "EXT_URL",
            views: Math.round(v.views * 0.09),
            watchTimeMinutes: Math.round(v.views * 0.17),
            estimatedRevenue: Number((v.views * 0.008).toFixed(2)),
          },
          {
            source: "NOTIFICATION",
            views: Math.round(v.views * 0.06),
            watchTimeMinutes: Math.round(v.views * 0.11),
            estimatedRevenue: Number((v.views * 0.005).toFixed(2)),
          },
        ],
        revenueAvailable: true,
      },
      demographics: {
        available: true,
        rows: DEMO_YOUTUBE_DASHBOARD.audience.ageGroups.flatMap((a) => [
          {
            ageGroup: a.ageGroup,
            gender: "male",
            viewerPercentage: Number((a.viewerPercentage * 0.6).toFixed(1)),
          },
          {
            ageGroup: a.ageGroup,
            gender: "female",
            viewerPercentage: Number((a.viewerPercentage * 0.38).toFixed(1)),
          },
        ]),
      },
      retention: {
        available: true,
        rows: Array.from({ length: 20 }, (_, i) => {
          const t = i / 19;
          return {
            elapsedVideoTimeRatio: Number(t.toFixed(2)),
            audienceWatchRatio: Number(
              Math.max(0.12, 1 - t * 0.82 - Math.sin(t * 8) * 0.03).toFixed(3),
            ),
            relativeRetentionPerformance: Number((Math.sin(t * 5) * 0.08).toFixed(3)),
          };
        }),
      },
    },
    meta: {
      source: "youtube_analytics_api",
      available: true,
      revenueAvailable: true,
      fetchedAt: new Date().toISOString(),
    },
  };
}

// ============ youtube/analyze-video (public lookup, used by add-video.tsx) ============
function demoAnalyzeVideo(url: URL) {
  const videoId = url.searchParams.get("videoId") ?? VIDEOS[0].id;
  const v = videoById(videoId);
  return {
    data: {
      video: {
        id: v.id,
        title: v.title,
        description: "Full breakdown of the system inside — timestamps below.",
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt,
        durationSeconds: 522,
        privacyStatus: "public",
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        channelId: CHANNEL.channelId,
      },
      channel: {
        id: CHANNEL_ROW_ID,
        youtubeChannelId: CHANNEL.channelId,
        title: CHANNEL.title,
        handle: CHANNEL.handle,
      },
      ownership: "connected",
      analyticsAccess: "private",
      savedVideo: null,
      transcript: null,
    },
  };
}

// ============ comment-rules ============
function demoCommentRules() {
  return {
    data: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        name: "Pricing questions",
        trigger_type: "keyword",
        keywords: ["price", "cost", "how much"],
        reply_template: "Thanks for asking! Pricing and details are linked in the description 🙌",
        active: true,
        created_at: "2026-08-02T10:00:00.000Z",
        updated_at: "2026-08-02T10:00:00.000Z",
        video: null,
        firedCount: 34,
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        name: "Welcome new commenters",
        trigger_type: "handle",
        keywords: ["@prince_kearl"],
        reply_template: "Appreciate you watching — let me know if you have questions!",
        active: true,
        created_at: "2026-07-14T10:00:00.000Z",
        updated_at: "2026-07-14T10:00:00.000Z",
        video: { id: "30000000-0000-4000-8000-000000000001", title: VIDEOS[0].title },
        firedCount: 61,
      },
      {
        id: "20000000-0000-4000-8000-000000000003",
        name: "Course/template requests",
        trigger_type: "question",
        keywords: ["template", "link"],
        reply_template: "Grab the free template here — link in pinned comment!",
        active: false,
        created_at: "2026-06-20T10:00:00.000Z",
        updated_at: "2026-06-20T10:00:00.000Z",
        video: null,
        firedCount: 12,
      },
    ],
    activeRulesThirtyDaysAgo: 2,
  };
}

// ============ youtube/quota ============
function demoQuota() {
  return { data: { used: 1840, max: 10_000 } };
}

// ============ youtube/comments ============
function demoComments() {
  return {
    status: "connected",
    data: {
      comments: [
        {
          id: "c1",
          videoId: VIDEOS[0].id,
          author: "Maria S.",
          authorAvatar: null,
          text: "This changed how I plan my whole month, thank you!",
          publishedAt: "2026-09-17T14:20:00.000Z",
          likeCount: 12,
          replied: true,
        },
        {
          id: "c2",
          videoId: VIDEOS[0].id,
          author: "creator_dev",
          authorAvatar: null,
          text: "What's the price for the template you mentioned?",
          publishedAt: "2026-09-17T09:05:00.000Z",
          likeCount: 3,
          replied: false,
        },
        {
          id: "c3",
          videoId: VIDEOS[1].id,
          author: "@prince_kearl fan",
          authorAvatar: null,
          text: "Been waiting for a revenue breakdown video, finally!",
          publishedAt: "2026-09-16T20:40:00.000Z",
          likeCount: 8,
          replied: true,
        },
        {
          id: "c4",
          videoId: VIDEOS[2].id,
          author: "Jonah T.",
          authorAvatar: null,
          text: "Can you link the template from this video?",
          publishedAt: "2026-09-15T11:12:00.000Z",
          likeCount: 1,
          replied: false,
        },
        {
          id: "c5",
          videoId: VIDEOS[3].id,
          author: "growth_kate",
          authorAvatar: null,
          text: "How much did this dashboard cost to build?",
          publishedAt: "2026-09-14T08:00:00.000Z",
          likeCount: 5,
          replied: false,
        },
      ],
      videos: VIDEOS.map((v) => ({ id: v.id, title: v.title })),
    },
  };
}

// ============ destinations ============
const DEMO_DESTINATIONS = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Free Content Calendar Template",
    type: "lead-magnet",
    url: "https://tubify.local/f/content-calendar",
    description: "Notion template for planning a month of content",
    status: "active",
    icon: "link",
    color: "purple",
    category: "conversion",
    created_at: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    name: "Creator Toolkit (Gumroad)",
    type: "product",
    url: "https://gumroad.com/l/creator-toolkit",
    description: null,
    status: "active",
    icon: "cart",
    color: "green",
    category: "conversion",
    created_at: "2026-06-12T00:00:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    name: "Instagram",
    type: "social",
    url: "https://instagram.com/prince_kearl",
    description: null,
    status: "active",
    icon: "instagram",
    color: "amber",
    category: "social",
    created_at: "2026-05-20T00:00:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000004",
    name: "Newsletter Signup",
    type: "email",
    url: "https://tubify.local/newsletter",
    description: "Weekly creator revenue tips",
    status: "active",
    icon: "external",
    color: "blue",
    category: "conversion",
    created_at: "2026-04-18T00:00:00.000Z",
  },
];

function demoDestinations() {
  return { data: DEMO_DESTINATIONS };
}

function demoDestinationTopVideos() {
  return {
    data: [
      { id: VIDEOS[0].id, title: VIDEOS[0].title, thumbnail: VIDEOS[0].thumbnail, clicks: 142 },
      { id: VIDEOS[1].id, title: VIDEOS[1].title, thumbnail: VIDEOS[1].thumbnail, clicks: 88 },
      { id: VIDEOS[2].id, title: VIDEOS[2].title, thumbnail: VIDEOS[2].thumbnail, clicks: 51 },
    ],
  };
}

// ============ deals (brand-deals.tsx, team.tsx) ============
function demoDeals() {
  return {
    data: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        name: "NordVPN Sponsorship",
        contact_name: "Alex Rivera",
        value: 4500,
        currency: "usd",
        tag: "Sponsorship",
        stage: "negotiating",
        next_action: "Send counter-offer",
        expected_close_date: "2026-10-02",
        closed_at: null,
        notes: "They want a 60s mid-roll, pushing for 90s.",
        assigned_member_id: null,
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-09-10T00:00:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        name: "Skillshare Integration",
        contact_name: "Priya Nair",
        value: 2800,
        currency: "usd",
        tag: "Affiliate",
        stage: "contracted",
        next_action: "Deliver video by Sep 30",
        expected_close_date: "2026-09-30",
        closed_at: null,
        notes: null,
        assigned_member_id: null,
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-09-08T00:00:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000003",
        name: "Notion Creator Program",
        contact_name: "Sam Lee",
        value: 1200,
        currency: "usd",
        tag: "Product",
        stage: "completed",
        next_action: null,
        expected_close_date: "2026-08-15",
        closed_at: "2026-08-14T00:00:00.000Z",
        notes: "Paid on delivery, good relationship.",
        assigned_member_id: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-08-14T00:00:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000004",
        name: "Local SaaS Startup",
        contact_name: "Dana Kim",
        value: 900,
        currency: "usd",
        tag: "Sponsorship",
        stage: "prospect",
        next_action: "Follow up next week",
        expected_close_date: null,
        closed_at: null,
        notes: null,
        assigned_member_id: null,
        created_at: "2026-09-12T00:00:00.000Z",
        updated_at: "2026-09-12T00:00:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000005",
        name: "Riverside.fm Partnership",
        contact_name: "Jordan Blake",
        value: 3200,
        currency: "usd",
        tag: "Sponsorship",
        stage: "pitched",
        next_action: "Awaiting reply",
        expected_close_date: "2026-10-15",
        closed_at: null,
        notes: null,
        assigned_member_id: null,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
    ],
  };
}

// ============ workspace/members (team.tsx, leads.tsx) ============
function demoWorkspaceMembers() {
  return {
    data: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        workspace_id: "w1",
        user_id: "demo-user-local-preview",
        invited_email: "demo@tubify.local",
        role: "owner",
        status: "active",
        lead_share: 0,
        commission: 0,
        job_title: "Founder",
        cost_amount: 0,
        invited_at: null,
        joined_at: "2026-06-01T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        member: { name: "Demo Creator", email: "demo@tubify.local", avatar: "/logo.png" },
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        workspace_id: "w1",
        user_id: "demo-user-2",
        invited_email: "jordan@tubify.local",
        role: "manager",
        status: "active",
        lead_share: 20,
        commission: 10,
        job_title: "Community Manager",
        cost_amount: 500,
        invited_at: "2026-07-01T00:00:00.000Z",
        joined_at: "2026-07-02T00:00:00.000Z",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-02T00:00:00.000Z",
        member: { name: "Jordan Blake", email: "jordan@tubify.local", avatar: null },
      },
      {
        id: "60000000-0000-4000-8000-000000000003",
        workspace_id: "w1",
        user_id: "demo-user-3",
        invited_email: "sam@tubify.local",
        role: "setter",
        status: "invited",
        lead_share: 15,
        commission: 5,
        job_title: "Outreach",
        cost_amount: 0,
        invited_at: "2026-09-10T00:00:00.000Z",
        joined_at: null,
        created_at: "2026-09-10T00:00:00.000Z",
        updated_at: "2026-09-10T00:00:00.000Z",
        member: null,
      },
    ],
    meta: { role: "owner" },
  };
}

// ============ campaigns (email.tsx) ============
function demoCampaigns() {
  return {
    data: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        name: "September revenue tips",
        subject: "3 ways creators are diversifying revenue this quarter",
        body: "Hey there — this week I'm breaking down...",
        status: "ready",
        created_at: "2026-09-10T00:00:00.000Z",
        updated_at: "2026-09-12T00:00:00.000Z",
      },
      {
        id: "70000000-0000-4000-8000-000000000002",
        name: "New template drop",
        subject: "Free content calendar template inside",
        body: "I just published a new content calendar template...",
        status: "draft",
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
      },
      {
        id: "70000000-0000-4000-8000-000000000003",
        name: "August recap",
        subject: "What worked (and what didn't) in August",
        body: "Monthly recap time...",
        status: "ready",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-03T00:00:00.000Z",
      },
    ],
  };
}

// ============ email/audience ============
function demoEmailAudience() {
  return {
    data: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        name: "Maria S.",
        email: "maria@example.com",
        platform: "YouTube Comment",
        status: "converted",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        name: "Jonah T.",
        email: "jonah@example.com",
        platform: "Instagram",
        status: "qualified",
        created_at: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "80000000-0000-4000-8000-000000000003",
        name: "Kate G.",
        email: "kate@example.com",
        platform: "Email",
        status: "new",
        created_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "80000000-0000-4000-8000-000000000004",
        name: "Dev R.",
        email: "dev@example.com",
        platform: "YouTube Comment",
        status: "contacted",
        created_at: "2026-09-08T00:00:00.000Z",
      },
    ],
  };
}

// ============ leads ============
function demoLeads() {
  return {
    data: [
      {
        id: "90000000-0000-4000-8000-000000000001",
        workspace_id: "w1",
        user_id: "demo-user-local-preview",
        name: "Maria S.",
        platform: "YouTube Comment",
        username: "@marias",
        email: "maria@example.com",
        source: "Comment on 'How I Plan a Month of YouTube Content'",
        notes: "Interested in the content calendar template.",
        status: "converted",
        assigned_to: null,
        tags: ["warm"],
        pinned: true,
        muted: false,
        favorite: true,
        archived: false,
        unread: false,
        primary_lead_id: null,
        ai_summary: null,
        ai_summary_generated_at: null,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-09-15T00:00:00.000Z",
      },
      {
        id: "90000000-0000-4000-8000-000000000002",
        workspace_id: "w1",
        user_id: "demo-user-local-preview",
        name: "Jonah T.",
        platform: "Instagram",
        username: "@jonaht",
        email: "jonah@example.com",
        source: "DM after Reel",
        notes: null,
        status: "qualified",
        assigned_to: null,
        tags: [],
        pinned: false,
        muted: false,
        favorite: false,
        archived: false,
        unread: true,
        primary_lead_id: null,
        ai_summary: null,
        ai_summary_generated_at: null,
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-09-14T00:00:00.000Z",
      },
      {
        id: "90000000-0000-4000-8000-000000000003",
        workspace_id: "w1",
        user_id: "demo-user-local-preview",
        name: "Kate G.",
        platform: "Email",
        username: null,
        email: "kate@example.com",
        source: "Newsletter signup",
        notes: null,
        status: "new",
        assigned_to: null,
        tags: ["cold"],
        pinned: false,
        muted: false,
        favorite: false,
        archived: false,
        unread: true,
        primary_lead_id: null,
        ai_summary: null,
        ai_summary_generated_at: null,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "90000000-0000-4000-8000-000000000004",
        workspace_id: "w1",
        user_id: "demo-user-local-preview",
        name: "Dev R.",
        platform: "YouTube Comment",
        username: "@creator_dev",
        email: "dev@example.com",
        source: "Comment asking about pricing",
        notes: "Follow up with pricing sheet.",
        status: "contacted",
        assigned_to: null,
        tags: [],
        pinned: false,
        muted: false,
        favorite: false,
        archived: false,
        unread: false,
        primary_lead_id: null,
        ai_summary: null,
        ai_summary_generated_at: null,
        created_at: "2026-09-08T00:00:00.000Z",
        updated_at: "2026-09-13T00:00:00.000Z",
      },
    ],
  };
}

function demoLeadMessages(url: URL) {
  const leadId = url.searchParams.get("leadId");
  if (leadId === "90000000-0000-4000-8000-000000000001") {
    return {
      data: [
        {
          id: "m1",
          lead_id: leadId,
          from_who: "lead",
          kind: "comment",
          text: "This changed how I plan my whole month, thank you!",
          pinned: false,
          created_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "m2",
          lead_id: leadId,
          from_who: "you",
          kind: "note",
          text: "Sent the content calendar template link.",
          pinned: false,
          created_at: "2026-08-02T09:00:00.000Z",
        },
        {
          id: "m3",
          lead_id: leadId,
          from_who: "lead",
          kind: "comment",
          text: "Got it, this is exactly what I needed!",
          pinned: true,
          created_at: "2026-08-03T10:00:00.000Z",
        },
      ],
    };
  }
  return { data: [] };
}

// ============ workspace/domain ============
function demoWorkspaceDomain() {
  return {
    data: {
      domain: null,
      verifiedAt: null,
      cnameTarget: "youtube-revenueos.vercel.app",
      canManage: true,
    },
  };
}

// ============ tracking-links ============
function demoTrackingLinks() {
  return {
    data: [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        slug: "calendar",
        status: "active",
        clicks: 142,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-09-15T00:00:00.000Z",
        destination: {
          id: DEMO_DESTINATIONS[0].id,
          name: DEMO_DESTINATIONS[0].name,
          url: DEMO_DESTINATIONS[0].url,
        },
        video: { id: VIDEOS[0].id, title: VIDEOS[0].title },
        uniqueClicks: 118,
        shortUrl: "https://youtube-revenueos.vercel.app/l/calendar",
      },
      {
        id: "a0000000-0000-4000-8000-000000000002",
        slug: "toolkit",
        status: "active",
        clicks: 88,
        created_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-09-10T00:00:00.000Z",
        destination: {
          id: DEMO_DESTINATIONS[1].id,
          name: DEMO_DESTINATIONS[1].name,
          url: DEMO_DESTINATIONS[1].url,
        },
        video: { id: VIDEOS[1].id, title: VIDEOS[1].title },
        uniqueClicks: 74,
        shortUrl: "https://youtube-revenueos.vercel.app/l/toolkit",
      },
      {
        id: "a0000000-0000-4000-8000-000000000003",
        slug: "ig",
        status: "active",
        clicks: 51,
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
        destination: {
          id: DEMO_DESTINATIONS[2].id,
          name: DEMO_DESTINATIONS[2].name,
          url: DEMO_DESTINATIONS[2].url,
        },
        video: null,
        uniqueClicks: 45,
        shortUrl: "https://youtube-revenueos.vercel.app/l/ig",
      },
    ],
  };
}

// ============ projects ============
function demoProjects() {
  return {
    data: [
      {
        id: "b0000000-0000-4000-8000-000000000001",
        title: "Q4 Sponsorship Pitch Deck",
        prompt: "A pitch deck outline for brand sponsorships targeting SaaS companies",
        status: "completed",
        output: {
          summary: "10-slide outline covering audience, past results, and package tiers.",
          wireframes: [
            "Title & audience overview",
            "Past sponsorship results",
            "Package tiers & pricing",
          ],
          flowchart: ["Intro", "Audience data", "Case studies", "Packages", "Contact"],
          developerHandoff: [],
        },
        error: null,
        user_id: "demo-user-local-preview",
        workspace_id: "w1",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
      },
      {
        id: "b0000000-0000-4000-8000-000000000002",
        title: "Video Series: Creator Finance 101",
        prompt: "A 5-part video series outline on creator finances",
        status: "completed",
        output: {
          summary: "5 episodes: taxes, LLCs, savings, reinvestment, and diversifying income.",
          wireframes: ["Episode 1: Taxes 101", "Episode 2: LLCs", "Episode 3: Savings"],
          flowchart: ["Hook", "Problem", "Framework", "Example", "CTA"],
          developerHandoff: [],
        },
        error: null,
        user_id: "demo-user-local-preview",
        workspace_id: "w1",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
      },
    ],
  };
}

// ============ reports/summary ============
function demoReportsSummary() {
  return {
    data: {
      periodLabel: "Past 30 days",
      revenueThisPeriod: 1200,
      revenueChangePct: 18.4,
      activePipeline: 9400,
      leadsThisPeriod: 4,
      leadsChangePct: 33.3,
      videosThisPeriod: 2,
      dealsClosedThisPeriod: 1,
      totals: { deals: 5, leads: 4, videos: 4 },
    },
  };
}

// ============ notifications ============
function demoNotifications() {
  return {
    data: [
      {
        id: "c0000000-0000-4000-8000-000000000001",
        type: "dollar",
        title: "New sponsorship payment",
        message: "Skillshare Integration deal marked as paid ($2,800)",
        read: false,
        pinned: true,
        archived: false,
        created_at: "2026-09-16T14:00:00.000Z",
      },
      {
        id: "c0000000-0000-4000-8000-000000000002",
        type: "message",
        title: "New lead",
        message: "Kate G. signed up via your newsletter",
        read: false,
        pinned: false,
        archived: false,
        created_at: "2026-09-15T09:00:00.000Z",
      },
      {
        id: "c0000000-0000-4000-8000-000000000003",
        type: "check",
        title: "Comment rule fired",
        message: '"Pricing questions" auto-replied to a new comment',
        read: true,
        pinned: false,
        archived: false,
        created_at: "2026-09-14T18:30:00.000Z",
      },
      {
        id: "c0000000-0000-4000-8000-000000000004",
        type: "zap",
        title: "Video published",
        message: '"How I Plan a Month of YouTube Content" is live',
        read: true,
        pinned: false,
        archived: false,
        created_at: "2026-08-24T15:05:00.000Z",
      },
    ],
  };
}

// ============ affiliate/summary ============
function demoAffiliateSummary() {
  return {
    data: {
      referralCode: "kearl2026",
      referralLink: "https://youtube-revenueos.vercel.app/signup?ref=kearl2026",
      totalEarningsCents: 48600,
      pendingPayoutCents: 6200,
      referredClients: 6,
      totalSignups: 14,
      totalClicks: 210,
      conversionRatePct: 6.7,
      monthlyCommission: [
        { month: "2026-05", cents: 4200 },
        { month: "2026-06", cents: 6800 },
        { month: "2026-07", cents: 9400 },
        { month: "2026-08", cents: 12600 },
        { month: "2026-09", cents: 15600 },
      ],
      monthlyPending: [{ month: "2026-09", cents: 6200 }],
      referredClientsByMonth: [
        { month: "2026-06", count: 1 },
        { month: "2026-07", count: 2 },
        { month: "2026-08", count: 1 },
        { month: "2026-09", count: 2 },
      ],
      conversionRateByMonth: [
        { month: "2026-06", ratePct: 5.1 },
        { month: "2026-07", ratePct: 6.2 },
        { month: "2026-08", ratePct: 7.0 },
        { month: "2026-09", ratePct: 6.7 },
      ],
      activeSubscriptions: [
        { planId: "pro", name: "Pro", count: 4, mrrCents: 15600 },
        { planId: "starter", name: "Starter", count: 2, mrrCents: 3800 },
      ],
      recentReferrals: [
        {
          id: "r1",
          client: "Alicia W.",
          plan: "Pro",
          commissionCents: 1560,
          date: "2026-09-10T00:00:00.000Z",
          status: "converted",
        },
        {
          id: "r2",
          client: "Marcus D.",
          plan: "Starter",
          commissionCents: 1900,
          date: "2026-09-05T00:00:00.000Z",
          status: "converted",
        },
        {
          id: "r3",
          client: "Priya N.",
          plan: null,
          commissionCents: 0,
          date: "2026-09-14T00:00:00.000Z",
          status: "pending",
        },
      ],
    },
  };
}

// ============ support/tickets ============
function demoSupportTickets() {
  return {
    data: [
      {
        id: "d0000000-0000-4000-8000-000000000001",
        subject: "Stripe payout delayed",
        message: "My last payout is showing pending for 5 days.",
        priority: "High",
        status: "Open",
        source: "App",
        created_at: "2026-09-14T00:00:00.000Z",
        updated_at: "2026-09-15T00:00:00.000Z",
      },
      {
        id: "d0000000-0000-4000-8000-000000000002",
        subject: "Can't connect Instagram",
        message: "OAuth redirect fails on the Integrations page.",
        priority: "Medium",
        status: "Resolved",
        source: "App",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-22T00:00:00.000Z",
      },
    ],
  };
}

// ============ freebies (freebie.tsx) ============
function demoFreebies() {
  return {
    data: [
      {
        id: "e0000000-0000-4000-8000-000000000001",
        user_id: "demo-user-local-preview",
        workspace_id: "w1",
        title: "Content Calendar Template",
        product: "Content planning",
        audience: "Solo creators",
        tone: "Friendly",
        format: "notion",
        content: "# Content Calendar Template\n\n...",
        source: "generated",
        status: "published",
        teaser: "Plan a month of content in under an hour.",
        slug: "content-calendar",
        file_path: null,
        destination_id: DEMO_DESTINATIONS[0].id,
        published_at: "2026-08-05T00:00:00.000Z",
        optins: [{ count: 312 }],
        clicks: 142,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-05T00:00:00.000Z",
      },
      {
        id: "e0000000-0000-4000-8000-000000000002",
        user_id: "demo-user-local-preview",
        workspace_id: "w1",
        title: "YouTube Growth Checklist",
        product: "Channel growth",
        audience: "New creators",
        tone: "Direct",
        format: "pdf",
        content: "# YouTube Growth Checklist\n\n...",
        source: "generated",
        status: "draft",
        teaser: null,
        slug: null,
        file_path: null,
        destination_id: null,
        published_at: null,
        optins: [{ count: 0 }],
        clicks: 0,
        created_at: "2026-09-10T00:00:00.000Z",
        updated_at: "2026-09-10T00:00:00.000Z",
      },
    ],
  };
}

// ============ knowledge (freebie.tsx knowledge base) ============
function demoKnowledge() {
  return {
    data: [
      {
        id: "f0000000-0000-4000-8000-000000000001",
        title: "Brand voice notes",
        kind: "note",
        content: "Friendly, direct, no corporate jargon. Speak like a peer, not a guru.",
        file_name: null,
        file_type: null,
        file_size: null,
        extraction_status: "ready",
        lead_magnet_id: null,
        created_at: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "f0000000-0000-4000-8000-000000000002",
        title: "Audience survey results.pdf",
        kind: "file",
        content: "Top requests: templates, pricing breakdowns, tool recommendations.",
        file_name: "audience-survey.pdf",
        file_type: "application/pdf",
        file_size: 184_320,
        extraction_status: "ready",
        lead_magnet_id: null,
        created_at: "2026-06-15T00:00:00.000Z",
      },
    ],
  };
}

// ============ workspace/branding ============
function demoWorkspaceBranding() {
  return {
    data: {
      logoUrl: null,
      primaryColor: "#0284C7",
      accentColor: "#3B82F6",
      fontFamily: "sans",
      canManage: true,
    },
  };
}

// ============ profile ============
function demoProfile() {
  return {
    data: {
      id: "demo-user-local-preview",
      email: "demo@tubify.local",
      name: "Demo Creator",
      avatar: "/logo.png",
      role: "owner",
      location: "Austin, TX",
      website: "https://youtube.com/@prince_kearl",
      bio: "Helping creators turn views into real, diversified revenue.",
      cover_url: null,
      banner_settings: {
        showName: true,
        showAvatar: true,
        showSubscribers: true,
        showRecentPosts: true,
        showVisitButton: true,
      },
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-08-27T00:00:00.000Z",
    },
  };
}

// ============ youtube/channels (settings.tsx) ============
function demoYoutubeChannels() {
  return {
    data: [
      {
        id: CHANNEL_ROW_ID,
        youtube_channel_id: CHANNEL.channelId,
        channel_name: CHANNEL.title,
        channel_handle: CHANNEL.handle,
        thumbnail: CHANNEL.thumbnail,
        subscriber_count: CHANNEL.subscriberCount,
        view_count: CHANNEL.viewCount,
        video_count: CHANNEL.videoCount,
        uploads_playlist_id: CHANNEL.uploadsPlaylistId,
        connected_at: "2026-06-01T00:00:00.000Z",
        last_synced_at: "2026-09-19T01:00:00.000Z",
        last_sync_status: "success",
        last_sync_error: null,
        token_expiry: "2027-01-01T00:00:00.000Z",
      },
    ],
  };
}

// ============ integrations ============
function demoIntegrations() {
  return {
    data: [
      {
        id: "g0000000-0000-4000-8000-000000000001",
        provider: "stripe",
        provider_account_id: "acct_demo123",
        account_name: "Stripe account",
        metadata: {},
        connected_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-10T00:00:00.000Z",
      },
    ],
  };
}

// ============ billing/subscription ============
function demoBillingSubscription() {
  return {
    data: {
      stripeConfigured: true,
      subscription: {
        plan_id: "pro",
        billing_interval: "month",
        status: "active",
        current_period_end: "2026-10-19T00:00:00.000Z",
        cancel_at_period_end: false,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      plans: [
        {
          id: "starter",
          name: "Starter",
          description: "For creators just getting started",
          features: ["1 channel", "Basic analytics", "Email support"],
          monthlyPriceCents: 1900,
          annualPriceCents: 19000,
          available: true,
        },
        {
          id: "pro",
          name: "Pro",
          description: "For full-time creators monetizing multiple ways",
          features: ["3 channels", "Full analytics", "Brand deals CRM", "Priority support"],
          monthlyPriceCents: 4900,
          annualPriceCents: 49000,
          available: true,
        },
        {
          id: "scale",
          name: "Scale",
          description: "For teams and agencies",
          features: ["Unlimited channels", "Team seats", "White-glove support"],
          monthlyPriceCents: 9900,
          annualPriceCents: 99000,
          available: true,
        },
      ],
    },
  };
}

// ---- registry: exact pathname -> handler ----
const GET_HANDLERS: Record<string, (url: URL) => unknown> = {
  "/api/youtube/breakdowns": demoBreakdowns,
  "/api/youtube/dashboard": demoDashboard,
  "/api/features/access": demoFeaturesAccess,
  "/api/youtube/audience": demoAudience,
  "/api/youtube/videos": demoVideosList,
  "/api/youtube/video": demoVideoDetail,
  "/api/youtube/analyze-video": demoAnalyzeVideo,
  "/api/comment-rules": demoCommentRules,
  "/api/youtube/quota": demoQuota,
  "/api/youtube/comments": demoComments,
  "/api/destinations": demoDestinations,
  "/api/destinations/top-videos": demoDestinationTopVideos,
  "/api/deals": demoDeals,
  "/api/workspace/members": demoWorkspaceMembers,
  "/api/campaigns": demoCampaigns,
  "/api/email/audience": demoEmailAudience,
  "/api/leads": demoLeads,
  "/api/leads/messages": demoLeadMessages,
  "/api/workspace/domain": demoWorkspaceDomain,
  "/api/tracking-links": demoTrackingLinks,
  "/api/projects": demoProjects,
  "/api/reports/summary": demoReportsSummary,
  "/api/notifications": demoNotifications,
  "/api/affiliate/summary": demoAffiliateSummary,
  "/api/support/tickets": demoSupportTickets,
  "/api/freebies": demoFreebies,
  "/api/knowledge": demoKnowledge,
  "/api/workspace/branding": demoWorkspaceBranding,
  "/api/profile": demoProfile,
  "/api/youtube/channels": demoYoutubeChannels,
  "/api/integrations": demoIntegrations,
  "/api/billing/subscription": demoBillingSubscription,
};

function requestUrlAndMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: URL; method: string } {
  if (typeof input === "string") {
    return {
      url: new URL(input, window.location.origin),
      method: (init?.method ?? "GET").toUpperCase(),
    };
  }
  if (input instanceof URL) {
    return { url: input, method: (init?.method ?? "GET").toUpperCase() };
  }
  return {
    url: new URL(input.url, window.location.origin),
    method: (init?.method ?? input.method ?? "GET").toUpperCase(),
  };
}

let installed = false;

export function installDemoApiInterceptor() {
  if (!IS_LOCAL_DEMO || installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method } = requestUrlAndMethod(input, init);
    const handler = GET_HANDLERS[url.pathname];
    if (method === "GET" && handler) {
      const body = handler(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof window.fetch;
}
