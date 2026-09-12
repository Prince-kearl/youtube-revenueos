import { useLocalStore, uid } from "./local-store";
import { dealStages as seedDealStages } from "./data";

// ============ DEALS ============
export type DealStage = "Prospect" | "Pitched" | "Negotiating" | "Contracted" | "Completed";
export const DEAL_STAGES: DealStage[] = [
  "Prospect",
  "Pitched",
  "Negotiating",
  "Contracted",
  "Completed",
];
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
  {
    id: uid(),
    name: "Welcome — Freebie Delivery",
    sent: "4,210",
    open: "62.4%",
    click: "24.1%",
    status: "Sending",
  },
  {
    id: uid(),
    name: "Day 2 — Value Drop",
    sent: "3,980",
    open: "48.9%",
    click: "18.7%",
    status: "Sent",
  },
  {
    id: uid(),
    name: "Day 5 — Offer",
    sent: "3,640",
    open: "41.2%",
    click: "12.4%",
    status: "Sent",
  },
  {
    id: uid(),
    name: "December Broadcast",
    sent: "650",
    open: "39.8%",
    click: "9.6%",
    status: "Scheduled",
  },
];
export const useCampaigns = () => useLocalStore<Campaign[]>("yroos.campaigns", seedCampaigns());

// ============ PROFILE ============
export interface Profile {
  name: string;
  email: string;
  avatar: string;
  role: string;
  timezone: string;
  bio?: string;
}
const seedProfile = (): Profile => ({
  name: "Alex Chen",
  email: "alex@yroos.app",
  avatar: "https://i.pravatar.cc/64?img=13",
  role: "Owner",
  timezone: "Europe/Berlin",
  bio: "",
});
export const useProfile = () => useLocalStore<Profile>("yroos.profile", seedProfile());

// ============ ONBOARDING ============
export interface OnboardingState {
  dismissed: boolean;
  completedSteps: string[];
}
const seedOnboarding = (): OnboardingState => ({ dismissed: false, completedSteps: [] });
export const useOnboarding = () =>
  useLocalStore<OnboardingState>("yroos.onboarding", seedOnboarding());

// ============ TEAM ============
// TeamRole is still used by the PlatformRole nav-preview demo below (canAccessRoute/ROLE_ROUTES) —
// the real team roster now lives server-side (workspace_members, see src/routes/team.tsx and
// src/lib/server/workspace.ts), which is why TeamMember/seedTeam/useTeam were removed from here.
export type TeamRole = "Owner" | "Manager" | "Setter" | "Editor";

// ============ UI PREFERENCES ============
// Persisted so the collapsed state survives navigating between pages — DashboardLayout
// remounts on every route change, so a plain useState would silently reset it each time.
export const useSidebarCollapsed = () => useLocalStore<boolean>("yroos.sidebarCollapsed", true);

// ============ RBAC ============
// Superadmin is a platform-level role (Tubify staff) that sits above every workspace's
// own Owner/Manager/Setter/Editor roles. The viewer role is switchable here purely so this
// demo can show off role-gated navigation without wiring up real multi-user auth.
export type PlatformRole = "Superadmin" | TeamRole;
export const PLATFORM_ROLES: PlatformRole[] = [
  "Superadmin",
  "Owner",
  "Manager",
  "Setter",
  "Editor",
];

export const useViewerRole = () =>
  useLocalStore<PlatformRole>("yroos.viewerRole", "Owner" as PlatformRole);

// Routes every role can always reach — personal/account-level pages, not workspace data.
const OPEN_ROUTES = ["/dashboard", "/settings", "/notifications", "/support"];

// Everything else is an allowlist per role. Owner and Superadmin get full workspace access;
// Superadmin additionally gets /admin, gated separately below.
const ROLE_ROUTES: Record<TeamRole, string[] | "all"> = {
  Owner: "all",
  Manager: [
    ...OPEN_ROUTES,
    "/videos",
    "/projects",
    "/ai-lab",
    "/destinations",
    "/link-tracking",
    "/comments",
    "/leads",
    "/audience",
    "/analytics",
    "/affiliate",
    "/freebie",
    "/email",
    "/brand-deals",
    "/team",
    "/reports",
  ],
  Setter: [...OPEN_ROUTES, "/comments", "/leads", "/audience", "/brand-deals", "/link-tracking"],
  Editor: [...OPEN_ROUTES, "/videos", "/projects", "/ai-lab", "/destinations", "/link-tracking"],
};

export function canAccessRoute(role: PlatformRole, path: string): boolean {
  if (path === "/admin") return role === "Superadmin";
  if (role === "Superadmin") return true;
  const allowed = ROLE_ROUTES[role];
  return allowed === "all" || allowed.includes(path);
}

// Reference matrix shown in the Admin Console — same source of truth as canAccessRoute.
export const ROLE_ROUTE_MATRIX = ROLE_ROUTES;

// ============ FEATURE FLAGS (platform-wide kill switches, Superadmin-controlled) ============
export type FeatureKey =
  "aiLab" | "commentAutomation" | "leads" | "affiliate" | "freebie" | "email" | "brandDeals";

export const FEATURE_META: Record<
  FeatureKey,
  { label: string; route: string; description: string }
