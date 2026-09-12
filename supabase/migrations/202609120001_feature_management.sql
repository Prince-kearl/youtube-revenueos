-- Real, database-backed feature visibility system, replacing the client-only localStorage
-- feature-flag toggle in SystemSection.tsx (yroos.featureFlags) which had no server enforcement
-- and was not per-role. The existing PlatformRole demo (Owner/Manager/Setter/Editor/Superadmin,
-- see canAccessRoute in stores.ts) and CustomRole (RolesSection) are both client-only UI previews
-- with no real auth backing — the only REAL, server-authenticated role dimension in this app is
-- profiles.role ('user' | 'admin'), so that is what role_feature_access is keyed on. Plan tiers
-- (starter/pro/scale, see plans/plan_prices) remain a deliberately separate concept — feature
-- visibility here is not plan entitlement.
create table public.features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  category text not null default 'Core',
  navigation_label text,
  route text,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_system_feature boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index features_sort_idx on public.features(sort_order);

create table public.role_feature_access (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'admin')),
  feature_id uuid not null references public.features(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (role, feature_id)
);

create index role_feature_access_role_idx on public.role_feature_access(role);

create trigger features_updated_at before update on public.features
  for each row execute function public.set_updated_at();
create trigger role_feature_access_updated_at before update on public.role_feature_access
  for each row execute function public.set_updated_at();

alter table public.features enable row level security;
alter table public.role_feature_access enable row level security;

-- Every signed-in user needs to read the registry + their own role's overrides to render their
-- real nav/feature access — same "public read, service-role write" pattern as plans/plan_prices.
-- Writes only ever happen through the service-role client in admin-gated API routes (see
-- api.admin.features.ts) — no insert/update/delete policy is granted here on purpose.
create policy features_public_read on public.features for select using (true);
create policy role_feature_access_public_read on public.role_feature_access for select using (true);

-- Seed the registry from the app's ACTUAL nav routes (src/components/DashboardLayout.tsx `nav`),
-- not invented feature names. `dashboard` is the only creator-facing system feature — a user
-- must never be locked out of their own dashboard.
insert into public.features
  (key, name, description, category, navigation_label, route, icon, sort_order, is_system_feature)
values
  ('dashboard', 'Dashboard', 'Main overview dashboard.', 'Core', 'Dashboard', '/dashboard', 'LayoutDashboard', 0, true),
  ('videos', 'Videos', 'Video library and analytics.', 'Creator Tools', 'Videos', '/videos', 'Video', 10, false),
  ('projects', 'Projects', 'AI project concept generator.', 'Creator Tools', 'Projects', '/projects', 'FolderKanban', 20, false),
  ('ai_lab', 'AI Lab', 'AI-generated video descriptions and tracked links.', 'AI', 'AI Lab', '/ai-lab', 'Sparkles', 30, false),
  ('destinations', 'Destinations', 'Bio-link redirect destinations.', 'Integrations', 'Destinations', '/destinations', 'MapPin', 40, false),
  ('link_tracking', 'Link Tracking', 'Short links with click tracking.', 'Creator Tools', 'Link Tracking', '/link-tracking', 'Link2', 50, false),
  ('comment_automation', 'Comment Automation', 'Auto-reply rules for YouTube comments.', 'AI', 'Comment Automation', '/comments', 'MessageSquare', 60, false),
  ('leads', 'Lead Inbox', 'Unified inbox for captured leads.', 'Monetization', 'Lead Inbox', '/leads', 'Inbox', 70, false),
  ('audience', 'Audience', 'Audience demographics and conversion.', 'Analytics', 'Audience', '/audience', 'Users', 80, false),
  ('analytics', 'Analytics', 'YouTube channel analytics.', 'Analytics', 'Analytics', '/analytics', 'BarChart3', 90, false),
  ('affiliate', 'Affiliate Program', 'Referral link tracking and commissions.', 'Monetization', 'Affiliate', '/affiliate', 'Percent', 100, false),
  ('freebie', 'AI Freebie Generator', 'AI-generated lead-magnet freebies.', 'AI', 'AI Freebie', '/freebie', 'Gift', 110, false),
  ('email', 'Email', 'Email campaign builder.', 'Creator Tools', 'Email', '/email', 'Mail', 120, false),
  ('brand_deals', 'Brand Deals', 'Sponsorship deal pipeline.', 'Monetization', 'Brand Deals', '/brand-deals', 'Handshake', 130, false),
  ('team', 'Team', 'Team member management.', 'Account', 'Team', '/team', 'UserPlus', 140, false),
  ('reports', 'Reports', 'Exportable summary reports.', 'Analytics', 'Reports', '/reports', 'FileText', 150, false);

-- Default: everything enabled for both real roles, matching current behavior exactly (nothing is
-- hidden today) — Superadmins can start restricting from here without anyone losing access on
-- migration day.
insert into public.role_feature_access (role, feature_id, enabled)
select r.role, f.id, true
from public.features f
cross join (values ('user'), ('admin')) as r(role);

-- ============================================================
-- Version / release management — application release metadata, NOT source control. Tracks what
-- Tubify build/release is "current" and its notes, independent of git tags or deployments.
-- ============================================================
create table public.app_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  build_number text,
  release_name text,
  release_notes text,
  status text not null default 'draft'
    check (status in ('draft', 'testing', 'published', 'deprecated', 'rolled_back')),
  is_current boolean not null default false,
  minimum_supported_version text,
  created_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);

-- Only one release can ever be "current" at a time.
create unique index app_releases_one_current on public.app_releases(is_current) where is_current;

create index app_releases_created_idx on public.app_releases(created_at desc);

alter table public.app_releases enable row level security;

-- No public read policy — release history (including draft/testing notes) may reveal unreleased
-- features, so normal users only ever see the current release through the dedicated /api/version
-- endpoint (service-role, returns only safe fields), never by querying this table directly.
create policy app_releases_admin_read on public.app_releases for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Bootstrap release so "Current Version" is never blank on a fresh install.
insert into public.app_releases (version, release_name, release_notes, status, is_current, published_at)
values ('1.0.0', 'Tubify Launch', 'Initial tracked release.', 'published', true, timezone('utc', now()));

-- ============================================================
-- Generic admin audit log for feature-management and release-management actions. plan_audit_log
-- already exists but is scoped specifically to plan/pricing changes; this mirrors its exact shape
-- for these two new subsystems rather than overloading an unrelated table.
-- ============================================================
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete set null,
  action text not null,
  target text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);

alter table public.admin_audit_log enable row level security;

create policy admin_audit_log_admin_read on public.admin_audit_log for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
