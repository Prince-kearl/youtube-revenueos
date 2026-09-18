-- Wires published freebies into the SAME destination/tracking-link/click-analytics system every
-- other conversion link already uses, instead of building a parallel one. Publishing a freebie
-- (see api.freebies.ts) auto-creates (or reuses) a real `destinations` row pointing at its public
-- page; AI Lab's existing "auto-generate a tracking link per destination" flow (built for regular
-- destinations) then works for a freebie with zero new tracking infrastructure — the Destinations
-- page's per-destination top-videos view already answers "which video drove the most clicks for
-- this freebie" for free.
-- `set null` (not cascade): tracking_links.destination_id is `on delete restrict`, so a freebie
-- with click history would fail to delete entirely if this cascaded. Deleting a freebie instead
-- just detaches its destination and archives it (see api.freebies.ts DELETE) — click history and
-- existing tracking links stay intact and inspectable on the Destinations page.
alter table public.destinations
  add column if not exists lead_magnet_id uuid references public.lead_magnets(id) on delete set null;

alter table public.lead_magnets
  add column if not exists destination_id uuid references public.destinations(id) on delete set null;

create unique index if not exists destinations_lead_magnet_id_idx
  on public.destinations(lead_magnet_id) where lead_magnet_id is not null;

-- The optional Instagram handle a visitor can leave alongside their email on a freebie's public
-- opt-in page (see f.$slug.tsx / api.freebies.optin.ts) — stored here as a durable record of what
-- was actually submitted, independent of the lead row's own `username`, which the same opt-in also
-- sets/updates.
alter table public.lead_magnet_optins
  add column if not exists instagram_handle text;
