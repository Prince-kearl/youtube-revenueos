create extension if not exists pgcrypto;

create type public.app_role as enum ('user', 'admin');
create type public.video_status as enum ('active', 'archived', 'deleted');
create type public.record_status as enum ('active', 'archived');
create type public.lead_status as enum ('new', 'contacted', 'qualified', 'converted', 'lost');
create type public.deal_stage as enum ('prospect', 'pitched', 'negotiating', 'contracted', 'completed');
create type public.job_status as enum ('queued', 'processing', 'completed', 'failed');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.youtube_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  youtube_channel_id text not null,
  channel_name text not null,
  channel_handle text,
  thumbnail text,
  subscriber_count bigint not null default 0 check (subscriber_count >= 0),
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea not null,
  token_expiry timestamptz,
  connected_at timestamptz not null default timezone('utc', now()),
  last_synced_at timestamptz,
  unique (user_id, youtube_channel_id)
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  youtube_video_id text not null,
  title text not null,
  description text,
  thumbnail text,
  published_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status public.video_status not null default 'active',
  analytics_updated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (channel_id, youtube_video_id)
);

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  transcript text not null,
  source text not null default 'manual',
  language text not null default 'en',
  timestamps jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null,
  url text not null,
  description text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (url ~* '^https?://')
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft',
  start_date date,
  end_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.campaign_videos (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  primary key (campaign_id, video_id)
);

create table public.tracking_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid references public.videos(id) on delete set null,
  destination_id uuid not null references public.destinations(id) on delete restrict,
  campaign_id uuid references public.campaigns(id) on delete set null,
  slug text not null unique,
  tracking_code text not null unique,
  status public.record_status not null default 'active',
  clicks bigint not null default 0 check (clicks >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.link_click_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.tracking_links(id) on delete cascade,
  channel_id uuid references public.youtube_channels(id) on delete set null,
  video_id uuid references public.videos(id) on delete set null,
  destination_id uuid not null references public.destinations(id) on delete restrict,
  campaign_id uuid references public.campaigns(id) on delete set null,
  referrer text,
  user_agent text,
  device_type text,
  privacy_id text,
  clicked_at timestamptz not null default timezone('utc', now())
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text,
  username text,
  platform text not null,
  contact jsonb,
  source text,
  video_id uuid references public.videos(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  status public.lead_status not null default 'new',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  name text not null,
  value numeric(14,2) not null default 0 check (value >= 0),
  currency char(3) not null default 'USD',
  stage public.deal_stage not null default 'prospect',
  status text not null default 'open',
  expected_close_date date,
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  name text not null,
  trigger_type text not null,
  trigger_value text not null,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  queue text not null,
  type text not null,
  status public.job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.youtube_quota_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  channel_id uuid references public.youtube_channels(id) on delete set null,
  operation text not null,
  quota_units integer not null check (quota_units >= 0),
  succeeded boolean not null default true,
  error_code text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index videos_channel_published_idx on public.videos(channel_id, published_at desc);
create index click_events_channel_video_time_idx on public.link_click_events(channel_id, video_id, clicked_at desc);
create index click_events_channel_destination_time_idx on public.link_click_events(channel_id, destination_id, clicked_at desc);
create index click_events_link_time_idx on public.link_click_events(link_id, clicked_at desc);
create index leads_user_status_idx on public.leads(user_id, status, created_at desc);
create index deals_user_stage_idx on public.deals(user_id, stage, created_at desc);
create index notifications_user_read_idx on public.notifications(user_id, read, created_at desc);
create index jobs_status_queue_idx on public.jobs(status, queue, created_at);
create index quota_channel_time_idx on public.youtube_quota_events(channel_id, created_at desc);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger videos_updated_at before update on public.videos for each row execute function public.set_updated_at();
create trigger destinations_updated_at before update on public.destinations for each row execute function public.set_updated_at();
create trigger campaigns_updated_at before update on public.campaigns for each row execute function public.set_updated_at();
create trigger tracking_links_updated_at before update on public.tracking_links for each row execute function public.set_updated_at();
create trigger leads_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger deals_updated_at before update on public.deals for each row execute function public.set_updated_at();
create trigger automation_rules_updated_at before update on public.automation_rules for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, avatar)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'avatar_url');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.youtube_channels enable row level security;
alter table public.videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.destinations enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_videos enable row level security;
alter table public.tracking_links enable row level security;
alter table public.link_click_events enable row level security;
alter table public.leads enable row level security;
alter table public.deals enable row level security;
alter table public.automation_rules enable row level security;
alter table public.notifications enable row level security;
alter table public.jobs enable row level security;
alter table public.youtube_quota_events enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

-- Directly owned records. Service-role workers bypass RLS; browser clients cannot cross tenants.
create policy youtube_channels_owner on public.youtube_channels for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy destinations_owner on public.destinations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy campaigns_owner on public.campaigns for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy campaign_videos_owner on public.campaign_videos for all using (
  exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid())
);
create policy leads_owner on public.leads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy deals_owner on public.deals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy automation_rules_owner on public.automation_rules for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_owner on public.notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy jobs_owner on public.jobs for select using (user_id = auth.uid());
create policy quota_owner on public.youtube_quota_events for select using (user_id = auth.uid());
create policy audit_owner on public.audit_events for select using (user_id = auth.uid());

-- Child records are accessible only through a channel/video/link owned by the user.
create policy videos_owner on public.videos for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
create policy transcripts_owner on public.transcripts for all using (
  exists (select 1 from public.videos v join public.youtube_channels c on c.id = v.channel_id where v.id = video_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.videos v join public.youtube_channels c on c.id = v.channel_id where v.id = video_id and c.user_id = auth.uid())
);
create policy tracking_links_owner on public.tracking_links for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy click_events_owner on public.link_click_events for select using (
  exists (select 1 from public.tracking_links l where l.id = link_id and l.user_id = auth.uid())
);
