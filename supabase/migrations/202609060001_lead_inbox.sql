-- Real backing for Lead Inbox, replacing the client-only mock chat store. public.leads already
-- existed (unused by any UI) — this adds the inbox-state columns the page needs, a real message
-- thread table (there was none), and a real AI summary cache. YouTube-sourced leads are created
-- for real by api.comment-rules.replies.ts when a rule actually fires — see that route — rather
-- than fabricated here; Instagram/Email leads are added manually via the UI since this app has no
-- integration with either platform to detect them automatically.
alter type public.lead_status add value if not exists 'call_booked';

alter table public.leads
  add column if not exists pinned boolean not null default false,
  add column if not exists muted boolean not null default false,
  add column if not exists favorite boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists unread boolean not null default true,
  add column if not exists tags text[] not null default '{}',
  add column if not exists assigned_to text,
  add column if not exists avatar_url text,
  add column if not exists email text,
  add column if not exists ai_summary jsonb,
  add column if not exists ai_summary_generated_at timestamptz;

-- Partial (not a plain unique constraint) so multiple manually-added leads with no known handle
-- never collide on NULL — only used to upsert-match a real returning commenter by their stable
-- YouTube channel id.
create unique index if not exists leads_user_platform_username_idx
  on public.leads(user_id, platform, username) where username is not null;

create table public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_who text not null check (from_who in ('lead', 'you', 'system')),
  kind text not null default 'note' check (kind in ('comment', 'note')),
  text text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index lead_messages_lead_created_idx on public.lead_messages(lead_id, created_at);

alter table public.lead_messages enable row level security;

create policy lead_messages_owner on public.lead_messages for all using (
  exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
) with check (
  exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
);
