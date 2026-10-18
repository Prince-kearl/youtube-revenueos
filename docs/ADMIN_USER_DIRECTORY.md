# Admin user directory — deployment and operations

The admin console's Users list reads `public.admin_user_directory`: one row per account with the
account's **Auth email** (authoritative — never the user-editable `profiles.email`), name, role and
account status, indexed for server-side paging, search, filters and counts.

## Deployment order

Run each step **on its own** in the Supabase SQL editor (the editor runs a pasted script as one
transaction; never paste these together). Deploy the app code only after step 3 is complete.

| Step | What                                                                              | Locks                                                                       | Duration                        |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| 1    | `202610180001_admin_user_directory.sql` — empty table, indexes, functions         | instant `SHARE ROW EXCLUSIVE` on `profiles` (FK to an empty table)          | < 1 s                           |
| 2    | `202610180002_admin_user_directory_triggers.sql` — the two triggers               | `SHARE ROW EXCLUSIVE` on `profiles` and `auth.users`, held for milliseconds | < 1 s                           |
| 3    | Backfill (below)                                                                  | row locks on new directory rows only                                        | minutes at millions of accounts |
| 4    | `202610180003_admin_audit_log_target_index.sql` — one `CREATE INDEX CONCURRENTLY` | none that block writes                                                      | seconds                         |

Steps 1 and 2 set `lock_timeout`, so they give up instead of queueing behind a long transaction
(a queued lock request would itself block sign-ins and sign-ups). If either fails with
`canceling statement due to lock timeout`:

1. run `rollback;` (the aborted transaction stays open until rolled back),
2. wait a few seconds,
3. run the file again — both are idempotent.

## Backfill

Repeat until the status is `complete`:

```sql
select * from public.admin_user_directory_backfill_step(2000);
```

or use **Users → Directory health → Build directory** (Superadmin), which calls the same function
one batch per request and can be stopped and resumed. Each batch:

- reads at most N accounts in id order after the stored cursor and inserts only rows that do not
  exist yet — a row a trigger already wrote (newer data) is never overwritten;
- is one short transaction; the cursor only moves when the batch commits, so an interrupted or
  failed batch is simply redone;
- is serialised (the state row is locked), so two operators cannot run batches at once;
- locks its batch's `profiles` rows `FOR KEY SHARE` while it runs: ordinary profile edits do not
  wait for it; deleting one of those accounts waits for the batch (milliseconds) or, if it
  committed first, drops the account from the batch, so a batch never fails on the foreign key;
- records `failed` and the SQLSTATE if it errors; the next call resumes from the same cursor.

Until the backfill is complete the database refuses to list, count or total the directory
(SQLSTATE `55000`), and the API answers `503 ADMIN_USERS_DIRECTORY_INCOMPLETE` with progress. A
partial directory is never presented as the user list.

Check progress: `select * from public.admin_user_directory_status();`

## Drift and repair

Triggers keep the directory current. If one fails, the Auth or profile write still succeeds; the
account id and SQLSTATE (never an email or message) are recorded in
`admin_user_directory_sync_failures`, and `status()` reports the last 24 hours.

**Users → Directory health → Check for drift / Repair** (Superadmin) walks every account in
windows of at most 2,000 per request. A check is read-only; a repair inserts missing rows and
corrects stale ones from the sources, never touching `auth.users` or `profiles`, and is written to
`admin_audit_log` with counts only. A row a trigger wrote after a repair started is left alone.

## Pagination guarantees

Keyset pagination, ordered by `(created_at, user_id)` or `(email_lower, user_id)` — `user_id`
breaks every tie, so the order is total. There is **no snapshot across requests**:

- each page is consistent in itself;
- an account that exists throughout and keeps its sort key is returned exactly once;
- accounts created while paging (newest first) land before the cursor and are not shown until
  the list is reloaded; deleted accounts simply disappear;
- an account whose sort key changes between pages (its email, in email order) can be skipped or
  shown twice;
- the total is computed for the first page and not updated while paging.

## Rollback

Redeploy the previous app code first (it does not use the directory), then:

```sql
begin;
set local lock_timeout = '3s';
drop trigger if exists admin_user_directory_auth_sync on auth.users;
drop trigger if exists admin_user_directory_profile_sync on public.profiles;
drop function if exists
  public.admin_list_users(integer, text, text, text, text, text, timestamptz, text, uuid),
  public.admin_count_users(text, text, text, text), public.admin_user_stats(),
  public.admin_user_directory_status(), public.admin_user_directory_backfill_step(integer),
  public.admin_user_directory_check(uuid, integer), public.admin_user_directory_repair(uuid, integer),
  public.admin_user_directory_assert_complete(), public.admin_user_directory_where(text, text, text, text),
  public.admin_user_directory_expected(uuid, integer),
  public.admin_user_directory_sync_profile(), public.admin_user_directory_sync_auth();
drop table if exists public.admin_user_directory_sync_failures,
  public.admin_user_directory_state, public.admin_user_directory;
commit;
```

and, on its own: `drop index concurrently if exists public.admin_audit_log_target_created_idx;`

This removes only directory objects; `auth.users`, `profiles` and `admin_audit_log` rows are
untouched.

## Local validation

`scripts/db/validate-admin-user-directory.mjs` runs all of the above against a real local
PostgreSQL 17 with concurrent sessions (Supabase simulated by stand-ins — not staging evidence).
