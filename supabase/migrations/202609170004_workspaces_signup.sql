-- Every new signup either joins a workspace they were already invited to (by email match) or
-- gets a brand-new workspace of their own, as its owner. This is the real-account equivalent of
-- the manual backfill in 202609170002 — same shape, just running automatically going forward.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pending_membership_id uuid;
  new_workspace_id uuid;
begin
  insert into public.profiles (id, email, name, avatar, referral_code, referred_by)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'avatar_url',
    lower(substr(replace(new.id::text, '-', ''), 1, 10)),
    (select id from public.profiles where referral_code = new.raw_user_meta_data ->> 'referred_by_code')
  );

  select id into pending_membership_id
  from public.workspace_members
  where invited_email = new.email and status = 'invited' and user_id is null
  limit 1;

  if pending_membership_id is not null then
    update public.workspace_members
    set user_id = new.id, status = 'active', joined_at = timezone('utc', now())
    where id = pending_membership_id;
  else
    insert into public.workspaces (name, owner_id)
    values (
      coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), new.email, 'My Workspace'),
      new.id
    )
    returning id into new_workspace_id;

    insert into public.workspace_members
      (workspace_id, user_id, invited_email, role, status, invited_by, invited_at, joined_at)
    values (
      new_workspace_id, new.id, coalesce(new.email, ''), 'owner', 'active', new.id,
      timezone('utc', now()), timezone('utc', now())
    );
  end if;

  return new;
end;
$$;
