alter table public.leads
  add column if not exists primary_lead_id uuid references public.leads(id) on delete set null;

alter table public.leads
  drop constraint if exists leads_primary_lead_id_not_self;

alter table public.leads
  add constraint leads_primary_lead_id_not_self check (primary_lead_id is null or primary_lead_id <> id);

create index if not exists leads_primary_lead_id_idx
  on public.leads(primary_lead_id)
  where primary_lead_id is not null;
