import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The nightly production database backup (.github/workflows/database-backup.yml,
// scripts/db-backup). The repository is PUBLIC — its workflow logs and artifacts are visible to any
// signed-in GitHub user — so these check that the backup is encrypted before it leaves the job,
// that nothing prints the connection string or data, and that the secret reaches only the backup
// step. tests/db-backup/self-test.sh exercises the packing, encryption and restore tooling.

const workflow = readFileSync(".github/workflows/database-backup.yml", "utf8").replace(
  /\r\n/g,
  "\n",
);
const backup = readFileSync("scripts/db-backup/backup.sh", "utf8").replace(/\r\n/g, "\n");
const restore = readFileSync("scripts/db-backup/restore.sh", "utf8").replace(/\r\n/g, "\n");

test("the backup runs nightly and on demand only — never for pull requests or pushes", () => {
  const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
  assert.match(on, /schedule:\n\s+- cron: "30 2 \* \* \*"/);
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /pull_request|push:|workflow_run|issue/);
  assert.match(workflow, /\npermissions:\n {2}contents: read\n/);
  assert.match(workflow, /if: github\.repository == 'Prince-kearl\/youtube-revenueos'/);
});

test("the database secret reaches only the backup step, as an environment variable", () => {
  const uses = workflow.match(/secrets\.[A-Z_]+/g) ?? [];
  assert.deepEqual(uses, ["secrets.PRODUCTION_DATABASE_URL"]);
  assert.match(
    workflow,
    /env:\n\s+DATABASE_URL: \$\{\{ secrets\.PRODUCTION_DATABASE_URL \}\}\n\s+run: bash scripts\/db-backup\/backup\.sh/,
  );
});

test("only the encrypted archive and its checksum are uploaded, kept 90 days", () => {
  const upload = workflow.slice(workflow.indexOf("actions/upload-artifact"));
  const paths = upload.slice(upload.indexOf("path: |"), upload.indexOf("retention-days")).trim();
  for (const line of paths.split("\n").slice(1))
    assert.match(line.trim(), /\.tar\.gz\.gpg(\.sha256)?$/, line);
  assert.match(upload, /retention-days: 90/);
  assert.match(upload, /if-no-files-found: error/);
});

test("backup.sh: strict, private files, encrypted with the public key, plaintext destroyed", () => {
  assert.match(backup, /^set -euo pipefail$/m);
  assert.match(backup, /^umask 077$/m);
  assert.doesNotMatch(backup, /set -x|set -o xtrace/);
  // the connection string is never printed or put on a command line it is not needed on
  assert.doesNotMatch(backup, /echo[^\n]*\$\{?DATABASE_URL/);
  assert.match(backup, /-e DATABASE_URL/);
  assert.match(backup, /--recipient-file "\$PUBLIC_KEY"/);
  assert.match(backup, /PUBLIC_KEY="\$REPO_ROOT\/\.github\/backup\/backup-public-key\.asc"/);
  assert.match(backup, /is_public_key_encrypted "\$OUT_DIR\/\$NAME\.tar\.gz\.gpg"/);
  // the only file written to the output folder is the encrypted archive (and its checksum)
  for (const m of backup.matchAll(/\$OUT_DIR\/[^"\s)]+/g))
    assert.match(m[0], /\.tar\.gz\.gpg/, m[0]);
  assert.match(backup, /trap cleanup EXIT/);
  assert.match(backup, /shred -u/);
});

test("backup.sh proves every backup restores before keeping it", () => {
  const restoreAt = backup.indexOf("Restoring the dump into it");
  const compareAt = backup.indexOf('compare_counts "$WORK/counts-before.tsv"');
  const encryptAt = backup.indexOf("--encrypt");
  assert.ok(restoreAt > 0 && compareAt > restoreAt && encryptAt > compareAt);
  assert.match(backup, /--single-transaction -v ON_ERROR_STOP=1/);
  assert.match(backup, /SET session_replication_role = replica/);
  // nothing the restore or the counts print reaches the log: output discarded, errors sanitized
  assert.match(backup, /--file \/dump\/data\.sql \\\n\s+>\/dev\/null 2>"\$WORK\/err\.txt"/);
  assert.doesNotMatch(backup, /cat "\$WORK\/counts|echo "\$mismatches"\s*$/m);
});

test("restore.sh refuses a database that already has data, and restores all-or-nothing", () => {
  assert.match(restore, /already has \$existing profiles/);
  assert.match(restore, /--allow-nonempty/);
  assert.match(restore, /--single-transaction -v ON_ERROR_STOP=1/);
  assert.match(restore, /sha256sum -c/);
});

const tool = (name: string) =>
  spawnSync(name, ["--version"], { encoding: "utf8", shell: false }).status === 0;

test(
  "the packing, encryption and restore tooling works end to end",
  { skip: !(tool("bash") && tool("gpg")) && "bash and gpg are needed", timeout: 120_000 },
  () => {
    const run = spawnSync("bash", ["tests/db-backup/self-test.sh"], {
      encoding: "utf8",
      timeout: 110_000,
    });
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 0, output);
    assert.match(output, /0 failed/);
    assert.doesNotMatch(output, /^FAIL/m, output);
  },
);
