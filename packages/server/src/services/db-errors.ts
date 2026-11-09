// DB-RESILIENCE G2 — recognising "the query never reached the server".
//
// Retrying is only safe when the failure provably happened BEFORE the
// statement reached Postgres, i.e. while establishing a connection:
//
// - P1001: can't reach the database server. The exact error from the
//   pilot-Mac sleep incident — every socket in the pool died while
//   Postgres itself stayed healthy.
// - P1002: the server was reached but the connection timed out during
//   establishment. Still pre-query.
//
// Deliberately NOT treated as retryable:
//
// - P1017 (server has closed the connection): ambiguous — the statement
//   may have reached the server and committed before the close, so a
//   retry could double-execute it. It IS still an unavailability signal
//   (see isDbUnreachableError below): live-fire testing shows P1017 is
//   the FIRST error after the database disappears under an established
//   pool — dead sockets fail with P1017 before fresh connection
//   attempts start failing with P1001.
// - P1008 (operations timed out): the operation may have run.
// - P2024 (pool timeout): a local starvation signal, not a dead server;
//   retrying adds load to an already-starved pool.
// - Everything else: not a connection problem.
//
// Duck-typed rather than instanceof so the error-handler middleware can
// use this without pulling in Prisma's error classes:
// PrismaClientKnownRequestError carries `.code`,
// PrismaClientInitializationError carries `.errorCode` (and, in the
// versions where that field is absent, a stable message prefix).

const CONNECTION_ERROR_CODES = new Set(['P1001', 'P1002']);

export function isDbConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { code, errorCode, name, message } = err as {
    code?: unknown;
    errorCode?: unknown;
    name?: unknown;
    message?: unknown;
  };
  if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
  if (typeof errorCode === 'string' && CONNECTION_ERROR_CODES.has(errorCode)) return true;
  return (
    name === 'PrismaClientInitializationError' &&
    typeof message === 'string' &&
    message.includes("Can't reach database server")
  );
}

/**
 * Broader than isDbConnectionError: also true for P1017 (server closed
 * the connection). Safe ONLY for non-retry decisions — mapping a
 * request to 503, marking the outage window in health state, resetting
 * the dead pool. Never use this to decide a retry: a P1017 statement
 * may already have committed.
 */
export function isDbUnreachableError(err: unknown): boolean {
  if (isDbConnectionError(err)) return true;
  return dbErrorCode(err) === 'P1017';
}

/** The Prisma error code carried by `err`, if any (for logging/health). */
export function dbErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const { code, errorCode } = err as { code?: unknown; errorCode?: unknown };
  if (typeof code === 'string') return code;
  if (typeof errorCode === 'string') return errorCode;
  return null;
}
