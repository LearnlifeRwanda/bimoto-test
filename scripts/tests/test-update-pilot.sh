#!/bin/sh
# =====================================================================
#  Tests for scripts/update-pilot.command.
#
#  Runs on any Linux/macOS box with node — no real Mac, pnpm, prisma
#  or database needed: pnpm is replaced by a shim on PATH, postgres by
#  a bare TCP listener, and the server by a tiny node health endpoint.
#
#  Run:  sh scripts/tests/test-update-pilot.sh
# =====================================================================

set -u

REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
UPDATER=$REPO_ROOT/scripts/update-pilot.command

WORK=${TMPDIR:-/tmp}/bimoto-updater-tests.$$
rm -rf "$WORK"
mkdir -p "$WORK"

PASS=0
FAIL=0
CLEANUP_PIDS=''

fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL: %s\n' "$1"
}

pass() {
  PASS=$((PASS + 1))
  printf 'ok:   %s\n' "$1"
}

# assert_grep NAME PATTERN FILE
assert_grep() {
  if grep -q "$2" "$3" 2>/dev/null; then pass "$1"; else
    fail "$1 (pattern not found: $2)"
    sed 's/^/      | /' "$3" 2>/dev/null | tail -25
  fi
}

assert_not_grep() {
  if grep -q "$2" "$3" 2>/dev/null; then
    fail "$1 (pattern unexpectedly found: $2)"
  else pass "$1"; fi
}

assert_exit() { # NAME EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected exit $2, got $3)"; fi
}

assert_file() { # NAME PATH
  if [ -f "$2" ]; then pass "$1"; else fail "$1 (missing: $2)"; fi
}

assert_no_file() { # NAME PATH
  if [ -f "$2" ]; then fail "$1 (unexpectedly present: $2)"; else pass "$1"; fi
}

assert_same() { # NAME FILE_A FILE_B
  if cmp -s "$2" "$3"; then pass "$1"; else fail "$1 (files differ)"; fi
}

# count_dirs PREFIX / newest_dir PREFIX — glob-based, no ls parsing.
count_dirs() {
  _n=0
  for _d in "$1"*; do [ -d "$_d" ] && _n=$((_n + 1)); done
  printf '%s' "$_n"
}

newest_dir() {
  _nd=''
  for _d in "$1"*; do [ -d "$_d" ] && _nd=$_d; done
  printf '%s' "$_nd"
}

