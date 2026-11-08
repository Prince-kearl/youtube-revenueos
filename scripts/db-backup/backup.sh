#!/usr/bin/env bash
# Nightly production database backup (.github/workflows/database-backup.yml). See
# docs/DATABASE_BACKUPS.md.
#
#   1. Dumps the database with the Supabase CLI — roles.sql, schema.sql, data.sql: the set Supabase
#      documents for restoring into a new project — and, best effort, a complete pg_dump of the
#      public, auth and storage schemas (full.dump).
#   2. Proves the dump restores: loads it into a fresh local Supabase database and checks that every
#      table has the same number of rows as production had while the dump was taken.
#   3. Encrypts the result with the backup PUBLIC key (.github/backup/backup-public-key.asc). Only
#      the matching private key, kept offline by the owner, can decrypt it.
#   4. Deletes every unencrypted file. Only the encrypted archive leaves this script.
#
# THIS REPOSITORY IS PUBLIC, and so are its workflow logs: nothing here may print the connection
# string, any data, or even row counts. Database errors are reported by their type only.
#
# usage: DATABASE_URL=... bash scripts/db-backup/backup.sh <output dir>
set -euo pipefail
umask 077

OUT_DIR="${1:?usage: backup.sh <output dir>}"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "::error::The PRODUCTION_DATABASE_URL secret is not set. See docs/DATABASE_BACKUPS.md."
  exit 1
fi
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLIC_KEY="$REPO_ROOT/.github/backup/backup-public-key.asc"
PG_IMAGE="postgres:17"
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
NAME="tubify-db-$STAMP"
WORK="$(mktemp -d)"
VERIFY_DIR="$(mktemp -d)"
mkdir -p "$OUT_DIR" "$WORK/$NAME/supabase"
DUMP="$WORK/$NAME"

