-- Real, server-side RBAC replacing the client-only PlatformRole demo (Owner/Manager/Setter/Editor/
-- Superadmin, see canAccessRoute in stores.ts — a pure localStorage nav-preview switcher with no
-- auth backing). profiles.role becomes the single canonical role, extended from the original
-- two-value 'user'|'admin' enum to six real roles. 'admin' is kept in the enum (Postgres can't
-- cheaply drop enum values) but no row should reference it after the next migration promotes
-- existing admins to 'superadmin', the closest real equivalent.
--
-- IMPORTANT: this file only adds enum values. A newly added enum value cannot be used (in an
-- UPDATE, CHECK constraint, etc.) inside the same transaction it was added in — that is a hard
-- Postgres restriction, not a style choice — so the data migration that actually uses these
-- values lives in the next migration file, applied after this one commits.
alter type public.app_role add value if not exists 'superadmin';
alter type public.app_role add value if not exists 'owner';
alter type public.app_role add value if not exists 'manager';
alter type public.app_role add value if not exists 'setter';
alter type public.app_role add value if not exists 'editor';