> = {
  aiLab: {
    label: "AI Lab",
    route: "/ai-lab",
    description: "AI-generated video descriptions and tracked-link injection.",
  },
  commentAutomation: {
    label: "Comment Automation",
    route: "/comments",
    description: "Auto-reply rules and lead capture from YouTube comments.",
  },
  leads: {
    label: "Lead Inbox",
    route: "/leads",
    description: "Unified inbox for leads captured from comments and DMs.",
  },
  brandDeals: {
    label: "Brand Deals",
    route: "/brand-deals",
    description: "Deal pipeline board for sponsorships and partnerships.",
  },
  affiliate: {
    label: "Affiliate",
    route: "/affiliate",
    description: "Referral link tracking and commission payouts.",
  },
  freebie: {
    label: "AI Freebie",
    route: "/freebie",
    description: "AI-generated lead-magnet freebies for the audience.",
  },
  email: {
    label: "Email",
    route: "/email",
    description: "Email campaign builder and send sequences.",
  },
};

const seedFeatureFlags = (): Record<FeatureKey, boolean> => ({
  aiLab: true,
  commentAutomation: true,
  leads: true,
  brandDeals: true,
  affiliate: true,
  freebie: true,
  email: true,
});
export const useFeatureFlags = () =>
  useLocalStore<Record<FeatureKey, boolean>>("yroos.featureFlags", seedFeatureFlags());

// ============ PLATFORM TENANTS (Superadmin's cross-customer view) ============
// Every workspace that pays Tubify for the product — distinct from a workspace's own
// brand-deal/AdSense revenue, which is money creators earn, not money they pay Tubify.
export type TenantPlan = "Starter" | "Pro" | "Scale";
export type TenantStatus = "Active" | "Trial" | "Past Due" | "Suspended";
export interface Tenant {
  id: string;
  name: string;
  owner: string;
  avatar: string;
  plan: TenantPlan;
  mrr: number;
  status: TenantStatus;
  joined: string;
  seatsUsed: number;
  seatsLimit: number;
  storageUsedGb: number;
  storageQuotaGb: number;
  domain?: string;
}
const PLAN_PRICE: Record<TenantPlan, number> = { Starter: 29, Pro: 79, Scale: 199 };
export { PLAN_PRICE as TENANT_PLAN_PRICE };
const PLAN_LIMITS: Record<TenantPlan, { seats: number; storageGb: number }> = {
  Starter: { seats: 1, storageGb: 10 },
  Pro: { seats: 5, storageGb: 100 },
  Scale: { seats: 20, storageGb: 500 },
};
export { PLAN_LIMITS as TENANT_PLAN_LIMITS };

const seedTenants = (): Tenant[] => [
  {
    id: uid(),
    name: "Alex Chen — This Workspace",
    owner: "alex@creator.io",
    avatar: "https://i.pravatar.cc/64?img=13",
    plan: "Pro",
    mrr: 79,
    status: "Active",
    joined: "2025-11-02",
    seatsUsed: 4,
    seatsLimit: 5,
    storageUsedGb: 38,
    storageQuotaGb: 100,
    domain: "tubify.app/alexchen",
  },
  {
    id: uid(),
    name: "RideRatchet Media",
    owner: "priya@rideratchet.io",
    avatar: "https://i.pravatar.cc/64?img=48",
    plan: "Scale",
    mrr: 199,
    status: "Active",
    joined: "2025-08-14",
    seatsUsed: 14,
    seatsLimit: 20,
    storageUsedGb: 312,
    storageQuotaGb: 500,
    domain: "rideratchet.io",
  },
  {
    id: uid(),
    name: "Northlight Gaming",
    owner: "devon@northlight.gg",
    avatar: "https://i.pravatar.cc/64?img=22",
    plan: "Pro",
    mrr: 79,
    status: "Active",
    joined: "2025-09-30",
    seatsUsed: 3,
    seatsLimit: 5,
    storageUsedGb: 61,
    storageQuotaGb: 100,
  },
  {
    id: uid(),
    name: "Kitchen with Kofi",
    owner: "kofi@kwk.tv",
    avatar: "https://i.pravatar.cc/64?img=11",
    plan: "Starter",
    mrr: 29,
    status: "Trial",
    joined: "2026-07-10",
    seatsUsed: 1,
    seatsLimit: 1,
    storageUsedGb: 2,
    storageQuotaGb: 10,
  },
  {
    id: uid(),
    name: "Loop Studio Collective",
    owner: "team@loopstudio.co",
    avatar: "https://i.pravatar.cc/64?img=60",
    plan: "Scale",
    mrr: 199,
    status: "Past Due",
    joined: "2025-05-21",
    seatsUsed: 18,
    seatsLimit: 20,
    storageUsedGb: 470,
    storageQuotaGb: 500,
    domain: "loopstudio.co",
  },
  {
    id: uid(),
    name: "Wanderlens Travel",
    owner: "sofia@wanderlens.com",
    avatar: "https://i.pravatar.cc/64?img=36",
    plan: "Pro",
    mrr: 79,
    status: "Active",
    joined: "2025-12-19",
    seatsUsed: 2,
    seatsLimit: 5,
    storageUsedGb: 19,
    storageQuotaGb: 100,
  },
  {
    id: uid(),
    name: "Bytesize Learning",
    owner: "hiro@bytesize.dev",
    avatar: "https://i.pravatar.cc/64?img=15",
    plan: "Starter",
    mrr: 29,
    status: "Suspended",
    joined: "2025-06-04",
    seatsUsed: 1,
    seatsLimit: 1,
    storageUsedGb: 6,
    storageQuotaGb: 10,
  },
  {
    id: uid(),
    name: "Glow Up Beauty Co",
    owner: "maya@glowup.co",
    avatar: "https://i.pravatar.cc/64?img=41",
    plan: "Pro",
    mrr: 79,
    status: "Active",
    joined: "2026-02-27",
    seatsUsed: 5,
    seatsLimit: 5,
    storageUsedGb: 84,
    storageQuotaGb: 100,
  },
];
export const useTenants = () => useLocalStore<Tenant[]>("yroos.tenants", seedTenants());

