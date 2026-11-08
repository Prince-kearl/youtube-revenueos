#!/usr/bin/env bash
# Restores a backup made by backup.sh. Step by step in docs/DATABASE_BACKUPS.md.
#
#   Decrypt and unpack only (to look inside, or to take one table's data):
#     bash scripts/db-backup/restore.sh <backup.tar.gz.gpg> --extract-only <folder>
#
#   Restore into a database (normally a NEW, empty Supabase project):
#     TARGET_DATABASE_URL='postgresql://...' bash scripts/db-backup/restore.sh <backup.tar.gz.gpg>
#
# Needs: gpg with the backup PRIVATE key imported (gpg --import tubify-db-backup-PRIVATE-KEY.asc),
# and psql 17 (or Docker, which is used when psql is not installed).
#
# Safety: it refuses a database that already has profiles (so it is never run over a live database
# by mistake) unless --allow-nonempty is given, and it restores in ONE transaction: it either
# completes or changes nothing. Unencrypted files are deleted when it ends (unless --extract-only).
set -euo pipefail
umask 077

FILE="${1:?usage: restore.sh <backup.tar.gz.gpg> [--extract-only <folder> | --allow-nonempty]}"
MODE="restore"
EXTRACT_TO=""
ALLOW_NONEMPTY=0
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --extract-only) MODE="extract"; EXTRACT_TO="${2:?--extract-only needs a folder}"; shift 2 ;;
    --allow-nonempty) ALLOW_NONEMPTY=1; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 1; }

# The download's checksum, when it sits next to the file.
if [ -f "$FILE.sha256" ]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null) \
    || { echo "The backup file does not match its checksum: it is damaged or incomplete."; exit 1; }
  echo "checksum: ok"
fi

WORK="$(mktemp -d)"
cleanup() {
  if [ "$MODE" = "restore" ]; then
    find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

echo "decrypting…"
gpg --batch --quiet --decrypt --output "$WORK/backup.tar.gz" "$FILE" \
  || { echo "Could not decrypt. Is the backup private key imported (gpg --import <key file>)?"; exit 1; }
tar -C "$WORK" -xzf "$WORK/backup.tar.gz"
rm -f "$WORK/backup.tar.gz"
DIR="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'tubify-db-*' | head -1)"
[ -n "$DIR" ] || { echo "Unexpected archive contents."; exit 1; }

# Every file must match the checksum recorded when the backup was taken.
(cd "$DIR" && sed -n '/^files:$/,$p' MANIFEST.txt | tail -n +2 | sha256sum -c --quiet -) \
  || { echo "A file in the backup does not match its recorded checksum."; exit 1; }
echo "contents: ok"
sed -n '1,5p' "$DIR/MANIFEST.txt"

if [ "$MODE" = "extract" ]; then
  mkdir -p "$EXTRACT_TO"
  mv "$DIR" "$EXTRACT_TO/"
  rm -rf "$WORK"
  echo "Unpacked to $EXTRACT_TO/$(basename "$DIR") — it is UNENCRYPTED: delete it when you are done."
  exit 0
fi

: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the database to restore into}"
export TARGET_DATABASE_URL
psql_run() {
  if command -v psql >/dev/null 2>&1; then
    psql "$TARGET_DATABASE_URL" "$@"
  else
    docker run --rm -i --network host -e TARGET_DATABASE_URL -v "$DIR/supabase:/dump:ro" postgres:17 \
      sh -c 'psql "$TARGET_DATABASE_URL" "$@"' psql "$@"
  fi
}
SQL_DIR="$DIR/supabase"
command -v psql >/dev/null 2>&1 || SQL_DIR="/dump"

existing="$(psql_run -X -q -A -t -c "select case when to_regclass('public.profiles') is null then 0 else (select count(*) from public.profiles) end" 2>/dev/null || echo "?")"
if [ "$existing" = "?" ]; then echo "Could not connect to the target database."; exit 1; fi
if [ "$existing" != "0" ] && [ "$ALLOW_NONEMPTY" != "1" ]; then
  echo "STOP: the target database already has $existing profiles. Restore into a NEW, empty project,"
  echo "or pass --allow-nonempty if you are certain (see docs/DATABASE_BACKUPS.md)."
  exit 1
fi

echo "restoring (one transaction: all or nothing)…"
psql_run -X -q --single-transaction -v ON_ERROR_STOP=1 \
  --file "$SQL_DIR/roles.sql" --file "$SQL_DIR/schema.sql" \
  --command 'SET session_replication_role = replica' --file "$SQL_DIR/data.sql" >/dev/null
echo "restored. Row counts at backup time are in row-counts.tsv inside the backup (--extract-only)."
