#!/bin/sh
# =====================================================================
#  Bimoto pilot updater — one command to update the Kigali server.
#
#  How to run it (macOS):
#    * Double-click this file (it opens in Terminal), or
#    * run:  sh scripts/update-pilot.command
#
#  What it does, in order:
#    1. Checks everything it needs BEFORE touching anything. If any
#       check fails it stops, explains in plain words, and nothing
#       has been changed.
#    2. Keeps your settings (.env) exactly as they are. They are
#       never overwritten and never printed.
#    3. Moves the old app aside (kept, not deleted).
#    4. Puts the new app in place, installs its parts, prepares the
#       database driver, and updates the database.
#    5. Asks you to start the server, then checks it really works.
#       If anything goes wrong after step 3, it puts the old app back.
#
#  SAFETY GUARD — a database reset is impossible from this script:
#  the only migration command in this file is the hard-coded package
#  script "db:migrate:deploy" (prisma migrate deploy). The interactive,
#  potentially destructive dev-migrate command is never invoked, no variable
#  ever holds a migration command, and every child command runs with
#  its input closed (</dev/null) so nothing can answer an interactive
#  prompt. CI greps this file to keep it that way
#  (scripts/tests/test-update-pilot.sh).
#
#  Environment overrides (for developers and tests only — operators
#  never need these):
#    BIMOTO_HOME                where the app is installed ($HOME/bimoto)
#    BIMOTO_UPDATER_LOG_DIR     where logs go ($HOME/bimoto-update-logs)
#    BIMOTO_UPDATER_ASSUME_YES  non-interactive: never wait for Enter
#    BIMOTO_VERIFY_TIMEOUT      seconds to wait for the restarted server (90)
#    BIMOTO_VERIFY_POLL         seconds between health checks (3)
# =====================================================================

set -u

# ----------------------------------------------------------------- paths