// ============ PLATFORM USERS (individual accounts across every org — distinct from a
// single workspace's own Team page) ============
export type UserStatus = "Active" | "Suspended" | "Banned" | "Pending";
export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  org: string;
  role: PlatformRole;
  status: UserStatus;
  emailVerified: boolean;
  creatorVerified: boolean;
  lastLogin: string;
  joined: string;
}
const seedUsers = (): PlatformUser[] => [
  {
    id: uid(),
    name: "Alex Chen",
    email: "alex@creator.io",
    avatar: "https://i.pravatar.cc/64?img=13",
    org: "Alex Chen — This Workspace",
    role: "Owner",
    status: "Active",
    emailVerified: true,
    creatorVerified: true,
    lastLogin: "2026-07-22",
    joined: "2025-11-02",
  },
  {
    id: uid(),
    name: "Jamie Rivera",
    email: "jamie@creator.io",
    avatar: "https://i.pravatar.cc/64?img=32",
    org: "Alex Chen — This Workspace",
    role: "Setter",
    status: "Active",
    emailVerified: true,
    creatorVerified: false,
    lastLogin: "2026-07-21",
    joined: "2025-11-10",
  },
  {
    id: uid(),
    name: "Priya Nair",
    email: "priya@rideratchet.io",
    avatar: "https://i.pravatar.cc/64?img=48",
    org: "RideRatchet Media",
    role: "Owner",
    status: "Active",
    emailVerified: true,
    creatorVerified: true,
    lastLogin: "2026-07-22",
    joined: "2025-08-14",
  },
  {
    id: uid(),
    name: "Devon Marsh",
    email: "devon@northlight.gg",
    avatar: "https://i.pravatar.cc/64?img=22",
    org: "Northlight Gaming",
    role: "Owner",
    status: "Active",
    emailVerified: true,
    creatorVerified: true,
    lastLogin: "2026-07-20",
    joined: "2025-09-30",
  },
  {
    id: uid(),
    name: "Kofi Boateng",
    email: "kofi@kwk.tv",
    avatar: "https://i.pravatar.cc/64?img=11",
    org: "Kitchen with Kofi",
    role: "Owner",
    status: "Pending",
    emailVerified: false,
    creatorVerified: false,
    lastLogin: "2026-07-10",
    joined: "2026-07-10",
  },
  {
    id: uid(),
    name: "Morgan Lee",
    email: "morgan@loopstudio.co",
    avatar: "https://i.pravatar.cc/64?img=60",
    org: "Loop Studio Collective",
    role: "Owner",
    status: "Active",
    emailVerified: true,
    creatorVerified: true,
    lastLogin: "2026-07-18",
    joined: "2025-05-21",
  },
  {
    id: uid(),
    name: "Sofia Ramos",
    email: "sofia@wanderlens.com",
    avatar: "https://i.pravatar.cc/64?img=36",
    org: "Wanderlens Travel",
    role: "Owner",
    status: "Active",
    emailVerified: true,
    creatorVerified: false,
    lastLogin: "2026-07-19",
    joined: "2025-12-19",
  },
  {
    id: uid(),
    name: "Hiro Tanaka",
    email: "hiro@bytesize.dev",
    avatar: "https://i.pravatar.cc/64?img=15",
    org: "Bytesize Learning",
    role: "Owner",
    status: "Suspended",
    emailVerified: true,
    creatorVerified: false,
    lastLogin: "2026-05-30",
    joined: "2025-06-04",
  },
  {
    id: uid(),
    name: "Maya Osei",
    email: "maya@glowup.co",
    avatar: "https://i.pravatar.cc/64?img=41",
    org: "Glow Up Beauty Co",
    role: "Owner",
    status: "Active",
    emailVerified: true,
    creatorVerified: true,
    lastLogin: "2026-07-22",
    joined: "2026-02-27",
  },
  {
    id: uid(),
    name: "Sam Patel",
    email: "sam@newhire.io",
    avatar: "https://i.pravatar.cc/64?img=5",
    org: "Alex Chen — This Workspace",
    role: "Setter",
    status: "Pending",
    emailVerified: false,
    creatorVerified: false,
    lastLogin: "—",
    joined: "2026-07-15",
  },
];
export const useUsers = () => useLocalStore<PlatformUser[]>("yroos.platformUsers", seedUsers());