cleanup() {
  # Unencrypted data never outlives the script, whatever happened.
  find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true
  rm -rf "$WORK"
  if [ -f "$VERIFY_DIR/supabase/config.toml" ]; then
    (cd "$VERIFY_DIR" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$VERIFY_DIR"
}
trap cleanup EXIT

step() { echo "==> $*"; }

# psql / pg_dump 17 from the official image (the database is Postgres 17). The connection string is
# passed in the environment, never on a command line.
pg() {
  docker run --rm --network host -e DATABASE_URL -e PGCONNECT_TIMEOUT=30 \
    -v "$WORK:/work" "$PG_IMAGE" "$@"
}

# Exact row counts of every table in public, and of auth.users: "schema.table|rows" lines.
COUNT_SQL="select table_schema || '.' || table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_type = 'BASE TABLE' and (table_schema = 'public' or (table_schema = 'auth' and table_name = 'users'))
  order by 1"
counts() { # $1 = connection string variable to use (DATABASE_URL or LOCAL)
  if [ "$1" = "LOCAL" ]; then
    docker run --rm --network host "$PG_IMAGE" \
      psql "$LOCAL_DB" -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -c "$COUNT_SQL"
  else
    pg sh -c 'psql "$DATABASE_URL" -X -q -A -t -F "|" -v ON_ERROR_STOP=1 -c "$0"' "$COUNT_SQL"
  fi
}

# sanitize, is_public_key_encrypted, compare_counts
# shellcheck source=scripts/db-backup/lib.sh
. "$REPO_ROOT/scripts/db-backup/lib.sh"

# ---- 1. dump ----------------------------------------------------------------------------------
step "Counting rows before the dump"
counts DATABASE_URL > "$WORK/counts-before.tsv"

step "Dumping roles, schema and data (Supabase CLI)"
supabase db dump --db-url "$DATABASE_URL" -f "$DUMP/supabase/roles.sql" --role-only >/dev/null 2>"$WORK/err.txt" \
  || { echo "::error::Role dump failed: $(sanitize "$WORK/err.txt")"; exit 1; }
supabase db dump --db-url "$DATABASE_URL" -f "$DUMP/supabase/schema.sql" >/dev/null 2>"$WORK/err.txt" \
  || { echo "::error::Schema dump failed: $(sanitize "$WORK/err.txt")"; exit 1; }
supabase db dump --db-url "$DATABASE_URL" -f "$DUMP/supabase/data.sql" --use-copy --data-only >/dev/null 2>"$WORK/err.txt" \
  || { echo "::error::Data dump failed: $(sanitize "$WORK/err.txt")"; exit 1; }

step "Counting rows after the dump"
counts DATABASE_URL > "$WORK/counts-after.tsv"

step "Full pg_dump of public, auth and storage (best effort)"
if pg sh -c 'pg_dump "$DATABASE_URL" --format=custom --schema=public --schema=auth --schema=storage --file=/work/'"$NAME"'/full.dump' \
  >/dev/null 2>"$WORK/err.txt"; then
  echo "    full dump: done"
else
  rm -f "$DUMP/full.dump"
  echo "::warning::The full pg_dump did not complete ($(sanitize "$WORK/err.txt")). The Supabase CLI dump above is complete and is the one restored below."
fi

# The dump must contain what matters.
for f in roles.sql schema.sql data.sql; do
  [ -s "$DUMP/supabase/$f" ] || [ "$f" = "roles.sql" ] || { echo "::error::$f is empty"; exit 1; }
done
grep -qE 'CREATE TABLE( IF NOT EXISTS)? "?public"?\."?profiles"?' "$DUMP/supabase/schema.sql" \
  || { echo "::error::schema.sql has no public.profiles table"; exit 1; }
grep -qE '^COPY "?public"?\."?profiles"?' "$DUMP/supabase/data.sql" \
  || { echo "::error::data.sql has no public.profiles data"; exit 1; }

# ---- 2. prove it restores ---------------------------------------------------------------------
step "Starting a fresh local Supabase database"
(
  cd "$VERIFY_DIR"
  # No terminal here: any question init would ask reads end-of-input and takes its default.
  supabase init </dev/null >/dev/null 2>&1 || true
  [ -f supabase/config.toml ] || { echo "::error::supabase init did not create a project"; exit 1; }
  sed -i 's/^major_version = .*/major_version = 17/' supabase/config.toml
  supabase db start >/dev/null 2>"$WORK/err.txt" \
    || { echo "::error::Could not start the local database: $(sanitize "$WORK/err.txt")"; exit 1; }
)

step "Restoring the dump into it"
docker run --rm --network host -v "$DUMP/supabase:/dump:ro" "$PG_IMAGE" \
  psql "$LOCAL_DB" -X -q --single-transaction -v ON_ERROR_STOP=1 \
  --file /dump/roles.sql --file /dump/schema.sql \
  --command 'SET session_replication_role = replica' --file /dump/data.sql \
  >/dev/null 2>"$WORK/err.txt" \
  || { echo "::error::The backup did not restore: $(sanitize "$WORK/err.txt")"; exit 1; }

step "Comparing row counts with production"
counts LOCAL > "$WORK/counts-restored.tsv"
# Every table production had must be restored with a row count between the counts taken before and
# after the dump (rows can be added while it runs). Only table names are ever printed.
mismatches="$(compare_counts "$WORK/counts-before.tsv" "$WORK/counts-after.tsv" "$WORK/counts-restored.tsv")"
tables="$(wc -l < "$WORK/counts-before.tsv" | tr -d ' ')"
if [ -n "$mismatches" ]; then
  echo "::error::The restored copy does not match production for: $(echo "$mismatches" | tr '\n' ' ')"
  exit 1
fi
echo "    restore verified: all $tables tables match production"
cp "$WORK/counts-after.tsv" "$DUMP/row-counts.tsv"

# ---- 3. encrypt -------------------------------------------------------------------------------
step "Packing and encrypting"
{
  echo "backup: $NAME"
  echo "taken (UTC): $STAMP"
  echo "postgres image: $PG_IMAGE"
  echo "supabase cli: $(supabase --version 2>/dev/null | head -1)"
  echo "restore verified: yes ($tables tables)"
  echo "files:"
  (cd "$DUMP" && find . -type f ! -name MANIFEST.txt | sort | xargs sha256sum)
} > "$DUMP/MANIFEST.txt"
tar -C "$WORK" -czf "$WORK/$NAME.tar.gz" "$NAME"
gpg --batch --yes --quiet --trust-model always --recipient-file "$PUBLIC_KEY" \
  --output "$OUT_DIR/$NAME.tar.gz.gpg" --encrypt "$WORK/$NAME.tar.gz"
# The archive must really be public-key encrypted before anything is uploaded.
is_public_key_encrypted "$OUT_DIR/$NAME.tar.gz.gpg" \
  || { echo "::error::Encryption check failed"; rm -f "$OUT_DIR/$NAME.tar.gz.gpg"; exit 1; }
(cd "$OUT_DIR" && sha256sum "$NAME.tar.gz.gpg" > "$NAME.tar.gz.gpg.sha256")
echo "    encrypted: $NAME.tar.gz.gpg ($(du -h "$OUT_DIR/$NAME.tar.gz.gpg" | cut -f1))"
echo "backup_name=$NAME" >> "${GITHUB_OUTPUT:-/dev/null}"
step "Done. Unencrypted files are removed on exit."
