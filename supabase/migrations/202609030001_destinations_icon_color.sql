-- The Destinations page lets a user pick a decorative icon/color per destination (e.g. "Course"
-- vs "Newsletter" vs "Affiliate" at a glance). That was previously a purely client-side/local-mock
-- concept with no backing column, so the choice never actually persisted — this adds real columns
-- for it, matching the DestinationDialog's existing icon/color pickers.
alter table public.destinations
  add column if not exists icon text not null default 'link'
    check (icon in ('cart', 'trend', 'cursor', 'link', 'external')),
  add column if not exists color text not null default 'purple'
    check (color in ('purple', 'green', 'blue', 'amber', 'red'));