// ============ ROLES & PERMISSIONS (custom RBAC roles) ============
// Distinct from PlatformRole above, which drives this demo's own nav gating. CustomRole
// models the broader "create any role, assign module permissions" system a real platform
// admin panel would offer.
export const PERMISSION_MODULES = [
  "Dashboard",
  "Users",
  "Billing",
  "AI Management",
  "Content Moderation",
  "Analytics",
  "Communications",
  "System",
  "Security",
  "Support",
  "Infrastructure",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export interface CustomRole {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionModule[];
}
const ALL_MODULES = [...PERMISSION_MODULES];
const seedCustomRoles = (): CustomRole[] => [
  {
    id: uid(),
    name: "Super Admin",
    description: "Full control over every module.",
    isSystem: true,
    permissions: ALL_MODULES,
  },
  {
    id: uid(),
    name: "Platform Admin",
    description: "Day-to-day operations across the platform, excluding billing.",
    isSystem: true,
    permissions: [
      "Dashboard",
      "Users",
      "AI Management",
      "Content Moderation",
      "Analytics",
      "Communications",
      "Support",
    ],
  },
  {
    id: uid(),
    name: "Support Agent",
    description: "Handles tickets and user account issues.",
    isSystem: false,
    permissions: ["Dashboard", "Users", "Support"],
  },
  {
    id: uid(),
    name: "Finance Manager",
    description: "Owns billing, plans, and payment operations.",
    isSystem: false,
    permissions: ["Dashboard", "Billing", "Analytics"],
  },
  {
    id: uid(),
    name: "Marketing Manager",
    description: "Runs announcements and campaigns.",
    isSystem: false,
    permissions: ["Dashboard", "Communications", "Analytics"],
  },
  {
    id: uid(),
    name: "Moderator",
    description: "Reviews and actions flagged content.",
    isSystem: false,
    permissions: ["Dashboard", "Content Moderation"],
  },
  {
    id: uid(),
    name: "Content Reviewer",
    description: "Read-only review of generated content.",
    isSystem: false,
    permissions: ["Content Moderation"],
  },
  {
    id: uid(),
    name: "AI Trainer",
    description: "Manages models, prompts, and usage limits.",
    isSystem: false,
    permissions: ["Dashboard", "AI Management"],
  },
  {
    id: uid(),
    name: "Developer",
    description: "Manages integrations and infrastructure.",
    isSystem: false,
    permissions: ["Dashboard", "System", "Infrastructure"],
  },
  {
    id: uid(),
    name: "Viewer",
    description: "Read-only access to the executive dashboard.",
    isSystem: false,
    permissions: ["Dashboard"],
  },
];
export const useCustomRoles = () =>
  useLocalStore<CustomRole[]>("yroos.customRoles", seedCustomRoles());

// ============ AI MANAGEMENT ============
export type AiProvider = "OpenAI" | "Anthropic" | "Gemini" | "Grok" | "Local";
export interface AiModelConfig {
  id: string;
  provider: AiProvider;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  tokenLimit: number;
  rateLimitPerMin: number;
  temperature: number;
  costPer1kTokens: number;
}
const seedAiModels = (): AiModelConfig[] => [
  {
    id: uid(),
    provider: "OpenAI",
    name: "GPT-4.1",
    enabled: true,
    isDefault: true,
    tokenLimit: 128000,
    rateLimitPerMin: 500,
    temperature: 0.7,
    costPer1kTokens: 0.01,
  },
  {
    id: uid(),
    provider: "Anthropic",
    name: "Claude Sonnet 5",
    enabled: true,
    isDefault: false,
    tokenLimit: 200000,
    rateLimitPerMin: 300,
    temperature: 0.7,
    costPer1kTokens: 0.012,
  },
  {
    id: uid(),
    provider: "Gemini",
    name: "Gemini 2.5 Pro",
    enabled: true,
    isDefault: false,
    tokenLimit: 1000000,
    rateLimitPerMin: 300,
    temperature: 0.6,
    costPer1kTokens: 0.007,
  },
  {
    id: uid(),
    provider: "Grok",
    name: "Grok 4",
    enabled: false,
    isDefault: false,
    tokenLimit: 128000,
    rateLimitPerMin: 200,
    temperature: 0.8,
    costPer1kTokens: 0.009,
  },
  {
    id: uid(),
    provider: "Local",
    name: "Llama 3 70B (self-hosted)",
    enabled: false,
    isDefault: false,
    tokenLimit: 8192,
    rateLimitPerMin: 100,
    temperature: 0.7,
    costPer1kTokens: 0,
  },
];
export const useAiModels = () => useLocalStore<AiModelConfig[]>("yroos.aiModels", seedAiModels());

export interface PromptTemplate {
  id: string;
  name: string;
  module: string;
  template: string;
  updated: string;
}
const seedPromptTemplates = (): PromptTemplate[] => [
  {
    id: uid(),
    name: "Video Description Generator",
    module: "AI Lab",
    template:
      "Write a YouTube description for a video about {{topic}}. Include timestamps and a call to action.",
    updated: "2026-06-18",
  },
  {
    id: uid(),
    name: "Comment Auto-Reply",
    module: "Comment Automation",
    template: "Reply warmly to a comment that says: {{comment}}. Keep it under 2 sentences.",
    updated: "2026-06-02",
  },
  {
    id: uid(),
    name: "AI Freebie Generator",
    module: "AI Freebie",
    template: "Create a short lead-magnet outline for creators in the {{niche}} niche.",
    updated: "2026-05-21",
  },
  {
    id: uid(),
    name: "Brand Deal Pitch",
    module: "Brand Deals",
    template: "Draft a sponsorship pitch email to {{brand}} highlighting audience fit.",
    updated: "2026-04-30",
  },
];
export const usePromptTemplates = () =>
  useLocalStore<PromptTemplate[]>("yroos.promptTemplates", seedPromptTemplates());

// ============ CONTENT MODERATION ============
export type ModerationStatus = "Pending" | "Approved" | "Removed";
export interface ModerationItem {
  id: string;
  type: string;
  org: string;
  preview: string;
  reason: string;
  status: ModerationStatus;
  date: string;
}
const seedModeration = (): ModerationItem[] => [
  {
    id: uid(),
    type: "AI Video Description",
    org: "Northlight Gaming",
    preview: '"Smash that subscribe button or your PC will explode 💀"',
    reason: "Flagged: exaggerated claim",
    status: "Pending",
    date: "2026-07-21",
  },
  {
    id: uid(),
    type: "Comment Auto-Reply",
    org: "Glow Up Beauty Co",
    preview: '"DM me for the discount code, link in bio 👉"',
    reason: "Flagged: off-platform contact pattern",
    status: "Pending",
    date: "2026-07-20",
  },
  {
    id: uid(),
    type: "AI Freebie",
    org: "Bytesize Learning",
    preview: '"Guaranteed to 10x your income in 30 days"',
    reason: "Flagged: unverifiable claim",
    status: "Pending",
    date: "2026-07-19",
  },
  {
    id: uid(),
    type: "AI Video Description",
    org: "RideRatchet Media",
    preview: '"Full disclosure: this video is sponsored by NitroFuel."',
    reason: "Flagged: sponsor disclosure check",
    status: "Approved",
    date: "2026-07-15",
  },
  {
    id: uid(),
    type: "Comment Auto-Reply",
    org: "Wanderlens Travel",
    preview: '"Thanks for watching! Check the link for my packing list."',
    reason: "Flagged: contains external link",
    status: "Approved",
    date: "2026-07-12",
  },
  {
    id: uid(),
    type: "AI Video Description",
    org: "Kitchen with Kofi",
    preview: '"This recipe cures inflammation instantly."',
    reason: "Flagged: medical claim",
    status: "Removed",
    date: "2026-07-08",
  },
];
export const useModerationQueue = () =>
  useLocalStore<ModerationItem[]>("yroos.moderation", seedModeration());

// ============ BILLING (platform-level) ============
export interface PlanConfig {
  id: TenantPlan;
  price: number;
  seats: number;
  storageGb: number;
  aiCredits: number;
}
const seedPlanConfigs = (): PlanConfig[] => [
  { id: "Starter", price: 29, seats: 1, storageGb: 10, aiCredits: 200 },
  { id: "Pro", price: 79, seats: 5, storageGb: 100, aiCredits: 1000 },
  { id: "Scale", price: 199, seats: 20, storageGb: 500, aiCredits: 5000 },
];
export const usePlanConfigs = () => useLocalStore<PlanConfig[]>("yroos.plans", seedPlanConfigs());

export interface Coupon {
  id: string;
  code: string;
  discountPct: number;
  scope: TenantPlan | "All Plans";
  redemptions: number;
  maxRedemptions: number;
  expires: string;
  active: boolean;
}
const seedCoupons = (): Coupon[] => [
  {
    id: uid(),
    code: "LAUNCH25",
    discountPct: 25,
    scope: "All Plans",
    redemptions: 142,
    maxRedemptions: 500,
    expires: "2026-09-01",
    active: true,
  },
  {
    id: uid(),
    code: "CREATOR50",
    discountPct: 50,
    scope: "Starter",
    redemptions: 88,
    maxRedemptions: 100,
    expires: "2026-08-15",
    active: true,
  },
  {
    id: uid(),
    code: "SCALEUP15",
    discountPct: 15,
    scope: "Scale",
    redemptions: 21,
    maxRedemptions: 50,
    expires: "2026-12-31",
    active: true,
  },
  {
    id: uid(),
    code: "WINBACK30",
    discountPct: 30,
    scope: "All Plans",
    redemptions: 50,
    maxRedemptions: 50,
    expires: "2026-05-01",
    active: false,
  },
];
export const useCoupons = () => useLocalStore<Coupon[]>("yroos.coupons", seedCoupons());

export type PaymentStatus = "Paid" | "Failed" | "Refunded";
export interface Payment {
  id: string;
  org: string;
  amount: number;
  plan: TenantPlan;
  status: PaymentStatus;
  date: string;
}
const seedPayments = (): Payment[] => [
  {
    id: uid(),
    org: "RideRatchet Media",
    amount: 199,
    plan: "Scale",
    status: "Paid",
    date: "2026-07-14",
  },
  {
    id: uid(),
    org: "Alex Chen — This Workspace",
    amount: 79,
    plan: "Pro",
    status: "Paid",
    date: "2026-07-02",
  },
  {
    id: uid(),
    org: "Northlight Gaming",
    amount: 79,
    plan: "Pro",
    status: "Paid",
    date: "2026-06-30",
  },
  {
    id: uid(),
    org: "Loop Studio Collective",
    amount: 199,
    plan: "Scale",
    status: "Failed",
    date: "2026-07-21",
  },
  {
    id: uid(),
    org: "Wanderlens Travel",
    amount: 79,
    plan: "Pro",
    status: "Paid",
    date: "2025-12-19",
  },
  {
    id: uid(),
    org: "Bytesize Learning",
    amount: 29,
    plan: "Starter",
    status: "Failed",
    date: "2026-06-04",
  },
  {
    id: uid(),
    org: "Glow Up Beauty Co",
    amount: 79,
    plan: "Pro",
    status: "Refunded",
    date: "2026-03-01",
  },
  {
    id: uid(),
    org: "Glow Up Beauty Co",
    amount: 79,
    plan: "Pro",
    status: "Paid",
    date: "2026-07-27",
  },
];
export const usePayments = () => useLocalStore<Payment[]>("yroos.payments", seedPayments());

// ============ COMMUNICATIONS ============
export type AnnouncementStatus = "Draft" | "Scheduled" | "Sent";
export type AnnouncementChannel = "In-app" | "Email" | "Push";
export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  channel: AnnouncementChannel;
  status: AnnouncementStatus;
  date: string;
}
const seedAnnouncements = (): Announcement[] => [
  {
    id: uid(),
    title: "New: Changelog page is live",
    body: "See everything we've shipped, filterable by type and area.",
    audience: "All Users",
    channel: "In-app",
    status: "Sent",
    date: "2026-07-16",
  },
  {
    id: uid(),
    title: "Scheduled maintenance — July 28",
    body: "Brief downtime expected between 2–3am UTC for a database upgrade.",
    audience: "All Users",
    channel: "Email",
    status: "Scheduled",
    date: "2026-07-28",
  },
  {
    id: uid(),
    title: "Scale plan: new AI credit pool",
    body: "Scale workspaces now get 5,000 AI credits per month.",
    audience: "Scale Plan",
    channel: "In-app",
    status: "Sent",
    date: "2026-07-05",
  },
  {
    id: uid(),
    title: "Trial ending reminders",
    body: "Draft reminder for workspaces entering their last 3 trial days.",
    audience: "Trial Users",
    channel: "Email",
    status: "Draft",
    date: "—",
  },
];
export const useAnnouncements = () =>
  useLocalStore<Announcement[]>("yroos.announcements", seedAnnouncements());

