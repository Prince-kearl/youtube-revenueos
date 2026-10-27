-- YouTube channels and Google connections: written by the server only.
--
-- Until now both tables had one "for all" policy (any active workspace member) and Supabase's
-- default table grants, so ANY member — whatever their workspace role, editor and setter included
-- — could, by calling the database API directly with their own session:
--   * read every Google connection of their workspace, encrypted token columns included;
--   * update or delete connections (breaking every channel that uses them);
--   * delete a channel row, which cascades through its videos, daily statistics, sync state,
--     comment rules and reply queue — the whole history of the channel.
-- The app itself never needed any of that from a client session: connecting, picking, refreshing
-- and disconnecting are server routes that check the caller's role (owner or manager) and
-- workspace, and use the service role for these writes (api.youtube.callback.ts,
-- api.youtube.connections.ts, api.youtube.channels.ts).
--
-- After this migration:
--   youtube_connections  no access for client roles at all (the service role bypasses RLS and
--                        grants). RLS stays enabled with no policy: deny by default.
--   youtube_channels     members may still READ their workspace's channels (the app lists them
--                        through RLS); no client role may insert, update or delete.
--
-- Rollback (restores the previous access exactly):
--   begin;
--   grant select, insert, update, delete on public.youtube_connections to authenticated, anon;
--   grant insert, update, delete on public.youtube_channels to authenticated, anon;
--   grant select on public.youtube_channels to anon;
--   drop policy if exists youtube_channels_member_read on public.youtube_channels;
--   create policy youtube_channels_workspace on public.youtube_channels for all
--     using (public.is_active_workspace_member(workspace_id))
--     with check (public.is_active_workspace_member(workspace_id));
--   create policy youtube_connections_workspace on public.youtube_connections for all
--     using (public.is_active_workspace_member(workspace_id))
--     with check (public.is_active_workspace_member(workspace_id));
--   commit;

begin;
set local lock_timeout = '3s';

-- Connections: server only.
drop policy if exists youtube_connections_workspace on public.youtube_connections;
revoke all on public.youtube_connections from anon, authenticated;
alter table public.youtube_connections enable row level security;

-- Channels: members read their own workspace's channels; nobody writes from a client.
drop policy if exists youtube_channels_workspace on public.youtube_channels;
drop policy if exists youtube_channels_member_read on public.youtube_channels;
create policy youtube_channels_member_read on public.youtube_channels
  for select to authenticated
  using (public.is_active_workspace_member(workspace_id));
revoke all on public.youtube_channels from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.youtube_channels from authenticated;
grant select on public.youtube_channels to authenticated;
alter table public.youtube_channels enable row level security;

commit;
