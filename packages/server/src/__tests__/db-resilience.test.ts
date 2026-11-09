// DB-RESILIENCE G6 — the retry helper's contract: retry P1001-class
// connection failures with a bounded ceiling, retry NOTHING else, and
// never re-run a job body that has already started.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
}));

import prisma from '../prisma';
import { withDbRetry } from '../services/db-resilience';
import { isDbConnectionError, isDbUnreachableError } from '../services/db-errors';
import { withJobLock } from '../services/job-lock';

const disconnect = prisma.$disconnect as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;

// Prisma surfaces connection failures as errors carrying a code
// (PrismaClientKnownRequestError.code) or errorCode
// (PrismaClientInitializationError.errorCode).
function p1001(): Error {
  const err = new Error("Can't reach database server at `localhost:5432`");
  (err as Error & { code: string }).code = 'P1001';
  return err;
}

function prismaError(code: string): Error {
  const err = new Error(`prisma error ${code}`);
  (err as Error & { code: string }).code = code;
  return err;
}

// Fast schedule so real timers stay in the microsecond range.
const fast = { baseDelayMs: 1, maxDelayMs: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('isDbConnectionError', () => {
  it('recognises P1001 and P1002 via code or errorCode', () => {
    expect(isDbConnectionError(p1001())).toBe(true);
    expect(isDbConnectionError(prismaError('P1002'))).toBe(true);
    const init = new Error("Can't reach database server at `localhost:5432`");
    (init as Error & { errorCode: string }).errorCode = 'P1001';
    expect(isDbConnectionError(init)).toBe(true);
  });

  it('rejects the ambiguous and the unrelated: P1017, P1008, P2024, plain errors', () => {
    expect(isDbConnectionError(prismaError('P1017'))).toBe(false);
    expect(isDbConnectionError(prismaError('P1008'))).toBe(false);
    expect(isDbConnectionError(prismaError('P2024'))).toBe(false);
    expect(isDbConnectionError(new Error('connection refused'))).toBe(false);
    expect(isDbConnectionError(null)).toBe(false);
  });

  it('isDbUnreachableError additionally accepts P1017 (presentation/pool-reset only)', () => {
    expect(isDbUnreachableError(prismaError('P1017'))).toBe(true);
    expect(isDbUnreachableError(p1001())).toBe(true);
    expect(isDbUnreachableError(prismaError('P2002'))).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('retries P1001 and returns the eventual success', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(p1001())
      .mockRejectedValueOnce(p1001())
      .mockResolvedValueOnce('healed');
    await expect(withDbRetry('test-op', fn, fast)).resolves.toBe('healed');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt ceiling and rethrows the last error', async () => {
    const fn = jest.fn().mockRejectedValue(p1001());
    await expect(withDbRetry('test-op', fn, { ...fast, maxAttempts: 3 })).rejects.toThrow(
      "Can't reach database server",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-connection error — it throws on the first attempt', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('unique constraint violation'));
    await expect(withDbRetry('test-op', fn, fast)).rejects.toThrow('unique constraint');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry P1017 (server closed the connection — statement may have committed)', async () => {
    const fn = jest.fn().mockRejectedValue(prismaError('P1017'));
    await expect(withDbRetry('test-op', fn, fast)).rejects.toThrow('P1017');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets the connection pool between attempts so retries get fresh sockets', async () => {
    // The reset is rate-limited to one per second across the process, so
    // let the window from earlier tests' retries expire first.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const fn = jest.fn().mockRejectedValueOnce(p1001()).mockResolvedValueOnce('ok');
    await withDbRetry('test-op', fn, fast);
    expect(disconnect).toHaveBeenCalled();
  }, 10_000);

  it('honours the shouldRetry veto even for a connection error', async () => {
    const fn = jest.fn().mockRejectedValue(p1001());
    await expect(
      withDbRetry('test-op', fn, { ...fast, shouldRetry: () => false }),
    ).rejects.toThrow("Can't reach database server");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withJobLock retry boundary', () => {
  it('retries when the connection fails before fn starts', async () => {
    const fn = jest.fn().mockResolvedValue('tick-done');
    transaction
      .mockRejectedValueOnce(p1001())
      .mockImplementationOnce(async (cb: any) =>
        cb({ $queryRaw: async () => [{ acquired: true }] }),
      );
    await expect(withJobLock('test.job', fn)).resolves.toBe('tick-done');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('does NOT retry once fn has started — a mid-job P1001 propagates and fn runs once', async () => {
    const fn = jest.fn().mockRejectedValue(p1001());
    transaction.mockImplementation(async (cb: any) =>
      cb({ $queryRaw: async () => [{ acquired: true }] }),
    );
    await expect(withJobLock('test.job', fn)).rejects.toThrow("Can't reach database server");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