// ============ SYSTEM ============
export interface Integration {
  id: string;
  name: string;
  category: string;
  status: "Connected" | "Not Connected" | "Error";
  lastChecked: string;
}
const seedIntegrations = (): Integration[] => [
  {
    id: uid(),
    name: "YouTube Data API",
    category: "YouTube",
    status: "Connected",
    lastChecked: "2 min ago",
  },
  {
    id: uid(),
    name: "YouTube Analytics API",
    category: "YouTube",
    status: "Connected",
    lastChecked: "2 min ago",
  },
  {
    id: uid(),
    name: "Google OAuth",
    category: "Auth",
    status: "Connected",
    lastChecked: "5 min ago",
  },
  { id: uid(), name: "OpenAI", category: "AI", status: "Connected", lastChecked: "1 min ago" },
  { id: uid(), name: "Anthropic", category: "AI", status: "Connected", lastChecked: "1 min ago" },
  {
    id: uid(),
    name: "Stripe",
    category: "Billing",
    status: "Connected",
    lastChecked: "10 min ago",
  },
  { id: uid(), name: "Resend", category: "Email", status: "Connected", lastChecked: "8 min ago" },
  {
    id: uid(),
    name: "Google Analytics",
    category: "Analytics",
    status: "Not Connected",
    lastChecked: "—",
  },
  {
    id: uid(),
    name: "Supabase",
    category: "Database",
    status: "Connected",
    lastChecked: "3 min ago",
  },
];
export const useIntegrations = () =>
  useLocalStore<Integration[]>("yroos.integrations", seedIntegrations());

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  updated: string;
}
const seedEmailTemplates = (): EmailTemplate[] => [
  { id: uid(), name: "Welcome Email", subject: "Welcome to Tubify 🎉", updated: "2026-06-02" },
  {
    id: uid(),
    name: "Password Reset",
    subject: "Reset your Tubify password",
    updated: "2026-05-14",
  },
  { id: uid(), name: "Trial Ending", subject: "Your trial ends in 3 days", updated: "2026-06-20" },
  {
    id: uid(),
    name: "Payment Failed",
    subject: "We couldn't process your payment",
    updated: "2026-05-28",
  },
];
export const useEmailTemplates = () =>
  useLocalStore<EmailTemplate[]>("yroos.emailTemplates", seedEmailTemplates());