# shellcheck disable=SC2317  # invoked via trap
cleanup() {
  for _p in $CLEANUP_PIDS; do kill "$_p" 2>/dev/null; done
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# ----------------------------------------------------------- fixtures

DB_PORT=59432
APP_PORT=53901

# A minimal but "complete" bimoto tree as the updater defines complete.
make_tree() {
  mkdir -p "$1/packages/server/prisma/migrations/20260729000000_payout_idempotency_one_inflight_batch" \
    "$1/packages/shared" "$1/scripts"
  printf '{\n  "name": "bimoto",\n  "scripts": { "db:migrate:deploy": "unused-by-shim" }\n}\n' >"$1/package.json"
  printf 'lockfileVersion: 9\n' >"$1/pnpm-lock.yaml"
  printf 'PORT=3000\nDATABASE_URL="postgresql://x@localhost:5432/db"\nJWT_SECRET="x"\n' >"$1/.env.example"
  printf '{ "name": "@bimoto/server", "engines": { "node": ">=18.0.0" } }\n' >"$1/packages/server/package.json"
  printf 'datasource db {}\n' >"$1/packages/server/prisma/schema.prisma"
  printf '{ "name": "@bimoto/shared" }\n' >"$1/packages/shared/package.json"
  cp "$UPDATER" "$1/scripts/update-pilot.command"
}

# The live install: a tree plus a real-looking settings file carrying a
# canary secret that must never appear in any output, plus a marker
# proving which generation of the install we are looking at.
make_install() {
  make_tree "$1"
  printf 'PORT=%s\nDATABASE_URL="postgresql://user:pw@127.0.0.1:%s/bimoto"\nJWT_SECRET="CANARY-secret-o9K2mQ"\n' \
    "$APP_PORT" "$DB_PORT" >"$1/packages/server/.env"
  printf 'OLD\n' >"$1/OLD_MARKER"
}

# pnpm shim — the updater must work against these exact invocations.
# BIMOTO_TEST_FAIL_STEP selects a step to fail, for rollback tests.
make_shim() {
  mkdir -p "$WORK/shim"
  cat >"$WORK/shim/pnpm" <<'SHIM'
#!/bin/sh
case "$*" in
  "install --frozen-lockfile")
    [ "${BIMOTO_TEST_FAIL_STEP:-}" = install ] && { echo "ERR_PNPM_INSTALL"; exit 1; }
    mkdir -p node_modules && echo "shim: installed" && exit 0 ;;
  "--filter @bimoto/shared build")
    [ "${BIMOTO_TEST_FAIL_STEP:-}" = shared ] && exit 1
    mkdir -p packages/shared/dist && echo "shim: shared built" && exit 0 ;;
  "exec prisma generate")
    [ "${BIMOTO_TEST_FAIL_STEP:-}" = generate ] && { echo "shim: generate exploded"; exit 1; }
    mkdir -p node_modules/@prisma/client
    echo "module.exports = {};" > node_modules/@prisma/client/index.js
    echo "shim: prisma client generated" && exit 0 ;;
  "run db:migrate:deploy")
    [ "${BIMOTO_TEST_FAIL_STEP:-}" = migrate ] && { echo "Error: P3018 migration failed to apply"; exit 1; }
    echo "Applying migration \`20260729000000_payout_idempotency_one_inflight_batch\`"
    echo "The following migration(s) have been applied:" && exit 0 ;;
  "run documents:encrypt")
    [ "${BIMOTO_TEST_FAIL_STEP:-}" = documents ] && {
      echo "[DOC-GUARD] REFUSING TO SWEEP — 1 file(s) could not be classified"; exit 1; }
    echo "[DOC-GUARD] done — 0 encrypted, 0 already encrypted." && exit 0 ;;
  "--version") echo "9.15.0-shim" && exit 0 ;;
  *) echo "pnpm shim: unexpected invocation: $*" >&2; exit 99 ;;
esac
SHIM
  chmod +x "$WORK/shim/pnpm"
}

# Fake postgres: anything accepting TCP satisfies the reachability check.
start_db() {
  node -e "require('net').createServer().listen($DB_PORT,'127.0.0.1');setInterval(()=>{},1e9)" \
    >/dev/null 2>&1 &
  CLEANUP_PIDS="$CLEANUP_PIDS $!"
  sleep 1
}

# Fake server health endpoint. $1 = uptime, $2 = dbConnected.
start_health() {
  node -e "
    const http = require('http');
    http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', dbConnected: $2, uptime: $1 }));
    }).listen($APP_PORT, '127.0.0.1');
    setInterval(() => {}, 1e9);
  " >/dev/null 2>&1 &
  HEALTH_PID=$!
  CLEANUP_PIDS="$CLEANUP_PIDS $HEALTH_PID"
  sleep 1
}

# run_updater HOME_DIR TREE_DIR [ARG] — captured output in $OUT,
# exit status in $STATUS.
run_updater() {
  OUT=$WORK/out.$PASS.$FAIL.txt
  HOME="$WORK/fakehome" \
  PATH="$WORK/shim:$PATH" \
  BIMOTO_HOME="$1" \
  BIMOTO_UPDATER_LOG_DIR="$WORK/logs" \
  BIMOTO_UPDATER_ASSUME_YES=1 \
  BIMOTO_VERIFY_TIMEOUT=${TEST_VERIFY_TIMEOUT:-6} \
  BIMOTO_VERIFY_POLL=1 \
  BIMOTO_TEST_FAIL_STEP=${TEST_FAIL_STEP:-} \
    sh "$2/scripts/update-pilot.command" "${3:-}" >"$OUT" 2>&1
  STATUS=$?
}

