import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { isDbUnreachableError } from '../services/db-errors';

export class AppError extends Error {
  constructor(public statusCode: number, public code: string, public i18nMessage: string, public details?: unknown) {
    super(i18nMessage);
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.i18nMessage, details: err.details },
    });
    return;
  }
  // VALIDATE-MEND G4 — an 11 MB KYC photo is not a server fault.
  //
  // multer enforces `limits.fileSize` before the route body runs and
  // calls next(err) with a MulterError. There was no branch for it
  // anywhere in the repo (#186 §8.4 measured this on both multer majors
  // and pinned it deliberately), so LIMIT_FILE_SIZE fell through to the
  // generic handler below: a motari uploading his licence from a phone
  // camera got `500 INTERNAL_ERROR`, which the client honestly renders
  // as "Bimoto has a problem, not your phone" — the exact opposite of
  // the truth. His file was too large and nobody told him.
  //
  // It sits here rather than in the two routes' own catches because
  // multer rejects BEFORE the handler: neither route body ever runs, so
  // neither catch can see it. Both upload paths (KYC documents in
  // user.routes, journey photos in upload.routes) are covered by this
  // one branch, and both keep the AppError response shape the client's
  // error presenter already reads.
  //
  // 413 for the size limit, which is what the status means. Every other
  // MulterError is a malformed request, not a server fault, so 400 with
  // its own code rather than a second unnamed 500. The code is carried
  // verbatim so a log names the real cause.
  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'FILE_TOO_LARGE' : err.code,
        message: tooLarge ? 'errors.fileTooLarge' : 'errors.uploadRejected',
      },
    });
    return;
  }
  // DB-RESILIENCE G4 — an unreachable database is an outage, not a bug:
  // answer 503 with a distinct code so it never reads as INTERNAL_ERROR.
  // Includes P1017 (what dead pooled sockets throw first): this is a
  // status mapping, not a retry, so P1017's may-have-committed
  // ambiguity is irrelevant here. The client already renders every 5xx
  // as "Bimoto has a problem, not your phone"
  // (lib/api-error-presenter.ts), so no client change is needed;
  // errors.serverProblem is that same honest, existing string.
  if (isDbUnreachableError(err)) {
    console.error(`[DB-RESILIENCE] ${new Date().toISOString()} request failed: database unreachable:`, err.message);
    res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'errors.serverProblem' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'errors.generic' } });
}