export interface PlatformSettings {
  productName: string;
  supportEmail: string;
  sessionTimeoutMins: number;
  passwordMinLength: number;
  requireMfa: boolean;
  ssoEnabled: boolean;
  defaultLanguage: string;
  defaultTimezone: string;
  maxUploadMb: number;
}
const seedPlatformSettings = (): PlatformSettings => ({
  productName: "Tubify",
  supportEmail: "support@tubify.app",
  sessionTimeoutMins: 60,
  passwordMinLength: 10,
  requireMfa: false,
  ssoEnabled: false,
  defaultLanguage: "English (US)",
  defaultTimezone: "UTC",
  maxUploadMb: 500,
});
export const usePlatformSettings = () =>
  useLocalStore<PlatformSettings>("yroos.platformSettings", seedPlatformSettings());

// ============ SITE CONTENT (Customization / Content Studio) ============
// Backs the public landing page (src/routes/landing.tsx) and app-wide branding (Logo, theme
// colors) so Superadmins can edit them from /admin without a code change. Seeded verbatim from
// landing.tsx's current copy so nothing changes visually until an admin edits a field.
export interface SiteContent {
  siteName: string;
  tagline: string;
  seoDescription: string;
  logoLightUrl: string;
  logoDarkUrl: string;
  primaryColor: string;
  buttonTextColor: string;
  accentColor: string;
  cardRadius: number;
  buttonRadius: number;
  inputRadius: number;
  /** Superadmin-controlled platform-wide theme switch — see Customization → General → Visual Style.
   *  Toggles the Liquid Glass / iOS 26-inspired surface treatment (dashboard + persistent app chrome)
   *  on or off for every user; disabling it reverts those surfaces to the standard flat theme without
   *  touching layout structure, data, or permissions. */
  ios26Design: boolean;
  heroBadge: string;
  heroHeadline: string;
  heroSubheadline: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  problemHeading: string;
  problemItems: { title: string; desc: string }[];
  showcaseBadge: string;
  showcaseHeading: string;
  showcaseSubtext: string;
  howItWorksHeading: string;
  howItWorksSubtitle: string;
  howItWorksSteps: { title: string; desc: string }[];
  creatorsHeading: string;
  creatorsSubtitle: string;
  statsHeading: string;
  stats: { value: string; label: string }[];
  finalCtaHeading: string;
  finalCtaSubtitle: string;
  faqHeading: string;
  faqs: { q: string; a: string }[];
  contactHeading: string;
  contactSubheading: string;
  contactEmail: string;
  socialLinks: { youtube: string; twitter: string; instagram: string; tiktok: string };
  copyrightText: string;
}
const seedSiteContent = (): SiteContent => ({
  siteName: "Tubify",
  tagline: "Turn your YouTube channel into a predictable revenue engine.",
  seoDescription:
    "Tubify ingests videos, auto-writes AI descriptions from transcripts, tracks multi-destination links, attributes Stripe sales, and automates comment engagement.",
  logoLightUrl: "/logo.png",
  logoDarkUrl: "/logo.png",
  primaryColor: "#0284c7",
  buttonTextColor: "#ffffff",
  accentColor: "#3b82f6",
  cardRadius: 4,
  buttonRadius: 0,
  inputRadius: 0,
  ios26Design: true,
  heroBadge: "Now with AI-generated descriptions",
  heroHeadline: "Stop guessing which videos make you money.",
  heroSubheadline:
    "Tubify turns your YouTube channel into a sales engine with AI descriptions, link tracking, comment automation, and revenue attribution per video.",
  heroPrimaryCta: "Get Started Free",
  heroSecondaryCta: "View Live Demo",
  problemHeading: "YouTube Studio wasn't built to run your business.",
  problemItems: [
    {
      title: "Views, not revenue clarity",
      desc: "YouTube Studio shows watch time. It doesn't show which video actually paid your rent.",
    },
    {
      title: "Comments pile up",
      desc: 'Every "link please?" and dropped @handle is a lead — most creators never reply in time.',
    },
    {
      title: "Deals live in spreadsheets",
      desc: "Brand deals, affiliate payouts, and memberships tracked in five different tools.",
    },
  ],
  showcaseBadge: "Product",
  showcaseHeading: "Turn your inbox of comments into a pipeline of leads.",
  showcaseSubtext:
    "Every comment, every tracked link, every brand deal — in one dashboard instead of five browser tabs.",
  howItWorksHeading: "How Tubify works",
  howItWorksSubtitle: "Simple enough to start today. Structured enough to grow into.",
  howItWorksSteps: [
    {
      title: "Connect your channel",
      desc: "Sync videos, analytics, and revenue in a few minutes — no spreadsheets required.",
    },
    {
      title: "AI writes descriptions & tracked links",
      desc: "Paste a URL. Tubify transcribes it, writes the description, and injects your tracked links automatically.",
    },
    {
      title: "Comment automation finds your leads",
      desc: "Auto-reply to keyword comments, dropped @handles, and AI-detected questions — every trigger creates a lead.",
    },
    {
      title: "Track revenue across every stream",
      desc: "AdSense, brand deals, memberships, affiliates — attributed down to the video, in one dashboard.",
    },
  ],
  creatorsHeading: "Built for creators who run a real business.",
  creatorsSubtitle:
    "Invite editors and setters, split lead distribution by percentage, and see who's actually driving revenue.",
  statsHeading: "Revenue tracked so far",
  stats: [
    { value: "$48.2M+", label: "Revenue tracked" },
    { value: "12,400+", label: "Videos synced" },
    { value: "3,100+", label: "Creators onboard" },
    { value: "34%", label: "Avg. revenue lift" },
  ],
  finalCtaHeading: "You already grew an audience. Now let's grow the revenue.",
  finalCtaSubtitle: "Free to start. Connect your channel in minutes.",
  faqHeading: "Frequently Asked Questions",
  faqs: [
    {
      q: "Do I need to connect my YouTube channel to get started?",
      a: "You can explore the dashboard with sample data first. Connecting your channel unlocks real analytics, revenue attribution, and comment automation.",
    },
    {
      q: "How does comment automation work?",
      a: "You set trigger rules — keywords, @handle patterns, or AI-detected questions — and Tubify auto-replies and logs the commenter as a lead, all within your YouTube API quota.",
    },
    {
      q: "Is my revenue data accurate?",
      a: "YouTube Analytics typically lags 24–72 hours and revenue ~48 hours. Click and Stripe attribution are real-time, which is why we show both feeds separately.",
    },
    {
      q: "Can I track brand deals and affiliate revenue too?",
      a: "Yes — Brand Deals has a full pipeline board (Prospect → Completed), and Affiliate tracks referrals and commissions alongside your AdSense and membership revenue.",
    },
    {
      q: "Does this replace YouTube Studio?",
      a: "No — Tubify reads from YouTube's API and layers revenue attribution, automation, and team collaboration on top. You'll still upload and manage videos in Studio.",
    },
    {
      q: "What if I work with a team?",
      a: "Invite editors and setters from the Team page, assign roles, and split incoming leads by percentage so everyone knows what's theirs.",
    },
  ],
  contactHeading: "Found a problem? Have a question?",
  contactSubheading:
    "Tell us what's going on — this goes straight to the Tubify team, whether or not you have an account yet.",
  contactEmail: "hey@tubify.app",
  socialLinks: { youtube: "", twitter: "", instagram: "", tiktok: "" },
  copyrightText: "© 2026 Tubify. All rights reserved.",
});
// Raw local store, no server sync — used by ThemeInjector.tsx to hydrate from the global
// settings API on app load without triggering a pointless write-back of the value it just read
// (see useSiteContent below). Everything else should use useSiteContent.
export const useSiteContentLocal = () =>
  useLocalStore<SiteContent>("yroos.siteContent", seedSiteContent());