mkdir -p "$WORK/fakehome" "$WORK/logs"
make_shim
make_tree "$WORK/newtree"

# ============================================== structural safety guard

# The destructive, interactive "prisma migrate dev" must be unreachable:
# the string must not exist in the updater in any spelling, and the only
# migration invocation must be the hard-coded deploy script.
assert_not_grep 'guard: "migrate dev" absent' 'migrate[[:space:]]\{1,\}dev' "$UPDATER"
assert_not_grep 'guard: "db:migrate:dev" absent' 'db:migrate:dev[^:]' "$UPDATER"
_migrate_calls=$(grep -c 'db:migrate:deploy' "$UPDATER")
if [ "$_migrate_calls" -ge 1 ] \
  && [ "$(grep -c 'pnpm run db:migrate:deploy' "$UPDATER")" = 1 ]; then
  pass 'guard: exactly one migration invocation, the deploy script'
else
  fail 'guard: migration invocations changed — review them'
fi
assert_grep 'guard: migration runs with stdin closed' \
  'pnpm run db:migrate:deploy </dev/null' "$UPDATER"

# ==================================================== preflight refusals

I=$WORK/install-a
make_install "$I"

# --- incomplete update folder
rm "$WORK/newtree/pnpm-lock.yaml"
run_updater "$I" "$WORK/newtree"
assert_exit 'refusal: incomplete bundle exits non-zero' 1 "$STATUS"
assert_grep 'refusal: incomplete bundle names the missing file' \
  'Missing: pnpm-lock.yaml' "$OUT"
assert_grep 'refusal: incomplete bundle says nothing changed' \
  'nothing has been changed' "$OUT"
printf 'lockfileVersion: 9\n' >"$WORK/newtree/pnpm-lock.yaml"

# --- install not found
run_updater "$WORK/does-not-exist" "$WORK/newtree"
assert_exit 'refusal: missing install exits non-zero' 1 "$STATUS"
assert_grep 'refusal: missing install names the path' \
  'Could not find the installed Bimoto server' "$OUT"
assert_file 'refusal: real install untouched' "$I/OLD_MARKER"

# --- script run from inside the install itself
run_updater "$I" "$I"
assert_exit 'refusal: script-inside-install exits non-zero' 1 "$STATUS"
assert_grep 'refusal: script-inside-install explained' \
  'inside the installed app itself' "$OUT"

# --- pnpm missing (shim dir replaced by an empty dir)
OUT=$WORK/out-nopnpm.txt
HOME="$WORK/fakehome" PATH="$WORK/empty-bin:/usr/local/bin:/usr/bin:/bin" \
  BIMOTO_HOME="$I" BIMOTO_UPDATER_LOG_DIR="$WORK/logs" BIMOTO_UPDATER_ASSUME_YES=1 \
  sh "$WORK/newtree/scripts/update-pilot.command" >"$OUT" 2>&1
STATUS=$?
assert_exit 'refusal: missing pnpm exits non-zero' 1 "$STATUS"
assert_grep 'refusal: missing pnpm named' "'pnpm' was not found" "$OUT"

# --- node too old for the new tree
printf '{ "name": "@bimoto/server", "engines": { "node": ">=99.0.0" } }\n' \
  >"$WORK/newtree/packages/server/package.json"
run_updater "$I" "$WORK/newtree"
assert_exit 'refusal: node too old exits non-zero' 1 "$STATUS"
assert_grep 'refusal: node too old names the needed version' \
  'version 99 or newer' "$OUT"
printf '{ "name": "@bimoto/server", "engines": { "node": ">=18.0.0" } }\n' \
  >"$WORK/newtree/packages/server/package.json"

# --- settings file missing
mv "$I/packages/server/.env" "$WORK/stash.env"
run_updater "$I" "$WORK/newtree"
assert_exit 'refusal: missing .env exits non-zero' 1 "$STATUS"
assert_grep 'refusal: missing .env explained' \
  'Could not find the settings file' "$OUT"
