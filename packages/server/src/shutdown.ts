// DB-RESILIENCE G3 — a complete, idempotent shutdown. The old handler
// stopped three of twenty-one background workers and never exited, so
// every Ctrl+C left seventeen job timers and the whole connection pool
// running. This module owns the sequence: stop every worker, close the
// HTTP server, disconnect Prisma, exit — bounded by a timeout so a hung
// close can never block exit forever. Kept dependency-injected so the
// sequence is unit-testable without binding a port.

export interface ShutdownDeps {
  /** Every background worker's stop function (jobs + cleanup timers). */
  stopWorkers: Array<() => void>;
  /** server.close-shaped: invokes cb once open connections have drained. */
  closeServer: (cb: (err?: Error) => void) => void;
  disconnectDb: () => Promise<void>;
  exit: (code: number) => void;
  /** Hard ceiling on the whole sequence (default 10s). */
  timeoutMs?: number;
}

export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => void {
  let shuttingDown = false;

  return (signal: string) => {
    if (shuttingDown) {
      console.log(`Received ${signal} — shutdown already in progress.`);
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);

    const timeoutMs = deps.timeoutMs ?? 10_000;
    const force = setTimeout(() => {
      console.error(`Shutdown did not complete within ${timeoutMs}ms — forcing exit.`);
      deps.exit(1);
    }, timeoutMs);
    force.unref?.();

    for (const stop of deps.stopWorkers) {
      try {
        stop();
      } catch (err) {
        console.error('Failed to stop a background worker:', err);
      }
    }

    deps.closeServer((err?: Error) => {
      if (err) console.error('HTTP server close failed:', err);
      deps
        .disconnectDb()
        .catch((dbErr) => console.error('Prisma disconnect failed:', dbErr))
        .then(() => {
          clearTimeout(force);
          console.log('Shutdown complete.');
          deps.exit(0);
        });
    });
  };
}