// Wraps the local store with a best-effort push to /api/settings (backed by Cloudflare KV, see
// src/routes/api.settings.ts) on every write, so a Superadmin's Customization changes reach every
// browser/device/user instead of just the one that made them. The local write always applies
// immediately and is never blocked or rolled back by the network call — offline edits, or a KV
// binding that isn't configured yet in this environment, still work exactly as before, just
// without leaving this browser.
export function useSiteContent(): [
  SiteContent,
  (updater: SiteContent | ((prev: SiteContent) => SiteContent)) => void,
] {
  const [content, setLocal] = useSiteContentLocal();
  const setContent = (updater: SiteContent | ((prev: SiteContent) => SiteContent)) => {
    setLocal((prev) => {
      const next =
        typeof updater === "function"
          ? (updater as (prev: SiteContent) => SiteContent)(prev)
          : updater;
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {});
      return next;
    });
  };
  return [content, setContent];
}

// ============ SECURITY ============
export interface AdminSession {
  id: string;
  user: string;
  device: string;
  location: string;
  lastActive: string;
}
const seedAdminSessions = (): AdminSession[] => [
  {
    id: uid(),
    user: "Alex Chen",
    device: "Chrome · macOS",
    location: "Berlin, DE",
    lastActive: "Active now",
  },
  {
    id: uid(),
    user: "Priya Nair",
    device: "Safari · iOS",
    location: "Austin, US",
    lastActive: "12 min ago",
  },
  {
    id: uid(),
    user: "Devon Marsh",
    device: "Edge · Windows",
    location: "Toronto, CA",
    lastActive: "1 hour ago",
  },
  {
    id: uid(),
    user: "Maya Osei",
    device: "Chrome · Android",
    location: "London, UK",
    lastActive: "3 hours ago",
  },
  {
    id: uid(),
    user: "Hiro Tanaka",
    device: "Firefox · Linux",
    location: "Osaka, JP",
    lastActive: "2 days ago",
  },
];
export const useAdminSessions = () =>
  useLocalStore<AdminSession[]>("yroos.sessions", seedAdminSessions());

