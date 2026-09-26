-- Introduces a proper OAuth-connection abstraction so a single Google OAuth grant can back
-- multiple YouTube channels (the case for any identity with account-level rights to more than one
-- channel, e.g. a legacy Brand Account manager). Today `youtube_channels` owns its own token pair
-- per row, which forces a separate consent flow per channel and silently discards every channel
-- past the first one Google returns from channels.list(mine=true) (see fetchAuthorizedYoutubeChannel
-- in google-oauth.ts, which takes items[0]). This migration does not change that discovery bug by
-- itself — the application code change lands alongside it — it only prepares the schema and safely
-- carries forward every existing channel's working credentials so no connected channel is ever
-- broken or forced to reauthorize by this migration.
--
--   workspace
--      |
--      +---- youtube_connection (owns the encrypted token pair + Google identity)
--                 |
--                 +---- youtube_channels row A
--                 +---- youtube_channels row B  (same Google identity, same connection)

create table public.youtube_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- The workspace member who performed this OAuth grant. Display/audit only — access to the
  -- channels under this connection is governed by workspace membership (RLS below), not by who
  -- happens to be user_id, matching how every other workspace-scoped table in this app works.
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Google's stable, non-reassignable subject identifier for the authenticated account (the `sub`
  -- claim from the ID token) — deliberately NOT the Google email, which can change. Nullable
  -- because connections backfilled from the pre-existing per-channel token model (see the backfill
  -- below) predate capturing it; those are filled in the next time that identity goes through a
  -- fresh consent flow. Never guessed or inferred — see the backfill's comment for why.
  google_subject_id text,
  google_email text,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea not null,
  token_expiry timestamptz,
  granted_scopes text[] not null default '{}',
  -- Connection-level token health, independent of any one channel's sync status. A refresh failure
  -- here means EVERY channel sharing this connection needs reauthorization, not just one.
  status text not null default 'active' check (status in ('active', 'reauth_required', 'revoked')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- A plain unique constraint already allows multiple NULLs per workspace in Postgres, so this does
-- not collide across the NULL google_subject_id rows produced by the backfill below — it only
-- prevents creating a second connection for an identity already connected to this workspace once
-- we do know its sub.
create unique index youtube_connections_workspace_identity_key
  on public.youtube_connections (workspace_id, google_subject_id)
  where google_subject_id is not null;

create index youtube_connections_workspace_id_idx on public.youtube_connections (workspace_id);

alter table public.youtube_connections enable row level security;

create policy youtube_connections_workspace on public.youtube_connections for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- Reuses the set_updated_at() trigger function already defined in 202608160001_initial_schema.sql.
create trigger youtube_connections_set_updated_at
  before update on public.youtube_connections
  for each row execute function public.set_updated_at();

-- youtube_channels gains a foreign key to the connection that owns its credentials. Nullable
-- through the backfill step below (every existing row gets one before the NOT NULL is applied),
-- never destroying a channel row and never permitted to leave a connection referenced by channels
-- deleted out from under them (restrict, not cascade — the application deletes/reassigns channels
-- before it may delete a connection, so a stray drop can't silently orphan working channels).
alter table public.youtube_channels
  add column connection_id uuid references public.youtube_connections (id) on delete restrict;

-- Safe backfill: one connection per existing channel row, carrying forward its EXACT existing
-- token pair unchanged. This does not attempt to detect or merge channels that already share a
-- Google identity — we have no google_subject_id for tokens issued before this migration, and
-- guessing that mapping (e.g. by matching workspace_id/user_id) risks merging two channels that
-- happen to belong to the same Tubify user but were connected under two different Google accounts.
-- Every existing channel keeps working exactly as it does today (own connection, own valid token);
-- true multi-channel sharing only starts applying to connections created after this migration,
-- once the application captures google_subject_id from the ID token at consent time.
do $$
declare
  ch record;
  new_connection_id uuid;
  migrated_count integer := 0;
  skipped_count integer := 0;
begin
  for ch in
    select id, workspace_id, user_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry
    from public.youtube_channels
    where connection_id is null
  loop
    if ch.workspace_id is null or ch.user_id is null then
      -- Never guess an owning workspace/user for an orphaned row — leave connection_id null and
      -- flag it via the raise notice below so a follow-up read-only audit can find it. The NOT
      -- NULL constraint intentionally is NOT applied to connection_id for this reason.
      skipped_count := skipped_count + 1;
      raise notice 'Skipped youtube_channels row % — missing workspace_id or user_id, cannot safely backfill a connection', ch.id;
      continue;
    end if;

    insert into public.youtube_connections (
      workspace_id, user_id, google_subject_id, google_email,
      access_token_ciphertext, refresh_token_ciphertext, token_expiry,
      granted_scopes, status
    ) values (
      ch.workspace_id, ch.user_id, null, null,
      ch.access_token_ciphertext, ch.refresh_token_ciphertext, ch.token_expiry,
      '{}', 'active'
    )
    returning id into new_connection_id;

    update public.youtube_channels set connection_id = new_connection_id where id = ch.id;
    migrated_count := migrated_count + 1;
  end loop;

  raise notice 'youtube_connections backfill: % channel(s) migrated, % skipped', migrated_count, skipped_count;
end $$;

-- Hard safety gate: any row that HAD a usable workspace_id/user_id but still lacks a
-- connection_id at this point means the backfill loop above failed to cover it — that's a bug,
-- not a legitimate orphan (legitimate orphans are exactly the null-workspace_id/user_id rows the
-- loop already skips on purpose). Abort the whole transaction rather than proceed to drop the
-- token columns against a partially migrated table; DDL in Postgres is transactional, so this
-- raise rolls back everything above, leaving production exactly as it was.
do $$
declare
  unmigrated_count integer;
begin
  select count(*) into unmigrated_count
  from public.youtube_channels
  where connection_id is null and workspace_id is not null and user_id is not null;

  if unmigrated_count > 0 then
    raise exception
      'youtube_connections backfill incomplete: % channel(s) with a valid workspace_id/user_id still lack a connection_id — aborting before dropping token columns',
      unmigrated_count;
  end if;
end $$;

-- Old per-channel token columns are dropped only now that every reachable row has been copied
-- into youtube_connections above in the same transaction, AND the safety gate above confirmed no
-- well-formed row was missed — never drop-then-hope. A row skipped for missing workspace_id/user_id
-- keeps connection_id null, which is intentional (see the backfill loop's comment) and is what the
-- read-only verification query run before this migration is applied is for — surfaced, not silently
-- dropped.
alter table public.youtube_channels drop column access_token_ciphertext;
alter table public.youtube_channels drop column refresh_token_ciphertext;
alter table public.youtube_channels drop column token_expiry;
