# Database backups

Every night at 02:30 UTC a GitHub Actions job (`.github/workflows/database-backup.yml`) backs up
the production database, **proves the backup restores**, encrypts it, and keeps it for 90 days.
It can also be run at any time.

## What each backup contains

| File                                           | What it is                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/roles.sql`, `schema.sql`, `data.sql` | The Supabase CLI dump: the set Supabase documents for restoring into a new project. Includes every table's data, user accounts (`auth.users`) included.          |
| `full.dump`                                    | A complete `pg_dump` of the `public`, `auth` and `storage` schemas (best effort: if it cannot be taken, the run warns and the CLI dump above is still complete). |
| `row-counts.tsv`                               | Every table's row count when the backup was taken.                                                                                                               |
| `MANIFEST.txt`                                 | When it was taken, tool versions, and a SHA-256 checksum of every file.                                                                                          |

**Not included:** files uploaded to Supabase Storage (only their records are in the database),
Supabase project settings (Auth providers, email templates, API keys), and Vercel environment
variables. Keep those documented separately.

## How a backup is made safe

- **Encrypted before it leaves the job.** This repository is public, so its workflow artifacts and
  logs can be seen by any signed-in GitHub user. Each backup is encrypted with the backup **public**
  key (`.github/backup/backup-public-key.asc`). Only the matching **private** key, which is never in
  GitHub, can decrypt it. Key fingerprint: `0A81 CD32 ACCF 484D 7B15 56B3 3A28 AAB2 B431 4CAE`.
- **Nothing readable in the logs.** The job prints no data, no row counts and never the connection
  string. Database errors are reported by type only, with values removed.
- **Unencrypted files are destroyed** (`shred`) when the job ends, whatever happened.
- **Restore-tested every night.** Each backup is restored into a fresh local Supabase database and
  every table's row count is compared with production. If anything does not match, the run fails
  and nothing is kept for that night.

## One-time setup (owner)

1. **Store the private key safely.** It was saved to `C:\Users\keten\tubify-db-backup-PRIVATE-KEY.asc`.
   Put it in your password manager (as an attachment or secure note) **and** keep a second copy
   offline (e.g. a USB drive). Then delete the file from the computer. **Without this key no backup
   can ever be read; anyone with it can read every backup.**
2. **Add the database connection string to GitHub.** Repository → Settings → Secrets and variables
   → Actions → New repository secret:
   - Name: `PRODUCTION_DATABASE_URL`
   - Value: the production **Session pooler** connection string from Supabase (Project Settings →
     Database → Connect → Session pooler, port 5432), with the database password filled in.
3. **Run the first backup now:** Actions → Database backup → Run workflow. It takes several
   minutes. A green run means the backup was taken, restored and verified, and encrypted.

## Monitoring

- GitHub emails you when a scheduled run fails. A failed night keeps no backup, so look into it the
  same day (Actions → Database backup → the failed run).
- GitHub pauses scheduled workflows in a public repository after **60 days without commits**. If
  that happens, re-enable it under Actions → Database backup.
- The list of backups is under Actions → Database backup → any run → Artifacts.

## Restoring

Restore into a **new, empty Supabase project**, not over production. Check the copy, then switch
the app to it (Vercel environment variables), or copy back only the data you need.

You need: the private key, `gpg`, and `psql` 17 (or Docker). On Windows, use WSL or Git Bash with
the PostgreSQL 17 client installed.

1. Download the backup: Actions → Database backup → the run → Artifacts → `tubify-db-…`. Unzip it:
   it holds `tubify-db-<date>.tar.gz.gpg` and its `.sha256`.
2. Import the private key once: `gpg --import tubify-db-backup-PRIVATE-KEY.asc`
3. To look inside, or take one table's data, without restoring:

   ```bash
   bash scripts/db-backup/restore.sh tubify-db-<date>.tar.gz.gpg --extract-only ./restore-work
   ```

   This writes **unencrypted** files: delete the folder when you are done.

4. To restore everything into the new project:

   ```bash
   TARGET_DATABASE_URL='postgresql://…new project…' \
     bash scripts/db-backup/restore.sh tubify-db-<date>.tar.gz.gpg
   ```

   It checks the download and every file against their checksums, refuses a database that already
   has users (pass `--allow-nonempty` only if you are certain), and restores in one transaction: it
   either completes or changes nothing.

5. Compare the restored row counts with `row-counts.tsv` from step 3.

## Supabase's own backups

Supabase also backs up projects on paid plans (daily, and point-in-time recovery as an add-on),
restorable from the Supabase dashboard. The backups here are independent of Supabase: they are kept
in a different place, under your own key, and are tested every night.
