#!/usr/bin/env bash
# Tests the database backup's packing, encryption and restore tooling (scripts/db-backup) without a
# database or Docker: a throwaway key pair, a fake dump, then restore.sh and the helpers in lib.sh.
# Run by tests/database-backup.test.ts. Prints PASS/FAIL lines; exits non-zero on any failure.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO/scripts/db-backup/lib.sh"
T="$(mktemp -d /tmp/dbbt.XXXXXX)"
pass=0
fail=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1"; fail=$((fail + 1)); fi; }
finish() {
  for h in "$T/k" "$T/e"; do GNUPGHOME="$h" gpgconf --kill all >/dev/null 2>&1 || true; done
  rm -rf "$T"
}
trap finish EXIT

# A throwaway key pair (the real private key is never needed here).
mkdir -p "$T/k" "$T/e"
chmod 700 "$T/k" "$T/e"
GNUPGHOME="$T/k" gpg --batch --quiet --pinentry-mode loopback --passphrase '' \
  --quick-gen-key "backup self-test <test@example.invalid>" future-default default never >/dev/null 2>&1
GNUPGHOME="$T/k" gpg --armor --export > "$T/public.asc" 2>/dev/null
check "a throwaway key pair was made" "[ -s '$T/public.asc' ]"

# The repository's key is a public key only.
check "the repository holds the backup PUBLIC key only" \
  "grep -q 'BEGIN PGP PUBLIC KEY BLOCK' '$REPO/.github/backup/backup-public-key.asc' && ! grep -q PRIVATE '$REPO/.github/backup/backup-public-key.asc'"
check "the repository's public key can encrypt" \
  "echo x | GNUPGHOME='$T/e' gpg --batch --quiet --trust-model always --recipient-file '$REPO/.github/backup/backup-public-key.asc' --encrypt >/dev/null 2>&1"

# A fake dump, packed exactly as backup.sh packs it.
NAME="tubify-db-2026-01-01T000000Z"
W="$T/w"
D="$W/$NAME"
mkdir -p "$D/supabase" "$T/out"
printf -- '-- roles\n' > "$D/supabase/roles.sql"
printf 'CREATE TABLE IF NOT EXISTS "public"."profiles" (id uuid);\n' > "$D/supabase/schema.sql"
printf 'COPY "public"."profiles" ("id") FROM stdin;\n\\.\n' > "$D/supabase/data.sql"
printf 'public.profiles|5\n' > "$D/row-counts.tsv"
{
  echo "backup: $NAME"
  echo "taken (UTC): test"
  echo "postgres image: postgres:17"
  echo "supabase cli: test"
  echo "restore verified: yes (1 tables)"
  echo "files:"
  (cd "$D" && find . -type f ! -name MANIFEST.txt | sort | xargs sha256sum)
} > "$D/MANIFEST.txt"
tar -C "$W" -czf "$W/$NAME.tar.gz" "$NAME"
enc() { GNUPGHOME="$T/e" gpg --batch --yes --quiet --trust-model always --recipient-file "$T/public.asc" --output "$2" --encrypt "$1" 2>/dev/null; }
enc "$W/$NAME.tar.gz" "$T/out/$NAME.tar.gz.gpg"
(cd "$T/out" && sha256sum "$NAME.tar.gz.gpg" > "$NAME.tar.gz.gpg.sha256")

check "the schema check matches the Supabase CLI's CREATE TABLE" \
  "grep -qE 'CREATE TABLE( IF NOT EXISTS)? \"?public\"?\.\"?profiles\"?' '$D/supabase/schema.sql'"
check "the data check matches its COPY" "grep -qE '^COPY \"?public\"?\.\"?profiles\"?' '$D/supabase/data.sql'"
check "an encrypted backup is recognised as public-key encrypted" "GNUPGHOME='$T/e' is_public_key_encrypted '$T/out/$NAME.tar.gz.gpg'"
check "an unencrypted archive is not" "! GNUPGHOME='$T/e' is_public_key_encrypted '$W/$NAME.tar.gz'"
check "no plaintext SQL is visible in the encrypted file" "! grep -aq 'CREATE TABLE' '$T/out/$NAME.tar.gz.gpg'"

