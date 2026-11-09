// DB-RESILIENCE G6 — the shutdown sequence: stop every worker, close
// the server, disconnect the database, exit once — even when signalled
// twice — and force exit when a close hangs past the ceiling.

import { createShutdownHandler } from '../shutdown';

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeDeps(overrides: Partial<Parameters<typeof createShutdownHandler>[0]> = {}) {
  return {
    stopWorkers: [jest.fn(), jest.fn(), jest.fn()],
    closeServer: jest.fn((cb: (err?: Error) => void) => cb()),
    disconnectDb: jest.fn().mockResolvedValue(undefined),
    exit: jest.fn(),
    ...overrides,
  };
}

describe('createShutdownHandler', () => {
  it('stops all workers, closes the server, disconnects the DB, exits 0', async () => {
    const deps = makeDeps();
    const shutdown = createShutdownHandler(deps);
    shutdown('SIGINT');
    await flush();
    for (const stop of deps.stopWorkers) expect(stop).toHaveBeenCalledTimes(1);
    expect(deps.closeServer).toHaveBeenCalledTimes(1);
    expect(deps.disconnectDb).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second signal does not re-run the sequence or exit twice', async () => {
    const deps = makeDeps();
    const shutdown = createShutdownHandler(deps);
    shutdown('SIGINT');
    shutdown('SIGTERM');
    await flush();
    for (const stop of deps.stopWorkers) expect(stop).toHaveBeenCalledTimes(1);
    expect(deps.closeServer).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('one worker throwing does not prevent the others from stopping', async () => {
    const good = jest.fn();
    const deps = makeDeps({
      stopWorkers: [
        jest.fn(() => {
          throw new Error('timer already dead');
        }),
        good,
      ],
    });
    createShutdownHandler(deps)('SIGTERM');
    await flush();
    expect(good).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('a hung server close cannot block exit forever — the ceiling forces exit 1', async () => {
    const deps = makeDeps({
      closeServer: jest.fn(), // never invokes the callback
      timeoutMs: 20,
    });
    createShutdownHandler(deps)('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('a failing prisma disconnect still exits 0 (logged, not fatal)', async () => {
    const deps = makeDeps({
      disconnectDb: jest.fn().mockRejectedValue(new Error('pool wedged')),
    });
    createShutdownHandler(deps)('SIGINT');
    await flush();
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});
