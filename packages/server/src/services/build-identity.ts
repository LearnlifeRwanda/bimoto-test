import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// FIELD-UX G5 — which build is this server actually running?
//
// Resolution order:
//   1. BUILD_SHA            — set by release bundles (hosting-agnostic)
//   2. RENDER_GIT_COMMIT    — set automatically on Render hosting
//   3. a BUILD_SHA file     — MATCH-CLOSE G4. Stamped into the update
//      bundle at bundle time and placed by scripts/update-pilot.command,
//      this is the rung the Kigali install actually lands on.
//   4. `git rev-parse` HEAD — a source checkout with a .git directory
//   5. "unknown"            — a bundle nobody stamped. The old default
//      here was "dev", which read as intentional and cost review time
//      twice.
//
// MATCH-CLOSE G4 — why a file and not an env var. The pilot install is
// an unzipped source bundle: it has no .git, Render's variable is
// absent, and nothing sets BUILD_SHA, so every rung fell through and
// /api/health answered "unknown" — which cost hours this session. The
// obvious fix, having the updater write BUILD_SHA into the operator's
// .env, was rejected: update-pilot.command promises Kigali that their
// settings file is carried forward unchanged, byte for byte, and that
// promise is worth more than the convenience. So the stamp travels as
// its own file next to the install and the ladder learns to read it.
//
// The env vars are read per call (cheap, and tests set them per case);
// the file and git lookups happen once per process and are memoized —
// neither can change under a running server.

type ExecLike = typeof execFileSync;
let execImpl: ExecLike = execFileSync;
let cachedGitSha: string | null | undefined;
let cachedFileSha: string | null | undefined;

type ReadFileLike = (path: string) => string;
let readFileImpl: ReadFileLike = (path) => readFileSync(path, 'utf8');

export function _setExecForTests(impl: ExecLike | null): void {
  execImpl = impl ?? execFileSync;
  cachedGitSha = undefined;
  cachedFileSha = undefined;
}

// MATCH-CLOSE G4 — the same seam as _setExecForTests, for the stamp
// file. Without it a BUILD_SHA file sitting in the developer's working
// tree (which is exactly where stamp-build-sha.command puts it) would
// win over the git rung and make the "nothing identifies this build"
// cases untestable. Pass a reader that throws to simulate no stamp.
export function _setReadFileForTests(impl: ReadFileLike | null): void {
  readFileImpl = impl ?? ((path) => readFileSync(path, 'utf8'));
  cachedFileSha = undefined;
}

// The install root relative to where the server is started. The pilot
// runbook starts it from packages/server (`cd $BIMOTO_HOME/packages/server`),
// a repo checkout may start it from the root; both are checked.
const BUILD_SHA_FILE_CANDIDATES = ['BUILD_SHA', '../../BUILD_SHA'];

function fileSha(): string | null {
  if (cachedFileSha !== undefined) return cachedFileSha;
  cachedFileSha = null;
  for (const candidate of BUILD_SHA_FILE_CANDIDATES) {
    try {
      const raw = readFileImpl(resolve(process.cwd(), candidate)).trim();
      // A stamp file that exists but is empty or blank is treated as
      // absent, so a half-written bundle cannot report a blank version.
      if (raw) {
        cachedFileSha = raw.split(/\s+/)[0];
        break;
      }
    } catch {
      // Missing or unreadable — try the next candidate.
    }
  }
  return cachedFileSha;
}

function gitShortSha(): string | null {
  if (cachedGitSha !== undefined) return cachedGitSha;
  try {
    // rev-parse succeeds exactly when a .git directory exists here or up
    // the tree; anywhere else (the pilot's zip deploy) it exits non-zero.
    const out = execImpl('git', ['rev-parse', '--short=7', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    });
    cachedGitSha = out.toString().trim() || null;
  } catch {
    cachedGitSha = null;
  }
  return cachedGitSha;
}

export function resolveBuildCommit(): string {
  const fromEnv = process.env.BUILD_SHA || process.env.RENDER_GIT_COMMIT;
  if (fromEnv) return fromEnv.slice(0, 7);
  const fromFile = fileSha();
  if (fromFile) return fromFile.slice(0, 7);
  return gitShortSha() ?? 'unknown';
}