# restore.sh: decrypt, verify, unpack.
out="$(GNUPGHOME="$T/k" bash "$REPO/scripts/db-backup/restore.sh" "$T/out/$NAME.tar.gz.gpg" --extract-only "$T/x" 2>&1)"
rc=$?
check "restore.sh decrypts, verifies and unpacks" "[ $rc -eq 0 ] && cmp -s '$T/x/$NAME/supabase/data.sql' '$D/supabase/data.sql'"
check "it checks the download and every file" "echo \"\$out\" | grep -q 'checksum: ok' && echo \"\$out\" | grep -q 'contents: ok'"

out="$(GNUPGHOME="$T/e" bash "$REPO/scripts/db-backup/restore.sh" "$T/out/$NAME.tar.gz.gpg" --extract-only "$T/x2" 2>&1)"
rc=$?
check "without the private key nothing is decrypted" "[ $rc -ne 0 ] && echo \"\$out\" | grep -q 'Could not decrypt' && [ ! -e '$T/x2' ]"

cp "$T/out/$NAME.tar.gz.gpg" "$T/damaged.tar.gz.gpg"
sed "s/$NAME.tar.gz.gpg/damaged.tar.gz.gpg/" "$T/out/$NAME.tar.gz.gpg.sha256" > "$T/damaged.tar.gz.gpg.sha256"
printf 'x' >> "$T/damaged.tar.gz.gpg"
out="$(GNUPGHOME="$T/k" bash "$REPO/scripts/db-backup/restore.sh" "$T/damaged.tar.gz.gpg" --extract-only "$T/x3" 2>&1)"
rc=$?
check "a damaged download is refused" "[ $rc -ne 0 ] && echo \"\$out\" | grep -q 'does not match its checksum'"

echo "changed" >> "$D/supabase/data.sql"
tar -C "$W" -czf "$W/t.tar.gz" "$NAME"
enc "$W/t.tar.gz" "$T/tampered.tar.gz.gpg"
out="$(GNUPGHOME="$T/k" bash "$REPO/scripts/db-backup/restore.sh" "$T/tampered.tar.gz.gpg" --extract-only "$T/x4" 2>&1)"
rc=$?
check "a file changed after the backup was taken is refused" "[ $rc -ne 0 ] && echo \"\$out\" | grep -q 'does not match its recorded checksum'"

out="$(GNUPGHOME="$T/k" bash "$REPO/scripts/db-backup/restore.sh" "$T/out/$NAME.tar.gz.gpg" 2>&1)"
rc=$?
check "a restore without a target database is refused" "[ $rc -ne 0 ] && echo \"\$out\" | grep -q 'TARGET_DATABASE_URL'"

# The restore test's row-count comparison.
printf 'public.a|10\npublic.b|5\nauth.users|3\n' > "$T/before"
printf 'public.a|12\npublic.b|5\nauth.users|3\n' > "$T/after"
printf 'public.a|11\npublic.b|5\nauth.users|3\n' > "$T/ok"
printf 'public.a|11\npublic.b|4\n' > "$T/bad"
check "restored counts within the before/after range pass" "[ -z \"\$(compare_counts '$T/before' '$T/after' '$T/ok')\" ]"
check "a short table and a missing table are reported, by name only" \
  "[ \"\$(compare_counts '$T/before' '$T/after' '$T/bad' | sort | tr '\n' ' ')\" = 'auth.users public.b ' ]"

# Errors reach the public log without values.
printf 'psql:/dump/data.sql:42: ERROR:  duplicate key value violates unique constraint "profiles_email_key"\nDETAIL:  Key (email)=(jane@example.com) already exists.\n' > "$T/err"
s="$(sanitize "$T/err")"
check "a database error is logged without its values" \
  "echo \"\$s\" | grep -q 'duplicate key' && ! echo \"\$s\" | grep -qE 'jane|example\.com|profiles_email_key'"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