mv "$WORK/stash.env" "$I/packages/server/.env"

# --- server still running (something listens on the app port)
node -e "require('net').createServer().listen($APP_PORT,'127.0.0.1');setInterval(()=>{},1e9)" \
  >/dev/null 2>&1 &
LISTEN_PID=$!
CLEANUP_PIDS="$CLEANUP_PIDS $LISTEN_PID"
sleep 1
run_updater "$I" "$WORK/newtree"
assert_exit 'refusal: running server exits non-zero' 1 "$STATUS"
assert_grep 'refusal: running server says how to stop it' \
  'Control key and press C' "$OUT"
kill "$LISTEN_PID" 2>/dev/null
sleep 1

# --- database unreachable (nothing listens on the db port)
run_updater "$I" "$WORK/newtree"
assert_exit 'refusal: unreachable database exits non-zero' 1 "$STATUS"
assert_grep 'refusal: unreachable database explained' \
  'database is not answering' "$OUT"

# ================================================= the successful update

start_db

# Plant a hostile bundled .env that must NOT survive, and a new example
# key that must be reported by name.
printf 'PORT=6666\nEVIL_BUNDLED=1\n' >"$WORK/newtree/packages/server/.env"
printf 'PORT=3000\nDATABASE_URL="x"\nJWT_SECRET="x"\nBRAND_NEW_SETTING=""\n' \
  >"$WORK/newtree/.env.example"
cp "$I/packages/server/.env" "$WORK/env-baseline"

run_updater "$I" "$WORK/newtree"
assert_exit 'update: succeeds' 0 "$STATUS"
assert_grep 'update: reaches the restart instructions' \
  'THE UPDATE IS IN PLACE' "$OUT"
# DOC-GUARD G3 — the document sweep runs as part of an ordinary update.
assert_grep 'update: encrypts previously uploaded documents' \
  'Locking up previously uploaded documents' "$OUT"

if cmp -s "$WORK/env-baseline" "$I/packages/server/.env"; then
  pass 'update: live .env byte-identical after the update'
else
  fail 'update: live .env changed'
fi
assert_not_grep 'update: bundled .env never wins' 'EVIL_BUNDLED' "$I/packages/server/.env"
assert_grep 'update: missing key reported by name' 'BRAND_NEW_SETTING' "$OUT"
assert_not_grep 'update: secret value never printed (stdout)' 'CANARY-secret-o9K2mQ' "$OUT"
if grep -rq 'CANARY-secret-o9K2mQ' "$WORK/logs" 2>/dev/null; then
  fail 'update: secret value leaked into a log file'
else
  pass 'update: secret value never written to logs'
fi
if [ "$(count_dirs "$I.previous.")" -ge 1 ]; then
  pass 'update: old install retired, not deleted'
else
  fail 'update: no retired copy found'
