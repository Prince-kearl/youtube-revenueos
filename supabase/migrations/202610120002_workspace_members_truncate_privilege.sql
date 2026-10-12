-- Row-level security does not apply to TRUNCATE, so the member-facing roles must not hold the
-- privilege on the membership table. Nothing in the application truncates anything, and every
-- write to this table is made with the service role.
--
-- Safe to apply at any time and to re-run: it needs no application change and changes no data.
-- The column-level SELECT grants on this table (202610100001) are not touched.

REVOKE TRUNCATE ON TABLE public.workspace_members
FROM PUBLIC, anon, authenticated;
