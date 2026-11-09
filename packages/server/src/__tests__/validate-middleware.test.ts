// Regression test for the e2e 500: the workspace can resolve two copies
// of zod (server CJS vs the ESM copy built @bimoto/shared schemas close
// over). A ZodError thrown by the "other" copy fails `instanceof` and
// used to fall through to the generic 500 handler. Validation failures
// must always answer 400 VALIDATION_ERROR.

import { z } from 'zod';
import { validate } from '../middleware/validate';
import { createJourneySchema, OUTSIDE_OPERATION_AREA_KEY } from '@bimoto/shared';

function run(schema: any, body: unknown) {
  const req: any = { body };
  let statusCode: number | undefined;
  let jsonBody: any;
  const res: any = {
    status(s: number) {
      statusCode = s;
      return this;
    },
    json(b: unknown) {
      jsonBody = b;
      return this;
    },
  };
  let nextErr: unknown = 'not-called';
  validate(schema)(req, res, (err?: unknown) => {
    nextErr = err;
  });
  return { statusCode, jsonBody, nextErr, req };
}

describe('validate middleware', () => {
  const schema = z.object({ otp: z.string().length(6) });

  test('passes a valid body through', () => {
    const { nextErr, req } = run(schema, { otp: '123456' });
    expect(nextErr).toBeUndefined();
    expect(req.body.otp).toBe('123456');
  });

  test('same-instance ZodError answers 400 VALIDATION_ERROR', () => {
    const { statusCode, jsonBody } = run(schema, { otp: 'way-too-long-not-six' });
    expect(statusCode).toBe(400);
    expect(jsonBody.error.code).toBe('VALIDATION_ERROR');
  });

  test('cross-instance ZodError (instanceof fails) still answers 400, not 500', () => {
    // Simulate a ZodError thrown by a different zod module instance: a
    // plain Error carrying the ZodError shape but not our prototype.
    const foreignZodError = new Error('validation failed');
    foreignZodError.name = 'ZodError';
    (foreignZodError as any).issues = [
      { code: 'too_big', maximum: 6, path: ['otp'], message: 'OTP must be 6 digits' },
    ];
    const throwingSchema = {
      parse() {
        throw foreignZodError;
      },
    };
    const { statusCode, jsonBody, nextErr } = run(throwingSchema, { otp: 'x'.repeat(64) });
    expect(statusCode).toBe(400);
    expect(jsonBody.error.code).toBe('VALIDATION_ERROR');
    expect(jsonBody.error.details).toHaveLength(1);
    expect(nextErr).toBe('not-called'); // never reached the 500 handler
  });

  // FIELD-FIT G3 — booking outside Kigali used to answer with the raw
  // zod dump ("Number must be less than or equal to -1.85"), which is
  // what the team meant by it "gets an error". The bounds rule is
  // unchanged; the answer now carries a code and a message key the
  // client renders in the person's own language.
  describe('out-of-area bookings are named, not dumped', () => {
    test('a coordinate outside the operation area answers OUTSIDE_OPERATION_AREA', () => {
      const { statusCode, jsonBody } = run(createJourneySchema, {
        type: 'PASSENGER',
        pickupLat: -1.4998, // Musanze
        pickupLng: 29.6339,
        pickupName: 'Musanze town',
        destinationLat: -1.9536,
        destinationLng: 30.0606,
        destinationName: 'Kigali Heights',
      });
      expect(statusCode).toBe(400);
      expect(jsonBody.error.code).toBe('OUTSIDE_OPERATION_AREA');
      expect(jsonBody.error.message).toBe(OUTSIDE_OPERATION_AREA_KEY);
      // The zod detail is still there for logs and the error ledger.
      expect(jsonBody.error.details.length).toBeGreaterThan(0);
    });

    test('a destination outside the area is named too', () => {
      const { jsonBody } = run(createJourneySchema, {
        type: 'PASSENGER',
        pickupLat: -1.9536,
        pickupLng: 30.0606,
        pickupName: 'Kigali Heights',
        destinationLat: -2.5967, // Huye
        destinationLng: 29.7394,
        destinationName: 'Huye',
      });
      expect(jsonBody.error.code).toBe('OUTSIDE_OPERATION_AREA');
    });

    test('an ordinary validation failure keeps the generic shape', () => {
      const { jsonBody } = run(createJourneySchema, {
        type: 'PASSENGER',
        pickupLat: -1.9536,
        pickupLng: 30.0606,
        // pickupName missing
        destinationLat: -1.9706,
        destinationLng: 30.1044,
        destinationName: 'Kicukiro',
      });
      expect(jsonBody.error.code).toBe('VALIDATION_ERROR');
    });

    test('a booking wholly inside Kigali passes', () => {
      const { nextErr } = run(createJourneySchema, {
        type: 'PASSENGER',
        pickupLat: -1.9536,
        pickupLng: 30.0606,
        pickupName: 'Kigali Heights',
        destinationLat: -1.9706,
        destinationLng: 30.1044,
        destinationName: 'Kicukiro Centre',
      });
      expect(nextErr).toBeUndefined();
    });
  });

  test('non-zod errors still propagate to the error handler', () => {
    const boom = new Error('boom');
    const throwingSchema = {
      parse() {
        throw boom;
      },
    };
    const { statusCode, nextErr } = run(throwingSchema, {});
    expect(statusCode).toBeUndefined();
    expect(nextErr).toBe(boom);
  });
});
