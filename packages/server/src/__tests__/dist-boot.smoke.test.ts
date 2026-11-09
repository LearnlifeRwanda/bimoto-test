import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard: spawn the *built* dist/index.js with valid env and
 * assert it boots, stays up, and shuts down cleanly.
 *
 * Catches the class of bug that bit Dispatch R1: when the package's
 * `start` script switched from `tsx src/index.ts` to `node dist/index.js`,
 * an ESM-resolution failure in @bimoto/shared (extensionless relative
 * imports) crashed the process before listen() could fire — but every
 * unit test still passed because ts-jest never exercises dist/.
 *
 * TRUE-WORDS G5.4 — this test used to guess about milliseconds. It sent
 * SIGTERM, slept 200 ms, and then asserted `exitCode === null` — that is,
 * that the process had NOT yet finished dying. On a fast machine the exit
 * event lands inside those 200 ms and the assertion fails on perfectly
 * healthy code; in CI it passed on timing luck. The still-alive check now
 * samples the exit state at the END of the boot window, BEFORE any signal
 * is sent, where "did it stay up on its own steam" is the actual question.
 * Shutdown is then verified by awaiting the real exit event rather than a
 * sleep, which also turns a former blind spot into coverage: dist/ now has
 * to shut down the way shutdown.ts promises — every worker stopped, server
 * closed, Prisma disconnected, exit 0.
 *
 * GROUNDSKEEPER G4 — this note used to read "CI runs `pnpm build` first,
 * so the file is present in CI". No workflow built @bimoto/server, so
 * existsSync was false on every CI run and describeBoot resolved to
 * describe.skip: the guard for a crash class unit tests provably cannot
 * see had never once executed against a pull request. The jest job now
 * builds the server before the suite, and asserts the suite ran rather
 * than trusting this comment again — see .github/workflows/server-tests.yml.
 *
 * Still skipped when dist/ is absent, which is the right local behaviour:
 * a developer running one unrelated test file should not be made to wait
 * for a build. In CI the build step makes the skip unreachable.
 */

const DIST_INDEX = resolve(__dirname, '..', '..', 'dist', 'index.js');
const BOOT_LOG = 'Bimoto server running';
const SHUTDOWN_ACK = 'Received SIGTERM, shutting down...';
const SHUTDOWN_DONE = 'Shutdown complete.';
// Window long enough to import the full module graph (Prisma + jobs +
// routes) on a slow CI runner. Two seconds was tight; four is safe.
const BOOT_WINDOW_MS = 4000;
// Generous ceiling for the shutdown sequence. The handler's own force-exit
// timer fires at 10s, so anything under that is the handler working; this
// only has to be longer than the handler, never a guess about how fast the
// machine is.
const SHUTDOWN_TIMEOUT_MS = 15000;

const env = {
  ...process.env,
  NODE_ENV: 'production',
  // Production-shape env so config.ts validates. The DB URL points
  // nowhere; the server boots and starts background jobs that fail
  // their first prisma call — we don't care, we only care that the
  // process didn't crash on import.
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/bimoto_smoke',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY: 'c'.repeat(64),
  PORT: '0', // OS assigns a free port; nothing else listens on it
  // Don't ship Sentry events from a smoke test.
  SENTRY_DSN: '',
  // GROUNDSKEEPER G2 — production-shape now includes a live-SMS credential:
  // startup-guard.ts refuses to boot a production server on SMS_MODE=live
  // with no AT_API_KEY (it would swallow every OTP and report success).
  // The value is never used — the Africa's Talking SDK is lazy-initialised
  // and this process sends nothing — it only has to be non-empty, exactly
  // as DATABASE_URL above only has to be well-formed.
  AT_API_KEY: 'smoke-test-not-a-real-key',
};

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const describeBoot = existsSync(DIST_INDEX) ? describe : describe.skip;

describeBoot('dist/index.js boots cleanly', () => {
  test(
    'stays alive through boot, logs, then exits 0 on SIGTERM',
    async () => {
      const child = spawn('node', [DIST_INDEX], { env, stdio: 'pipe' });

      let stdout = '';
      let stderr = '';
      // Held in an object so no assertion can be narrowed away by the
      // compiler: `exit.value` is genuinely unknown until the event fires.
      const exit: { value: Exit | null } = { value: null };

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const exited = new Promise<Exit>((res) => {
        child.on('exit', (code, signal) => {
          exit.value = { code, signal };
          res({ code, signal });
        });
      });

      try {
        await new Promise((r) => setTimeout(r, BOOT_WINDOW_MS));

        const combined = () => `${stdout}\n---STDERR---\n${stderr}`;

        // 1. The process must not have exited under its own steam during
        //    the boot window. Sampled here, before any signal is sent —
        //    which is the only point at which "it stayed up by itself" is
        //    a question about the code and not about scheduling.
        expect({ exitedDuringBoot: exit.value, combined: combined() }).toEqual(
          expect.objectContaining({ exitedDuringBoot: null }),
        );

        // 2. The headline log line means listen() succeeded, which in turn
        //    means the entire import graph resolved.
        expect(stdout).toContain(BOOT_LOG);

        // 3. Most informative regression check: the exact failure mode that
        //    motivated this test must not appear.
        expect(stderr).not.toContain('ERR_MODULE_NOT_FOUND');

        // 4. Graceful shutdown. Wait for the real exit event — no sleep, so
        //    the result is the same on a fast laptop and a slow CI runner.
        child.kill('SIGTERM');

        let timer: NodeJS.Timeout | undefined;
        const result = await Promise.race([
          exited,
          new Promise<never>((_, rej) => {
            timer = setTimeout(
              () => rej(new Error(`dist/index.js did not exit within ${SHUTDOWN_TIMEOUT_MS}ms of SIGTERM.\n${combined()}`)),
              SHUTDOWN_TIMEOUT_MS,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        // shutdown.ts exits 0 once every worker is stopped, the server is
        // closed and Prisma is disconnected. A signal instead of a code
        // means the handler never ran; code 1 means its force-exit timer
        // fired or something threw on the way out.
        expect({ ...result, combined: combined() }).toEqual(
          expect.objectContaining({ code: 0, signal: null }),
        );
        expect(stdout).toContain(SHUTDOWN_ACK);
        expect(stdout).toContain(SHUTDOWN_DONE);
      } finally {
        if (exit.value === null) child.kill('SIGKILL');
      }
    },
    BOOT_WINDOW_MS + SHUTDOWN_TIMEOUT_MS + 10_000,
  );
});
