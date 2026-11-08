# Helpers for backup.sh, kept apart so they can be tested on their own
# (tests/database-backup.test.ts). Sourced, not run.

# A failed command's error, reduced to its type: anything in parentheses or double quotes (keys,
# values, constraint names) is removed so no data reaches the public workflow log.
sanitize() {
  sed -E 's/\([^)]*\)/(…)/g; s/"[^"]*"/"…"/g' "$1" | grep -m1 -E "ERROR|error|FATAL" | cut -c1-160 || true
}

# Whether $1 is encrypted to a public key (an OpenPGP "pubkey enc packet"). Without the private key
# gpg lists the packets but exits non-zero, so its output is read first and its status ignored.
is_public_key_encrypted() {
  local packets
  packets="$(gpg --batch --list-packets "$1" 2>/dev/null || true)"
  grep -q "pubkey enc packet" <<<"$packets"
}

# Tables whose restored row count is wrong. Each file has "schema.table|rows" lines: $1 production
# before the dump, $2 production after it, $3 the restored copy. A table passes when its restored
# count lies between the before and after counts (rows can be added while the dump runs). Prints
# table names only, one per line — never a count.
compare_counts() {
  awk -F'|' '
    FILENAME == ARGV[1] { before[$1] = $2; next }
    FILENAME == ARGV[2] { after[$1] = $2; next }
    { restored[$1] = $2 }
    END {
      for (t in before) {
        lo = before[t] + 0; hi = (t in after) ? after[t] + 0 : lo
        if (lo > hi) { x = lo; lo = hi; hi = x }
        if (!(t in restored) || restored[t] + 0 < lo || restored[t] + 0 > hi) print t
      }
    }' "$1" "$2" "$3"
}
