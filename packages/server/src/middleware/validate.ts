import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { OUTSIDE_OPERATION_AREA_KEY } from '@bimoto/shared';

// The workspace can resolve more than one copy of zod (the server's CJS
// copy vs the ESM copy the built @bimoto/shared schemas close over), and
// `instanceof` fails across instances — which used to turn a plain
// validation failure into a 500 INTERNAL_ERROR. Detect zod errors
// structurally as the fallback.
function isZodError(err: unknown): err is ZodError {
  return (
    err instanceof ZodError ||
    (err instanceof Error && err.name === 'ZodError' && Array.isArray((err as ZodError).issues))
  );
}

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data;
      next();
    } catch (err) {
      if (isZodError(err)) {
        // FIELD-FIT G3 — one validation failure gets its own name
        // because it is the only one a passenger can hit by doing
        // something perfectly reasonable: asking for a ride outside the
        // area the pilot serves. Everything else keeps the generic
        // VALIDATION_ERROR shape, details included, exactly as before.
        const outsideArea = err.issues.some(
          (issue) => issue.message === OUTSIDE_OPERATION_AREA_KEY,
        );
        res.status(400).json({
          error: {
            code: outsideArea ? 'OUTSIDE_OPERATION_AREA' : 'VALIDATION_ERROR',
            message: outsideArea ? OUTSIDE_OPERATION_AREA_KEY : 'errors.validation',
            details: err.issues,
          },
        });
        return;
      }
      next(err);
    }
  };
}
