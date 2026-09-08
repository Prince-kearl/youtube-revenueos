-- Real backing for Comment Automation, replacing the client-only mock rule store and fake
-- "Recent Triggers"/fired-count numbers. Rules match against comments fetched live from YouTube
-- (see fetchRecentYoutubeComments); replies are logged here for a real trigger history and a real
-- per-rule fired count, computed from actual successful sends rather than a static seed number.
create table public.comment_automation_rules (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('keyword', 'handle', 'question')),
  keywords text[] not null default '{}',
  reply_template text not null,
  video_id uuid references public.videos(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.comment_automation_replies (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  rule_id uuid references public.comment_automation_rules(id) on delete set null,
  youtube_comment_id text not null,
  youtube_video_id text not null,
  author_name text,
  comment_text text not null,
  reply_text text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default timezone('utc', now())
);

create index comment_automation_rules_channel_idx on public.comment_automation_rules(channel_id);
create index comment_automation_replies_channel_created_idx
  on public.comment_automation_replies(channel_id, created_at desc);

create trigger comment_automation_rules_updated_at before update on public.comment_automation_rules
  for each row execute function public.set_updated_at();

alter table public.comment_automation_rules enable row level security;
alter table public.comment_automation_replies enable row level security;

create policy comment_automation_rules_owner on public.comment_automation_rules for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
create policy comment_automation_replies_owner on public.comment_automation_replies for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