case "$0" in
  /*) SCRIPT_PATH=$0 ;;
  *) SCRIPT_PATH=$(pwd)/$0 ;;
esac
NEW_TREE=$(CDPATH='' cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd -P)

BIMOTO_HOME=${BIMOTO_HOME:-$HOME/bimoto}
BIMOTO_HOME=${BIMOTO_HOME%/}

STAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR=${BIMOTO_UPDATER_LOG_DIR:-$HOME/bimoto-update-logs}
LOG_FILE=$LOG_DIR/update-$STAMP.log
MIGRATE_LOG=$LOG_DIR/update-$STAMP-migrate.log
STATE_FILE=$BIMOTO_HOME/.pilot-update-state

VERIFY_TIMEOUT=${BIMOTO_VERIFY_TIMEOUT:-90}
VERIFY_POLL=${BIMOTO_VERIFY_POLL:-3}
UPTIME_GRACE=60

# Filled in by preflight; used by later phases.
PORT=3000
DB_URL=''
DB_HOST=''
DB_PORT=5432
PREVIOUS=''

# ---------------------------------------------------------------- output

say() {
  printf '%s\n' "$*"
  printf '%s\n' "$*" >>"$LOG_FILE" 2>/dev/null || true
}

hr() {
  say '----------------------------------------------------------------'
}

log_only() {
  printf '%s\n' "$*" >>"$LOG_FILE" 2>/dev/null || true
}

# Preflight failure: stop before anything was touched.
refuse() {
  hr
  say 'UPDATE STOPPED — nothing has been changed.'
  say ''
  for _line in "$@"; do say "$_line"; done
  say ''
  say 'The server can be used exactly as before. You can close this window.'
  exit 1
}

is_interactive() {
  [ -t 0 ] && [ -z "${BIMOTO_UPDATER_ASSUME_YES:-}" ]
}

# ------------------------------------------------------------- utilities

# env_value FILE KEY — last value of KEY in FILE, surrounding quotes
# stripped. Values are never echoed to the screen or the log by callers
# other than PORT and the database host/port (never secrets).
env_value() {
  sed -n "s/^[[:space:]]*$2=//p" "$1" 2>/dev/null | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# env_keys FILE — the setting names (only names, never values).
env_keys() {
  sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1" 2>/dev/null | sort -u
}

# tcp_open HOST PORT — succeeds when something is listening there.
tcp_open() {
  BIMOTO_TCP_HOST=$1 BIMOTO_TCP_PORT=$2 node -e '
    const s = require("net").connect({
      host: process.env.BIMOTO_TCP_HOST,
      port: Number(process.env.BIMOTO_TCP_PORT),
    });
    s.on("connect", () => { s.destroy(); process.exit(0); });
    s.on("error", () => process.exit(1));
    setTimeout(() => { s.destroy(); process.exit(1); }, 2500).unref();
  ' </dev/null >/dev/null 2>&1
}

# probe_health PORT — asks the LOCAL server (127.0.0.1, never the public
# tunnel address) for /api/health. Prints "UPTIME=<seconds> DB=yes|no".
# The request cannot come from a cache: it is a raw HTTP request from
# node straight to the loopback interface (node's http module ignores
# proxy settings), with Cache-Control/Pragma no-cache headers and a
# unique query string on every call.
probe_health() {
  BIMOTO_PORT=$1 node -e '
    const http = require("http");
    const path = "/api/health?nocache=" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const req = http.get({
      host: "127.0.0.1",
      port: Number(process.env.BIMOTO_PORT),
      path,
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      timeout: 5000,
    }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          console.log("UPTIME=" + Math.round(Number(j.uptime)) + " DB=" + (j.dbConnected ? "yes" : "no"));
          process.exit(0);
        } catch (e) { process.exit(2); }
      });
    });
    req.on("error", () => process.exit(1));
    req.on("timeout", () => { req.destroy(); process.exit(1); });
  ' </dev/null 2>/dev/null
}

# state_value KEY — read a field from the update state file.
state_value() {
  env_value "$STATE_FILE" "$1"
}

write_state() {
  {
    printf 'PHASE=%s\n' "$1"
    printf 'PREVIOUS=%s\n' "$PREVIOUS"
    printf 'STAMP=%s\n' "$STAMP"
    printf 'UPDATED_AT=%s\n' "$(date +%s)"
    printf 'PORT=%s\n' "$PORT"
  } >"$STATE_FILE"
}

start_command_lines() {
  say "       cd $BIMOTO_HOME/packages/server"
  say '       pnpm dev'
}

# ------------------------------------------------------------- preflight

preflight() {
  say 'Step 1 of 5 — checking that everything is ready...'

  # 1. The folder this script lives in must be a complete update.
  for _need in \
    package.json \
    pnpm-lock.yaml \
    .env.example \
    packages/server/package.json \
    packages/server/prisma/schema.prisma \
    packages/shared/package.json
  do
    if [ ! -f "$NEW_TREE/$_need" ]; then
      refuse \
        'The folder this script is in does not look like a complete Bimoto update.' \
        "Missing: $_need" \
        '' \
        'Ask us to send the update folder again, then run the script from the new copy.'
    fi
  done
  if [ ! -d "$NEW_TREE/packages/server/prisma/migrations" ]; then
    refuse \
      'The folder this script is in does not look like a complete Bimoto update.' \
      'Missing: packages/server/prisma/migrations' \
      '' \
      'Ask us to send the update folder again, then run the script from the new copy.'
  fi
  if ! grep -q '"name": "bimoto"' "$NEW_TREE/package.json"; then
    refuse \
      'The folder this script is in does not look like a Bimoto update at all.' \
      '' \
      'Ask us to send the update folder again.'
  fi

  # 2. The installed app must exist where we expect it.
  if [ ! -f "$BIMOTO_HOME/package.json" ] || [ ! -d "$BIMOTO_HOME/packages/server" ]; then
    refuse \
      'Could not find the installed Bimoto server at:' \
      "    $BIMOTO_HOME" \
      '' \
      'If Bimoto lives in a different folder on this Mac, tell us — we will' \
      'send you a one-line command adjusted for it.'
  fi

  # 3. The update folder and the installed app must be different folders.
  _install_real=$(CDPATH='' cd -- "$BIMOTO_HOME" && pwd -P)
  if [ "$NEW_TREE" = "$_install_real" ]; then
    refuse \
      'You started the copy of this script that is inside the installed app itself.' \
      '' \
      'Please open the NEW update folder you received and double-click' \
      'update-pilot.command in there instead.'
  fi
  case "$NEW_TREE/" in
    "$_install_real"/*)
      refuse \
        'The update folder is INSIDE the installed app folder.' \
        'Please move the update folder somewhere else (the Desktop is fine)' \
        'and run the script again from there.'
      ;;
  esac
  case "$_install_real/" in
    "$NEW_TREE"/*)
      refuse \
        'The installed app appears to be INSIDE the update folder — that is not' \
        'a layout this script can update. Please contact us.'
      ;;
  esac

  # 4. node must exist and be new enough for the new version.
  if ! command -v node >/dev/null 2>&1; then
    refuse \
      "The program 'node' was not found on this Mac." \
      'It should already be installed. Do not continue — contact us.'
  fi
  _req=$(BIMOTO_PKG="$NEW_TREE/packages/server/package.json" node -p \
    'String((require(process.env.BIMOTO_PKG).engines || {}).node || "")' 2>/dev/null)
  _req_major=$(printf '%s' "$_req" | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p')
  _cur_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
  if [ -n "$_req_major" ] && [ -n "$_cur_major" ] && [ "$_cur_major" -lt "$_req_major" ]; then
    refuse \
      "This Mac has Node.js version $(node -v 2>/dev/null), but the new Bimoto needs" \
      "version $_req_major or newer." \
      '' \
      'Do not continue — ask us to help update Node.js first.'
  fi

  # 5. pnpm must exist.
  if ! command -v pnpm >/dev/null 2>&1; then
    refuse \
      "The program 'pnpm' was not found on this Mac." \
      'It should already be installed. Do not continue — contact us.'
  fi
  log_only "pnpm version: $(pnpm --version 2>/dev/null)"
  log_only "node version: $(node -v 2>/dev/null)"

  # 6. The settings file (.env) of the installed app must exist.
  #    The server reads packages/server/.env (preferred) and the root
  #    .env; we accept either and carry BOTH forward if both exist.
  if [ ! -f "$BIMOTO_HOME/packages/server/.env" ] && [ ! -f "$BIMOTO_HOME/.env" ]; then
    refuse \
      'Could not find the settings file of the installed app (the file' \
      'called .env). Updating without it would break the server.' \
      '' \
      'Do not continue — contact us.'
  fi

  # 7. Read the port the server uses (settings win over the default).
  _port=''
  if [ -f "$BIMOTO_HOME/packages/server/.env" ]; then
    _port=$(env_value "$BIMOTO_HOME/packages/server/.env" PORT)
  fi
  if [ -z "$_port" ] && [ -f "$BIMOTO_HOME/.env" ]; then
    _port=$(env_value "$BIMOTO_HOME/.env" PORT)
  fi
  PORT=${_port:-3000}
  case "$PORT" in
    *[!0-9]*)
      refuse \
        'The PORT line in your settings file does not look like a number,' \
        'so I cannot safely check whether the server is running.' \
        '' \
        'Do not continue — contact us.'
      ;;
  esac

  # 8. The server must NOT be running while we update.
  if tcp_open 127.0.0.1 "$PORT"; then
    refuse \
      'The Bimoto server seems to be RUNNING right now (something is' \
      "answering on port $PORT). Updating while it runs is not safe." \
      '' \
      'What to do:' \
      '  1. Go to the Terminal window where the server is running.' \
      '  2. Hold the Control key and press C once. Wait for it to stop.' \
      '  3. Run this update again.'
  fi

  # 9. The database must be reachable (the update changes it).
  DB_URL=''
  if [ -f "$BIMOTO_HOME/packages/server/.env" ]; then
    DB_URL=$(env_value "$BIMOTO_HOME/packages/server/.env" DATABASE_URL)
  fi
  if [ -z "$DB_URL" ] && [ -f "$BIMOTO_HOME/.env" ]; then
    DB_URL=$(env_value "$BIMOTO_HOME/.env" DATABASE_URL)
  fi
  if [ -z "$DB_URL" ]; then
    refuse \
      'Your settings file has no DATABASE_URL line, so I cannot reach' \
      'the database. Do not continue — contact us.'
  fi
  _hostport=${DB_URL#*://}
  _hostport=${_hostport%%/*}
  _hostport=${_hostport##*@}
  DB_HOST=${_hostport%%:*}
  case "$_hostport" in
    *:*) DB_PORT=${_hostport##*:} ;;
    *) DB_PORT=5432 ;;
  esac
  case "$DB_PORT" in *[!0-9]*) DB_PORT=5432 ;; esac
  if [ -z "$DB_HOST" ]; then
    refuse \
      'I could not read the database address from your settings, so I' \
      'cannot check the database is on. Do not continue — contact us.'
  fi
  if ! tcp_open "$DB_HOST" "$DB_PORT"; then
    refuse \
      "The database is not answering (tried $DB_HOST, port $DB_PORT)." \
      'The update needs the database to be on.' \
      '' \
      'Postgres usually runs by itself. To start it, run this in Terminal:' \
      '    brew services start postgresql@16' \
      'Then run this update again.'
  fi

  say '    Everything is ready. Nothing has been changed yet.'
}

# -------------------------------------------------- crash recovery

# newest_dir PREFIX — newest directory matching PREFIX* (stamps in the
# names sort oldest-to-newest, and shell globs expand sorted).
newest_dir() {
  _newest=''
  for _d in "$1"*; do
    [ -d "$_d" ] && _newest=$_d
  done
  printf '%s' "$_newest"
}

# If an earlier run died at the worst moment, put things right before
# doing anything else. Two cases:
#   a) the install folder is GONE but a kept previous copy exists
#      (death between the two renames of the swap) — restore it;
#   b) the state file says an update was still mid-apply — the install
#      is a half-updated copy; retire it and restore the previous one.
recover_if_needed() {
  if [ ! -d "$BIMOTO_HOME" ]; then
    _prev=$(newest_dir "$BIMOTO_HOME.previous.")
    if [ -n "$_prev" ]; then
      say 'An earlier update stopped halfway. Putting the previous version'
      say 'back first...'
      mv "$_prev" "$BIMOTO_HOME" || refuse \
        'I could not restore the previous version automatically.' \
        "It is still safe, at: $_prev" \
        'Please contact us before doing anything else.'
      say '    Done. Continuing with a fresh update.'
    fi
    return 0
  fi
  if [ -f "$STATE_FILE" ]; then
    _phase=$(state_value PHASE)
    _prevdir=$(state_value PREVIOUS)
    case "$_phase" in
      applying)
        if [ -d "$_prevdir" ]; then
          say 'An earlier update stopped before it finished. Putting the'
          say 'previous version back first...'
          mv "$BIMOTO_HOME" "$BIMOTO_HOME.failed.$STAMP" || refuse \
            'I could not move the half-updated app aside.' \
            'Please contact us before doing anything else.'
          mv "$_prevdir" "$BIMOTO_HOME" || refuse \
            'I could not restore the previous version automatically.' \
            "It is still safe, at: $_prevdir" \
            'Please contact us before doing anything else.'
          say '    Done. Continuing with a fresh update.'
        fi
        ;;
    esac
  fi
  return 0
}

# ------------------------------------------- G2: settings + the swap

INCOMING=''

cleanup_incoming() {
  if [ -n "$INCOMING" ] && [ -d "$INCOMING" ]; then
    rm -rf "$INCOMING"
  fi
}

# Copy the new tree next to the install, carry the live settings into
# it, and prove the copy is byte-identical — all BEFORE the running
# install is touched. Any problem here is a clean refusal.
prepare_incoming() {
  say 'Step 2 of 5 — preparing the new version (your settings are kept)...'
  INCOMING=$BIMOTO_HOME.incoming.$STAMP
  rm -rf "$INCOMING"
  mkdir -p "$INCOMING"
  if ! (CDPATH='' cd -- "$NEW_TREE" && tar -cf - --exclude node_modules --exclude .git .) \
      | (CDPATH='' cd -- "$INCOMING" && tar -xf -); then
    cleanup_incoming
    refuse \
      'Copying the new version failed (possibly the disk is full).' \
      'Please contact us.'
  fi
  if [ ! -f "$INCOMING/package.json" ]; then
    cleanup_incoming
    refuse \
      'Copying the new version failed (the copy came out incomplete).' \
      'Please contact us.'
  fi

  # The bundle must never bring its own settings: your live .env is the
  # source of truth. Delete any .env the bundle carried (keep .env.example).
  find "$INCOMING" -name '.env' -type f -exec rm -f {} + 2>/dev/null
  find "$INCOMING" -name '.env.*' ! -name '.env.example' -type f -exec rm -f {} + 2>/dev/null

  # Carry the live settings forward, byte for byte, and prove it.
  for _envrel in .env packages/server/.env; do
    if [ -f "$BIMOTO_HOME/$_envrel" ]; then
      if ! cp -p "$BIMOTO_HOME/$_envrel" "$INCOMING/$_envrel" \
          || ! cmp -s "$BIMOTO_HOME/$_envrel" "$INCOMING/$_envrel"; then
        cleanup_incoming
        refuse \
          'I could not carry your settings file over safely, so I stopped' \
          'before changing anything. Please contact us.'
      fi
    fi
  done
  say '    Your settings file was carried over unchanged (checked byte'
  say '    for byte). It was not printed and will not be.'

  # MATCH-CLOSE G4 — place the build stamp, so the installed server can
  # say which build it is. The bundle carries BUILD_SHA (written by
  # scripts/stamp-build-sha.command before the folder was sent); the tar
  # above already copied it, and this makes the placement explicit and
  # checked. Your settings file is NOT touched by this: the stamp is its
  # own file, precisely so the byte-for-byte promise above stays true.
  if [ -f "$NEW_TREE/BUILD_SHA" ]; then
    if ! cp -p "$NEW_TREE/BUILD_SHA" "$INCOMING/BUILD_SHA" \
        || ! cmp -s "$NEW_TREE/BUILD_SHA" "$INCOMING/BUILD_SHA"; then
      cleanup_incoming
      refuse \
        'I could not place the version stamp for the new build, so I' \
        'stopped before changing anything. Please contact us.'
    fi
    say "    This update is build $(cat "$INCOMING/BUILD_SHA")."
  else
    # Not fatal: an unstamped bundle still installs and runs. It just
    # cannot tell us which build it is when something goes wrong.
    say '    NOTE — this update folder carries no version stamp, so the'
    say '    server will report its build as "unknown". Everything still'
    say '    works; please mention this if you contact us.'
  fi

  # MAP-TRUTH G3 — keep the offline map archives.
  # MAP-RWANDA G2 — ALL of them, not just Kigali.
  #
  # data/*.pmtiles are large generated artefacts, not part of the source:
  # scripts/build-region-pmtiles.command makes them, and the server finds
  # them there with no configuration at all — whatever archives are in
  # that folder ARE the regions this server offers. They are deliberately
  # NOT an .env setting — writing MAP_PMTILES_PATH into your settings
  # would break the byte-for-byte promise above — so the files' location
  # IS the wiring, and losing one would silently take a whole province's
  # offline map away from every rider who had it.
  #
  # This used to name kigali.pmtiles literally, which meant that adding a
  # province would have quietly dropped it on the next update. The loop
  # below carries every archive the same way and with the same proof, so
  # provisioning a new region stays a matter of dropping in one file.
  #
  # If the update folder brought its own copy of an archive, the copy
  # above already placed it and it wins; only the ones it did not bring
  # are carried forward. Nothing here writes .env.
  _carried=0
  _brought=0
  for _archive in "$BIMOTO_HOME"/data/*.pmtiles; do
    # An unmatched glob comes back literally — that just means no
    # archives are installed, which is a perfectly normal server.
    [ -f "$_archive" ] || continue
    _name=$(basename "$_archive")

    if [ -f "$INCOMING/data/$_name" ]; then
      _brought=$((_brought + 1))
      continue
    fi

    if ! mkdir -p "$INCOMING/data" \
        || ! cp -p "$_archive" "$INCOMING/data/$_name" \
        || ! cmp -s "$_archive" "$INCOMING/data/$_name"; then
      cleanup_incoming
      refuse \
        'I could not carry the offline map files over safely, so I stopped' \
        'before changing anything. Please contact us.'
    fi
    # The manifest travels with it when there is one; it only records how
    # the archive was built, so a missing one is not worth stopping for.
    if [ -f "$_archive.json" ]; then
      cp -p "$_archive.json" "$INCOMING/data/$_name.json" 2>/dev/null || true
    fi
    _carried=$((_carried + 1))
  done

  # Count what the update itself brought, including regions this server
  # has never had — that is how a new province arrives.
  for _archive in "$INCOMING"/data/*.pmtiles; do
    if [ -f "$_archive" ] && [ ! -f "$BIMOTO_HOME/data/$(basename "$_archive")" ]; then
      _brought=$((_brought + 1))
    fi
  done

  if [ "$_carried" -gt 0 ]; then
    say "    $_carried offline map file(s) were carried over (checked byte"
    say '    for byte).'
  fi
  if [ "$_brought" -gt 0 ]; then
    say "    This update brings $_brought offline map file(s)."
  fi
}

# Compare the live settings against the new version's .env.example and
# name (names only, never values) any setting the new version knows
# about that the live file does not have.
report_missing_keys() {
  _example=$NEW_TREE/.env.example
  _livekeys_file=$LOG_DIR/.live-keys.$STAMP
  : >"$_livekeys_file"
  [ -f "$BIMOTO_HOME/.env" ] && env_keys "$BIMOTO_HOME/.env" >>"$_livekeys_file"
  [ -f "$BIMOTO_HOME/packages/server/.env" ] && env_keys "$BIMOTO_HOME/packages/server/.env" >>"$_livekeys_file"
  sort -u "$_livekeys_file" -o "$_livekeys_file"
  _missing=$(env_keys "$_example" | comm -23 - "$_livekeys_file")
  rm -f "$_livekeys_file"
  if [ -n "$_missing" ]; then
    hr
    say 'NOTE — this update knows about settings that your settings file'
    say 'does not have yet:'
    for _k in $_missing; do
      say "    - $_k"
    done
    say ''
    say 'Many settings are optional and this is often fine. But if we told'
    say 'you to add a new setting for this update, stop here and add it'
    say 'first. No value was invented for them; your settings were not'
    say 'changed.'
    if is_interactive; then
      printf 'Press Enter to continue the update, or type q then Enter to stop: '
      read -r _answer || _answer=''
      case "$_answer" in
        q|Q)
          cleanup_incoming
          say ''
          say 'Stopped at your request. Nothing has been changed.'
          exit 1
          ;;
      esac
    fi
    hr
  fi
}

# The swap: retire the old install (kept, NOT deleted) and put the
# prepared copy in its place. Two renames; recovery above handles a
# crash between them.
swap_installs() {
  PREVIOUS=$BIMOTO_HOME.previous.$STAMP
  say 'Step 3 of 5 — keeping the current version safe at:'
  say "    $PREVIOUS"
  if ! mv "$BIMOTO_HOME" "$PREVIOUS"; then
    cleanup_incoming
    refuse \
      'I could not move the current app aside, so nothing was changed.' \
      'Please contact us.'
  fi
  if ! mv "$INCOMING" "$BIMOTO_HOME"; then
    # Put the old install straight back; nothing else has happened yet.
    mv "$PREVIOUS" "$BIMOTO_HOME" || true
    cleanup_incoming
    refuse \
      'I could not put the new version in place. The current version was' \
      'put back and is unchanged. Please contact us.'
  fi
  INCOMING=''
  write_state applying
}

# ------------------------------------------------- G3: apply + rollback

# Undo everything after the swap: keep the failed copy for us to look
# at, restore the previous install (settings included — that folder was
# never modified), and tell the operator plainly what happened.
rollback() {
  _failed=$BIMOTO_HOME.failed.$STAMP
  hr
  say 'THE UPDATE DID NOT FINISH — putting the previous version back...'
  if [ -d "$BIMOTO_HOME" ]; then
    mv "$BIMOTO_HOME" "$_failed" 2>/dev/null || rm -rf "$BIMOTO_HOME"
  fi
  if ! mv "$PREVIOUS" "$BIMOTO_HOME"; then
    say ''
    say 'AUTOMATIC RESTORE FAILED — the previous version is still safe at:'
    say "    $PREVIOUS"
    say 'Do not delete anything. Contact us right away and send this file:'
    say "    $LOG_FILE"
    exit 1
  fi
  say ''
  say "What went wrong: $1"
  say ''
  say 'The Mac is back on the version that was running before. Your'
  say 'settings are unchanged. Nothing more needs fixing right now.'
  say ''
  say 'You can start the server as usual:'
  say ''
  start_command_lines
  say ''
  say 'Please send us this file so we can see what happened:'
  say "    $LOG_FILE"
  if [ -f "$MIGRATE_LOG" ]; then
    say 'and this one:'
    say "    $MIGRATE_LOG"
  fi
  exit 1
}

# run_step DIR CMD... — run a command with input closed, showing its
# output live and keeping a copy in the log. Returns its exit status
# (a pipe would swallow it in POSIX sh, hence the status file).
run_step() {
  _stepdir=$1
  shift
  (
    CDPATH='' cd -- "$_stepdir" && "$@" </dev/null 2>&1
    printf '%s' "$?" >"$LOG_DIR/.last-status"
  ) | tee -a "$LOG_FILE"
  _st=$(cat "$LOG_DIR/.last-status" 2>/dev/null || printf '1')
  rm -f "$LOG_DIR/.last-status"
  [ "$_st" = '0' ]
}

apply_update() {
  say 'Step 4 of 5 — installing and preparing the new version...'
  say ''
  say '(1/5) Installing components — this can take a few minutes...'
  if ! run_step "$BIMOTO_HOME" pnpm install --frozen-lockfile; then
    rollback 'installing the app components failed (pnpm install).'
  fi

  say '(2/5) Building shared components...'
  if ! run_step "$BIMOTO_HOME" pnpm --filter @bimoto/shared build; then
    rollback 'building the shared components failed.'
  fi

  # 29 July incident guard: generate the database driver EVERY time
  # (install may reuse cached packages and skip it), then prove the
  # driver actually loads — before the server would trip over it.
  say '(3/5) Preparing the database driver...'
  if ! run_step "$BIMOTO_HOME/packages/server" pnpm exec prisma generate; then
    rollback 'preparing the database driver (prisma generate) failed.'
  fi
  if ! (CDPATH='' cd -- "$BIMOTO_HOME/packages/server" \
      && node -e 'require("@prisma/client")' </dev/null >>"$LOG_FILE" 2>&1); then
    rollback 'the database driver did not install correctly (this is the
problem from 29 July — the update stopped before it could break the server).'
  fi

  say '(4/5) Updating the database...'
  # SAFETY: this is the only migration command in this script. It is the
  # hard-coded, non-interactive "deploy" script — the destructive
  # interactive variant is never invoked anywhere, and stdin is closed.
  (
    CDPATH='' cd -- "$BIMOTO_HOME" \
      && DATABASE_URL=$DB_URL pnpm run db:migrate:deploy </dev/null 2>&1
    printf '%s' "$?" >"$LOG_DIR/.last-status"
  ) | tee -a "$LOG_FILE" "$MIGRATE_LOG"
  _mst=$(cat "$LOG_DIR/.last-status" 2>/dev/null || printf '1')
  rm -f "$LOG_DIR/.last-status"
  if [ "$_mst" != '0' ]; then
    hr
    say 'The DATABASE update step failed. This can be a problem in the'
    say 'update itself, or the database refusing a change for its own'
    say 'reasons — that second case is not your fault and not always the'
    say "update's fault either. The full database output was saved."
    if grep -q 'DriverPayoutBatch_driverId_pending_key' "$MIGRATE_LOG" 2>/dev/null; then
      say ''
      say 'This particular failure usually fixes itself: after the previous'
      say 'version is restored, simply run this update once more.'
    fi
    rollback 'the database update (migration) failed — see the saved output.'
  fi
  if grep -q 'No pending migrations' "$MIGRATE_LOG" 2>/dev/null; then
    say '    The database was already up to date — no changes were needed.'
  else
    say '    Database changes were applied. A copy of the details is at:'
    say "        $MIGRATE_LOG"
  fi
  if grep -q 'PAYOUT-IDEMPOTENCY: demoted' "$MIGRATE_LOG" 2>/dev/null; then
    say '    (A note about duplicate payout records appeared — that note is'
    say '    expected, the database update still succeeded, and no driver'
    say '    loses money. We keep the details in the saved file above.)'
  fi

  # DOC-GUARD G3 — lock up the documents already on this Mac.
  #
  # Drivers' licences, RURA authorisations and insurance certificates
  # uploaded before this version are still the plain scans. The app can
  # read them either way, so this is not required for the server to
  # work — which is exactly why a failure here does NOT roll the update
  # back. It refuses rather than guesses: if it cannot tell what a file
  # is, it changes nothing and says which file needs a human.
  say '(5/5) Locking up previously uploaded documents...'
  if run_step "$BIMOTO_HOME/packages/server" pnpm run documents:encrypt; then
    say '    Documents on this Mac are now stored scrambled.'
  else
    say ''
    say '    NOTE: some previously uploaded documents were left as they'
    say '    were, because the check could not tell what they are. The'
    say '    update itself is fine and the app works normally — those'
    say '    files are simply not scrambled yet. Send us the log:'
    say "        $LOG_FILE"
  fi

  write_state updated
}

print_restart_instructions() {
  hr
  say 'THE UPDATE IS IN PLACE. One last thing: start the server again.'
  say ''
  say '  1. Open a new Terminal window (or use the old server window).'
  say '  2. Copy and run these two lines:'
  say ''
  start_command_lines
  say ''
  say '  3. Wait until it prints that it is running.'
}

# --------------------------------------------- G4: verify, or put back

# After a verified update we keep the two most recent retired/failed
# copies and remove older ones — never before the new version has
# proven itself. Directory names carry sortable timestamps, so the
# glob expands oldest-first.
prune_keep_two() {
  _prune_count=0
  for _d in "$1"*; do
    [ -d "$_d" ] && _prune_count=$((_prune_count + 1))
  done
  _prune_delete=$((_prune_count - 2))
  for _d in "$1"*; do
    [ -d "$_d" ] || continue
    [ "$_prune_delete" -gt 0 ] || break
    rm -rf "$_d"
    say "    Cleaned up an old kept copy: $_d"
    _prune_delete=$((_prune_delete - 1))
  done
}

# Guided rollback from the verify phase: the server may be running the
# new code, so we insist it is stopped before swapping folders back.
verify_rollback() {
  _prevdir=$(state_value PREVIOUS)
  if [ -z "$_prevdir" ] || [ ! -d "$_prevdir" ]; then
    hr
    say 'I could not find the kept previous version, so I cannot undo the'
    say 'update automatically. Nothing was deleted. Please contact us and'
    say "send this file:  $LOG_FILE"
    exit 1
  fi
  while tcp_open 127.0.0.1 "$PORT"; do
    if is_interactive; then
      say ''
      say 'The server is still running. Please stop it first:'
      say '  1. Go to the Terminal window where the server is running.'
      say '  2. Hold the Control key and press C once. Wait for it to stop.'
      printf 'Then press Enter here to continue: '
      read -r _ignored || true
    else
      hr
      say 'Cannot undo the update while the server is still running.'
      say 'Stop the server (Ctrl+C in its Terminal window), then run this'
      say 'script again and choose to undo.'
      exit 1
    fi
  done
  mv "$BIMOTO_HOME" "$BIMOTO_HOME.failed.$STAMP" 2>/dev/null || true
  if ! mv "$_prevdir" "$BIMOTO_HOME"; then
    say ''
    say 'AUTOMATIC RESTORE FAILED — the previous version is still safe at:'
    say "    $_prevdir"
    say 'Do not delete anything. Contact us right away.'
    exit 1
  fi
  hr
  say 'THE UPDATE WAS UNDONE — you are back on the previous version.'
  say 'Your settings are unchanged.'
  say ''
  say 'Start the server as usual:'
  say ''
  start_command_lines
  say ''
  say 'Please send us this file so we can see what happened:'
  say "    $LOG_FILE"
  exit 1
}

# Poll the LOCAL health endpoint until the restarted server proves
# itself: it must answer on 127.0.0.1, report the database connected,
# and have an uptime SMALLER than the time since the update finished —
# a process that has been up longer than that existed before the
# update, i.e. the old server was never stopped. A cached response
# cannot pass this (see probe_health for why none is possible).
do_verify() {
  say 'Step 5 of 5 — checking that the new version really works...'

  _updated_at=$(state_value UPDATED_AT)
  case "$_updated_at" in ''|*[!0-9]*) _updated_at=0 ;; esac
  _state_port=$(state_value PORT)
  case "$_state_port" in ''|*[!0-9]*) _state_port='' ;; esac
  [ -n "$_state_port" ] && PORT=$_state_port
  # When verification resumes in a fresh process, the kept-previous
  # pointer lives only in the state file — reload it so writing the
  # verified state does not lose it.
  [ -z "$PREVIOUS" ] && PREVIOUS=$(state_value PREVIOUS)

  _last_outcome=silent
  while :; do
    _deadline=$(($(date +%s) + VERIFY_TIMEOUT))
    while [ "$(date +%s)" -lt "$_deadline" ]; do
      _probe=$(probe_health "$PORT") || _probe=''
      if [ -n "$_probe" ]; then
        _uptime=${_probe#UPTIME=}
        _uptime=${_uptime%% *}
        _db=${_probe##*DB=}
        _age=$(($(date +%s) - _updated_at))
        if [ "$_uptime" -gt $((_age + UPTIME_GRACE)) ] 2>/dev/null; then
          _last_outcome=old_process
          break
        fi
        if [ "$_db" = 'yes' ]; then
          write_state verified
          hr
          say 'UPDATE VERIFIED — the new version is running (it started'
          say "${_uptime}s ago, after the update) and the database is"
          say 'connected. All done!'
          if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
            say ''
            say 'The previous version is kept in case we ever need it:'
            say "    $PREVIOUS"
          fi
          prune_keep_two "$BIMOTO_HOME.previous."
          prune_keep_two "$BIMOTO_HOME.failed."
          say ''
          say 'You can close this window. Thank you!'
          exit 0
        fi
        _last_outcome=db_down
      else
        _last_outcome=no_answer
      fi
      sleep "$VERIFY_POLL"
    done

    hr
    case "$_last_outcome" in
      old_process)
        say 'A server answered, but it has been running since BEFORE the'
        say 'update — it looks like the old server was never stopped, or an'
        say 'old window is still running it.'
        say ''
        say 'What to do:'
        say '  1. Go to EVERY Terminal window that runs the server.'
        say '  2. Hold the Control key and press C once in each. Wait.'
        say '  3. Start the server again:'
        say ''
        start_command_lines
        ;;
      db_down)
        say 'The server answers, but it says the database is NOT connected.'
        say 'The new version may have a problem.'
        ;;
      *)
        say "Nothing answered on port $PORT after $VERIFY_TIMEOUT seconds —"
        say 'the server may not be running (or is still starting up).'
        ;;
    esac

    if is_interactive; then
      say ''
      say 'You can:'
      say "  press Enter      check again for another $VERIFY_TIMEOUT seconds"
      say '  type r + Enter   UNDO the update and go back to the previous version'
      say '  type q + Enter   stop here (nothing more is changed)'
      printf 'Your choice: '
      read -r _choice || _choice=q
      case "$_choice" in
        r|R) verify_rollback ;;
        q|Q)
          say ''
          say 'Stopped. The new version stays in place but is NOT confirmed'
          say 'working. Run this script again to re-check, and send us this'
          say "file:  $LOG_FILE"
          exit 1
          ;;
      esac
    else
      say ''
      say 'Not confirmed. Start the server, then run this script again to'
      say 're-check. If it keeps failing, contact us and send this file:'
      say "    $LOG_FILE"
      exit 1
    fi
  done
}

# ------------------------------------------------------------------ main

main() {
  MODE=${1:-}
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  say '================================================================'
  say '  Bimoto pilot updater'
  say '================================================================'
  say "A record of this run is saved to: $LOG_FILE"
  say ''

  # A finished-but-unverified update resumes at verification instead of
  # updating again — so double-clicking the script twice never stacks a
  # second update on an unproven one. 'update' forces a fresh update;
  # 'verify' forces the health check alone.
  if [ "$MODE" != 'update' ] && [ -f "$STATE_FILE" ]; then
    _phase=$(state_value PHASE)
    if [ "$_phase" = 'updated' ] || [ "$MODE" = 'verify' ]; then
      say 'An update is already in place and waiting to be checked.'
      say '(To force a brand-new update instead, run this script with the'
      say " word 'update' after it.)"
      say ''
      say 'If the server is not running yet, start it now:'
      say ''
      start_command_lines
      say ''
      do_verify
    fi
  fi
  if [ "$MODE" = 'verify' ]; then
    say 'There is no update waiting to be checked; running the health'
    say 'check anyway.'
    do_verify
  fi

  say 'This updates the Bimoto server on this Mac. It checks everything'
  say 'first and stops safely if something is not right.'
  say ''
  recover_if_needed
  preflight
  prepare_incoming
  report_missing_keys
  swap_installs
  apply_update
  print_restart_instructions
  if is_interactive; then
    say ''
    printf 'When the server says it is running, press Enter here and I will check it: '
    read -r _ignored || true
    say ''
    do_verify
  else
    say ''
    say 'Then run this script again — it will check that the new version'
    say 'really works.'
    exit 0
  fi
}

main "$@"