export interface IpRule {
  id: string;
  ip: string;
  note: string;
}
export interface IpLists {
  allow: IpRule[];
  block: IpRule[];
}
const seedIpLists = (): IpLists => ({
  allow: [{ id: uid(), ip: "10.0.4.0/24", note: "Tubify HQ office network" }],
  block: [
    { id: uid(), ip: "198.51.100.23", note: "Repeated failed logins" },
    { id: uid(), ip: "203.0.113.77", note: "Flagged by rate limiter" },
  ],
});
export const useIpLists = () => useLocalStore<IpLists>("yroos.ipLists", seedIpLists());

// ============ AUDIT LOG ============
export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  module: string;
  target: string;
  timestamp: string;
  ip: string;
  outcome: "Success" | "Failed";
}
const seedAuditLog = (): AuditEntry[] => [
  {
    id: uid(),
    actor: "Alex Chen",
    action: "Changed plan",
    module: "Billing",
    target: "Glow Up Beauty Co → Pro",
    timestamp: "2026-07-20T14:12:00Z",
    ip: "203.0.113.5",
    outcome: "Success",
  },
  {
    id: uid(),
    actor: "Alex Chen",
    action: "Disabled feature",
    module: "System",
    target: "AI Freebie",
    timestamp: "2026-07-19T09:41:00Z",
    ip: "203.0.113.5",
    outcome: "Success",
  },
  {
    id: uid(),
    actor: "Alex Chen",
    action: "Suspended workspace",
    module: "Users",
    target: "Bytesize Learning",
    timestamp: "2026-06-04T11:02:00Z",
    ip: "203.0.113.5",
    outcome: "Success",
  },
];
export const useAuditLog = () => useLocalStore<AuditEntry[]>("yroos.auditLog", seedAuditLog());
export function makeAuditEntry(
  actor: string,
  action: string,
  module: string,
  target: string,
  outcome: "Success" | "Failed" = "Success",
): AuditEntry {
  return {
    id: uid(),
    actor,
    action,
    module,
    target,
    timestamp: new Date().toISOString(),
    ip: `203.0.113.${1 + Math.floor(Math.random() * 250)}`,
    outcome,
  };
}

// ============ INFRASTRUCTURE ============
export interface BackupRecord {
  id: string;
  type: "Manual" | "Scheduled";
  size: string;
  createdAt: string;
  status: "Completed" | "Running";
}
const seedBackups = (): BackupRecord[] => [
  {
    id: uid(),
    type: "Scheduled",
    size: "4.2 GB",
    createdAt: "2026-07-22T03:00:00Z",
    status: "Completed",
  },
  {
    id: uid(),
    type: "Scheduled",
    size: "4.1 GB",
    createdAt: "2026-07-21T03:00:00Z",
    status: "Completed",
  },
  {
    id: uid(),
    type: "Manual",
    size: "4.1 GB",
    createdAt: "2026-07-18T16:22:00Z",
    status: "Completed",
  },
  {
    id: uid(),
    type: "Scheduled",
    size: "4.0 GB",
    createdAt: "2026-07-20T03:00:00Z",
    status: "Completed",
  },
];
export const useBackups = () => useLocalStore<BackupRecord[]>("yroos.backups", seedBackups());