fi
_prev_dir=$(newest_dir "$I.previous.")
assert_file 'update: retired copy is the old generation' "$_prev_dir/OLD_MARKER"
assert_no_file 'update: new tree is in place' "$I/OLD_MARKER"
assert_grep 'update: state file says updated' 'PHASE=updated' "$I/.pilot-update-state"
if grep -rq 'payout_idempotency_one_inflight_batch' "$WORK/logs"/*-migrate.log 2>/dev/null; then
  pass 'update: migration output captured in its own log'
else
  fail 'update: migration output not captured'
fi

# ============================== verify: resume, restart evidence, states

# Re-running with PHASE=updated resumes verification (no second update),
# and a fresh healthy server verifies.
start_health 5 true
run_updater "$I" "$WORK/newtree"
assert_exit 'verify: healthy fresh server verifies' 0 "$STATUS"
assert_grep 'verify: resume instead of re-update' \
  'already in place and waiting to be checked' "$OUT"
assert_grep 'verify: success stated plainly' 'UPDATE VERIFIED' "$OUT"
assert_grep 'verify: state file says verified' 'PHASE=verified' "$I/.pilot-update-state"
_prev_count=$(count_dirs "$I.previous.")
if [ "$_prev_count" = 1 ]; then
  pass 'verify: retired copy survives verification'
else
  fail "verify: expected 1 retired copy, found $_prev_count"
fi
kill "$HEALTH_PID" 2>/dev/null
sleep 1

# The old process still answering: uptime predates the update.
start_health 9999999 true
run_updater "$I" "$WORK/newtree" verify
assert_exit 'verify: old process is not accepted' 1 "$STATUS"
assert_grep 'verify: old process called out' \
  'running since BEFORE the' "$OUT"
kill "$HEALTH_PID" 2>/dev/null
sleep 1

# Server up but database down: distinct message.
start_health 5 false
run_updater "$I" "$WORK/newtree" verify
assert_exit 'verify: db-down is a failure' 1 "$STATUS"
assert_grep 'verify: db-down called out' 'database is NOT connected' "$OUT"
kill "$HEALTH_PID" 2>/dev/null
sleep 1

# Nothing answering at all: distinct message.
TEST_VERIFY_TIMEOUT=3 run_updater "$I" "$WORK/newtree" verify
assert_exit 'verify: silence is a failure' 1 "$STATUS"
assert_grep 'verify: silence called out' 'Nothing answered on port' "$OUT"

# ======================================================== rollback paths

# Migration failure: previous install and settings restored, failed
# copy kept for diagnosis.
J=$WORK/install-b
make_install "$J"
cp "$J/packages/server/.env" "$WORK/env-baseline-b"
TEST_FAIL_STEP=migrate run_updater "$J" "$WORK/newtree"
assert_exit 'rollback: migrate failure exits non-zero' 1 "$STATUS"
assert_grep 'rollback: says the update was undone' \
  'DID NOT FINISH' "$OUT"
assert_grep 'rollback: says the Mac is back on the old version' \
  'back on the version that was running before' "$OUT"
assert_file 'rollback: old install restored' "$J/OLD_MARKER"
assert_same 'rollback: settings byte-identical after rollback' \
  "$WORK/env-baseline-b" "$J/packages/server/.env"
if [ "$(count_dirs "$J.failed.")" -ge 1 ]; then
  pass 'rollback: failed copy kept for diagnosis'
else
  fail 'rollback: failed copy missing'
fi

# DOC-GUARD G3 — the document sweep is the ONE step that must not roll
# the update back. It refuses when it cannot classify a file, and the
# app reads plaintext and encrypted documents alike, so an unswept file
# is a thing to follow up, not a reason to put the old version back.
S=$WORK/install-docs
make_install "$S"
TEST_FAIL_STEP=documents run_updater "$S" "$WORK/newtree"
assert_exit 'documents: a refused sweep still completes the update' 0 "$STATUS"
assert_grep 'documents: the update is still in place' \
  'THE UPDATE IS IN PLACE' "$OUT"
assert_grep 'documents: the operator is told which files were left' \
  'could not tell what they are' "$OUT"
assert_no_file 'documents: no rollback happened' "$S/OLD_MARKER"

# Broken Prisma Client (the 29 July incident): generate fails, rollback.
K=$WORK/install-c
make_install "$K"
TEST_FAIL_STEP=generate run_updater "$K" "$WORK/newtree"
assert_exit 'rollback: generate failure exits non-zero' 1 "$STATUS"
assert_grep 'rollback: generate failure names the driver' \
  'database driver' "$OUT"
assert_file 'rollback: generate failure restores old install' "$K/OLD_MARKER"

# A second run right after a rollback behaves like a clean first run.
run_updater "$K" "$WORK/newtree"
assert_exit 'second run: clean update after a rollback' 0 "$STATUS"
assert_grep 'second run: reaches the restart instructions' \
  'THE UPDATE IS IN PLACE' "$OUT"
assert_same 'second run: settings still byte-identical' \
  "$WORK/env-baseline" "$K/packages/server/.env"

# =============================================================== summary

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ] || exit 1
exit 0
