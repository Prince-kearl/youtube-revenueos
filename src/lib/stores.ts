import { useLocalStore, uid } from "./local-store";
import { dealStages as seedDealStages, destinations as seedDestinations, links as seedLinks } from "./data";

// ============ DEALS ============
export type DealStage = "Prospect" | "Pitched" | "Negotiating" | "Contracted" | "Completed";
export const DEAL_STAGES: DealStage[] = ["Prospect", "Pitched", "Negotiating", "Contracted", "Completed"];
export const stageColor: Record<DealStage, string> = {
  Prospect: "var(--color-muted-foreground)",
  Pitched: "var(--color-warning)",
  Negotiating: "var(--color-brand-purple)",
  Contracted: "var(--color-brand-blue)",
  Completed: "var(--color-brand-green)",
};

export interface Deal {
  id: string;
  company: string;
  contact: string;
  value: number;
  tag: string;
  stage: DealStage;
  progress: number;
  action: string;
  date: string;
}

function seedDeals(): Deal[] {
  const out: Deal[] = [];
  for (const stage of seedDealStages) {
    for (const d of stage.deals) {
      out.push({
        id: uid(),
        company: d.company,
        contact: d.contact,
        value: Number(String(d.value).replace(/[^\d.]/g, "")) || 0,
        tag: d.tag,
        stage: stage.name as DealStage,
        progress: d.progress,
        action: d.action,
        date: d.date,
      });
    }
  }
  return out;
}
export const useDeals = () => useLocalStore<Deal[]>("yroos.deals", seedDeals());

// ============ DESTINATIONS ============
export interface Destination {
  id: string;
  name: string;
  tag: string;
  tagColor: string;
  icon: string;
  url: string;
  clicks: string;
  cvr: string;
  revenue: string;
}
export const DEST_ICONS = ["cart", "trend", "cursor", "link", "external"] as const;
export const DEST_COLORS = ["purple", "green", "blue", "amber", "red"] as const;

const seedDest = (): Destination[] => seedDestinations.map((d) => ({ id: uid(), ...d }));
export const useDestinations = () => useLocalStore<Destination[]>("yroos.destinations", seedDest());

// ============ LINKS ============
export interface TrackLink {
  id: string;
  short: string;
  full: string;
  source: string;
  clicks: string;
  unique: string;
  conversions: string;
  cvr: string;
  revenue: string;
  change: string;
  up: boolean;
}
const seedLnk = (): TrackLink[] => seedLinks.map((l) => ({ id: uid(), ...l }));
export const useLinks = () => useLocalStore<TrackLink[]>("yroos.links", seedLnk());

// ============ COMMENT RULES ============
export interface CommentRule {
  id: string;
  type: string;
  icon: "message" | "at" | "help";
  color: "purple" | "blue" | "green";
  active: boolean;
  match: string;
  reply: string;
  fired: number;
  video: string;
}
const seedRules = (): CommentRule[] => [
  { id: uid(), type: "Keyword trigger", icon: "message", color: "purple", active: true,
    match: 'Comment contains "link", "info", "send me", "how do I get"',
    reply: "Thanks! Grab everything in the pinned comment 👉 the free training link is there.",
    fired: 342, video: "How I Made $100K on YouTube" },
  { id: uid(), type: "Instagram handle detection", icon: "at", color: "blue", active: true,
    match: "Comment contains an @handle pattern",
    reply: "Just DM'd you on Instagram! Check your requests 📩",
    fired: 118, video: "AI Tools for Content Creators" },
  { id: uid(), type: "Question detection (AI)", icon: "help", color: "green", active: false,
    match: "AI classifies comment as purchase-intent question",
    reply: "Great question — yes, it works for beginners. Full breakdown here: {{LINK_VSL}}",
    fired: 64, video: "The Creator Business Blueprint" },
];
export const useCommentRules = () => useLocalStore<CommentRule[]>("yroos.rules", seedRules());

// ============ CAMPAIGNS ============
export interface Campaign {
  id: string;
  name: string;
  sent: string;
  open: string;
  click: string;
  status: "Sending" | "Sent" | "Scheduled" | "Draft";
}
const seedCampaigns = (): Campaign[] => [
  { id: uid(), name: "Welcome — Freebie Delivery", sent: "4,210", open: "62.4%", click: "24.1%", status: "Sending" },
  { id: uid(), name: "Day 2 — Value Drop", sent: "3,980", open: "48.9%", click: "18.7%", status: "Sent" },
  { id: uid(), name: "Day 5 — Offer", sent: "3,640", open: "41.2%", click: "12.4%", status: "Sent" },
  { id: uid(), name: "December Broadcast", sent: "650", open: "39.8%", click: "9.6%", status: "Scheduled" },
];
export const useCampaigns = () => useLocalStore<Campaign[]>("yroos.campaigns", seedCampaigns());

// ============ NOTIFICATIONS ============
export interface Notification {
  id: string;
  icon: "message" | "check" | "dollar" | "alert" | "zap" | "clock";
  color: string;
  title: string;
  time: string;
  read: boolean;
  pinned: boolean;
  archived: boolean;
}
const seedNotifs = (): Notification[] => [
  { id: uid(), icon: "message", color: "purple", title: "TechCorp deal expires in 3 days", time: "Now", read: false, pinned: false, archived: false },
  { id: uid(), icon: "check", color: "green", title: '"AI Tools" hit 500K views 🎉', time: "1h", read: false, pinned: false, archived: false },
  { id: uid(), icon: "dollar", color: "amber", title: "AdSense: $4,820 payout incoming", time: "2h", read: false, pinned: false, archived: false },
  { id: uid(), icon: "alert", color: "red", title: "CPM drop detected — 3 videos", time: "3h", read: true, pinned: false, archived: false },
  { id: uid(), icon: "zap", color: "purple", title: "AI optimization ready for 7 videos", time: "5h", read: true, pinned: false, archived: false },
  { id: uid(), icon: "clock", color: "blue", title: "HealthBrand follow-up scheduled", time: "6h", read: true, pinned: false, archived: false },
];
export const useNotifications = () => useLocalStore<Notification[]>("yroos.notifs", seedNotifs());

// ============ PROFILE ============
export interface Profile {
  name: string;
  email: string;
  avatar: string;
  role: string;
  timezone: string;
}
const seedProfile = (): Profile => ({
  name: "Alex Chen",
  email: "alex@yroos.app",
  avatar: "https://i.pravatar.cc/64?img=13",
  role: "Owner",
  timezone: "Europe/Berlin",
});
export const useProfile = () => useLocalStore<Profile>("yroos.profile", seedProfile());
