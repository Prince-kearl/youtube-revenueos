// Shared mock data for the RevenueOS clone.

export const channel = {
  name: "@YourChannel",
  handle: "YourChannel",
  url: "https://www.youtube.com/@YourChannel",
  avatar: "https://i.pravatar.cc/128?img=13",
  subscribers: "1.24M",
  subscribersLabel: "subscribers",
};

export const recentPosts = [
  { title: "How I Made $100K on YouTube", date: "Dec 12, 2024", views: "892K", duration: "14:22", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { title: "The Creator Business Blueprint", date: "Nov 28, 2024", views: "641K", duration: "22:07", url: "https://www.youtube.com/watch?v=9bZkp7q19f0" },
  { title: "YouTube Monetization Deep Dive", date: "Nov 15, 2024", views: "428K", duration: "18:45", url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk" },
  { title: "AI Tools for Content Creators", date: "Oct 30, 2024", views: "380K", duration: "11:30", url: "https://www.youtube.com/watch?v=3JZ_D3ELwOQ" },
];


export const topVideos = [
  { rank: 1, title: "How I Made $100K on YouTube", date: "Dec 12, 2024", views: "892,400", viewsShort: "892K", revenue: "$12,400", ctr: "5.2%", cpm: "$8.40", likes: "24.1K", status: "Top Performer", change: "14.2%", up: true },
  { rank: 2, title: "The Creator Business Blueprint", date: "Nov 28, 2024", views: "641,200", viewsShort: "641K", revenue: "$8,900", ctr: "4.8%", cpm: "$7.20", likes: "18.6K", status: "High Revenue", change: "8.7%", up: true },
  { rank: 3, title: "YouTube Monetization Deep Dive", date: "Nov 15, 2024", views: "428,300", viewsShort: "428K", revenue: "$6,200", ctr: "3.9%", cpm: "$6.80", likes: "12.4K", status: "Steady", change: "2.1%", up: false },
  { rank: 4, title: "AI Tools for Content Creators", date: "Oct 30, 2024", views: "380,600", viewsShort: "380K", revenue: "$5,800", ctr: "6.1%", cpm: "$9.20", likes: "16.2K", status: "Growing", change: "22.4%", up: true },
  { rank: 5, title: "My Brand Deal Negotiation Script", date: "Oct 14, 2024", views: "316,800", viewsShort: "316K", revenue: "$4,100", ctr: "4.3%", cpm: "$5.90", likes: "9.8K", status: "Steady", change: "5.9%", up: true },
  { rank: 6, title: "10 Passive Income Streams for Creators", date: "Sep 28, 2024", views: "284,100", viewsShort: "284K", revenue: "$3,800", ctr: "3.7%", cpm: "$6.20", likes: "8.3K", status: "Steady", change: "3.2%", up: true },
  { rank: 7, title: "How to Pitch Brands as a Small Creator", date: "Sep 12, 2024", views: "198,400", viewsShort: "198K", revenue: "$2,900", ctr: "3.2%", cpm: "$5.40", likes: "6.1K", status: "Declining", change: "8.4%", up: false },
];

export const revenueSplit = [
  { label: "Brand Deals", amount: "$27,466", pct: 62, color: "var(--color-brand-purple)" },
  { label: "AdSense", amount: "$9,303", pct: 21, color: "var(--color-brand-blue)" },
  { label: "Memberships", amount: "$4,430", pct: 10, color: "var(--color-brand-green)" },
  { label: "Affiliates", amount: "$3,101", pct: 7, color: "var(--color-brand-amber)" },
];

export const revenueTrend = [
  { month: "Jan", adsense: 3, brand: 4, memberships: 1 },
  { month: "Feb", adsense: 6, brand: 12, memberships: 2 },
  { month: "Mar", adsense: 7, brand: 10, memberships: 3 },
  { month: "Apr", adsense: 8, brand: 14, memberships: 4 },
  { month: "May", adsense: 8, brand: 18, memberships: 4 },
  { month: "Jun", adsense: 9, brand: 13, memberships: 5 },
  { month: "Jul", adsense: 10, brand: 20, memberships: 5 },
  { month: "Aug", adsense: 10, brand: 22, memberships: 6 },
  { month: "Sep", adsense: 11, brand: 24, memberships: 6 },
  { month: "Oct", adsense: 12, brand: 27, memberships: 7 },
  { month: "Nov", adsense: 12, brand: 26, memberships: 7 },
  { month: "Dec", adsense: 13, brand: 32, memberships: 8 },
];

export const analyticsBars = [
  { month: "Jul", brand: 12, adsense: 3, memberships: 2, affiliates: 1 },
  { month: "Aug", brand: 18, adsense: 5, memberships: 3, affiliates: 2 },
  { month: "Sep", brand: 19, adsense: 5, memberships: 3, affiliates: 2 },
  { month: "Oct", brand: 24, adsense: 6, memberships: 4, affiliates: 2 },
  { month: "Nov", brand: 22, adsense: 5, memberships: 3, affiliates: 2 },
  { month: "Dec", brand: 30, adsense: 8, memberships: 5, affiliates: 3 },
];

export const geoRevenue = [
  { country: "United States", code: "US", views: 3.8, revenue: 68400, pct: 41 },
  { country: "United Kingdom", code: "GB", views: 1.2, revenue: 19800, pct: 12 },
  { country: "Canada", code: "CA", views: 0.9, revenue: 14200, pct: 9 },
  { country: "India", code: "IN", views: 1.4, revenue: 9600, pct: 6 },
  { country: "Australia", code: "AU", views: 0.6, revenue: 9200, pct: 6 },
  { country: "Germany", code: "DE", views: 0.5, revenue: 7800, pct: 5 },
  { country: "Netherlands", code: "NL", views: 0.3, revenue: 5400, pct: 3 },
  { country: "Philippines", code: "PH", views: 0.7, revenue: 4100, pct: 3 },
  { country: "Brazil", code: "BR", views: 0.5, revenue: 3600, pct: 2 },
  { country: "Other", code: "—", views: 2.1, revenue: 9800, pct: 6 },
];

export const cpmTrend = [
  { month: "Jul", cpm: 6.2 },
  { month: "Aug", cpm: 6.8 },
  { month: "Sep", cpm: 7.4 },
  { month: "Oct", cpm: 8.9 },
  { month: "Nov", cpm: 9.3 },
  { month: "Dec", cpm: 10.1 },
];

export const destinations = [
  { name: "Creator Course", tag: "Course", tagColor: "purple", icon: "cart", url: "https://creator.io/course", clicks: "12,840", cvr: "6.9%", revenue: "$44,600" },
  { name: "Weekly Newsletter", tag: "Email List", tagColor: "green", icon: "trend", url: "https://creator.io/newsletter", clicks: "28,410", cvr: "32.6%", revenue: "N/A" },
  { name: "1:1 Coaching", tag: "Service", tagColor: "blue", icon: "cursor", url: "https://creator.io/coaching", clicks: "4,120", cvr: "2.0%", revenue: "$28,700" },
  { name: "Free Templates Pack", tag: "Lead Magnet", tagColor: "amber", icon: "link", url: "https://creator.io/templates", clicks: "18,640", cvr: "34.9%", revenue: "N/A" },
  { name: "Affiliate: ConvertKit", tag: "Affiliate", tagColor: "red", icon: "external", url: "https://convertkit.com/ref/creator", clicks: "3,840", cvr: "5.0%", revenue: "$2,880" },
];

export const links = [
  { short: "rvos.io/course", full: "creator.io/course", source: "How I Made $100K on YouTube", clicks: "4,842", unique: "3,912", conversions: "324", cvr: "8.3%", revenue: "$16,200", change: "14.2%", up: true },
  { short: "rvos.io/newsletter", full: "creator.io/newsletter", source: "The Creator Business Blueprint", clicks: "2,104", unique: "1,820", conversions: "687", cvr: "37.7%", revenue: "N/A", change: "22.1%", up: true },
  { short: "rvos.io/coaching", full: "creator.io/coaching", source: "AI Tools for Content Creators", clicks: "1,240", unique: "1,102", conversions: "28", cvr: "2.5%", revenue: "$9,800", change: "3.4%", up: false },
  { short: "rvos.io/templates", full: "creator.io/templates", source: "My Brand Deal Negotiation...", clicks: "3,610", unique: "3,014", conversions: "1,260", cvr: "41.8%", revenue: "N/A", change: "8.9%", up: true },
  { short: "rvos.io/affiliate-ck", full: "convertkit.com/ref/creator", source: "10 Passive Income Streams", clicks: "892", unique: "741", conversions: "44", cvr: "5.9%", revenue: "$660", change: "1.2%", up: false },
];

export const dealStages = [
  {
    name: "Prospect", count: 3, color: "var(--color-muted-foreground)", total: "$26,500",
    deals: [
      { company: "TechFlow AI", contact: "Mark Davies", value: "$8,500", tag: "SaaS", progress: 15, action: "Send media kit", date: "Jan 15" },
      { company: "HealthPlus", contact: "Anna Kim", value: "$6,000", tag: "Health", progress: 10, action: "Research brand fit", date: "Jan 20" },
      { company: "CreatorTools", contact: "Sam Lee", value: "$12,000", tag: "SaaS", progress: 5, action: "Cold email", date: "Feb 1" },
    ],
  },
  {
    name: "Pitched", count: 2, color: "var(--color-warning)", total: "$24,500",
    deals: [
      { company: "NordVPN", contact: "J. Miller", value: "$15,000", tag: "Tech", progress: 45, action: "Follow up email", date: "Jan 12" },
      { company: "Skillshare", contact: "R. Johnson", value: "$9,500", tag: "Education", progress: 35, action: "Call scheduled", date: "Jan 18" },
    ],
  },
  {
    name: "Negotiating", count: 2, color: "var(--color-brand-purple)", total: "$40,500",
    deals: [
      { company: "Squarespace", contact: "L. Chen", value: "$22,000", tag: "Web", progress: 70, action: "Counter offer sent", date: "Jan 8" },
      { company: "Notion", contact: "P. Park", value: "$18,500", tag: "SaaS", progress: 65, action: "Review contract draft", date: "Jan 10" },
    ],
  },
  {
    name: "Contracted", count: 1, color: "var(--color-brand-blue)", total: "$30,000",
    deals: [
      { company: "Shopify", contact: "T. Brown", value: "$30,000", tag: "E-comm", progress: 80, action: "Film content", date: "Jan 25" },
    ],
  },
  {
    name: "Completed", count: 2, color: "var(--color-brand-green)", total: "$39,000",
    deals: [
      { company: "HubSpot", contact: "E. Davis", value: "$25,000", tag: "CRM", progress: 100, action: "Invoice sent", date: "Dec 30" },
      { company: "Canva", contact: "M. Wilson", value: "$14,000", tag: "Design", progress: 100, action: "Done ✓", date: "Dec 20" },
    ],
  },
];

export const reports = [
  { title: "Q4 2024 Revenue Report", range: "Oct – Dec 2024", color: "purple", badges: ["$44,300 total revenue", "+18.4% YoY growth", "7 brand deals closed"] },
  { title: "November Performance Summary", range: "Nov 1 – 30, 2024", color: "green", badges: ["$38,200 revenue", "Top video: 641K views", "3 new brand deals"] },
  { title: "October Revenue Report", range: "Oct 1 – 31, 2024", color: "purple", badges: ["$36,000 revenue", "Best CPM month: $8.40", "2 deals closed"] },
  { title: "Q3 2024 Quarterly Summary", range: "Jul – Sep 2024", color: "amber", badges: ["$98,500 revenue", "12.4M total views", "6 brand deals"] },
];

const TXN_SOURCES = ["AdSense", "Brand Deal", "Memberships", "Affiliates"] as const;
const TXN_METHODS = ["Bank Transfer", "Direct Deposit", "Wire Transfer", "PayPal"] as const;
const TXN_STATUSES = ["Received", "Processed", "Pending", "Failed"] as const;
const TXN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TXN_SOURCE_BASE: Record<(typeof TXN_SOURCES)[number], number> = {
  AdSense: 2200, "Brand Deal": 8400, Memberships: 1100, Affiliates: 600,
};

export type RevenueTransaction = {
  id: string;
  amount: number;
  source: (typeof TXN_SOURCES)[number];
  video: string;
  method: (typeof TXN_METHODS)[number];
  date: string;
  status: (typeof TXN_STATUSES)[number];
};

export const revenueTransactions: RevenueTransaction[] = Array.from({ length: 50 }, (_, i) => {
  const source = TXN_SOURCES[i % TXN_SOURCES.length];
  const status = TXN_STATUSES[(i + Math.floor(i / TXN_SOURCES.length)) % TXN_STATUSES.length];
  const method = TXN_METHODS[(i * 2) % TXN_METHODS.length];
  const video = topVideos[i % topVideos.length].title;
  const month = TXN_MONTHS[(11 - Math.floor(i / 4)) % 12];
  const day = ((i * 7) % 27) + 1;
  const amount = TXN_SOURCE_BASE[source] + ((i * 173) % 4200);
  return {
    id: `TXN-2024${String(401 + i)}`,
    amount,
    source,
    video,
    method,
    date: `${month} ${day}`,
    status,
  };
});
